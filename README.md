# Discord Bot

## 概要
このプロジェクトはTypeScriptとdiscord.jsを使用したDiscordボットです。  
個人チャンネルでの利用を前提としているので、個人的にほしい機能だけを実装しています。

## 必要な環境
- Node.js (v18以上推奨)
- npm または yarn
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
- `DISCORD_BOT_TOKEN`: DiscordボットのトークンIDED）
- `CLIENT_ID`: ボットのクライアント
- `GUILD_ID`: テスト用ギルド（サーバー）のID

### 3. Discord Developer Portal での設定
1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot セクションでトークンを取得
3. OAuth2 セクションで適切な権限を設定

## 使用方法

### 開発環境での実行
```bash
npm run dev
```

### ビルド
```bash
npm run build
```

### テスト実行
```bash
npm test
```

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