# Discord Bot

## 概要

Discord UIはTypeScriptとdiscord.js、一覧・在庫・リマインドの業務処理はDDDベースのGo HTTP APIで実装しています。
個人チャンネルでの利用を前提としているので、個人的にほしい機能だけを実装しています。

## 必要な環境

- Node.js 24以上
- Go 1.27.1
- npm
- PostgreSQL 18（DB統合テストにはDockerが必要）
- Discord Developer Portal でのBotアプリケーション作成

## セットアップ

### 1. 依存関係のインストール

```bash
npm ci
```

### 2. 環境変数の設定

`.env.example` を参考に `.env` ファイルを作成し、必要な環境変数を設定してください。

```bash
cp .env.example .env
```

必要な環境変数:

- `DISCORD_BOT_TOKEN`: Discordボットのトークン
- `CLIENT_ID`: ボットのクライアントID
- `CORE_API_URL`: Core APIのURL（ローカルでは `http://localhost:8080`）
- `CORE_API_TOKEN`: APIと共有するBearerトークン
- `GUILD_ID`: テスト用ギルド（任意）

Go APIには別の環境で `DATABASE_URL`（限定DBロール）、同じ `CORE_API_TOKEN` と `DISCORD_BOT_TOKEN` を渡します。DB管理URLと `DATABASE_BOT_ROLE` はmigration CLI専用です。
`DISCORD_OUTPUT_ENABLED=false` でGoのDiscord出力を停止できます。未指定では有効です。停止中も業務受付と出力予約を続けます。

### 3. Discord Developer Portal での設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot セクションでトークンを取得
3. OAuth2 セクションで適切な権限を設定

## 使用方法

### 本番環境（Raspberry Pi 5）

GitHub ActionsがARM64イメージをGHCRへ公開し、Tailscale経由でPiの更新を起動します。Piのtimerは起動時と日次の補完として動作します。
一覧・在庫・リマインドは外付けHDD上のPostgreSQLに保存し、Discordから操作します。

Go APIはスキーマ版3と既存の移行完了マーカーを検査します。BotはAPI readinessと出力契約 `go-discord-output-v1` の確認後にDiscordへログインします。

在庫の一括編集は `行番号,名前,在庫数,カテゴリ` の形式です。既存行は行番号を変えず、新規行の行番号は空欄にします。名前を変えても同じ在庫として保持されます。編集画面の有効期限は15分です。期限切れや編集中に在庫が変わった場合は、画面を開き直して最新の内容から編集します。

### 開発環境での実行

限定DB URLとトークンを設定した別ターミナルで `cd backend && MIGRATIONS_DIR=../db/migrations go run ./cmd/api` を起動し、Botの `.env` を設定して `npm run dev` を実行します。Goは起動時にDDLを実行しません。既存データへのmigrationは手動で適用します。

### Discord出力の確認・復旧

初回のGo出力切替では、次の順序で作業します。通常の自動更新はDDLを実行せず、schemaが合わないイメージへの更新・切戻しを拒否します。

1. `.deploy-state/ci-disabled` を作成し、`bash scripts/pi-update.sh --block` で更新をブロックします。更新・バックアップのtimerと実行中serviceを停止し、`docker compose stop bot api` で旧TSの出力とAPIを停止します。
2. `bash scripts/pi-backup.sh` でDBを退避し、検証済みmanifestと現在のイメージdigestを保持します。以後の操作には、検証した新しいARM64イメージのdigestを `BOT_IMAGE` に指定します。
3. 新イメージと同じコミットの `scripts/`、`deploy/`、Compose定義を配置します。APIの4項目の設定を `scripts/pi-env.mjs api` と `scripts/install-pi-env.sh api` で配置し、Botと同じトークン、`DISCORD_OUTPUT_ENABLED=false` を指定します。起動・更新スクリプトは両サービスのトークン一致を検証します。
4. 新イメージで `docker compose --profile ops run --rm --no-deps ops` を手動実行してschema 3へ移行し、同じコマンドに `--check` を付けて確認します。
5. `bash scripts/pi-update.sh --recover "$BOT_IMAGE"` でAPI、Botの順に同一digestを起動します。出力停止のまま、health、出力契約、`outputctl list` と必要な詳細・既存IDを確認します。
6. 確認後にAPIの永続設定を明示的にtrueへ変更し、APIを再作成します。`/v1/outputs/status` の `enabled` と `workerRunning`、API/Botのhealth、`bash scripts/pi-update.sh --verify "$BOT_IMAGE"` を確認します。
7. `.deploy-state/ci-disabled` を除去し、更新・バックアップtimerを再開します。初回切替の途中で失敗した場合は出力をfalseに保ち、schema 3と互換なイメージで前進復旧します。旧TS出力イメージを起動し直しません。

共通イメージの `./bin/outputctl` はAPIと同じ限定DBロールを使います。ローカルでは `backend` から `MIGRATIONS_DIR=../db/migrations go run ./cmd/outputctl ...` で実行できます。DB接続情報やトークンは環境変数で渡し、引数には含めません。

| 操作 | 引数の例 |
|---|---|
| 一覧 | `list --channel CHANNEL_ID --state uncertain --limit 100` |
| 詳細・送信履歴 | `detail JOB_ID` |
| 既知ID・nonceの照合 | `reconcile --actor USER_ID --stage message JOB_ID` |
| 確認した既存IDの紐付け | `bind --actor USER_ID --stage message --discord-id MESSAGE_ID JOB_ID` |
| 未送信を確認した出力の再試行 | `retry-confirm-unsent --actor USER_ID --confirm-unsent JOB_ID` |
| 取消 | `cancel --actor USER_ID JOB_ID` |

