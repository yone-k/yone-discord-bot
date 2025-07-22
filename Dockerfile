# マルチステージビルド: ビルドステージ
FROM node:18-alpine AS builder

WORKDIR /app

# package.json と package-lock.json をコピー
COPY package*.json ./

# 開発依存関係を含めてインストール
RUN npm ci

# ソースコードをコピー
COPY . .

# TypeScriptコンパイルとコマンドビルド
RUN npm run build

# プロダクションステージ
FROM node:18-alpine AS production

WORKDIR /app

# 必要なシステムパッケージをインストール
RUN apk add --no-cache dumb-init

# package.json と package-lock.json をコピー
COPY package*.json ./

# プロダクション依存関係のみインストール
RUN npm ci --only=production && npm cache clean --force

# ビルド成果物をコピー
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/templates ./templates

# 非rootユーザーを作成
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# アプリケーションファイルの所有権を変更
RUN chown -R botuser:nodejs /app

USER botuser

# ヘルスチェック用のポートを公開
EXPOSE 3000

# dumb-initを使用してアプリケーションを起動
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]