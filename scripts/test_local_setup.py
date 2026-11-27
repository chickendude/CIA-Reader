"""Offline safety checks for native setup; no SSH or database is contacted.

Run: python3 -m unittest discover -s scripts -p 'test_local_setup.py'
"""

import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
FAKE_TOOL = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
name = pathlib.Path(sys.argv[0]).name
with open(os.environ['TOOL_LOG'], 'a') as log:
    log.write(json.dumps([name, *sys.argv[1:]]) + '\n')
if name == 'ssh':
    if os.environ.get('SSH_FAIL'):
        sys.stdout.write('partial download')
        sys.exit(255)
    os.execvp('bash', ['bash', '-c', sys.argv[-1]])
elif name == 'docker':
    assert sys.argv[1:8] == ['compose', '-f', 'infra/docker-compose.prod.yml', '--env-file', 'infra/.env', 'exec', '-T']
    assert sys.argv[8:11] == ['postgres', 'sh', '-c']
    os.environ.update(POSTGRES_USER='remote_user', POSTGRES_DB='remote_db')
    os.execvp('sh', ['sh', '-c', sys.argv[11]])
elif name == 'pg_dump':
    assert '--username=remote_user' in sys.argv
    assert '--dbname=remote_db' in sys.argv
    sys.stdout.buffer.write(b'broken' if os.environ.get('BAD_DUMP') else b'PGDMP-test-fixture')
elif name == 'pg_restore':
    if pathlib.Path(sys.argv[-1]).read_bytes() != b'PGDMP-test-fixture':
        sys.exit(1)
    if '--single-transaction' in sys.argv and os.environ.get('RESTORE_FAIL'):
        sys.exit(1)
elif name == 'createdb':
    if os.environ.get('DB_EXISTS'):
        sys.stderr.write('database already exists\n')
        sys.exit(1)
elif name in ('pg_ctl', 'psql', 'initdb'):
    pass
elif name in ('python', 'python3', 'python3.12'):
    if name == 'python3.12' or os.environ.get('BROKEN_PYTHON'):
        sys.exit(127)
    if sys.argv[1:] == ['--version']:
        print('Python 3.14.10')
    elif sys.argv[1:3] == ['-m', 'venv']:
        target = pathlib.Path(sys.argv[3]) / 'bin' / 'python'
        target.parent.mkdir(parents=True)
        target.write_text(pathlib.Path(sys.argv[0]).read_text())
        target.chmod(0o755)
elif name == 'pnpm':
    pass
else:
    sys.exit(99)
