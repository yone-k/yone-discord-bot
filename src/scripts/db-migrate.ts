import { Pool } from 'pg';
import { applyMigrations, assertSchema } from '../db/schema';

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: db-migrate [--check]');
  const connectionString = process.env.DATABASE_ADMIN_URL;
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL is required');
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    if (args.includes('--check')) await assertSchema(pool);
    else {
      if (!process.env.DATABASE_BOT_ROLE) throw new Error('DATABASE_BOT_ROLE is required');
      await applyMigrations(pool, process.env.DATABASE_BOT_ROLE);
    }
  } finally { await pool.end(); }
}

if (require.main === module) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Schema operation failed'); process.exitCode = 1; });
}
