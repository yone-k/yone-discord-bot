import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

it('backs up, verifies, retains and restores through mocked Docker and Drive boundaries', () => {
  const result = spawnSync('python3', ['-B', 'tests/operations/backup_checks.py'], { encoding: 'utf8', timeout: 20000 });
  expect(result.stderr).not.toContain('FAILED');
  expect(result.status, result.stderr).toBe(0);
});
