import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { main } from '../../src/scripts/migrate-sheets-to-postgres';
import { fixture } from './fixture';

describe('migration CLI entrypoint', () => {
  it('executes snapshot validation through the entrypoint without Discord or Google credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-cli-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('DATABASE_ADMIN_URL', '');
    try {
      const snapshot = join(directory, 'snapshot.json');
      const report = join(directory, 'report.json');
      await writeFile(snapshot, JSON.stringify(fixture()));
      await main(['--snapshot', snapshot, '--dry-run', '--report', report]);
      expect(JSON.parse(await readFile(report, 'utf8')).status).toBe('validated');
      expect(log).toHaveBeenCalledOnce();
    } finally { log.mockRestore(); vi.unstubAllEnvs(); await rm(directory, { recursive: true }); }
  });
  it.each([[], ['--snapshot', 'input.json', '--fetch', '--dry-run'], ['--snapshot', 'input.json', '--unknown']])('rejects invalid CLI mode %j', async args => {
    await expect(main(args)).rejects.toThrow();
  });
});