'''


class LocalSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cia-local-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        scripts = self.root / 'scripts'
        scripts.mkdir()
        for name in ('download-parhiba-db.sh', 'dev-local.sh'):
            shutil.copy2(SCRIPTS / name, scripts / name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for tool in ('ssh', 'docker', 'pg_dump', 'pg_restore', 'createdb', 'pg_ctl', 'psql', 'initdb',
                     'pnpm', 'python3', 'python3.12'):
            path = self.bin / tool
            path.write_text(FAKE_TOOL.replace('#!/usr/bin/env python3', f'#!{sys.executable}'))
            path.chmod(0o755)
        self.log = self.root / 'tools.jsonl'
        self.env = dict(os.environ, PATH=f'{self.bin}:{os.environ["PATH"]}', TOOL_LOG=str(self.log))
        # Exercise remote argument quoting, including shell metacharacters.
        self.remote = self.root / "remote 'quoted' $variable `text`; path"
        self.remote.mkdir()
        self.output = self.root / 'snapshot.dump'

    def run_script(self, name, *args, **env):
        return subprocess.run(
            ['bash', str(self.root / 'scripts' / name), *map(str, args)],
            env=dict(self.env, **env), cwd=self.root, capture_output=True, text=True,
        )

    def download(self, **env):
        return self.run_script('download-parhiba-db.sh', '--path', self.remote,
                               '--output', self.output, **env)

    def calls(self):
        import json
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_download_quotes_remote_path_and_creates_private_archive(self):
        result = self.download()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_bytes(), b'PGDMP-test-fixture')
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        self.assertFalse(list(self.root.glob('*.partial.*')))
        self.assertTrue(any('--file=/dev/null' in call for call in self.calls()))

    def test_existing_archive_is_untouched_without_connecting(self):
        self.output.write_bytes(b'existing backup')
        self.assertNotEqual(self.download().returncode, 0)
        self.assertEqual(self.output.read_bytes(), b'existing backup')
        self.assertFalse(self.calls())

    def test_ssh_failure_removes_partial_download(self):
        self.assertNotEqual(self.download(SSH_FAIL='1').returncode, 0)
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.root.glob('*.partial.*')))

    def test_invalid_archive_is_not_published(self):
        self.assertNotEqual(self.download(BAD_DUMP='1').returncode, 0)
        self.assertFalse(self.output.exists())
        self.assertFalse(list(self.root.glob('*.partial.*')))

    def prepare_restore(self):
        pgdata = self.root / '.local' / 'postgres'
        pgdata.mkdir(parents=True)
        (pgdata / 'PG_VERSION').write_text('18')
        self.output.write_bytes(b'PGDMP-test-fixture')

    def test_restore_refuses_existing_database_before_writing(self):
        self.prepare_restore()
        result = self.run_script('dev-local.sh', 'restore', self.output, DB_EXISTS='1')
        self.assertNotEqual(result.returncode, 0)
        restores = [call for call in self.calls() if call[0] == 'pg_restore']
        self.assertEqual(len(restores), 1)
        self.assertIn('--list', restores[0])

    def test_restore_uses_local_database_and_atomic_transaction(self):
        self.prepare_restore()
        result = self.run_script('dev-local.sh', 'restore', self.output)
        self.assertEqual(result.returncode, 0, result.stderr)
        restore = [call for call in self.calls() if call[0] == 'pg_restore'][-1]
        self.assertIn('--single-transaction', restore)
        self.assertIn('--no-owner', restore)
        self.assertIn('--no-privileges', restore)
        self.assertIn('--dbname=postgres://ciareader@127.0.0.1:55432/ciareader_local', restore)
        self.assertNotIn('--clean', restore)

    def test_dated_snapshot_is_selected_only_after_success(self):
        self.prepare_restore()
        snapshot = self.output.with_name('parhiba-20261126T184225Z.dump')
        self.output.rename(snapshot)
        config = self.root / '.local' / 'env'
        self.run_script('dev-local.sh', 'db-up').check_returncode()
        previous_config = config.read_text()
        failed = self.run_script('dev-local.sh', 'restore', snapshot, RESTORE_FAIL='1')
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(config.read_text(), previous_config)

        result = self.run_script('dev-local.sh', 'restore', snapshot)
        self.assertEqual(result.returncode, 0, result.stderr)
        name = 'ciareader_site_20261126_184225'
        self.assertEqual([c for c in self.calls() if c[0] == 'createdb'][-1][-1], name)
        restore = [c for c in self.calls() if '--single-transaction' in c][-1]
        self.assertIn('--dbname=postgres://ciareader@127.0.0.1:55432/' + name, restore)
        self.assertEqual(set(config.read_text().splitlines()),
                         set(previous_config.replace('ciareader_local', name).splitlines()))

    def prepare_venv(self):
        python = self.root / 'services' / 'nlp' / '.venv' / 'bin' / 'python'
        python.parent.mkdir(parents=True)
        shutil.copy2(self.bin / 'python3', python)

    def test_install_reuses_venv_without_calling_broken_system_python(self):
        self.prepare_venv()
        result = self.run_script('dev-local.sh', 'install', PYTHON='python3.12')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Reusing', result.stdout)
        self.assertFalse(any(call[0] in ('python3', 'python3.12') for call in self.calls()))
        self.assertTrue(any(call[:4] == ['python', '-m', 'pip', 'install'] for call in self.calls()))

    def test_new_install_uses_python3_from_path(self):
        result = self.run_script('dev-local.sh', 'install', PYTHON='')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any(call[:3] == ['python3', '-m', 'venv'] for call in self.calls()))
        self.assertFalse(any(call[0] == 'python3.12' for call in self.calls()))

    def test_broken_existing_venv_fails_before_installing(self):
        self.prepare_venv()
        result = self.run_script('dev-local.sh', 'install', BROKEN_PYTHON='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Existing venv is broken', result.stderr)
        self.assertFalse(any(call[0] == 'pnpm' for call in self.calls()))

    def test_broken_selected_interpreter_fails_before_installing(self):
        result = self.run_script('dev-local.sh', 'install', PYTHON='python3.12')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must be a working Python', result.stderr)
        self.assertFalse(any(call[0] == 'pnpm' for call in self.calls()))


if __name__ == '__main__':
    unittest.main()
