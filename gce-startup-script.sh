#!/bin/bash

# ログ設定
exec > >(tee -a /var/log/startup-script.log)
exec 2>&1

echo "Startup script started at $(date)"

# Docker をインストール（まだインストールされていない場合）
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
fi

# gcloud auth docker を設定
gcloud auth configure-docker --quiet

# 古いコンテナを停止・削除
echo "Stopping and removing old containers..."
docker stop discord-bot 2>/dev/null || true
docker rm discord-bot 2>/dev/null || true

# 最新のイメージをプル
echo "Pulling latest image..."
docker pull gcr.io/PROJECT_ID/discord-bot:latest

# 新しいコンテナを起動
echo "Starting new container..."
docker run -d \
  --name discord-bot \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DISCORD_BOT_TOKEN="${DISCORD_BOT_TOKEN}" \
  -e CLIENT_ID="${CLIENT_ID}" \
  -e GOOGLE_SERVICE_ACCOUNT_EMAIL="${GOOGLE_SERVICE_ACCOUNT_EMAIL}" \
  -e GOOGLE_PRIVATE_KEY="${GOOGLE_PRIVATE_KEY}" \
  -e GOOGLE_SPREADSHEET_ID="${GOOGLE_SPREADSHEET_ID}" \
  gcr.io/PROJECT_ID/discord-bot:latest

echo "Container started. Checking health..."

# ヘルスチェック
sleep 10
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "Health check passed"
else
    echo "Health check failed"
    exit 1
fi

echo "Startup script completed at $(date)"