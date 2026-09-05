# Raspberry Pi 5 運用手順

## 構成

本番BotをGCEから `ras-pi`（yone@192.168.1.245）へ移す。OSはDebian 13 / aarch64、既存のDocker 26.1.5・Compose 2.26.1とHome Assistantを維持する。ホストにNode.js/npmは不要。管理端末はNode.js 24、Git、gcloud、SSHを使用する。

| 項目 | 設定 |
|---|---|
| 配置先 / Compose project / service | `/home/yone/discord-bot` / `discord-bot` / `bot` |
| 配布元 | public GHCR `ghcr.io/yone-k/yone-discord-bot`、Piは匿名pull |
| 起動イメージ | `BOT_IMAGE=ghcr.io/yone-k/yone-discord-bot@sha256:<64桁>` を明示 |
| 設定 | `.env`、所有者yone、600。Git・イメージに入れない |
| 更新状態 | `.deploy-state/state`、秘密情報なし。手動でsourceしない |
| 自動起動 / ログ | `unless-stopped` / json-file、10m × 3 |
| health | `127.0.0.1:3000:3000`、HTTP成功かつJSONの `bot.ready === true` |

日常のhealth確認はSSH経由で行う。Docker 28未満で同一LANから到達する場合も許容し、LAN遮断のためのDocker更新・ファイアウォール追加は行わない。インターネット向けの受信経路は新設しない。

`deploy.yml` はmainのpushまたはmainへのworkflow_dispatchで、npm ci → check → test → ARM64ビルド・architecture検査 → GHCR公開を行う。SHAタグとmainタグは同じ成果物を指す。実行ID・再実行番号のラベルにより同じコミットの再ビルドも別ダイジェストになる。ジョブを直列化し、公開直前にmainと一致しないコミットは公開しない。

## 1. 切替準備

初回PRをレビュー・マージし、CI成功後にGHCRのパッケージ設定でvisibilityをpublicへ変更する。マージ・公開設定・Piへの配置・GCE停止は対象を確認して承認後に実行する。

事前に次を記録する。秘密値は記録しない。

- 現行GCEのproject・zone・instance、ブートディスク、サービスアカウント、稼働イメージのダイジェスト、旧コミット、Artifact Registry参照。
- GCEメタデータに `startup-script` と必要な `env-*` が存在すること。現在の `env-NODE_ENV` はproductionであることを照合する。
- 旧GCEデプロイジョブの待機・実行・再実行が残っていないこと。旧イメージを消すジョブやArtifact Registryの削除ポリシーを停止・除外し、7日間保護すること。
- 既存のリマインド1件とその予定時刻・対応するSheetsの行。切替後に実際の通知を確認できる日程を選ぶ。

PiではDockerの自動起動、yoneのdockerグループ、Compose v2、bash・flock・curl、NTP、空き容量、3000番の空き、外向きGHCR/GitHub/Discord/Google API接続を確認する。Home AssistantのコンテナIDと稼働状態を記録する。既存OS/Dockerの再インストールや全体pruneはしない。不足ツールがある場合のみ対象パッケージを追加する。

管理端末で、レビュー済みの**実際の40桁コミットSHA**を `deploy_commit` に設定して以下を実行する。可変のブランチ名を配置元にしない。

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes ras-pi \
  'install -d -m 700 /home/yone/discord-bot'
git archive "$deploy_commit" docker-compose.yml scripts/pi-update.sh scripts/install-pi-env.sh deploy/systemd \
  | ssh ras-pi 'tar -xf - -C /home/yone/discord-bot'
