"""External command boundaries only are mocked; all generation/filesystem logic runs."""
import importlib.util
import io
from contextlib import redirect_stderr
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', 'deploy/postgres-backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.remote = self.root / 'remote'
        self.remote.mkdir()
        self.calls = []
        self.fail_transfer = False
        self.corrupt = False
        self.disk_full = False
        self.target_exists = True
        self.env = patch.dict(os.environ, {'STORAGE_ROOT': str(self.root), 'RCLONE_REMOTE': 'bot-drive:',
            'BOT_IMAGE': 'ghcr.io/yone-k/yone-discord-bot@sha256:' + 'a' * 64})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.runner = patch.object(backup.subprocess, 'run', side_effect=self.command)
        self.runner.start()
        self.addCleanup(self.runner.stop)

    def command(self, cmd, **kwargs):
        self.calls.append(cmd)
        if cmd[0] == 'rclone':
            if cmd[1] == 'copyto':
                src, dst = cmd[2:4]
                if dst.startswith('bot-drive:') and self.fail_transfer:
                    raise subprocess.CalledProcessError(1, cmd)
                src = self.remote / src.split(':', 1)[1] if src.startswith('bot-drive:') else Path(src)
                dst = self.remote / dst.split(':', 1)[1] if dst.startswith('bot-drive:') else Path(dst)
                data = src.read_bytes()
                if self.corrupt and str(src).endswith('.dump') and str(src).startswith(str(self.remote)):
                    data += b'corrupt'
                dst.write_bytes(data)
            elif cmd[1] == 'deletefile':
                (self.remote / cmd[2].split(':', 1)[1]).unlink(missing_ok=True)
        elif 'pg_dump' in ' '.join(cmd):
            if self.disk_full:
                raise OSError(28, 'No space left on device')
            kwargs['stdout'].write(b'PGDMP synthetic data')
        elif 'psql' in ' '.join(cmd):
            result = '' if 'pg_database' in kwargs.get('input', '') and not self.target_exists else '1\n'
            return subprocess.CompletedProcess(cmd, 0, stdout=result)
        return subprocess.CompletedProcess(cmd, 0, stdout='')

    def test_four_successes_keep_three_verified_generations(self):
        for _ in range(4):
            backup.create_backup()
        self.assertEqual(len(list(self.remote.glob('*.dump'))), 3)
        self.assertEqual(len(list((self.root / 'backups').glob('*.dump'))), 3)
        self.assertEqual(len(list(self.remote.glob('*.json'))), 3)
        self.assertTrue(all('--drive-use-trash=false' in c for c in self.calls if 'deletefile' in c))

    def test_transfer_failure_preserves_all_previous_generations(self):
        for _ in range(3):
            backup.create_backup()
        existing = {p.name: p.read_bytes() for p in self.remote.iterdir()}
        self.fail_transfer = True
        with self.assertRaises(Exception):
            backup.create_backup()
        self.assertEqual(existing, {p.name: p.read_bytes() for p in self.remote.iterdir()})

    def test_download_hash_mismatch_never_deletes_a_good_generation(self):
        for _ in range(3):
            backup.create_backup()
        existing = {p.name: p.read_bytes() for p in self.remote.iterdir()}
        self.corrupt = True
        with self.assertRaises(Exception):
            backup.create_backup()
        self.assertEqual(existing, {p.name: p.read_bytes() for p in self.remote.iterdir()})

    def test_unrelated_files_are_not_retention_targets(self):
        (self.remote / 'personal.txt').write_text('keep')
        for _ in range(4):
            backup.create_backup()
        self.assertEqual((self.remote / 'personal.txt').read_text(), 'keep')

    def test_restore_rejects_existing_database_before_restoring(self):
        backup.create_backup()
        manifest = next(self.remote.glob('*.json')).name
        with self.assertRaises(Exception):
            backup.restore_backup(manifest, 'existing_db')
        self.assertFalse(any('pg_restore' in ' '.join(c) for c in self.calls))

    def test_capacity_failure_preserves_previous_backups(self):
        backup.create_backup()
        existing = {p.name: p.read_bytes() for p in self.remote.iterdir()}
        self.disk_full = True
        with self.assertRaises(OSError):
            backup.create_backup()
        self.assertEqual(existing, {p.name: p.read_bytes() for p in self.remote.iterdir()})

    def test_commit_marker_failure_cleans_only_new_generation_and_next_success_retains_three(self):
        for _ in range(3):
            backup.create_backup()
        previous = {p.name: p.read_bytes() for p in self.remote.iterdir()}
        write_text = Path.write_text

        def fail_commit(path, *args, **kwargs):
            if path.suffix == '.verified':
                # A write can create an empty marker before failing.
                path.touch()
                raise OSError(28, 'No space left on device')
            return write_text(path, *args, **kwargs)

        with patch.object(Path, 'write_text', fail_commit):
            with self.assertRaises(OSError):
                backup.create_backup()

        self.assertEqual(previous, {p.name: p.read_bytes() for p in self.remote.iterdir()})
        directory = self.root / 'backups'
        self.assertEqual(len(list(directory.glob('*.dump'))), 3)
        self.assertEqual(len(list(directory.glob('*.verified'))), 3)
        backup.create_backup()
        self.assertEqual(len(list(directory.glob('*.dump'))), 3)
        self.assertEqual(len(list(directory.glob('*.verified'))), 3)
        self.assertEqual(len(list(self.remote.glob('*.dump'))), 3)

    def test_last_success_failure_preserves_the_already_committed_generation(self):
        for _ in range(3):
            backup.create_backup()
        directory = self.root / 'backups'
        previous_status = (directory / 'last-success').read_text()
        previous = {p.name: p.read_bytes() for p in self.remote.iterdir()}
        write_text = Path.write_text

        def fail_status(path, *args, **kwargs):
            if path.name == 'last-success':
                # Opening for write can truncate before the first write fails.
                write_text(path, '')
                raise OSError(28, 'No space left on device')
            return write_text(path, *args, **kwargs)

        errors = io.StringIO()
        with patch.object(Path, 'write_text', fail_status), redirect_stderr(errors):
            with self.assertRaises(OSError):
                backup.create_backup()

        self.assertEqual((directory / 'last-success').read_text(), previous_status)
        self.assertIn('last-success=' + previous_status.strip(), errors.getvalue())
        self.assertEqual(len(list(directory.glob('*.verified'))), 4)
        self.assertEqual(len(list(self.remote.glob('*.dump'))), 4)
        for name, content in previous.items():
            self.assertEqual((self.remote / name).read_bytes(), content)
        self.assertFalse(list(directory.glob('.pending-*')))
        backup.create_backup()
        self.assertEqual(len(list(directory.glob('*.verified'))), 3)
        self.assertEqual(len(list(directory.glob('*.dump'))), 3)
        self.assertEqual(len(list(self.remote.glob('*.dump'))), 3)

    def test_restore_downloads_and_checks_before_creating_a_new_database(self):
        backup.create_backup()
        manifest = next(self.remote.glob('*.json')).name
        self.target_exists = False
        backup.restore_backup(manifest, 'new_db')
        restore = next(c for c in self.calls if 'pg_restore' in ' '.join(c))
        self.assertIn('--single-transaction', ' '.join(restore))
        self.assertEqual(restore[-1], 'new_db')

    def test_restore_corruption_does_not_create_a_database(self):
        backup.create_backup()
        self.target_exists = False
        self.corrupt = True
        with self.assertRaises(ValueError):
            backup.restore_backup(next(self.remote.glob('*.json')).name, 'new_db')
        self.assertFalse(any('createdb' in ' '.join(c) for c in self.calls))


if __name__ == '__main__':
    unittest.main()
