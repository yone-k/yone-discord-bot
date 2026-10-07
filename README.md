# Discord Bot

UIはTypeScript（discord.js）、業務処理はGo HTTP API（Core API）、データはPostgreSQL 18。
本番はRaspberry Pi 5で動かし、mainへのマージでGitHub Actions経由で自動更新される。

## 開発

`.env.example` を `.env` にコピーして設定する。Core APIにはBotと同じ `CORE_API_TOKEN`、`DATABASE_URL`、`DISCORD_BOT_TOKEN` を渡す。

```bash
npm ci
(cd backend && MIGRATIONS_DIR=../db/migrations go run ./cmd/api)  # 別ターミナル
npm run dev
```

- API契約は `api/main.tsp` を編集し、`npm run api:generate` と `(cd backend && go generate ./...)` で再生成する（生成物は手編集しない）。
- migrationは起動時に適用されないので手動で流す。
- 統合テスト（`npm run test:db`、`npm run test:api-integration`）は、テスト専用PG18コンテナの `TEST_DATABASE_URL`・`TEST_DB_CONTAINER_ID` が必要（DBは初期化される）。

```bash
npm run check && npm test && npm run build-only
(cd backend && go vet ./... && go test ./...)
```

## 運用メモ（Pi）

### スキーマ移行

自動更新はDDLを流さず、スキーマが合わないイメージへの更新を拒否する。移行後は旧イメージに戻せない。

1. マージ前に `.deploy-state/ci-disabled` を作成し、`bash scripts/pi-update.sh --block`
2. `bash scripts/pi-backup.sh` でバックアップ
3. `BOT_IMAGE` に新イメージのdigestを指定し、`.env.storage` を読み込み、同じコミットの `scripts/`・`deploy/`・Compose定義を配置
4. Bot → APIの順に `docker compose -p discord-bot stop`、`docker compose -p discord-bot --profile ops run --rm --no-deps ops` で移行（`--check` で確認）
5. `bash scripts/pi-update.sh --recover "$BOT_IMAGE"` で起動し、`--verify "$BOT_IMAGE"` で確認
6. `curl http://127.0.0.1:8080/health` が200なら `.deploy-state/ci-disabled` を削除

### Discord出力の復旧

送信結果が不明な出力は `./bin/outputctl` で確認・復旧する（`list` / `detail` / `reconcile` / `bind` / `retry-confirm-unsent` / `cancel`）。
DB復元後は出力が停止状態（`DISCORD_OUTPUT_ENABLED=false`）になるので、`outputctl` で確認してからtrueに戻す。
