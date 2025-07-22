#!/bin/bash

# ローカル開発用のデプロイスクリプト
# このスクリプトはローカル環境からGCEにデプロイする際に使用します

set -e

# カラーコード
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 必要な環境変数をチェック
check_env_var() {
    if [ -z "${!1}" ]; then
        echo -e "${RED}Error: Environment variable $1 is not set${NC}"
        exit 1
    fi
}

echo -e "${GREEN}🚀 Discord Bot Local Deploy Script${NC}"
echo "================================"

# 環境変数チェック
echo "Checking environment variables..."
check_env_var "GCP_PROJECT_ID"
check_env_var "GCE_INSTANCE"
check_env_var "GCE_ZONE"

# デフォルト値設定
GCE_INSTANCE=${GCE_INSTANCE:-discord-bot-instance}
GCE_ZONE=${GCE_ZONE:-us-central1-a}
IMAGE_NAME=${IMAGE_NAME:-discord-bot}

echo "Project ID: $GCP_PROJECT_ID"
echo "Instance: $GCE_INSTANCE"
echo "Zone: $GCE_ZONE"
echo ""

# gcloudの認証確認
echo "Checking gcloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 > /dev/null; then
    echo -e "${RED}Error: Not authenticated with gcloud. Please run 'gcloud auth login'${NC}"
    exit 1
fi

# プロジェクト設定
gcloud config set project $GCP_PROJECT_ID

# Dockerイメージをビルド
echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t "gcr.io/$GCP_PROJECT_ID/$IMAGE_NAME:latest" .

# Docker認証設定
echo "Configuring Docker authentication..."
gcloud auth configure-docker --quiet

# イメージをプッシュ
echo -e "${YELLOW}Pushing Docker image to GCR...${NC}"
docker push "gcr.io/$GCP_PROJECT_ID/$IMAGE_NAME:latest"

# インスタンスの存在確認
echo "Checking if GCE instance exists..."
if ! gcloud compute instances describe $GCE_INSTANCE --zone=$GCE_ZONE > /dev/null 2>&1; then
    echo -e "${YELLOW}Creating new GCE instance...${NC}"
    
    # スタートアップスクリプトを準備
    STARTUP_SCRIPT=$(cat gce-startup-script.sh | sed "s/PROJECT_ID/$GCP_PROJECT_ID/g")
    
    gcloud compute instances create $GCE_INSTANCE \
        --zone=$GCE_ZONE \
        --machine-type=e2-micro \
        --boot-disk-size=10GB \
        --boot-disk-type=pd-standard \
        --boot-disk-device-name=$GCE_INSTANCE \
        --image-family=cos-stable \
        --image-project=cos-cloud \
        --tags=http-server,https-server,discord-bot \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --metadata="startup-script=$STARTUP_SCRIPT"
else
    echo -e "${GREEN}Instance already exists${NC}"
fi

# 環境変数を更新
echo -e "${YELLOW}Updating instance metadata...${NC}"
gcloud compute instances add-metadata $GCE_INSTANCE \
    --zone=$GCE_ZONE \
    --metadata="startup-script=$(cat gce-startup-script.sh | sed "s/PROJECT_ID/$GCP_PROJECT_ID/g")"

# インスタンスを再起動
echo -e "${YELLOW}Restarting instance to deploy new version...${NC}"
gcloud compute instances reset $GCE_INSTANCE --zone=$GCE_ZONE

# デプロイ完了を待つ
echo -e "${YELLOW}Waiting for deployment to complete...${NC}"
sleep 60

# インスタンスのIPアドレスを取得
INSTANCE_IP=$(gcloud compute instances describe $GCE_INSTANCE --zone=$GCE_ZONE --format="get(networkInterfaces[0].accessConfigs[0].natIP)")

echo "Instance IP: $INSTANCE_IP"

# ヘルスチェック
echo "Performing health check..."
for i in {1..30}; do
    if curl -f "http://$INSTANCE_IP:3000/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Deployment successful!${NC}"
        echo "Bot is running at: http://$INSTANCE_IP:3000"
        echo "Health check: http://$INSTANCE_IP:3000/health"
        exit 0
    else
        echo "Health check failed, retrying in 10 seconds... ($i/30)"
        sleep 10
    fi
done

echo -e "${RED}❌ Deployment failed - health check timeout${NC}"
echo "Please check the instance logs:"
echo "gcloud compute ssh $GCE_INSTANCE --zone=$GCE_ZONE --command='sudo docker logs discord-bot'"
exit 1