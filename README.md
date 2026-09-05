# Discord Bot

## 概要
このプロジェクトはTypeScriptとdiscord.jsを使用したDiscordボットです。  
個人チャンネルでの利用を前提としているので、個人的にほしい機能だけを実装しています。

## 必要な環境
- Node.js 24以上
- npm または yarn
- PostgreSQL 18（DB統合テストにはDockerが必要）
- Discord Developer Portal でのBotアプリケーション作成

## セットアップ

### 1. 依存関係のインストール
```bash
npm install
```

### 2. 環境変数の設定
`.env.example` を参考に `.env` ファイルを作成し、必要な環境変数を設定してください。

```bash
cp .env.example .env
```

必要な環境変数:
- `DISCORD_BOT_TOKEN`: Discordボットのトークン
- `CLIENT_ID`: ボットのクライアントID
- `DATABASE_URL`: Bot用ロールのPostgreSQL接続URL
- `GUILD_ID`: テスト用ギルド（任意）

### 3. Discord Developer Portal での設定
1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot セクションでトークンを取得
3. OAuth2 セクションで適切な権限を設定

## 使用方法

### 本番環境（Raspberry Pi 5）

GitHub ActionsがARM64イメージをGHCRへ公開し、Tailscale経由でPiの更新を起動します。Piのtimerは起動時と日次の補完として動作します。
一覧・在庫・リマインドは外付けHDD上のPostgreSQLに保存し、Discordから操作します。

- [Piへの配置・更新](docs/raspberry-pi-deployment.md)
- [DB初期構築・Google Driveバックアップ・復元](docs/postgres-operations.md)
- [Sheetsからの移行・切替](docs/postgres-migration.md)

スキーマ適用と移行完了マーカーの検査に成功したDBだけでBotが起動します。実装・合成データ検証を完了してから、本番データ移行を実施します。

在庫の一括編集は `行番号,名前,在庫数,カテゴリ` の形式です。既存行は行番号を変えず、新規行の行番号は空欄にします。名前を変えても同じ在庫として保持されます。編集画面の有効期限は15分です。期限切れや編集中に在庫が変わった場合は、画面を開き直して最新の内容から編集します。

### 開発環境での実行
```bash
npm run dev
```

### ビルド
```bash
npm run build-only
```

`npm run build`と`npm run dev`はDiscordのコマンド登録も行います。

### テスト実行
```bash
npm test
```

型・lintは`npm run check`で確認します。DB統合テストはPostgreSQL 18のテスト専用コンテナを用意し、接続URLを`DATABASE_URL`、そのコンテナIDまたは名前を`TEST_DB_CONTAINER_ID`へ設定して`npm run test:db`を実行します。DB統合テストは対象DBを初期化するため、開発・本番データの入ったDBを指定しないでください。Discord・Sheets・Driveの外部APIはモックで検証します。

## プロジェクト構成
```
discord-bot/
├── src/           # ソースコード
├── dist/          # ビルド後のファイル
├── .env.example   # 環境変数の例
├── .env           # 環境変数（gitignore対象）
└── package.json   # プロジェクト設定
```

## ライセンス
ISC

## サポート
問題や質問がある場合は、Issueを作成してください。
