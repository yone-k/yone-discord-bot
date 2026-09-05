# PostgreSQL 運用

Bot・PostgreSQL 18・運用CLIは `/home/yone/discord-bot` のCompose project `discord-bot` に置く。DBポートは公開せず、Botのhealthだけを `127.0.0.1:3000` へ公開する。DB・WAL・一時ファイル・dumpは外付けext4 HDDに保存する。Home Assistant、Dockerの保存先、OSは変更しない。DockerログはBot・DBとも10MB×3であり、SDカードへのログとイメージ更新の書込みは残る。

初回の本番作業は [移行手順](postgres-migration.md) のフェーズA完了後に行う。ここにあるディスク操作、OAuth、Piへの配置はフェーズBの手順である。

## 外付けHDD

管理端末から `ssh ras-pi` で入り、`lsblk -o NAME,SIZE,MODEL,SERIAL,FSTYPE,MOUNTPOINTS,UUID` と `findmnt` で対象を照合する。予定はTOSHIBA MQ01ABD100 約1TB、現状 `/dev/sda1` のNTFS、`/media/yone/HDPC-UT`。**機種・容量・シリアルの一致と既存データのバックアップを確認できなければ停止する。** デバイス名だけで判断しない。

照合したパーティションを `db_partition` に設定してから実行する。Home AssistantやSDカードのパーティションを選ばない。

```bash
sudo umount "$db_partition"
sudo mkfs.ext4 -L discord-bot-db "$db_partition"
sudo blkid "$db_partition"
sudo install -d -m 755 /srv/discord-bot-storage
```

得られた実UUIDを `/etc/fstab` に1行追加する（`<UUID>`は置換）。

```text
UUID=<UUID> /srv/discord-bot-storage ext4 defaults,nofail 0 2
```

```bash
sudo mount /srv/discord-bot-storage
findmnt -M /srv/discord-bot-storage -o UUID,FSTYPE,OPTIONS
sudo chown yone:yone /srv/discord-bot-storage
install -d -m 755 /srv/discord-bot-storage/postgres
install -d -m 700 /srv/discord-bot-storage/{backups,migration}
```

`postgres`の親ディレクトリはyone所有で維持する。`PGDATA=postgres/18/docker` は公式entrypointがpostgresユーザー所有・700にする。ホストのpreflightはUUID・ext4・書込・識別ファイルを検査し、700のPGDATAをyoneで読まない。コンテナentrypointが識別ファイルと `PG_VERSION=18` を確認してから権限を落とす。未マウント時はbindの `create_host_path: false`、空・別クラスタ時はentrypointで停止し、自動再起動でも新規DBを作らない。

## 設定ファイル

すべてyone所有、600、Git管理外にする。`.env.storage` と `.env.backup` は運用スクリプトがshell設定として読み込むため、下表の代入だけを記載する。秘密値を引数・シェル履歴・ログへ出さず、エディタまたは管理端末からSSH標準入力で配置する。展開済み `docker compose config` は表示せず `--quiet` を使う。

| ファイル | 内容・配布先 |
|---|---|
| `.env.storage` | `STORAGE_UUID=実UUID`、`STORAGE_ROOT=/srv/discord-bot-storage`、`OPS_UID=1000`、`OPS_GID=1000`。UID/GIDは `id yone` と照合。ホストとCompose補間 |
| `.env` | `DISCORD_BOT_TOKEN`、`CLIENT_ID`、`DATABASE_URL=postgresql://bot:…@db/discord_bot`、`NODE_ENV=production`。Botだけ |
| `.env.db-admin` | `POSTGRES_USER=discord_admin`、`POSTGRES_PASSWORD`、`POSTGRES_DB=discord_bot`、`DATABASE_ADMIN_URL=postgresql://discord_admin:…@db/discord_bot`、`DATABASE_BOT_ROLE=bot`。db/db-init/ops/migrationだけ |
| `.env.migration` | `GOOGLE_SHEETS_SPREADSHEET_ID`、`GOOGLE_SERVICE_ACCOUNT_EMAIL`、`GOOGLE_PRIVATE_KEY`。migrationだけ。切替成功後削除 |
| `.env.backup` | `RCLONE_CONFIG=/home/yone/discord-bot/rclone.conf`、`RCLONE_REMOTE=bot-drive:`。ホストだけ |
| `rclone.conf` | Desktop OAuth client設定・refresh token・専用 `root_folder_id`。Bot/DBへ渡さない |

