import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import { assertSnapshot, convertSnapshot, makePlan, SnapshotValidationError, type MigrationPlan } from './conversion';
import { importRows, reportFor, type MigrationReport } from './importer';
import { assertSchema } from '../db/schema';

export interface MigrationOptions { snapshot: string; plan?: string; report?: string; dryRun?: boolean; databaseUrl?: string }

async function readPlan(path: string, sha: string): Promise<MigrationPlan | undefined> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const plan = JSON.parse(text) as MigrationPlan;
  if (plan.snapshot_sha256 !== sha) throw new Error('Migration plan SHA mismatch');
  if (!plan.list_ids || typeof plan.list_ids !== 'object' || Array.isArray(plan.list_ids)) throw new Error('Invalid UUID plan');
  return plan;
}

export async function runMigration(options: MigrationOptions): Promise<MigrationReport> {
  const directory = dirname(options.snapshot);
  const planPath = options.plan ?? join(directory, 'migration-plan.json');
  const reportPath = options.report ?? join(directory, `migration-report-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`);
  if (new Set([options.snapshot, planPath, reportPath].map(p => resolve(p))).size !== 3) throw new Error('Snapshot, plan and report paths must be distinct');
  // Reserve a new file before any source/DB work. O_EXCL rejects existing files,
  // including symbolic and hard-link aliases; later writes use this same descriptor.
  const reportFile = await open(reportPath, 'wx', 0o600);
  let report: MigrationReport | undefined;
  let sha: string | undefined;
  let inputSheets: string[] = [];
  try {
    const bytes = await readFile(options.snapshot);
    sha = createHash('sha256').update(bytes).digest('hex');
    const snapshot: unknown = JSON.parse(bytes.toString('utf8'));
    assertSnapshot(snapshot);
    inputSheets = snapshot.sheets.map(sheet => sheet.title);
    let plan = await readPlan(planPath, sha);
    if (options.dryRun) {
      // An optional destination is read-only here, including recovery of a lost import plan.
      if (!plan && options.databaseUrl) {
        const pool = new Pool({ connectionString: options.databaseUrl, max: 1, connectionTimeoutMillis: 10000, options: '-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=10000' });
        try {
          await assertSchema(pool);
          const marker = (await pool.query('SELECT snapshot_sha256,report FROM data_imports')).rows[0];
          if (marker && marker.snapshot_sha256 !== sha) throw new Error('Imported snapshot SHA mismatch');
          if (marker) plan = { snapshot_sha256: sha, list_ids: marker.report.list_ids };
        } finally { await pool.end(); }
      }
      plan ??= makePlan(snapshot, sha);
      report = reportFor(convertSnapshot(snapshot, plan), plan);
      await persistPlan(planPath, plan);
      await writeReport(reportFile, report);
    } else {
      if (!options.databaseUrl) throw new Error('DATABASE_ADMIN_URL or --database-url is required');
      const pool = new Pool({ connectionString: options.databaseUrl, max: 1, connectionTimeoutMillis: 10000, options: '-c timezone=UTC -c statement_timeout=60000 -c lock_timeout=10000' });
      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(36002)');
          await assertSchema(client);
          await client.query('LOCK TABLE data_imports,list_channels,inventory_channels,remind_channels,list_items,inventory_items,remind_tasks,remind_task_inventory_items IN EXCLUSIVE MODE');
          if (!plan) {
            const marker = (await client.query('SELECT snapshot_sha256,report FROM data_imports')).rows[0];
            if (marker && marker.snapshot_sha256 !== sha) throw new Error('Imported snapshot SHA mismatch');
            plan = marker ? { snapshot_sha256: sha, list_ids: marker.report.list_ids } : makePlan(snapshot, sha);
          }
          report = reportFor(convertSnapshot(snapshot, plan), plan);
          await persistPlan(planPath, plan);
          await importRows(client, report);
          await writeReport(reportFile, report);
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      } finally { await pool.end(); }
    }
    return report;
  } catch (error) {
    const partial = error instanceof SnapshotValidationError ? error.partial : undefined;
    await writeReport(reportFile, { input_sheets: inputSheets, ...partial, ...report, status: 'failed', snapshot_sha256: sha, error: (error as Error).message });
    throw error;
  } finally { await reportFile.close(); }
}

async function writeReport(file: FileHandle, report: unknown): Promise<void> {
  const content = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  let offset = 0;
  while (offset < content.length) {
    const { bytesWritten } = await file.write(content, offset, content.length - offset, offset);
    if (bytesWritten === 0) throw new Error('Unable to write migration report');
    offset += bytesWritten;
  }
  await file.truncate(content.length);
}

async function persistPlan(path: string, plan: MigrationPlan): Promise<void> {
  try { await writeFile(path, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const current = await readPlan(path, plan.snapshot_sha256);
    if (!isDeepStrictEqual(current, plan)) throw new Error('Concurrent or inconsistent migration plan');
  }
}