フラグはジョブIDより前に指定します。`USER_ID` は操作する本人のDiscordユーザーIDです。一覧の件数・停止・保留は全体を表示し、チャンネル・状態フィルタと上限はジョブ一覧に適用します。実行中のジョブは更新できません。

照合と紐付けには `DISCORD_BOT_TOKEN` が必要です。照合は保存済みID、または直近100件のnonce完全一致を使います。`resolved: false` は未送信の証明ではなく、保留は続きます。紐付けはBot投稿者・送信先・段階を検証します。通知用親メッセージには `--stage parent`、スレッドには `--stage thread` を指定し、通知用スレッドは親を先に紐付けます。

カードを再作成した際の送信結果は、`detail` の `stages` に表示された `message:1` などの名前を `--stage` に指定して照合・紐付けします。記録されていない再作成段階は指定できません。

DB復元後のカードに古いIDが残っている場合は、`bind` で確認した現在のカードIDを指定できます。異なる旧IDがすべてDiscordの「Unknown Message」で削除済みと確認でき、新IDの送信先とBot投稿者が一致する場合だけ交換します。旧メッセージが残る場合や権限不足では交換せず、以前の作成段階と送信履歴も書き換えません。

明示再試行は、運用者が作成されていないことを確認した場合だけ使います。業務操作を再実行せず、同じ送信段階とnonceを保持します。取消しても結果不明の投稿の保留や全削除によるチャンネル停止は解除されません。全削除の停止解除は、未完了の削除を解決した後にDiscordの初期化コマンドで行います。

DB復元はAPI・Botと更新処理を停止してから、新しいDBへ行います。復元スクリプトはAPIの永続設定を `DISCORD_OUTPUT_ENABLED=false` に変更し、復元に失敗してもそのまま保持します。未完了の新規出力は、バックアップ時点でpendingでも送信済みの可能性があるためuncertainにします。送信履歴、確認済み削除件数、チャンネル停止は保持します。対応するイメージでAPIを出力停止のまま起動し、CLIで既存IDと送信結果を確認してください。送信履歴のない復元ジョブも、確認したIDを明示的に紐付けられます。出力再開は確認後に設定を明示的にtrueへ変更してAPIを再作成します。

### ビルド

```bash
npm run build-only
```

`npm run build`と`npm run dev`はDiscordのコマンド登録も行います。

### 検証とコード生成

```bash
npm ci
npm run api:generate
(cd backend && go generate ./...)
git diff --exit-code -- api/generated src/api/generated backend
npm run check
npm test
npm run build-only
(cd backend && go vet ./... && go test ./... && go test -race ./... && go build ./cmd/...)
(cd backend && test -z "$(gofmt -l .)")
```

API契約は `api/main.tsp` を編集します。OpenAPI、Go HTTP型、TS型とent生成コードは手編集せず、再生成してGitに含めます。

DB統合テストはテスト専用PostgreSQL 18コンテナのURLを `TEST_DATABASE_URL`、コンテナIDまたは名前を `TEST_DB_CONTAINER_ID` に指定し、`npm run test:db` を実行します。入口はGoの `integration` build tagとrace検査を実行します。未設定・接続不能・コンテナと接続先の不一致は失敗させます。対象DBを初期化するため開発・本番データのDBは使用しません。DiscordとDriveは外部境界をモックします。

`npm run test:api-integration` は実Go API＋PG18＋TSアダプター＋Discordモックを通します。出力停止時の業務・バックアップ検証の後、専用DBを初期化して有効なGo workerを起動し、実モーダル入力→カード作成→保存済みIDでのボタン操作→404後の再作成→新IDでの操作を検証します。DiscordのHTTP転送はテスト専用Goバイナリでのみ差し替えます。同じ環境変数にloopback URLと専用コンテナを設定し、DB名を `discord_bot_test_http` など `_http` で終える必要があります。runnerは指定コンテナと接続先のクラスタを照合してから専用DBを作成・初期化し、検証終了時にAPIプロセスと偽Discordサーバーを回収します。ホスト8080を空けてください。Linuxではコンテナ作成時に `--add-host=host.docker.internal:host-gateway` を指定します。

ARM64ビルド後は `bash scripts/check-core-image.sh <ローカルイメージ名>` で使い捨てPG18/API/Bot/outputctlの同一イメージ、GoによるDiscord出力、health・認証・schema不一致・API/DB停止・出力を止めたdump/restoreを検証できます。Discord SDKとHTTPS REST境界をモックし、外部通信できない内部networkで実Botのready変化と再起動後の新規投稿重複がないことも確認します。OpenSSLでテスト専用証明書を生成し、専用コンテナ・networkとともに成功・失敗時の両方で回収します。

## プロジェクト構成

```
discord-bot/
├── src/           # Discord UI・生成TS型・APIクライアント
├── backend/       # Go domain/application/infrastructure/HTTP
├── api/           # TypeSpec契約と生成OpenAPI
├── db/migrations/ # SQLが物理スキーマの正
├── dist/          # ビルド後のファイル
├── .env.example   # 環境変数の例
├── .env           # 環境変数（gitignore対象）
└── package.json   # プロジェクト設定
```

## ライセンス

ISC

## サポート

問題や質問がある場合は、Issueを作成してください。
