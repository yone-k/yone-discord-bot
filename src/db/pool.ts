import { Pool } from 'pg';

let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const connectionUrl = new URL(process.env.DATABASE_URL);
    const options = `${connectionUrl.searchParams.get('options') ?? ''} -c timezone=UTC`.trim();
    connectionUrl.searchParams.set('options',options);
    pool = new Pool({ connectionString: connectionUrl.toString(), connectionTimeoutMillis: 5000 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = undefined; }
}
