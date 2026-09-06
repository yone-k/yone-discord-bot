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

Go APIには別の環境で `DATABASE_URL`（限定DBロール）と同じ `CORE_API_TOKEN` を渡します。DB管理URLと `DATABASE_BOT_ROLE` はmigration CLI専用です。

### 3. Discord Developer Portal での設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot セクションでトークンを取得
3. OAuth2 セクションで適切な権限を設定

## 使用方法

### 本番環境（Raspberry Pi 5）

GitHub ActionsがARM64イメージをGHCRへ公開し、Tailscale経由でPiの更新を起動します。Piのtimerは起動時と日次の補完として動作します。
一覧・在庫・リマインドは外付けHDD上のPostgreSQLに保存し、Discordから操作します。

Go APIはスキーマ版2と既存の移行完了マーカーを検査します。BotはAPI readinessの確認後にDiscordへログインします。

在庫の一括編集は `行番号,名前,在庫数,カテゴリ` の形式です。既存行は行番号を変えず、新規行の行番号は空欄にします。名前を変えても同じ在庫として保持されます。編集画面の有効期限は15分です。期限切れや編集中に在庫が変わった場合は、画面を開き直して最新の内容から編集します。

### 開発環境での実行

限定DB URLとトークンを設定した別ターミナルで `cd backend && MIGRATIONS_DIR=../db/migrations go run ./cmd/api` を起動し、Botの `.env` を設定して `npm run dev` を実行します。Goは起動時にDDLを実行しません。既存データへのmigrationは手動で適用します。

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

`npm run test:api-integration` は実Go API＋PG18＋TSアダプター＋Discordモックを通します。同じ環境変数にloopback URLと専用コンテナを設定し、DB名を `discord_bot_test_http` など `_http` で終える必要があります。runnerは指定コンテナと接続先のクラスタを照合してから専用DBを作成・初期化し、検証終了時にAPIプロセスを回収します。ホスト8080を空けてください。Linuxではコンテナ作成時に `--add-host=host.docker.internal:host-gateway` を指定します。

ARM64ビルド後は `bash scripts/check-core-image.sh <ローカルイメージ名>` で使い捨てPG18/API/Botの同一イメージ、health・認証・schema不一致・API/DB停止・dump/restoreを検証できます。Discord SDKだけをモックし、外部通信できない内部networkで実Botのready変化も確認します。専用コンテナとnetworkは成功・失敗時とも回収します。

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
