# Raspberry Pi 5 運用

Botは `ras-pi` の `/home/yone/discord-bot`、Compose project `discord-bot` で稼働する。PostgreSQLを唯一の保存先とし、外付けHDDとGoogle Driveの論理バックアップを使う。[PostgreSQL運用](postgres-operations.md) と [Sheetsからの切替](postgres-migration.md) に従う。#35のGCE→Pi移行は先行作業として完了している必要がある。

| 項目 | 設定 |
|---|---|
| 配布 | public GHCR `ghcr.io/yone-k/yone-discord-bot`、ARM64、匿名pull |
| 起動 | `BOT_IMAGE=ghcr.io/yone-k/yone-discord-bot@sha256:<64桁>` |
| health | `127.0.0.1:3000:3000`。HTTP200かつ `bot.ready === true`（Discord・DB・schema/移行状態を含む） |
| Bot DNS | `192.168.1.1`、`1.1.1.1`。ホスト設定は変更しない |
| 更新状態 | `.deploy-state/state`。データとして読み、shellへsourceしない |
| 更新経路 | CI公開後のTailscale/OpenSSH push、起動5分後と毎日05:00のtimer（#39） |
| ログ | Bot・DBともjson-file、10m×3 |

Home Assistant、Docker root、OS、既存Tailscale構成を保持する。Docker 28未満でloopback公開が同一LANから到達する場合も、LAN遮断のためのDocker更新やfirewall追加は行わない。インターネット向けの受信経路は新設しない。

## 配置と検証

フェーズAでコード・DB・移行・backup/restore・ARM64・独立レビューを完了する。個人利用のためDB準備中の停止を許容し、自動更新を停止せずCI成功後にmainへ先行マージする。DBや設定が未整備なら配布後の起動・更新は失敗し得る。実際のDB整備・データ移行は [切替手順](postgres-migration.md) に従って別途実施する。

管理端末でレビュー済みの実コミットを `deploy_commit` に設定する。以下はフェーズBのホストファイル配置であり、Botを起動しない。

```bash
git archive "$deploy_commit" docker-compose.yml scripts/pi-update.sh scripts/pi-ci-deploy.sh \
  scripts/pi-db-preflight.sh scripts/pi-db-init.sh scripts/pi-start.sh scripts/pi-backup.sh \
  scripts/pi-restore.sh scripts/install-pi-env.sh deploy \
  | ssh ras-pi 'tar -xf - -C /home/yone/discord-bot'
ssh ras-pi 'sudo install -m 644 /home/yone/discord-bot/deploy/systemd/discord-bot-* /etc/systemd/system/ && sudo systemctl daemon-reload'
```

Piでunitを `systemd-analyze verify` し、設定600、Compose `config --quiet`、UUID/ext4/write、匿名pullのlinux/arm64を確認する。CLIはイメージ内の `node dist/scripts/db-migrate.js` と `node dist/scripts/migrate-sheets-to-postgres.js` を専用Compose serviceで実行する。PiホストにNode/npmは不要。bash/flock/findmnt/python3/rcloneとDocker Composeは必要。

ホストファイルはイメージ更新では変わらない。変更時はCI・timerを停止し、レビュー済みコミットから再配置する。可変mainのシェルを定期処理で取得・実行しない。

## CIと通常更新

PRのCIは `npm ci → check → test → test:db → build-only`。main公開workflowはDB検証後、ARM64イメージを一度ビルドし、architecture・pg読込・CLI/DDL同梱・Google設定なしの起動検査・秘密ファイル非混入を確認してからSHA/mainタグを公開する。公開直前に現mainと一致しないコミットは公開・Pi接続をスキップする。公開処理を直列化し、古いコミットによるmainタグ上書きを防ぐ。

CIは公開成功後だけTailscaleへ一時接続し、制限付きOpenSSH鍵で `discord-bot-update.service` を同期起動する。CI成功は公開したダイジェストがPiでhealthyになったことを意味する。取りこぼしは起動時・日次timerで確認する。5分ごとのポーリングには戻さない。

