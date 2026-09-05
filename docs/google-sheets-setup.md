# Sheets移行CLIの認証

Sheetsの認証情報は、移行元スナップショットを取得するCLIで使用する。通常のBotはPostgreSQLへ接続する。

## 設定

既存のサービスアカウントと秘密鍵を使い、移行元スプレッドシートへの読み取り権限を確認する。PiのBot専用ディレクトリに、所有者`yone`・権限600の`.env.migration`を配置する。

```dotenv
GOOGLE_SHEETS_SPREADSHEET_ID=移行元のID
GOOGLE_SERVICE_ACCOUNT_EMAIL=既存サービスアカウントのメールアドレス
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n既存の秘密鍵\n-----END PRIVATE KEY-----\n"
```

CLIは秘密鍵中の文字列`\n`を改行へ変換する。完全なPEM形式の秘密鍵を指定する。認証情報はComposeの`migration`サービスだけへ渡し、Bot・DB・イメージ・Gitへ含めない。

## 取得と検証

本番Sheetsの読み取りは、実装・合成データ検証の完了後に[移行手順](postgres-migration.md)に従って行う。CLIの`--fetch --snapshot <ファイル>`で全列を固定ファイルへ取得し、`--snapshot <ファイル> --dry-run`で検査する。使用するAPIは`spreadsheets.get`と`values.get`で、シートへの書き込みは行わない。

認証失敗時はサービスアカウントの共有権限、スプレッドシートID、秘密鍵のPEM形式を確認する。設定値全体や秘密鍵をログへ出力しない。DB版への切替完了後に`.env.migration`を削除する。Google Driveバックアップの認証は、[DB運用手順](postgres-operations.md)で設定する個人アカウントのOAuthを使用する。
