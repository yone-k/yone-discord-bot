# GCE デプロイメントガイド

このガイドでは、DiscordBotをGoogle Cloud Engine（GCE）の無料枠で稼働させるための設定方法を説明します。

## gcloudコマンドの実行方法

gcloudコマンドは以下のいずれかの方法で実行できます：

### 方法1: Cloud Shell（推奨・簡単）
1. [Google Cloud Console](https://console.cloud.google.com/) にアクセス
2. 画面右上の **Cloud Shell** アイコン（ターミナルマーク）をクリック
3. 画面下部にターミナルが開いたら、そこでgcloudコマンドを実行
4. 初回起動時は「承認」をクリックして認証を完了

### 方法2: ローカル環境
1. **Google Cloud CLIのインストール**
   - **Windows**: [インストーラーをダウンロード](https://cloud.google.com/sdk/docs/install-sdk#windows) して実行
   - **macOS**: 
     ```bash
     # Homebrewを使用
     brew install --cask google-cloud-sdk
     
     # または直接ダウンロード
     curl https://sdk.cloud.google.com | bash
     ```
   - **Linux**: 
     ```bash
     curl https://sdk.cloud.google.com | bash
     ```

2. **認証とプロジェクト設定**
   ```bash
   # 初期化（ブラウザで認証画面が開きます）
   gcloud init
   
   # または手動で認証
   gcloud auth login
   
   # プロジェクトを設定
   gcloud config set project YOUR_PROJECT_ID
   
   # 設定確認
   gcloud config list
   ```

3. **インストール確認**
   ```bash
   # gcloudのバージョン確認
   gcloud version
   
   # 現在の設定確認
   gcloud info
   ```

**注意**: 以下のコマンド例では `PROJECT_ID` を実際のプロジェクトIDに置き換えてください。

## 必要な準備

### 1. Google Cloud Platform 設定

1. **GCPプロジェクト作成**
   - [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
   - プロジェクトIDをメモしておく

2. **必要なAPIを有効化**
   
   **Cloud Shell または ローカル環境で実行:**
   ```bash
   # プロジェクトを設定（Cloud Shellの場合は自動設定される場合があります）
   gcloud config set project YOUR_PROJECT_ID
   
   # 必要なAPIを有効化
   gcloud services enable compute.googleapis.com
   gcloud services enable containerregistry.googleapis.com
   ```
   
   **実行場所**: Cloud Shell（画面右上のターミナルアイコン）またはローカルのターミナル

3. **サービスアカウント作成**
   
   **Cloud Shell または ローカル環境で実行:**
   ```bash
   # 現在のプロジェクトIDを確認
   gcloud config get-value project
   
   # サービスアカウント作成
   gcloud iam service-accounts create discord-bot-deployer \
     --display-name="Discord Bot Deployer"
   
   # 必要な権限を付与（PROJECT_IDを実際のプロジェクトIDに置き換え）
   gcloud projects add-iam-policy-binding yonediscordbot \
     --member="serviceAccount:discord-bot-deployer@yonediscordbot.iam.gserviceaccount.com" \
     --role="roles/compute.instanceAdmin.v1"
   
   gcloud projects add-iam-policy-binding yonediscordbot \
     --member="serviceAccount:discord-bot-deployer@yonediscordbot.iam.gserviceaccount.com" \
     --role="roles/storage.admin"
   
   # キーファイル生成
   gcloud iam service-accounts keys create key.json \
     --iam-account=discord-bot-deployer@yonediscordbot.iam.gserviceaccount.com
   ```
   
   **実行場所**: Cloud Shell（画面右上のターミナルアイコン）またはローカルのターミナル
   
   **重要**: 
   - 生成された `key.json` ファイルの内容をコピーしてGitHub Secretsに設定します
   - Cloud Shellの場合、ファイルをダウンロードするには `cloudshell download key.json` を実行

### 2. GitHub Secrets 設定

GitHub リポジトリの Settings > Secrets and variables > Actions で以下のシークレットを追加：

#### GCP 関連
- `GCP_PROJECT_ID`: GCPプロジェクトID
- `GCP_SERVICE_ACCOUNT_KEY`: 上記で作成したkey.jsonファイルの内容（JSON全体）

#### Discord 関連
- `DISCORD_BOT_TOKEN`: Discord BotのトークンID
- `CLIENT_ID`: Discord ApplicationのClient ID

#### Google Sheets 関連
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Google Sheets用サービスアカウントのメールアドレス
- `GOOGLE_PRIVATE_KEY`: Google Sheets用サービスアカウントの秘密鍵
- `GOOGLE_SPREADSHEET_ID`: 使用するGoogle SheetsのスプレッドシートID

### 3. Discord Bot 設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーション作成
2. Bot タブでトークンを取得（`DISCORD_BOT_TOKEN`）
3. General Information タブでClient IDを取得（`CLIENT_ID`）
4. Bot Permissions:
   - Send Messages
   - Use Slash Commands
   - Read Message History
   - Add Reactions

### 4. Google Sheets 設定

1. [Google Cloud Console](https://console.cloud.google.com/) でサービスアカウント作成
2. Google Sheets APIを有効化
3. サービスアカウントキーをダウンロード
4. 使用するスプレッドシートにサービスアカウントのメールアドレスを編集権限で共有

## デプロイ方法

### 初回セットアップ

1. **ファイアウォール設定**
   
   **方法A: GitHub Actionsで自動実行（推奨）**
   - GitHub リポジトリの Actions タブ > "Setup GCP Firewall" > "Run workflow" をクリック
   
   **方法B: 手動でコマンド実行**
   
   **Cloud Shell または ローカル環境で実行:**
   ```bash
   # ファイアウォールルールを作成（ポート3000を開放）
   gcloud compute firewall-rules create allow-discord-bot-health \
     --allow tcp:3000 \
     --source-ranges 0.0.0.0/0 \
     --target-tags discord-bot \
     --description "Allow health check access to Discord Bot"
   ```
   
   **実行場所**: Cloud Shell（画面右上のターミナルアイコン）またはローカルのターミナル

2. **初回デプロイ**
   - main ブランチにプッシュすると自動的にデプロイが開始されます
   - GitHub Actions の「Deploy to GCE」ワークフローで進行状況を確認できます

### 継続的デプロイ

- main ブランチへのプッシュで自動デプロイ
- GitHub Actions の Actions タブから手動実行も可能

## GCE 無料枠について

このプロジェクトは以下のGCE無料枠内で動作するように設定されています：

- **インスタンスタイプ**: e2-micro（vCPU x1、メモリ 1GB）
- **ディスク**: 10GB標準永続ディスク
- **リージョン**: us-central1（オレゴン）
- **ネットワーク**: 月間1GBのエグレス

## トラブルシューティング

### デプロイメントの確認

1. **インスタンス状態確認**
   
   **Cloud Shell または ローカル環境で実行:**
   ```bash
   # インスタンスの詳細情報を確認
   gcloud compute instances describe discord-bot-instance --zone=us-central1-a
   
   # インスタンスの一覧とIPアドレスを確認
   gcloud compute instances list --filter="name:discord-bot-instance"
   ```
   
   **実行場所**: Cloud Shell（画面右上のターミナルアイコン）またはローカルのターミナル

2. **ログ確認**
   
   **Cloud Shell または ローカル環境で実行:**
   ```bash
   # インスタンスにSSH接続
   gcloud compute ssh discord-bot-instance --zone=us-central1-a
   
   # 接続後、Docker コンテナのログを確認
   sudo docker logs discord-bot
   
   # リアルタイムでログを監視
   sudo docker logs -f discord-bot
   ```
   
   **実行場所**: Cloud Shell（画面右上のターミナルアイコン）またはローカルのターミナル

3. **ヘルスチェック**
   
   **ブラウザまたはターミナルで確認:**
   ```bash
   # インスタンスのIPアドレスを取得
   INSTANCE_IP=$(gcloud compute instances describe discord-bot-instance --zone=us-central1-a --format="get(networkInterfaces[0].accessConfigs[0].natIP)")
   echo "Instance IP: $INSTANCE_IP"
   
   # ヘルスチェックエンドポイントにアクセス
   curl http://$INSTANCE_IP:3000/health
   ```
   
   またはブラウザで `http://INSTANCE_IP:3000/health` にアクセス
   
   **実行場所**: Cloud Shell、ローカルのターミナル、またはブラウザ

### 一般的な問題

1. **権限エラー**
   - サービスアカウントの権限を確認
   - GitHub Secretsの設定を確認

2. **Docker起動失敗**
   - インスタンスのログを確認
   - 環境変数の設定を確認

3. **Bot応答なし**
   - Discord Botのトークンを確認
   - Botの権限設定を確認

## 費用管理

無料枠を超えないための対策：

1. **アラート設定**
   - GCP Console でユーザ請求先アカウントにアラートを設定
   - 月額使用量が無料枠に近づいたら通知

2. **リソース監視**
   - 定期的にGCP Console でリソース使用量を確認
   - 不要になったリソースは速やかに削除

3. **インスタンス管理（必要に応じて）**
   
   **Cloud Shell または ローカル環境で実行:**
   ```bash
   # インスタンスを停止（課金を止める）
   gcloud compute instances stop discord-bot-instance --zone=us-central1-a
   
   # インスタンスを再起動
   gcloud compute instances start discord-bot-instance --zone=us-central1-a
   
   # インスタンス削除（注意：すべてのデータが削除されます）
   gcloud compute instances delete discord-bot-instance --zone=us-central1-a
   ```
   
   **実行場所**: Cloud Shell（画面右上のターミナルアイコン）またはローカルのターミナル
   
   **重要**: インスタンスを停止すると課金が停止しますが、ディスクの料金は継続します。