FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine AS go-builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -o /out/core-api ./cmd/api && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -o /out/db-migrate ./cmd/db-migrate && \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -o /out/outputctl ./cmd/outputctl

# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code and configuration files
COPY . .

# Build the application
RUN npm run build-only

# Production stage
FROM node:24-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discord-bot -u 1001 && apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/db ./db
COPY --from=go-builder /out/ ./bin/

# Change ownership to non-root user
RUN chown -R discord-bot:nodejs /app

# Switch to non-root user
USER discord-bot

# Expose port for health check
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://localhost:3000/health', {signal: AbortSignal.timeout(5000)}).then(async r => { if (!r.ok || (await r.json()).bot?.ready !== true) process.exit(1); }).catch(() => process.exit(1));"]

# Start the application
CMD ["node", "dist/index.js"]
