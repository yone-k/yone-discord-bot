import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigration } from '../../src/migration/runner';
import { fixture } from './fixture';

describe('migration file workflow', () => {
  it('runs dry-run without database access, fixes UUID plan and emits all-field report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      await writeFile(snapshot, JSON.stringify(fixture()));
      const first = await runMigration({ snapshot, dryRun: true });
      const plan = await readFile(join(directory, 'migration-plan.json'), 'utf8');
      const second = await runMigration({ snapshot, dryRun: true });
      expect(first.status).toBe('validated');
      expect(second.list_ids).toEqual(first.list_ids);
      expect(await readFile(join(directory, 'migration-plan.json'), 'utf8')).toBe(plan);
      expect(first.source_counts.list_items).toBe(1);
      expect(first.mapped_rows.list_items[0].last_notified_at).toBe('2026-09-05T00:00:00.001Z');
    } finally { await rm(directory, { recursive: true }); }
  });
  it('refuses a changed snapshot and persists failure report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      const report = join(directory, 'failure.json');
      await writeFile(snapshot, JSON.stringify(fixture()));
      await runMigration({ snapshot, dryRun: true });
      await writeFile(snapshot, `${JSON.stringify(fixture())}\n`);
      await expect(runMigration({ snapshot, report, dryRun: true })).rejects.toThrow('SHA');
      expect(JSON.parse(await readFile(report, 'utf8')).status).toBe('failed');
    } finally { await rm(directory, { recursive: true }); }
  });
  it('preserves input inventory and source row diagnostics in a failed report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      const report = join(directory, 'failure.json');
      const input = fixture(); input.sheets[3].rows[1][3] = 'invalid';
      await writeFile(snapshot, JSON.stringify(input));
      await expect(runMigration({ snapshot, report, dryRun: true })).rejects.toThrow('list_1:2');
      const failure = JSON.parse(await readFile(report, 'utf8'));
      expect(failure.input_sheets).toContain('list_1');
      expect(failure.excluded_sheets).toContain('remind_list_3_backup_20260905');
      expect(failure.error).toContain('list_1:2');
    } finally { await rm(directory, { recursive: true }); }
  });
  it('rejects colliding artifact paths before changing the snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      const original = JSON.stringify(fixture());
      await writeFile(snapshot, original);
      await expect(runMigration({ snapshot, report: snapshot, dryRun: true })).rejects.toThrow('distinct');
      expect(await readFile(snapshot, 'utf8')).toBe(original);
    } finally { await rm(directory, { recursive: true }); }
  });
  it.each([
    ['symlink', symlink, false], ['hardlink', link, false],
    ['symlink during validation failure', symlink, true], ['hardlink during validation failure', link, true]
  ] as const)('rejects report %s without changing the source', async (_name, alias, invalid) => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      const report = join(directory, 'report.json');
      const input = fixture();
      if (invalid) input.sheets[3].rows[1][3] = 'invalid';
      const original = JSON.stringify(input);
      await writeFile(snapshot, original);
      await alias(snapshot, report);
      await expect(runMigration({ snapshot, report, dryRun: true })).rejects.toThrow('EEXIST');
      expect(await readFile(snapshot, 'utf8')).toBe(original);
    } finally { await rm(directory, { recursive: true }); }
  });
  it('preserves existing success reports and reuses the snapshot and UUID plan with a fresh report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      const report = join(directory, 'report.json');
      await writeFile(snapshot, JSON.stringify(fixture()));
      const first = await runMigration({ snapshot, report, dryRun: true });
      const originalReport = await readFile(report, 'utf8');
      await expect(runMigration({ snapshot, report, dryRun: true })).rejects.toThrow('EEXIST');
      expect(await readFile(report, 'utf8')).toBe(originalReport);
      const second = await runMigration({ snapshot, report: join(directory, 'second.json'), dryRun: true });
      expect(second.list_ids).toEqual(first.list_ids);
    } finally { await rm(directory, { recursive: true }); }
  });
  it.each([['symlink', symlink], ['hardlink', link]] as const)('protects UUID plan from report %s aliases', async (_name, alias) => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      const plan = join(directory, 'migration-plan.json');
      const report = join(directory, 'alias.json');
      await writeFile(snapshot, JSON.stringify(fixture()));
      await runMigration({ snapshot, dryRun: true });
      const original = await readFile(plan, 'utf8');
      await alias(plan, report);
      await expect(runMigration({ snapshot, report, dryRun: true })).rejects.toThrow('EEXIST');
      expect(await readFile(plan, 'utf8')).toBe(original);
    } finally { await rm(directory, { recursive: true }); }
  });
  it('rejects snapshot aliases through a symbolic parent directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-test-'));
    try {
      const snapshot = join(directory, 'snapshot.json');
      const original = JSON.stringify(fixture());
      await writeFile(snapshot, original);
      const alias = join(directory, 'parent-alias');
      await symlink(directory, alias);
      await expect(runMigration({ snapshot, report: join(alias, 'snapshot.json'), dryRun: true })).rejects.toThrow('EEXIST');
      expect(await readFile(snapshot, 'utf8')).toBe(original);
    } finally { await rm(directory, { recursive: true }); }
  });
});
