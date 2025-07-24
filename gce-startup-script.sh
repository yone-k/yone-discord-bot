#!/bin/bash

# ログ設定
exec > >(tee -a /var/log/startup-script.log)
exec 2>&1

echo "Startup script started at $(date)"

# Container-Optimized OS environment variables
PROJECT_ID="{{PROJECT_ID}}"
ARTIFACT_REGISTRY_REGION="{{ARTIFACT_REGISTRY_REGION}}"
ARTIFACT_REGISTRY_REPO="{{ARTIFACT_REGISTRY_REPO}}"
IMAGE_NAME="{{IMAGE_NAME}}"
IMAGE_TAG="{{IMAGE_TAG}}"

# Full image path
FULL_IMAGE_PATH="$ARTIFACT_REGISTRY_REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REGISTRY_REPO/$IMAGE_NAME:$IMAGE_TAG"

echo "Configuring Docker for Artifact Registry..."

# Set Docker config directory to writable location
export DOCKER_CONFIG="/tmp/.docker"
mkdir -p "$DOCKER_CONFIG"

# Get OAuth2 access token from metadata server
METADATA_URL="http://metadata.google.internal/computeMetadata/v1"
SVC_ACCT="$METADATA_URL/instance/service-accounts/default"
ACCESS_TOKEN=$(curl -s -H "Metadata-Flavor: Google" "$SVC_ACCT/token" | cut -d'"' -f 4)

# Login to Artifact Registry using OAuth2 access token
echo $ACCESS_TOKEN | docker login -u oauth2accesstoken --password-stdin https://$ARTIFACT_REGISTRY_REGION-docker.pkg.dev

echo "Checking disk usage and cleaning up Docker resources..."

# Check disk usage before cleanup
echo "Disk usage before cleanup:"
df -h /
echo "Docker system usage:"
docker system df 2>/dev/null || echo "Docker system df not available"

# Clean up old Docker resources to free disk space
echo "Cleaning up old Docker images and containers..."

# Remove dangling images and stopped containers
docker system prune -f 2>/dev/null || echo "Docker system prune failed (may not be available)"

# Remove old discord-bot images (keep only the latest 3)
echo "Removing old discord-bot images..."
echo "Current discord-bot images:"
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}" | grep discord-bot || echo "No discord-bot images found"

# Get discord-bot image IDs, sorted by creation time (newest first), skip the newest 3
OLD_DISCORD_IMAGES=$(docker images --format "{{.ID}} {{.CreatedAt}} {{.Repository}}" | grep discord-bot | sort -k2 -r | tail -n +4 | awk '{print $1}' || echo "")

if [ -n "$OLD_DISCORD_IMAGES" ]; then
  echo "Removing old discord-bot images: $OLD_DISCORD_IMAGES"
  for img in $OLD_DISCORD_IMAGES; do
    docker rmi $img 2>/dev/null && echo "Removed image: $img" || echo "Could not remove image: $img (may be in use)"
  done
else
  echo "No old discord-bot images to remove"
fi

# Remove unused volumes
docker volume prune -f 2>/dev/null || echo "Docker volume prune not available"

echo "Disk usage after cleanup:"
df -h /

echo "Pulling Docker image: $FULL_IMAGE_PATH"

# Pull the latest Docker image
docker pull $FULL_IMAGE_PATH

echo "Stopping existing Discord Bot container..."

# Stop and remove existing container if it exists
docker stop discord-bot 2>/dev/null || true
docker rm discord-bot 2>/dev/null || true

echo "Starting Discord Bot container..."

# Parse environment variables from metadata
echo "Reading environment variables from individual metadata keys..."

# Build docker run command with environment variables
DOCKER_CMD=(docker run -d --name discord-bot --restart unless-stopped -p 3000:3000)

# List of expected environment variables
ENV_KEYS=(
    "DISCORD_BOT_TOKEN"
    "CLIENT_ID"
    "NODE_ENV"
    "GOOGLE_SERVICE_ACCOUNT_EMAIL"
    "GOOGLE_SHEETS_SPREADSHEET_ID"
)

