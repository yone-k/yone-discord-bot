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

# デフォルト値設定
GCE_INSTANCE=${GCE_INSTANCE:-discord-bot-instance}
GCE_ZONE=${GCE_ZONE:-us-central1-a}
IMAGE_NAME=${IMAGE_NAME:-discord-bot}
ARTIFACT_REGISTRY_REGION=${ARTIFACT_REGISTRY_REGION:-us-central1}
ARTIFACT_REGISTRY_REPO=${ARTIFACT_REGISTRY_REPO:-discord-bot-repo}

echo "Project ID: $GCP_PROJECT_ID"
echo "Instance: $GCE_INSTANCE"
echo "Zone: $GCE_ZONE"
echo "Artifact Registry Region: $ARTIFACT_REGISTRY_REGION"
echo "Repository: $ARTIFACT_REGISTRY_REPO"
echo ""

# gcloudの認証確認
echo "Checking gcloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1 > /dev/null; then
    echo -e "${RED}Error: Not authenticated with gcloud. Please run 'gcloud auth login'${NC}"
    exit 1
fi

# プロジェクト設定
gcloud config set project $GCP_PROJECT_ID

# Artifact Registry認証設定
echo "Configuring Docker authentication for Artifact Registry..."
gcloud auth configure-docker $ARTIFACT_REGISTRY_REGION-docker.pkg.dev --quiet

# Artifact Registryリポジトリを作成
echo "Creating Artifact Registry repository..."
gcloud artifacts repositories create $ARTIFACT_REGISTRY_REPO \
    --repository-format=docker \
    --location=$ARTIFACT_REGISTRY_REGION \
    --description="Discord Bot Docker Repository" || echo "Repository already exists"

# Dockerイメージをビルド
echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t "$ARTIFACT_REGISTRY_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$ARTIFACT_REGISTRY_REPO/$IMAGE_NAME:latest" .

# イメージをプッシュ
echo -e "${YELLOW}Pushing Docker image to Artifact Registry...${NC}"
docker push "$ARTIFACT_REGISTRY_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$ARTIFACT_REGISTRY_REPO/$IMAGE_NAME:latest"

# 環境変数を設定（実際の値は.envファイルから取得するか環境変数で指定）
echo "Please make sure the following environment variables are set:"
echo "- DISCORD_BOT_TOKEN"
echo "- CLIENT_ID" 
echo "- GOOGLE_SERVICE_ACCOUNT_EMAIL"
echo "- GOOGLE_PRIVATE_KEY"
echo "- GOOGLE_SPREADSHEET_ID"
echo ""

if [ -z "$DISCORD_BOT_TOKEN" ]; then
    echo -e "${YELLOW}Warning: Environment variables not set. Please set them manually in GCE metadata${NC}"
    ENV_VARS=""
else
    ENV_VARS="DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN"
    ENV_VARS="$ENV_VARS,CLIENT_ID=$CLIENT_ID"
    ENV_VARS="$ENV_VARS,GOOGLE_SERVICE_ACCOUNT_EMAIL=$GOOGLE_SERVICE_ACCOUNT_EMAIL"
    ENV_VARS="$ENV_VARS,GOOGLE_PRIVATE_KEY=$GOOGLE_PRIVATE_KEY"
    ENV_VARS="$ENV_VARS,GOOGLE_SPREADSHEET_ID=$GOOGLE_SPREADSHEET_ID"
fi