updaterはflockで排他し、pull・構文・HDD・候補と現在版のschema互換を確認してからBotだけを入れ替える。schema変更やSheets版への切戻しは自動実行しない。通常更新失敗時は候補を停止し、直前の互換DB版へ戻す。各health期限は5分。失敗ダイジェストを記録して再適用を抑止する。切戻し失敗・停止失敗・中断・状態不一致はblockedを永続化する。同じダイジェストがunhealthyになっただけでは自動再起動しない。

| state | 意味 |
|---|---|
| current / previous | 最後の正常DB版 / 直前の正常DB版 |
| rejected | 自動再試行しない失敗ダイジェスト |
| blocked | 運用者が復旧するまで更新停止 |
| pending | 更新未完了。次回は推測せずブロック |
| initialized | 全受入後の初期登録完了 |

正常版と直前正常版を保持し、自動pruneは行わない。障害調査は `pi-update.sh --status`、必要項目だけのinspect、journal、アプリログを使う。展開済みenvやDocker inspect全体を共有しない。

## CI接続設定

既存 #39 の設定を維持する。

- PiのTailscaleは `--accept-dns=false`、`tag:discord-bot-pi`。OpenSSHを使い、Tailscale SSH/Funnel/subnet routeは有効にしない。
- tailnetの `deploy/tailscale/policy.hujson` は既存他用途を保って適用し、CIからPiのTCP22だけを許可する。
- OIDC issuerは `https://token.actions.githubusercontent.com`、subjectは `repo:yone-k/yone-discord-bot:ref:refs/heads/main`、custom claimは `workflow_ref=yone-k/yone-discord-bot/.github/workflows/deploy.yml@refs/heads/main`、scope `auth_keys` write、tag `tag:discord-bot-ci`。
- GitHub Secretsは `TS_OAUTH_CLIENT_ID`、`TS_AUDIENCE`、`PI_DEPLOY_SSH_KEY`。Variablesは `PI_TAILSCALE_HOST` と既存管理接続で照合済みの `PI_SSH_KNOWN_HOSTS`。
- yoneのauthorized_keysはCI鍵に `restrict,command="/bin/bash /home/yone/discord-bot/scripts/pi-ci-deploy.sh"` を付ける。任意コマンド・転送・鍵自動受入を許可しない。
- 入口は `deploy sha256:<64桁>` だけを受け、service完了後に `--verify` で実ダイジェスト・healthy・状態を照合する。

## 手動復旧と停止

```bash
cd /home/yone/discord-bot
touch .deploy-state/ci-disabled
sudo systemctl disable --now discord-bot-update.timer
bash scripts/pi-update.sh --block
systemctl is-active discord-bot-update.service
flock -n .deploy-state/lock true
```

`--block` の非0を無視しない。serviceが完了してから再実行し、blocked=1とlock解放を確認する。設定変更・復元ではbackup timerも停止する。

修正・再検証した**schema互換DB版**を明示して `bash scripts/pi-update.sh --recover "$BOT_IMAGE"` を実行する。成功時だけブロックを解除する。Sheets版やschema不一致は起動前に拒否する。失敗時はDBを保全してDB版の復旧を続ける。

受入後にci-disabledを削除してtimerを再開する。失敗版の再試行は `--retry <失敗ダイジェスト>` でrejectedを解除し、その時点のmainを再評価する。状態破損時はCI/timer停止を維持し、記録と実コンテナを照合して状態を退避し、既存正常DB版の `--initialize` で再登録する。状態削除だけで更新を再開しない。

DB版Botの初回起動指示後はSheets/GCEへ復帰しない。#35のGCE初回移行・7日保持・専用リソース撤去の記録は [DB移行前の手順](https://github.com/yone-k/yone-discord-bot/blob/46c9073/docs/raspberry-pi-deployment.md) とIssue #35を参照する。未完了なら本DB移行より先に完了する。
