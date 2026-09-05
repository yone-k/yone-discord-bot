#!/usr/bin/env python3
"""Custom-format PostgreSQL backups. Drive is a dedicated rclone root_folder_id."""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

GENERATION = re.compile(r'discord-bot-\d{8}T\d{12}Z-[0-9a-f]{8}')
IMAGE = re.compile(r'ghcr\.io/yone-k/yone-discord-bot@sha256:[0-9a-f]{64}')


def command(*args, **kwargs):
    return subprocess.run(list(args), check=True, stderr=subprocess.DEVNULL, **kwargs)


def compose(*args, **kwargs):
    return command('docker', 'compose', '-p', 'discord-bot', *args, **kwargs)


def sql(statement):
    return compose('exec', '-T', 'db', 'sh', '-c',
        'exec psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
        input=statement, text=True, stdout=subprocess.PIPE).stdout.strip()


def remote():
    value = os.environ['RCLONE_REMOTE']
    if not re.fullmatch(r'[A-Za-z0-9_-]+:', value):
        raise ValueError('RCLONE_REMOTE must be a dedicated remote root, e.g. bot-drive:')
    return value


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def image():
    value = os.environ.get('BOT_IMAGE', '')
    if not value:
        for line in Path('.deploy-state/state').read_text().splitlines():
            if line.startswith('current='):
                value = line.split('=', 1)[1]
    if not IMAGE.fullmatch(value):
        raise ValueError('A digest-pinned DB Bot image is required')
    os.environ['BOT_IMAGE'] = value
    return value


def validate_manifest(manifest, generation):
    if not GENERATION.fullmatch(generation) or manifest.get('format') != 'discord-bot-backup-v1':
        raise ValueError('Invalid backup manifest')
    if manifest.get('generation') != generation or not IMAGE.fullmatch(manifest.get('bot_image', '')):
        raise ValueError('Manifest identity mismatch')
    if not re.fullmatch('[0-9a-f]{64}', manifest.get('sha256', '')) or not isinstance(manifest.get('schema_version'), int):
        raise ValueError('Invalid backup checksum or schema version')


def create_backup():
    destination = remote()
    bot_image = image()
    directory = Path(os.environ.get('STORAGE_ROOT', '/srv/discord-bot-storage')) / 'backups'
    directory.mkdir(mode=0o700, exist_ok=True)
    now = datetime.datetime.now(datetime.timezone.utc)
    generation = 'discord-bot-' + now.strftime('%Y%m%dT%H%M%S%fZ') + '-' + uuid.uuid4().hex[:8]
    dump_name, manifest_name = generation + '.dump', generation + '.manifest.json'
    verified = False
    stage = 'dump'
    try:
        with tempfile.TemporaryDirectory(prefix='.pending-', dir=directory) as scratch:
            scratch = Path(scratch)
            dump, manifest_path = scratch / dump_name, scratch / manifest_name
            with dump.open('wb') as stream:
                compose('exec', '-T', 'db', 'sh', '-c',
                    'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"', stdout=stream)
            if not dump.stat().st_size:
                raise ValueError('Empty dump')
            manifest = {'format': 'discord-bot-backup-v1', 'generation': generation,
                'sha256': sha(dump), 'schema_version': int(sql('SELECT max(version) FROM schema_migrations;')),
                'bot_image': bot_image, 'created_at': now.isoformat()}
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False) + '\n')
            stage = 'upload'
            command('rclone', 'copyto', str(dump), destination + dump_name)
            command('rclone', 'copyto', str(manifest_path), destination + manifest_name)
            downloaded = scratch / 'download.dump'
            downloaded_manifest = scratch / 'download.json'
            stage = 'download-verification'
            command('rclone', 'copyto', destination + dump_name, str(downloaded))
            command('rclone', 'copyto', destination + manifest_name, str(downloaded_manifest))
            if sha(downloaded) != manifest['sha256'] or downloaded_manifest.read_bytes() != manifest_path.read_bytes():
                raise ValueError('Downloaded backup checksum mismatch')
            stage = 'local-commit'
            dump.replace(directory / dump_name)
            manifest_path.replace(directory / manifest_name)
            # A local commit record is written only after both remote objects verify.
            (directory / (generation + '.verified')).write_text(now.isoformat() + '\n')
            verified = True
            stage = 'last-success'
            # The scratch directory is on the same filesystem: a failed write
            # leaves the previous success timestamp intact until atomic replace.
            pending_status = scratch / 'last-success'
            pending_status.write_text(now.isoformat() + '\n')
            pending_status.replace(directory / 'last-success')
        stage = 'retention'
        retain(directory, destination)
        print('backup: success ' + now.isoformat() + ' ' + generation, flush=True)
    except Exception:
        if not verified:
            for name in (dump_name, manifest_name, generation + '.verified'):
                (directory / name).unlink(missing_ok=True)
            # Only this unique generation can be cleaned up on failure.
            for name in (dump_name, manifest_name):
                try:
                    command('rclone', 'deletefile', destination + name, '--drive-use-trash=false')
                except Exception:
                    print('backup: failed-generation cleanup failed: ' + name, file=sys.stderr)
        last = directory / 'last-success'
        print('backup: failed stage=' + stage + '; last-success=' + (last.read_text().strip() if last.exists() else 'never'), file=sys.stderr)
        raise


