// Management terminal only. Read DB Bot settings JSON from stdin; write Compose env.
import { readFileSync } from 'node:fs';

try {
  const items = JSON.parse(readFileSync(0, 'utf8'));
  const required = ['DISCORD_BOT_TOKEN', 'CLIENT_ID', 'DATABASE_URL', 'NODE_ENV'];
  if (Object.keys(items).some(key => !required.includes(key))) throw new Error();
  const values = {};
  for (const key of required) {
    if (typeof items[key] !== 'string' || !items[key].trim()) throw new Error();
    values[key] = items[key];
  }
  const database = new URL(values.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || !database.username || !database.password) throw new Error();
  if (values.NODE_ENV !== 'production' || !/^\d+$/.test(values.CLIENT_ID)) throw new Error();
  const lines = Object.entries(values).map(([name, value]) => {
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error();
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$');
    return `${name}="${escaped}"`;
  });
  process.stdout.write(`${lines.join('\n')}\n`);
} catch {
  process.stderr.write('Invalid DB Bot settings; no configuration generated\n');
  process.exitCode = 1;
}
