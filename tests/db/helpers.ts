import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';

export function testPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  const container = process.env.TEST_DB_CONTAINER_ID;
  if (!connectionString || !container) throw new Error('DATABASE_URL and TEST_DB_CONTAINER_ID are required');
  const running = execFileSync('docker', ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8' }).trim();
  if (running !== 'true') throw new Error('Test PostgreSQL container is not running');
  const url = new URL(connectionString);
  const username = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1)) || username;
  const cluster = execFileSync('docker', ['exec', container, 'psql', '-X', '-At', '-U', username, '-d', database,
    '-c', 'SELECT system_identifier::text FROM pg_control_system()'], { encoding: 'utf8', timeout: 5000 }).trim();
  if (!/^\d+$/.test(cluster)) throw new Error('Cannot identify test PostgreSQL cluster');
  return new Pool({ connectionString, max: 8, connectionTimeoutMillis: 3000,
    // pg-pool awaits onConnect before releasing a connection to its first query.
    // Check every physical connection, including ones opened after a reconnect.
    onConnect: async (client): Promise<void> => {
      const { rows } = await client.query('SELECT system_identifier::text, current_setting(\'server_version_num\') AS server_version_num FROM pg_control_system()');
      if (rows[0]?.system_identifier !== cluster) throw new Error('DATABASE_URL does not match the test container cluster');
      if (Math.floor(Number(rows[0]?.server_version_num) / 10000) !== 18) throw new Error('PostgreSQL 18 is required for integration tests');
    }
  });
}

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
}