ssh ras-pi 'sudo install -m 644 /home/yone/discord-bot/deploy/systemd/discord-bot-update.* /etc/systemd/system/ && sudo systemctl daemon-reload'
```

unitの `systemd-analyze verify` を実施し、timerとserviceを無効・停止のままにする。新規unitなので未起動であることを確認する。すでに存在する場合は `sudo systemctl disable --now discord-bot-update.timer`、`sudo systemctl stop discord-bot-update.service` を実行して停止を確認する。Botはまだ起動しない。

認証を使わない一時Docker設定で、Piからイメージを事前取得する。以下はPi上で実行する。

```bash
anonymous_config=$(mktemp -d)
docker --config "$anonymous_config" pull --platform linux/arm64 ghcr.io/yone-k/yone-discord-bot:main
rm -r "$anonymous_config"
docker image inspect --format '{{.Os}}/{{.Architecture}} {{json .RepoDigests}}' ghcr.io/yone-k/yone-discord-bot:main
```

出力がlinux/arm64であることを確認し、GHCRのダイジェストと対応するCIコミットを記録する。以降、Piのシェルでは `export BOT_IMAGE='ghcr.io/yone-k/yone-discord-bot@sha256:実際の64桁'` を設定する。例示文字列は実際の値に置換する。初期化フラグは立てない。

## 2. 既存の認証情報を移送する

取得元はGCEインスタンスメタデータ。Google Sheets用サービスアカウント・鍵・Botトークンを継続し、新規発行しない。GitHub Secretsの読み出しは不要。

| GCE metadata key | Pi変数 |
|---|---|
| env-DISCORD_BOT_TOKEN | DISCORD_BOT_TOKEN |
| env-CLIENT_ID | CLIENT_ID |
| env-GOOGLE_SERVICE_ACCOUNT_EMAIL | GOOGLE_SERVICE_ACCOUNT_EMAIL |
| env-GOOGLE_SHEETS_SPREADSHEET_ID | GOOGLE_SHEETS_SPREADSHEET_ID |
| env-GOOGLE_PRIVATE_KEY_B64 | デコードしてGOOGLE_PRIVATE_KEY |
| env-NODE_ENV | 照合後、productionを設定 |

管理端末のリポジトリで `gce_project`・`gce_zone`・`gce_instance` と `BOT_IMAGE` を照合済みの実値に設定する。次のブロックはbashで実行する。`set -x` は使わない。

```bash
(
  set -euo pipefail
  set +x
  config=$(gcloud compute instances describe "$gce_instance" \
    --project "$gce_project" --zone "$gce_zone" --format=json \
    | node scripts/pi-env.mjs)
  printf '%s\n' "$config" | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes ras-pi \
    "BOT_IMAGE='$BOT_IMAGE' bash /home/yone/discord-bot/scripts/install-pi-env.sh"
)
```

変換は必須項目・Base64・鍵のヘッダーを検証してから出力する。秘密値はSSHの標準入力だけに渡り、コマンド引数や履歴に載らない。鍵は1行の `\n` 表現にし、Composeの補間文字・引用符・バックスラッシュをエスケープする。既存Configが実改行へ戻す。Pi側は600の一時ファイルを完全性・Compose構文検証後に置換し、失敗時は既存.envを保持する。

`stat -c '%U %a' /home/yone/discord-bot/.env` で `yone 600` を確認する。内容や `docker compose config` の全出力、全項目の `docker inspect` はログへ出さない。検証は `docker compose config --quiet` を使う。`BOT_ENV_FILE` は検証時の一時.env指定用で、通常運用では未設定にする。

## 3. GCE停止 → Pi起動 → 受入

停止対象と時間を承認後、管理端末で実行する。数分の停止を許容する。

```bash
gcloud compute instances stop "$gce_instance" --project "$gce_project" --zone "$gce_zone"
gcloud compute instances describe "$gce_instance" --project "$gce_project" --zone "$gce_zone" --format='value(status)'
```

**TERMINATEDを確認してから**Piを起動する。HTTP疎通不可だけでは停止確認としない。Pi上で:

```bash
cd /home/yone/discord-bot
docker compose -p discord-bot config --quiet
docker compose -p discord-bot up -d --no-build --pull never bot
curl --fail --silent http://localhost:3000/health
docker inspect --format '{{.Config.Image}} {{.State.Health.Status}}' "$(docker compose -p discord-bot ps -q bot)"
```

起動から最大5分以内に `bot.ready: true` とhealthyを確認する。運用者が同じ本番BotでSheetsアクセス、`/ping`応答、事前選定したリマインドの実送信とSheetsの通知状態更新を確認する。対象・予定時刻・送信・更新の結果を記録する。リマインド予定時刻までの待機は5分の起動期限とは別。確認用Botや追加リマインドを作らない。

すべての受入が成功してから、Pi上で実際の正常ダイジェストを登録する。登録はコンテナを再作成しない。

```bash
bash scripts/pi-update.sh --initialize "$BOT_IMAGE"
bash scripts/pi-update.sh --status
sudo systemctl enable --now discord-bot-update.timer
systemctl list-timers discord-bot-update.timer
journalctl -u discord-bot-update.service --since today --no-pager
```

初期登録失敗時はtimerを有効にしない。定期実行の正常動作を確認し、全受入とtimer有効化の成功時刻を記録する。この時刻を7日間保持の起点とする。

## 4. 通常更新とPi内復旧

timerは有効化から5分後、その後はservice終了から5分後に実行する。長いpullや切戻しの後にも次回を予約し、実行中は重複起動しない。ネットワーク・pull失敗は稼働中Botを維持し、次回再試行する。mainが同じダイジェストなら再作成しない。変更時だけ最大5分でhealthを確認する。失敗時は候補を停止し、直前の正常版へ戻して最大5分検証する。停止失敗・切戻し失敗・中断・実体との不一致では自動更新をブロックする。

| 状態項目 | 意味 |
|---|---|
| current / previous | 最後に正常確認した版 / その直前の正常版 |
| rejected | 起動に失敗し、以後自動適用しないダイジェスト |
| blocked | 1なら運用者の復旧まで自動更新停止 |
| pending | 1なら置換処理が未完了。次回は推測せずブロック |
| initialized | 全初期受入後に1として登録済み |

正常版と直前の正常版のローカルイメージを保持する。自動pruneは行わない。容量整理時もこの2版は削除しない。同じ版の稼働中Botがunhealthyになっても、自動再起動する監視機構は追加していない。

障害調査は `--status`、journal、必要項目だけのinspect、アプリログを使う。Dockerエラーの全出力は秘密値を含み得るため、更新処理は分類名だけをjournalに記録する。

稼働中Botを維持したまま更新だけを固定する場合は `bash scripts/pi-update.sh --block` を使う。再開時は正常ダイジェストの `--recover` でhealthを確認して解除する。

手動復旧・設定変更の前はtimerを停止する。service停止により更新が中断した場合もpendingで検出する。

```bash
sudo systemctl disable --now discord-bot-update.timer
sudo systemctl stop discord-bot-update.service
bash scripts/pi-update.sh --status
# currentまたはpreviousから、保持済みの正常ダイジェストをBOT_IMAGEへ設定
bash scripts/pi-update.sh --recover "$BOT_IMAGE"
```

`--recover` はブロック中も利用可能。現在のBotを停止後、指定版を再作成してhealthyを確認し、成功時だけブロックを解除する。失敗時は停止のまま調査し、別版を同時起動しない。成功後にDiscord/Sheetsを確認してtimerを再有効化する。

失敗版を再試行する場合は原因修正後、非ブロック状態で `bash scripts/pi-update.sh --retry '失敗したGHCRダイジェスト'` を実行する。rejectedと一致する指定だけを解除し、その時点のmainを再評価する。mainが既に別版なら別版が対象になる。ブロック中はまず `--recover` を使う。

設定変更は同じ移送手順で.envを更新し、`--recover "$BOT_IMAGE"` で現在の正常版を明示的に再作成する。ホストのCompose/script/unit更新もtimer・service停止後、レビュー済みコミットから「切替準備」の配置手順で再配置し、daemon-reload・unit検証を行う。イメージ更新だけではホストファイルは変わらない。

状態ファイルが破損して読み込めない場合はtimerを停止したまま、記録したダイジェストと実コンテナを照合する。状態を退避し、明示ダイジェストのComposeで稼働・healthy・Discord/Sheetsを確認した後に `--initialize` で登録し直す。状態を削除しただけでtimerを再開しない。

## 5. GCEへの切戻し（保持期間中のみ）

初回受入失敗や移行不具合時、**Piを確実に停止してから**GCEを再起動する。Pi上で:

```bash
sudo systemctl disable --now discord-bot-update.timer
sudo systemctl stop discord-bot-update.service
cd /home/yone/discord-bot
docker compose -p discord-bot down
docker compose -p discord-bot ps -a -q
```

downの成功とコンテナが残っていないことを確認する。これによりPi再起動でもBotは復帰しない。停止が確認できなければGCEを起動しない。その後、管理端末でGCEをstartし、旧BotのDiscord/Sheets・healthを確認する。

```bash
gcloud compute instances start "$gce_instance" --project "$gce_project" --zone "$gce_zone"
```

旧 `gce-startup-script.sh` と `scripts/local-deploy.sh` は保持期間中に残すが、Piへ流用しない。旧スクリプトのログには秘密情報が含まれ得るため、全ログを共有しない。再度Piへ切替成功した時点から7日間を取り直す。

## 6. 7日保持・更新確認・GCP撤去

停止GCE・ブートディスク・startup/envメタデータ・旧Artifact Registryイメージ・必要な実行権限を成功時刻から7日以上保持する。停止中もディスクの費用は残る。

保持期間中に、Discord/Sheets・既存通知と状態更新・Home Assistantの継続稼働を記録する。timerで同じ版ならコンテナIDが変わらないことを確認する。次に承認を得てmainのworkflow_dispatchを1回実行し、新ダイジェストを次の5分周期で検知・更新して正常版に記録することを確認する。同じコードでもビルド実行ラベルによりダイジェストが変わるため、#36や追加コード変更を待つ必要はない。

7日経過・通常更新成功・未解決の移行不具合なしを確認した後、Bot専用と確認できた対象の削除一覧を提示し、承認後に撤去する。

| 候補 | 判定 |
|---|---|
| GCE instance / boot disk / 固定IP / firewall | 実在とBot専用性を個別照合 |
| Artifact Registry discord-bot-repo | 共有イメージがないことを確認 |
| 旧デプロイ用サービスアカウントと鍵 | Sheetsと共用なら維持 |
| GitHub Secrets GCP_PROJECT_ID / GCP_SERVICE_ACCOUNT_KEY | 他workflowとの共有がなければ削除 |

Google Sheets用サービスアカウント・鍵・API、GCPプロジェクト自体、共有リソース、GitHubの `GOOGLE_*`・`DISCORD_BOT_TOKEN`・`CLIENT_ID`・`GUILD_ID` は維持する。各候補を「削除」「共有のため維持」「存在なし」「保留」に分類し、保留のまま撤去完了としない。削除後はAPIで不存在とSheets継続を確認する。

撤去後、別の後片付けPRで旧GCEスクリプト2件を削除し、この文書の現行復旧案内をPi内復旧へ揃える。初回PRだけでIssue完了としない。

## ローカル検証

```bash
npm ci
npm run check
npm test
npm run build-only
bash -n scripts/pi-update.sh scripts/install-pi-env.sh scripts/publish-image.sh
docker buildx build --platform linux/arm64 --load -t discord-bot:check .
docker image inspect --format '{{.Os}}/{{.Architecture}} {{.Config.User}} {{json .Config.Healthcheck}}' discord-bot:check
```

テストにはDocker Compose CLIが必要（env解析だけなのでデーモンは不要）。Linuxでは実flockの競合も検証する。macOSでは `/bin/bash` のBash 3.2で更新処理を実行し、flock競合だけLinux CIへ委ねる。`npm run build` / `npm run dev` はDiscordコマンド登録を伴うため、この検証では実行しない。

参考: [Dockerのポート公開](https://docs.docker.com/engine/network/port-publishing/)、[Composeの補間](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)、[GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)。
