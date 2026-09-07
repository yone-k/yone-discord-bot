// Management terminal only. Read role settings JSON from stdin; write Compose env.
import { readFileSync } from 'node:fs';

try {
  const items = JSON.parse(readFileSync(0, 'utf8'));
  const role = process.argv[2] ?? 'bot';
  if (!['bot', 'api'].includes(role)) throw new Error();
  const required = role === 'bot'
    ? ['DISCORD_BOT_TOKEN', 'CLIENT_ID', 'CORE_API_URL', 'CORE_API_TOKEN', 'NODE_ENV']
    : ['DATABASE_URL', 'CORE_API_TOKEN', 'DISCORD_BOT_TOKEN', 'DISCORD_OUTPUT_ENABLED'];
  if (Object.keys(items).some(key => !required.includes(key))) throw new Error();
  const values = {};
  for (const key of required) {
    if (typeof items[key] !== 'string' || !items[key].trim()) throw new Error();
    values[key] = items[key];
  }
  if (role === 'api') {
    if (!['true', 'false'].includes(values.DISCORD_OUTPUT_ENABLED)) throw new Error();
    const database = new URL(values.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname || !database.username || !database.password) throw new Error();
  } else {
    if (values.CORE_API_URL !== 'http://api:8080') throw new Error();
    if (values.NODE_ENV !== 'production' || !/^\d+$/.test(values.CLIENT_ID)) throw new Error();
  }
  const lines = Object.entries(values).map(([name, value]) => {
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error();
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$');
    return `${name}="${escaped}"`;
  });
  process.stdout.write(`${lines.join('\n')}\n`);
} catch {
  process.stderr.write('Invalid service settings; no configuration generated\n');
  process.exitCode = 1;
}