# インスタンスの存在確認
echo "Checking if GCE instance exists..."
if ! gcloud compute instances describe $GCE_INSTANCE --zone=$GCE_ZONE > /dev/null 2>&1; then
    echo -e "${YELLOW}Creating new GCE instance...${NC}"
    
    # スタートアップスクリプトを準備
    sed "s|{{PROJECT_ID}}|$GCP_PROJECT_ID|g; s|{{ARTIFACT_REGISTRY_REGION}}|$ARTIFACT_REGISTRY_REGION|g; s|{{ARTIFACT_REGISTRY_REPO}}|$ARTIFACT_REGISTRY_REPO|g; s|{{IMAGE_NAME}}|$IMAGE_NAME|g" gce-startup-script.sh > startup-script-temp.sh
    
    CREATE_ARGS="--zone=$GCE_ZONE \
        --machine-type=e2-micro \
        --boot-disk-size=10GB \
        --boot-disk-type=pd-standard \
        --boot-disk-device-name=$GCE_INSTANCE \
        --image-family=cos-stable \
        --image-project=cos-cloud \
        --tags=http-server,https-server,discord-bot \
        --scopes=https://www.googleapis.com/auth/cloud-platform \
        --metadata-from-file=startup-script=startup-script-temp.sh"
    
    if [ -n "$ENV_VARS" ]; then
        CREATE_ARGS="$CREATE_ARGS --metadata=env-vars=\"$ENV_VARS\""
    fi
    
    gcloud compute instances create $GCE_INSTANCE $CREATE_ARGS
    
    rm startup-script-temp.sh
else
    echo -e "${GREEN}Instance already exists${NC}"
fi

# 環境変数とスタートアップスクリプトを更新
echo -e "${YELLOW}Updating instance metadata...${NC}"
sed "s|{{PROJECT_ID}}|$GCP_PROJECT_ID|g; s|{{ARTIFACT_REGISTRY_REGION}}|$ARTIFACT_REGISTRY_REGION|g; s|{{ARTIFACT_REGISTRY_REPO}}|$ARTIFACT_REGISTRY_REPO|g; s|{{IMAGE_NAME}}|$IMAGE_NAME|g" gce-startup-script.sh > startup-script-temp.sh

UPDATE_ARGS="--zone=$GCE_ZONE --metadata-from-file=startup-script=startup-script-temp.sh"
if [ -n "$ENV_VARS" ]; then
    UPDATE_ARGS="$UPDATE_ARGS --metadata=env-vars=\"$ENV_VARS\""
fi

gcloud compute instances add-metadata $GCE_INSTANCE $UPDATE_ARGS
rm startup-script-temp.sh

# インスタンスを再起動
echo -e "${YELLOW}Restarting instance to deploy new version...${NC}"
gcloud compute instances reset $GCE_INSTANCE --zone=$GCE_ZONE

# デプロイ完了を待つ
echo -e "${YELLOW}Waiting for deployment to complete...${NC}"
sleep 30

# インスタンスのIPアドレスを取得
INSTANCE_IP=$(gcloud compute instances describe $GCE_INSTANCE --zone=$GCE_ZONE --format="get(networkInterfaces[0].accessConfigs[0].natIP)")

echo "Instance IP: $INSTANCE_IP"
echo "Starting health check loop..."

# ヘルスチェック (HTTP経由のみでSSH鍵競合を回避)
echo "Performing health check..."
for i in {1..60}; do
    echo "Health check attempt $i/60"
    
    # Try health check
    echo "Testing health endpoint..."
    HEALTH_RESPONSE=$(curl -s -w "HTTP_CODE:%{http_code}" "http://$INSTANCE_IP:3000/health" 2>/dev/null || echo "CURL_FAILED")
    echo "Health response: $HEALTH_RESPONSE"
    
    if echo "$HEALTH_RESPONSE" | grep -q "HTTP_CODE:200"; then
        echo -e "${GREEN}✅ Deployment successful!${NC}"
        echo "Bot is running at: http://$INSTANCE_IP:3000"
        echo "Health check: http://$INSTANCE_IP:3000/health"
        exit 0
    else
        echo "Health check failed, retrying in 5 seconds... ($i/60)"
        if [ $((i % 12)) -eq 0 ]; then
            echo -e "${YELLOW}📊 Progress: Completed $i/60 health checks${NC}"
        fi
        sleep 5
    fi
done

echo -e "${RED}❌ Deployment failed - health check timeout after 5 minutes${NC}"
echo "Please check the instance manually if needed:"
echo "gcloud compute ssh $GCE_INSTANCE --zone=$GCE_ZONE"
echo "Then run: docker logs discord-bot"
exit 1