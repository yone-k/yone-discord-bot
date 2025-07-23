# Build stage
FROM node:22-alpine AS builder

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
FROM node:22-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discord-bot -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Change ownership to non-root user
RUN chown -R discord-bot:nodejs /app

# Switch to non-root user
USER discord-bot

# Expose port for health check
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]