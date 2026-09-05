import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runMigration } from '../migration/runner';
import { captureFromEnvironment } from '../migration/sheets';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { snapshot: { type: 'string' }, plan: { type: 'string' }, report: { type: 'string' }, 'database-url': { type: 'string' }, 'dry-run': { type: 'boolean' }, fetch: { type: 'boolean' } }, allowPositionals: false });
  if (!values.snapshot) throw new Error('--snapshot <path> is required');
  if (values.fetch) {
    if (values.plan || values.report || values['database-url'] || values['dry-run']) throw new Error('--fetch must run separately from validation/import');
    const snapshot = await captureFromEnvironment();
    await writeFile(values.snapshot, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`Snapshot saved: ${values.snapshot}`);
    return;
  }
  const report = await runMigration({ snapshot: values.snapshot, plan: values.plan, report: values.report, dryRun: values['dry-run'], databaseUrl: values['database-url'] ?? process.env.DATABASE_ADMIN_URL });
  console.log(JSON.stringify({ status: report.status, snapshot_sha256: report.snapshot_sha256, source_counts: report.source_counts, target_counts: report.target_counts, difference_count: report.difference_count }));
}

if (require.main === module) main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