# Fetch each environment variable from metadata
for key in "${ENV_KEYS[@]}"; do
    echo "Fetching env-$key from metadata..."
    VALUE=$(curl -s "http://metadata.google.internal/computeMetadata/v1/instance/attributes/env-$key" -H "Metadata-Flavor: Google" 2>/dev/null || echo "")
    
    if [ -n "$VALUE" ]; then
        echo "  ✓ $key: Found (length: ${#VALUE})"
        # Add to docker command array
        DOCKER_CMD+=(-e "$key=$VALUE")
    else
        echo "  ✗ $key: Not found in metadata"
    fi
done

# Special handling for GOOGLE_PRIVATE_KEY (Base64 encoded)
echo "Fetching and decoding GOOGLE_PRIVATE_KEY from metadata..."
GOOGLE_PRIVATE_KEY_B64=$(curl -s "http://metadata.google.internal/computeMetadata/v1/instance/attributes/env-GOOGLE_PRIVATE_KEY_B64" -H "Metadata-Flavor: Google" 2>/dev/null || echo "")

if [ -n "$GOOGLE_PRIVATE_KEY_B64" ]; then
    echo "  ✓ GOOGLE_PRIVATE_KEY_B64: Found (length: ${#GOOGLE_PRIVATE_KEY_B64})"
    
    # Decode Base64 to get the actual private key
    GOOGLE_PRIVATE_KEY=$(echo "$GOOGLE_PRIVATE_KEY_B64" | base64 -d 2>/dev/null || echo "")
    
    if [ -n "$GOOGLE_PRIVATE_KEY" ]; then
        echo "  ✓ GOOGLE_PRIVATE_KEY decoded successfully (length: ${#GOOGLE_PRIVATE_KEY})"
        echo "  First 50 chars: ${GOOGLE_PRIVATE_KEY:0:50}..."
        echo "  Last 50 chars: ...${GOOGLE_PRIVATE_KEY: -50}"
        
        # Add to docker command array
        DOCKER_CMD+=(-e "GOOGLE_PRIVATE_KEY=$GOOGLE_PRIVATE_KEY")
    else
        echo "  ✗ Failed to decode GOOGLE_PRIVATE_KEY from Base64"
    fi
else
    echo "  ✗ GOOGLE_PRIVATE_KEY_B64: Not found in metadata"
fi

# Add the image to the command
DOCKER_CMD+=("$FULL_IMAGE_PATH")

echo "Starting Docker container..."
echo "Command: ${DOCKER_CMD[*]:0:5} ... [environment variables] ... ${DOCKER_CMD[-1]}"

# Execute the docker run command
"${DOCKER_CMD[@]}"

echo "Waiting for container to start..."
sleep 10

