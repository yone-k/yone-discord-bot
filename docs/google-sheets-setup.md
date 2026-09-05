# Google Sheets 認証設定ガイド

## 概要

このドキュメントでは、本番環境でGoogle Sheets APIの認証を正しく設定する方法を説明します。

## 必要な環境変数

以下の3つの環境変数が必要です：

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: サービスアカウントのメールアドレス
- `GOOGLE_PRIVATE_KEY`: サービスアカウントの秘密鍵
- `GOOGLE_SHEETS_SPREADSHEET_ID`: 使用するスプレッドシートのID

## 設定方法

### 1. サービスアカウントの作成

1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. プロジェクトを作成または選択
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「サービスアカウント」
4. サービスアカウントを作成し、JSONキーファイルをダウンロード

### 2. 環境変数の設定

#### ローカル環境（.env ファイル）

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC9W8bAF7Nq0BtF
...（省略）...
-----END PRIVATE KEY-----"
```

#### Docker環境

本番Piでは[運用手順](raspberry-pi-deployment.md)に従い、既存GCEの認証情報を所有者yone・権限600の `.env` へ移送します。Composeの `env_file` で実行時に読み込み、Dockerfileやイメージへ秘密値を埋め込みません。今回の移行ではサービスアカウントや鍵を新規発行しません。

#### Heroku

```bash
# サービスアカウントのJSONファイルから値を抽出
heroku config:set GOOGLE_SERVICE_ACCOUNT_EMAIL=$(cat key.json | jq -r .client_email)
heroku config:set GOOGLE_SHEETS_SPREADSHEET_ID=your-spreadsheet-id

# 秘密鍵の設定（改行文字を保持）
heroku config:set GOOGLE_PRIVATE_KEY="$(cat key.json | jq -r .private_key)"
```

#### AWS ECS / Fargate

AWS Systems Manager Parameter StoreまたはSecrets Managerを使用：

```bash
# Parameter Storeに保存
aws ssm put-parameter \
  --name "/myapp/google-private-key" \
  --type "SecureString" \
  --value "$(cat key.json | jq -r .private_key)"
```

#### GitHub Actions

GitHub Secretsに保存：

1. リポジトリの Settings → Secrets and variables → Actions
2. 以下のシークレットを追加：
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`（JSONファイルから抽出した値）
   - `GOOGLE_SHEETS_SPREADSHEET_ID`

## よくある問題と解決方法

### 1. ERR_OSSL_UNSUPPORTED エラー

**症状**: `error:1E08010C:DECODER routines::unsupported`

**原因**: 秘密鍵の形式が正しくない、または改行文字が適切に処理されていない

**解決方法**:
1. サービスアカウントのJSONファイルから秘密鍵を再度コピー
2. 改行文字が正しく保持されているか確認
3. 下記の検証方法でCompose構文と実際のSheetsアクセスを確認

### 2. 改行文字の問題

**症状**: 秘密鍵に `\n` が文字列として含まれている

**解決方法**:
```bash
# 改行文字を正しくエンコード
export GOOGLE_PRIVATE_KEY=$(cat key.json | jq -r .private_key)
```

### 3. PEMヘッダー/フッターの欠落

**症状**: 秘密鍵にBEGIN/ENDヘッダーがない

**解決方法**: サービスアカウントのJSONファイルから完全な秘密鍵をコピー

## 検証方法

Pi上で正常イメージの `BOT_IMAGE` を設定したうえで `docker compose config --quiet` により設定構文を確認します。認証の成功は本番BotのSheetsアクセス、および既存リマインド送信後の通知状態更新で確認します。healthがreadyでもSheets認証の成功は保証されません。秘密鍵や解決後の環境変数全体を出力しないでください。

## セキュリティのベストプラクティス

1. **秘密鍵を直接コードにハードコードしない**
2. **環境変数は暗号化されたシークレット管理サービスを使用**
3. **サービスアカウントには最小限の権限のみ付与**
4. **定期的にキーをローテーション**
5. **ログに秘密鍵を出力しない**

## トラブルシューティング

問題が解決しない場合：

1. Compose構文とBotのSheets認証エラーの有無を確認（秘密値を出力しない）
2. Google Cloud Consoleでサービスアカウントの権限を確認
3. スプレッドシートの共有設定を確認（サービスアカウントのメールアドレスに編集権限があるか）
4. Node.jsのバージョンを確認（v18以上を推奨）