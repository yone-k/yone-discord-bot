# SheetsからPostgreSQLへの切替

## フェーズA：実装完了ゲート

作業ブランチで `npm run check`、`npm test`、`npm run build-only` と、PostgreSQL 18の合成データ用コンテナを指定した `npm run test:db` を成功させる。`DATABASE_URL`・`TEST_DB_CONTAINER_ID` が未設定/利用不能ならDBテストは失敗させる。移行fixtureの全列・件数・順序・通知状態、UUID計画の再利用、除外・不整合・rollback、DB制約・競合、dump/restore、起動ガード、バックアップ外部境界、ARM64イメージを検証する。

独立コードレビューで修正必須指摘を解消し、このフェーズB手順もレビューする。**ここまで本番Sheetsを読まず、Pi・HDDを変更せず、mainへマージしない。** CIのイメージ公開・本番接続もゲート通過後である。

## フェーズB：準備

前提は #35 のPi移行が完了し、旧Sheets版がPiで正常稼働していること。現在の更新経路は #39 のCI pushと起動時・日次timerの両方である。フェーズAの完了記録を残す。

### mainへの先行マージ

個人利用のため、DB準備中のBot停止を許容し、自動更新を停止せずにPRのCI成功後にmainへマージする。マージによりDB版の公開・更新が始まり、DBや設定が未整備なら起動・更新が失敗し得る。マージ完了は本番データ移行の完了を意味しない。

以下はDB作業へ着手する際の保守手順であり、先行マージの条件ではない。先行配布後は稼働イメージと更新stateを確認してから作業を始める。

### 1. DB作業開始時の更新経路・稼働状態の確認

Pi上の `/home/yone/discord-bot` で:

```bash
mkdir -p .deploy-state
touch .deploy-state/ci-disabled
sudo systemctl disable --now discord-bot-update.timer
bash scripts/pi-update.sh --block
```

`--block` はupdaterと同じflockを取得する。この段階で稼働する旧版（46c9073）はロック競合でも終了コード0を返すため、終了コードだけでブロック完了と判断しない。実行中serviceが完了してから再実行し、**`.deploy-state/state` の `blocked=1` を直接確認する**。DB版のupdaterではこの競合を非0に修正している。途中の更新serviceを強制終了して新旧状態を推測しない。`systemctl is-active discord-bot-update.service` がinactiveになり、`flock -n .deploy-state/lock true` が成功すること、CIの進行中deployが終了したことを確認する。旧Botは停止しない。

旧イメージのダイジェスト、旧Compose、旧 `.env`、コマンド定義と `.deploy-state/state` を秘密設定ごとPi上の600/700の退避先へ保存する。旧Compose退避ファイルは同じproject `discord-bot` でbotだけを扱う。旧イメージをpruneしない。

先行マージで全CIゲートを通ったARM64ダイジェストを取得する。保守中のdeploy失敗と公開ゲート自体の失敗を区別する。レビュー済みコミットから [Pi配置手順](raspberry-pi-deployment.md) のホストファイルを配置する。DB版Botの起動要求を既に実行した場合は、以下のSheetsへの切戻し条件を満たさないものとしてDB側で復旧する。

### 2. DBとバックアップを整備する

[DB運用手順](postgres-operations.md) に従い、対象HDDの機種・容量・シリアルを照合してext4初期化、UUID/fstab、各設定、db-init→停止削除→通常db→ロール→DDL、Drive専用OAuth設定を行う。Home Assistantの稼働を照合する。

同じPostgreSQLコンテナ内に別DBを作り、合成データの保存・dump・Drive転送・再ダウンロード・新DBへのrestoreを実機確認する。管理URLと `POSTGRES_DB` の両方を隔離DBに設定した一時 `.env.db-admin.rehearsal` を使い、本番DBと混ぜない。バックアップの別設定で `DB_ADMIN_ENV_FILE` を当該ファイルに指定し、Composeのdbサービス環境も一時設定に合わせる。確認後は通常 `.env.db-admin` へ戻してdbを再作成する。Botは旧版のまま保持する。

この隔離DBの復元確認は、同じ `.env.storage` / `.env.backup` をexportしたシェルで `python3 -B deploy/postgres-backup.py --restore <実manifest名> discord_bot_rehearsal_restore` を実行する。CI・更新処理のブロックを保ち、存在しない隔離DB名を指定する。この操作は新DBだけを作り、稼働中の旧Sheets版Botへ触れない。本番DBの障害復旧はBot停止を確認する `pi-restore.sh` を使う。

### 3. 稼働中の原本でリハーサルする

移行用Google設定はmigrationサービスだけに渡す。PiのmigrationディレクトリはyoneのUID/GIDとComposeのOPS_UID/GIDを一致させる。

```bash
install -d -m 700 /srv/discord-bot-storage/migration/rehearsal-01
docker compose --profile migration run --rm --no-deps migration \
  --fetch --snapshot /migration/rehearsal-01/snapshot.json
docker compose --profile migration run --rm --no-deps migration \
  --snapshot /migration/rehearsal-01/snapshot.json --dry-run
```

snapshotごとに新しいサブディレクトリを作り、原本・UUID計画・レポートを同居させる。再取得時はrehearsal-02等の新しいディレクトリを使う。異なるSHAの入力に既存migration-plan.jsonを流用しない。同じ固定入力の再実行だけ同じ計画を使う。