# Debug: Check environment variables inside container
echo "Debugging environment variables inside container..."
if docker ps | grep -q discord-bot; then
    echo "Checking environment variables inside container:"
    
    # Check basic environment variables
    for key in NODE_ENV DISCORD_BOT_TOKEN CLIENT_ID GOOGLE_SERVICE_ACCOUNT_EMAIL GOOGLE_SHEETS_SPREADSHEET_ID; do
        VALUE=$(docker exec discord-bot env | grep "^$key=" | cut -d'=' -f2- 2>/dev/null || echo "")
        if [ -n "$VALUE" ]; then
            echo "  ✓ $key: Set (length: ${#VALUE})"
        else
            echo "  ✗ $key: NOT SET"
        fi
    done
    
    # Special handling for GOOGLE_PRIVATE_KEY
    echo "Checking GOOGLE_PRIVATE_KEY format:"
    PRIVATE_KEY=$(docker exec discord-bot env | grep "^GOOGLE_PRIVATE_KEY=" | cut -d'=' -f2- 2>/dev/null || echo "")
    if [ -n "$PRIVATE_KEY" ]; then
        echo "  ✓ GOOGLE_PRIVATE_KEY: Set (length: ${#PRIVATE_KEY})"
        echo "  First 50 chars: ${PRIVATE_KEY:0:50}..."
        echo "  Last 50 chars: ...${PRIVATE_KEY: -50}"
        echo "  Contains BEGIN PRIVATE KEY: $(echo "$PRIVATE_KEY" | grep -c "BEGIN PRIVATE KEY" || echo "0")"
        echo "  Contains END PRIVATE KEY: $(echo "$PRIVATE_KEY" | grep -c "END PRIVATE KEY" || echo "0")"
        echo "  Contains \\n: $(echo "$PRIVATE_KEY" | grep -c "\\\\n" || echo "0")"
        
        # Count actual newlines in the private key
        NEWLINE_COUNT=$(echo "$PRIVATE_KEY" | wc -l)
        echo "  Actual newline count: $NEWLINE_COUNT"
        
        # Check if it looks like a valid private key format
        if echo "$PRIVATE_KEY" | grep -q "BEGIN PRIVATE KEY" && echo "$PRIVATE_KEY" | grep -q "END PRIVATE KEY"; then
            echo "  ✓ Private key appears to have valid PEM format"
        else
            echo "  ⚠ Private key may be missing PEM headers/footers"
        fi
    else
        echo "  ✗ GOOGLE_PRIVATE_KEY: NOT SET"
    fi
    
    # Test Google Sheets authentication inside container
    echo "Testing Google Sheets authentication inside container..."
    docker exec discord-bot node -e "
        const { GoogleAuth } = require('google-auth-library');
        
        const privateKey = process.env.GOOGLE_PRIVATE_KEY;
        const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        
        console.log('Testing Google authentication...');
        console.log('Email:', email ? 'SET' : 'NOT SET');
        console.log('Private key:', privateKey ? 'SET' : 'NOT SET');
        
        if (privateKey && email) {
            try {
                // Test key normalization
                const normalizePrivateKey = (key) => {
                    if (!key) throw new Error('Private key is empty');
                    if (key.includes('-----BEGIN PRIVATE KEY-----')) return key;
                    const cleanKey = key.replace(/\\\\n/g, '\n').trim();
                    return \`-----BEGIN PRIVATE KEY-----\n\${cleanKey}\n-----END PRIVATE KEY-----\`;
                };
                
                const normalizedKey = normalizePrivateKey(privateKey);
                console.log('Normalized key first 50 chars:', normalizedKey.substring(0, 50));
                console.log('Normalized key contains proper headers:', normalizedKey.includes('-----BEGIN PRIVATE KEY-----'));
                
                const auth = new GoogleAuth({
                    credentials: {
                        client_email: email,
                        private_key: normalizedKey
                    },
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                });
                
                auth.getAccessToken().then(() => {
                    console.log('✓ Google authentication successful!');
                }).catch(err => {
                    console.log('✗ Google authentication failed:', err.message);
                });
            } catch (err) {
                console.log('✗ Error during authentication test:', err.message);
            }
        } else {
            console.log('✗ Missing required environment variables');
        }
    " 2>&1 || echo "Failed to run authentication test"
    
    echo ""
else
    echo "Discord bot container is not running - skipping environment variable check"
fi

# Check container status
if docker ps | grep -q discord-bot; then
    echo "Discord Bot container started successfully at $(date)"
    echo "Container status:"
    docker ps --filter name=discord-bot --format "table {{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo "Container logs:"
    docker logs discord-bot
    echo ""
    echo "Environment variables inside container:"
    docker exec discord-bot env | grep -E "^(DISCORD_BOT_TOKEN|CLIENT_ID|NODE_ENV|GOOGLE_)" || echo "No Discord/Google environment variables found"
else
    echo "Failed to start Discord Bot container at $(date)"
    echo "Container logs (if any):"
    docker logs discord-bot 2>&1 || true
    echo ""
    echo "All containers:"
    docker ps -a
    exit 1
fi

echo "Final disk usage monitoring..."
DISK_USAGE=$(df / | awk '/\// {print $(NF-1)}' | sed 's/%//')
echo "Current disk usage: ${DISK_USAGE}%"

if [ "$DISK_USAGE" -gt 85 ]; then
    echo "⚠️  WARNING: Disk usage is high (${DISK_USAGE}%). Consider increasing disk size or implementing more aggressive cleanup."
    echo "Docker system usage:"
    docker system df 2>/dev/null || echo "Docker system df not available"
    echo "Top disk usage by directory:"
    du -sh /var/lib/docker/* 2>/dev/null | sort -hr | head -5 || echo "Could not analyze Docker directory usage"
elif [ "$DISK_USAGE" -gt 70 ]; then
    echo "⚠️  NOTICE: Disk usage is moderate (${DISK_USAGE}%). Monitoring recommended."
else
    echo "✅ Disk usage is acceptable (${DISK_USAGE}%)."
fi

echo "Startup script completed at $(date)"