URLのユーザー名・パスワード中の予約文字はURLエンコードする。Botロールに管理ロールを流用しない。通常Botは管理URLもGoogle設定も受け取らない。`.env`は管理端末のJSON（上表の4項目だけ）を `node scripts/pi-env.mjs` に標準入力し、出力をSSH標準入力で `scripts/install-pi-env.sh` へ渡してもよい。JSON・秘密値はログへ表示しない。installは完全性とCompose検証後に600で原子的に置換する。

Composeの手動実行前は、Piの配置先で以下を設定する。`BOT_IMAGE` は検証済みの実ダイジェストを指定する。

```bash
cd /home/yone/discord-bot
set -a; . ./.env.storage; set +a
export BOT_IMAGE='ghcr.io/yone-k/yone-discord-bot@sha256:<64桁>'
docker compose config --quiet
```

## 初期化とスキーマ

公式PostgreSQL 18.6のARM64 manifest `sha256:6fd9e18b6fedda0a34e4d53ad6fdbd4289a217300af573c31ec7084e6d9cf329` を固定している。2026-09-05に公式registryのplatform/versionを照合した。PG18は `/var/lib/postgresql` をmountし、その下の `18/docker` をPGDATAとする。[公式イメージ仕様](https://hub.docker.com/_/postgres)

初回だけ `bash scripts/pi-db-init.sh` を実行する。preflight、通常DB停止・PGDATA空確認、明示許可ファイル作成、db-init起動、TCPで初期化完了確認、db-init停止・削除、通常db起動まで進む。`db-init` は再起動しない。途中失敗時は調査し、既存PGDATAを削除して自動的に再試行しない。

Bot用ロールを作成してからDDLを適用する。通常dbに対して管理ユーザーで `docker compose exec db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` を開き、`CREATE ROLE bot LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;` と `\password bot` でパスワードを設定する。パスワードは対話入力し、SQLへ埋め込まない。その後 `docker compose --profile ops run --rm --no-deps ops` を実行する。CLIは管理者所有の9テーブルとBotの限定権限を設定する。

通常のschema変更時は、CI入口・timer・Botを停止してdumpを保全し、`docker compose --profile ops run --rm --no-deps ops` で適用する。`ops --check` は期待するversion/checksumとの一致を調べるだけでDDLを実行しない。自動updaterは候補と切戻し先の両方をこの検査に通し、不一致やCLIを持たないSheets版を起動しない。

## Driveバックアップ

Piに `python3`、`rclone`、`flock`、`findmnt` があることを確認する。不足時だけ該当ツールを導入する。Node/npmやpgクライアントをPiホストへ入れる必要はない。

個人Googleアカウント用のDesktop OAuth clientを用意し、同意画面を長期運用で7日失効するTesting状態から変更する。管理端末の `rclone config` で `bot-drive` remoteを作り、Drive backend、専用client ID/secret、scope `drive.file` を選んで認可する。rcloneで新しいBot専用フォルダを作り、そのIDを調べてremoteの `root_folder_id` に設定する。このremoteが当該フォルダを指すことを `rclone lsf bot-drive:` で確認してから、設定をPiの `rclone.conf` に600で移す。共有Drive・Sheetsサービスアカウントは使わない。[rclone Drive](https://rclone.org/drive/)、[Google OAuth有効期限](https://developers.google.com/identity/protocols/oauth2#expiration)

`bash scripts/pi-backup.sh` は `pg_dump -Fc`、manifest作成、dump/manifest転送、両方の再ダウンロード・SHA-256/manifest一致、正常世代確定、古い世代削除の順に動く。manifestには取得時刻・schema版・Botダイジェストを含む。Bot起動前の初回dumpでは `BOT_IMAGE` に新DB版を明示する。通常timerはupdaterのcurrentから読み取る。

HDDとDriveには正常な直近3世代を保持する。転送直後の4世代と再ダウンロード分の作業領域が必要であり、実サイズはリハーサルのdumpから算出する。削除は、この処理が作成しHDD上で検証済み記録を持つ世代の完全一致ファイル名だけが対象。`--drive-use-trash=false` で完全削除し、Drive全体のゴミ箱操作はしない。HDD交換等で検証済み記録を失った場合は、旧Drive世代を自動削除しない。正常世代をダウンロード・照合してから運用者が容量と保持を整理する。

失敗時は非0終了し、理由の分類と `last-success` をjournalに残す。過去の正常世代は削除せず、当該実行の一時ファイルだけ清掃する。OAuth失効は管理端末で再認可して設定を再配置、容量不足は対象フォルダ/HDDの容量を確保、DB接続失敗はmount・db・資格情報を確認してから `sudo systemctl start discord-bot-backup.service` で再実行する。

切替受入後にunitを配置・検証して有効化する。

```bash
sudo install -m 644 deploy/systemd/discord-bot-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/discord-bot-backup.service /etc/systemd/system/discord-bot-backup.timer
sudo systemctl enable --now discord-bot-backup.timer
```

毎日03:00 Asia/Tokyo、停止中は次回起動時に1回実行する。日次で `systemctl list-timers discord-bot-backup.timer`、`systemctl status discord-bot-backup.service`、`journalctl -u discord-bot-backup.service --since yesterday` とHDDの `backups/last-success` を照合する。成功が続いても最大約24時間の更新を失いうる。失敗が続くと損失期間は24時間を超える。

## 復元

1. `.deploy-state/ci-disabled` を作り、`pi-update.sh --block` の成功を確認し、timerを両方停止する。実行中の更新service終了とflockの解放を確認してBotを停止する。現状DBは削除せず保持する。ディスク故障時は停止DBの物理コピーまたは取得可能なdumpを別の安全な領域へ保全する。
2. 新HDDでは上記の照合・初期化を行い、管理ロール・Botロール・接続設定を再作成する。dumpはロールのパスワードを含まない。同じロール名を用意し、復元先には業務テーブルを作らない。
3. 正常世代の正確なmanifest名と、存在しない新DB名を指定する。

   ```bash
   bash scripts/pi-restore.sh discord-bot-<実世代>.manifest.json discord_bot_restored
   ```

   Driveからdump/manifestをダウンロードしhashを照合してから新DBを作る。既存DBへの復元は拒否し、単一transactionでrestoreする。失敗した新DBは調査用に残し、別の新DB名で再試行する。元DBの上書き・dropはしない。
4. `.env.db-admin.restore` に新DBへの管理URLと同じロール設定を600で用意し、`DB_ADMIN_ENV_FILE=.env.db-admin.restore docker compose --profile ops run --rm --no-deps ops --check` を実行する。管理SQLで業務7テーブルの件数、全外部キーがvalidated、`data_imports` が1件、schema履歴を確認・記録する。`pg_restore` の非0やconstraint失敗を無視しない。
5. `.env` のBot用URLを新DBへ変更し、manifestの対応イメージを `BOT_IMAGE` に指定して `pi-start.sh` で起動する。health、Discord、各機能の表示・操作・通知状態を確認してDB版を継続する。失敗時はDB版を停止・保全・修復する。Sheetsへ戻さない。
6. 正常版のstateを確認し、明示的な `--recover` または記録再登録後、CI入口とtimerを再開する。日次backupの対象DBも `.env.db-admin` の `POSTGRES_DB` と `DATABASE_ADMIN_URL` を新DBに揃え、dbサービスを再作成して適用する。これは接続先設定の変更であり、既存クラスタを再初期化しない。

バックアップ取得後にDiscordへ送った通知は巻き戻らず、復元後に再通知される可能性がある。