`--report` は既存ファイルを上書きしない。再実行ではsnapshotとplanを維持し、report名だけ新しくするか、`--report` を省略して時刻とUUIDを含む一意名を自動生成する。

`--fetch` はSheetsの読み取りだけで、既存snapshotを上書きしない。`--dry-run` は検査とレポートだけでDBを書かない。未知シート・孤立データ・メタデータ参照切れを除外扱いにしない。旧形式・重複・不正日付/数値/JSON/参照等の指摘を解消するまで本番切替へ進まない。既知の `remind_list_<id>_backup_<timestamp>` だけを除外する。

合格入力を**別実行で `--dry-run` を付けず**隔離DBへ取り込む。秘密URLを引数に入れず、隔離DBを指す `.env.db-admin.rehearsal` を `DB_ADMIN_ENV_FILE` に指定する。CLIは `DATABASE_ADMIN_URL` を使用する。

```bash
DB_ADMIN_ENV_FILE=.env.db-admin.rehearsal docker compose --profile migration run --rm --no-deps migration \
  --snapshot /migration/rehearsal-01/snapshot.json
```

取り込み・全項目比較、dump/restore、旧Bot再開まで含む所要時間を測る。旧Bot停止からDB版起動指示または旧Bot再開まで30分に収まらなければ延期する。圧縮dumpの実サイズ×3、転送直後4世代と再ダウンロード領域のHDD/Drive空き容量を確認する。稼働中のsnapshotは本番取込には使わない。

### 4. 旧在庫形式を解消する

原本を別snapshotに保全してから、旧Botの `/migrate-inventory` を在庫チャンネルごとに実行する。コンフリクト報告と自動的に最大値を採用した在庫数を確認・必要なら修正する。「既に移行済み」は正常スキップとする。新snapshotで再検査して旧形式0件、空/存在しないinventoryId 0件、未処理・不整合0件を確認する。DB版はこのコマンドや旧形式パーサーを持たない。

## 停止枠内の切替

事前に既存リマインドの検証対象1件と予定時刻、移行前の全機能の表示・件数・通知状態を記録する。Botと手動Sheets編集を止める。更新ブロックは継続する。

5. 停止時刻を記録し、旧Compose・旧env・旧ダイジェストで **botだけ**を停止する。`docker compose ... stop bot` の成功と実コンテナ非稼働を確認する。`down` でDBまで止めない。
6. HDDのmigration配下に `final-<時刻>` ディレクトリを700で新規作成し、`--fetch --snapshot /migration/final-<時刻>/snapshot.json` を実行する。SHA-256を記録し、`--dry-run` 合格後、同じ入力を空の本番DBへ `--dry-run` なしで取り込む。移行レポートの全項目・件数・表示順・通知状態の差分ゼロと完了マーカーを確認する。`migration-plan.json` とレポートを原本と一緒にHDDへ保持する。既存業務データへの追記・上書き、未処理の無視、欠落の自動補正はしない。
7. 新DB版の `BOT_IMAGE` を指定して `bash scripts/pi-backup.sh` を実行し、初回の本番dump/manifest転送と再ダウンロード照合の成功を記録する。スキーマ・マーカー・必要容量・残り停止時間を確認する。
8. **`bash scripts/pi-start.sh` によるDB版Botの起動指示がSheets切戻しの期限になる。** このスクリプトは事前schema検査の後、起動コマンドより先に `.deploy-state/db-started` を記録する。起動コマンドやhealthが失敗しても、ここからSheetsへ戻さない。30分の停止枠はこの起動指示まで。
9. healthがHTTP200、Discord接続・DB readiness、`/ping`、一覧・在庫・リマインドの移行前表示との一致、一覧追加、在庫操作、既存リマインド1件の実送信とDB通知状態更新を確認する。DB起動のたびに既存表示を更新する。失敗チャンネルはログを確認し機能別initコマンドで再試行する。正常ならBotを動かしたまま次へ進む。失敗時はDB版を停止してDB保全・修正・再検証・再開する。
10. 正常なDB版ダイジェストを記録する。旧Sheets用のstateを退避してから `pi-update.sh --initialize "$BOT_IMAGE"` でDB版を登録する（ci-disabledは保持）。previousにSheets版を残さない。新コマンド定義から `/migrate-inventory` が除かれることを確認したうえでコマンド登録を実行する。通常Botの.envにGoogle/admin情報がないことを確認し、`.env.migration` を削除する。Sheets本体・Googleプロジェクト等は削除しない。
11. 全受入後、CI入口のci-disabledを削除し、更新timerとバックアップtimerを有効にする。CI経路・timer経路と日次backupの成功を記録する。正常DB版・直前の互換DB版とバックアップを保持する。

## 起動指示前に中止する場合

`.deploy-state/db-started` がまだなく、DB版Botの起動指示を行っていない場合に限る。DB版を起動せず、退避した旧Compose・旧.env・旧イメージでbotだけを再開し、旧Botのhealth・Discord/Sheetsを確認する。Sheetsは読み取り専用で取得したため復元不要。新DBとsnapshot/レポートは原因調査用に保全する。旧Bot再開までが30分枠。CI入口と更新timerは停止したままにし、DB版mainを旧Botへ自動適用しない。

DB版起動指示後は、起動確認の成否に関係なくDBを正とする。DB→Sheetsの逆移行、二重書き込み、新旧同時稼働は行わない。
