// Management terminal only. Read GCE instance JSON from stdin; write Compose env.
import { readFileSync } from 'node:fs';

try {
  const items = JSON.parse(readFileSync(0, 'utf8')).metadata.items;
  const required = ['DISCORD_BOT_TOKEN', 'CLIENT_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_PRIVATE_KEY_B64', 'NODE_ENV'];
  const values = {};
  for (const key of required) {
    const matches = items.filter(item => item.key === `env-${key}`);
    if (matches.length !== 1 || typeof matches[0].value !== 'string' || !matches[0].value.trim()) throw new Error();
    values[key] = matches[0].value;
  }
  const encoded = values.GOOGLE_PRIVATE_KEY_B64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error();
  const key = Buffer.from(encoded, 'base64').toString('utf8').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  if (!key.startsWith('-----BEGIN PRIVATE KEY-----\n') || !key.trimEnd().endsWith('\n-----END PRIVATE KEY-----')) throw new Error();
  delete values.GOOGLE_PRIVATE_KEY_B64;
  delete values.NODE_ENV;
  values.GOOGLE_PRIVATE_KEY = key.replace(/\n/g, '\\n');
  values.NODE_ENV = 'production';
  const lines = Object.entries(values).map(([name, value]) => {
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error();
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$');
    return `${name}="${escaped}"`;
  });
  process.stdout.write(`${lines.join('\n')}\n`);
} catch {
  process.stderr.write('Invalid GCE environment metadata; no configuration generated\n');
  process.exitCode = 1;
}