def retain(directory, destination):
    generations = []
    for marker in directory.glob('*.verified'):
        generation = marker.stem
        if not GENERATION.fullmatch(generation):
            continue
        manifest_path = directory / (generation + '.manifest.json')
        manifest = json.loads(manifest_path.read_text())
        validate_manifest(manifest, generation)
        if sha(directory / (generation + '.dump')) != manifest['sha256']:
            raise ValueError('Local committed backup is damaged; retention stopped')
        generations.append(generation)
    for generation in sorted(generations, reverse=True)[3:]:
        for suffix in ('.dump', '.manifest.json'):
            command('rclone', 'deletefile', destination + generation + suffix, '--drive-use-trash=false')
        for suffix in ('.dump', '.manifest.json', '.verified'):
            (directory / (generation + suffix)).unlink()
        print('backup: deleted ' + generation, flush=True)


def restore_backup(manifest_name, database):
    generation = manifest_name.removesuffix('.manifest.json')
    if manifest_name != generation + '.manifest.json' or not GENERATION.fullmatch(generation):
        raise ValueError('Select an exact manifest filename')
    if not re.fullmatch('[a-z][a-z0-9_]{0,62}', database):
        raise ValueError('Use a simple new database name')
    image()
    if sql("SELECT 1 FROM pg_database WHERE datname = '" + database + "';"):
        raise ValueError('Restore target already exists; a new database is required')
    directory = Path(os.environ.get('STORAGE_ROOT', '/srv/discord-bot-storage')) / 'backups'
    with tempfile.TemporaryDirectory(prefix='.restore-', dir=directory) as scratch:
        scratch = Path(scratch)
        manifest_path, dump = scratch / manifest_name, scratch / 'restore.dump'
        command('rclone', 'copyto', remote() + manifest_name, str(manifest_path))
        manifest = json.loads(manifest_path.read_text())
        validate_manifest(manifest, generation)
        command('rclone', 'copyto', remote() + generation + '.dump', str(dump))
        if sha(dump) != manifest['sha256']:
            raise ValueError('Restore checksum mismatch')
        compose('exec', '-T', 'db', 'sh', '-c', 'exec createdb -U "$POSTGRES_USER" "$1"', 'sh', database)
        with dump.open('rb') as stream:
            compose('exec', '-T', 'db', 'sh', '-c',
                'exec pg_restore --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$1"',
                'sh', database, stdin=stream)
        print('restore: restored to ' + database + '; verify schema, counts, references and readiness before Bot startup')
        print('restore: corresponding-image=' + manifest['bot_image'])


if __name__ == '__main__':
    os.umask(0o077)
    try:
        directory = Path(os.environ.get('STORAGE_ROOT', '/srv/discord-bot-storage'))
        with (directory / '.operations-lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if len(sys.argv) == 1:
                create_backup()
            elif len(sys.argv) == 4 and sys.argv[1] == '--restore':
                restore_backup(sys.argv[2], sys.argv[3])
            else:
                raise ValueError('Usage: postgres-backup.py [--restore MANIFEST NEW_DATABASE]')
    except Exception as error:
        print('backup: ' + type(error).__name__ + '; inspect database, storage and rclone configuration', file=sys.stderr)
        sys.exit(1)
