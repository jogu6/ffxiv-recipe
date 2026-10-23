import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import unittest

from server.common import canonical, digest
from test_worker import Fixture

ROOT = Path(__file__).resolve().parents[1]
PWSH = ROOT / '.tools/pwsh/pwsh'


class WindowsWorkerTests(Fixture):
    def make_config(self):
        return {'schemaVersion': 1, 'enabled': False, 'workerId': 'win1',
                'ssh': {'executable': str(self.base / 'ssh.exe'), 'host': 'vps.invalid', 'user': 'ffxivdev',
                        'port': 22, 'knownHosts': 'control/known_hosts',
                        'identityPublicKey': 'control/worker-key.pub', 'timeoutSeconds': 20},
                'storage': {'minimumFreeBytes': 1048576, 'maxWorkspaceBytes': 268435456,
                            'startReservationBytes': 1048576},
                'tools': {'node': {'executable': str(self.base / 'node.exe'), 'prefixArgs': []}},
                'profiles': [{'projectId': 'alpha', 'profileId': 'exe', 'revision': self.cap['revision'],
                              'definition': self.definition}], 'environment': {}, 'pathEntries': []}

    def tar_fixture(self, name, members, descriptor_entries=None, mutate=None):
        path = self.base / (name + '.tar')
        entries = []
        with tarfile.open(path, 'w', format=tarfile.USTAR_FORMAT) as tar:
            for member, content in members:
                tar.addfile(member, io.BytesIO(content) if member.isreg() else None)
                if member.isreg():
                    entries.append({'path': member.name, 'size': len(content),
                                    'sha256': hashlib.sha256(content).hexdigest(), 'mode': member.mode})
        data = path.read_bytes()
        if mutate:
            data = mutate(data)
            path.write_bytes(data)
        descriptor = {'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data),
                      'expandedBytes': sum(e['size'] for e in (descriptor_entries or entries)),
                      'files': descriptor_entries or entries}
        return {'archive': path.name, 'source': descriptor}

    def run_ps(self, script, *args):
        if not PWSH.exists():
            self.skipTest('Portable PowerShell is required; see docs/windows-worker.md')
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(self.base), 'TMPDIR': str(self.base),
               'DOTNET_CLI_HOME': str(self.base), 'POWERSHELL_TELEMETRY_OPTOUT': '1',
               'DOTNET_CLI_TELEMETRY_OPTOUT': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
        result = subprocess.run([str(PWSH), '-NoLogo', '-NoProfile', '-NonInteractive',
                                 '-File', str(script), *map(str, args)],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout.decode(errors='replace'))
        return result.stdout.decode()

    def create_core_fixtures(self):
        def member(name, data=b'hello\n'):
            info = tarfile.TarInfo(name)
            info.mode = 0o644
            info.size = len(data)
            return info, data
        valid = member('src/main.txt')
        archives = {'valid': self.tar_fixture('valid', [valid])}
        good_entries = archives['valid']['source']['files']
        archives['traversal'] = self.tar_fixture('traversal', [member('../outside.txt')], good_entries)
        archives['absolute'] = self.tar_fixture('absolute', [member('/outside.txt')], good_entries)
        for kind, flag in [('symlink', tarfile.SYMTYPE), ('hardlink', tarfile.LNKTYPE), ('pax', tarfile.XHDTYPE)]:
            info, data = member('src/main.txt')
            info.type = flag
            info.linkname = '../outside.txt' if flag != tarfile.XHDTYPE else ''
            archives[kind] = self.tar_fixture(kind, [(info, data)], good_entries)
        archives['duplicate'] = self.tar_fixture('duplicate', [valid, valid], good_entries)
        archives['unlisted'] = self.tar_fixture('unlisted', [valid, member('extra.txt')], good_entries)
        archives['missing'] = self.tar_fixture('missing', [], good_entries)
        bad_hash = copy.deepcopy(good_entries)
        bad_hash[0]['sha256'] = '0' * 64
        archives['filehash'] = self.tar_fixture('filehash', [valid], bad_hash)
        wrong_size = copy.deepcopy(good_entries)
        wrong_size[0]['size'] += 1
        archives['size'] = self.tar_fixture('size', [valid], wrong_size)
        case_entries = good_entries + [dict(good_entries[0], path='SRC/MAIN.txt')]
        archives['case'] = self.tar_fixture('case', [valid, member('SRC/MAIN.txt')], case_entries)
        archives['reserved'] = self.tar_fixture('reserved', [member('CON.txt')])
        archives['trailing'] = self.tar_fixture('trailing', [valid], mutate=lambda b: b + b'not-zero')
        archives['checksum'] = self.tar_fixture('checksum', [valid], mutate=lambda b: bytes([b[0] ^ 1]) + b[1:])
        vectors = []
        for args in [[], ['plain', 'C:\\a b\\', '"quote"'], ['日本語', '😀', '<>&', '\n\t\u0000']]:
            definition = copy.deepcopy(self.definition)
            definition['steps'][0]['args'] = args
            vectors.append({'definition': definition, 'revision': digest(definition)})
        (self.source / 'src/main.txt').write_text('hello\n')
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
        # This fixture is never authenticated against the scratch queue. Keep even
        # exported copies free of live/random ownership credentials.
        job['token'] = 'fixture-only-not-an-authentication-token'
        fixture = {'config': self.make_config(), 'job': job, 'vectors': vectors, 'archives': archives}
        (self.base / 'fixtures.json').write_bytes(canonical(fixture))
        return fixture

    def test_powershell_core_unit_tests_and_static_parser(self):
        self.create_core_fixtures()
        output = self.run_ps(ROOT / 'tests/windows/Run-Tests.ps1', '-FixtureRoot', self.base,
                             '-CodeRoot', ROOT)
        print(output, end='')
        self.assertIn('failed=0', output)

    def integration(self, behavior, first_success=False):
        # Copy only the generic server implementation; no real repository is registered.
        shutil.copytree(ROOT / 'server', self.root / 'server')
        shutil.copy2(ROOT / 'broker.py', self.root / 'broker.py')
        client = self.base / 'client'
        client.mkdir(mode=0o700)
        (client / 'client.json').write_bytes(canonical(self.make_config()))
        old_pointer = None
        if first_success:
            with self.q() as q:
                self.submit(q, 'previous')
                good = self.claim(q)
                self.upload(q, good)
                q.finish(*self.auth(good), 'succeeded')
                old_pointer = q.latest('alpha', 'exe')['id']
        with self.q() as q:
            pending = self.submit(q, 'integration')
        output = self.run_ps(ROOT / 'tests/windows/Integration.Tests.ps1',
                             '-FixtureRoot', client, '-CodeRoot', ROOT, '-BrokerRoot', self.root,
                             '-Behavior', behavior)
        print(output, end='')
        self.assertIn('buildCount=1 state=idle', output)
        with self.q() as q:
            status = q.status(pending['id'])
            expected = 'failed' if behavior == 'failed' else 'succeeded'
            self.assertEqual(status['state'], expected)
            self.assertEqual(status['attempt'], 1)
            if behavior == 'failed':
                self.assertEqual(q.latest('alpha', 'exe')['id'], old_pointer)
            else:
                self.assertEqual(q.latest('alpha', 'exe')['id'], pending['id'])
                directory = self.root / status['result']['directory']
                self.assertEqual((directory / '0').read_bytes(), b'fixture-artifact')
        state = json.loads((client / 'control/state.json').read_bytes())
        self.assertEqual(state, {'version': 1, 'phase': 'idle', 'job': None})

    def test_real_server_and_powershell_client_success(self):
        self.integration('success')

    def test_real_server_and_powershell_client_failure_preserves_success(self):
        self.integration('failed', first_success=True)

    def test_upload_response_loss_resumes_without_rebuilding(self):
        self.integration('upload-loss')

    def test_finish_response_loss_reconciles_without_rebuilding(self):
        self.integration('finish-loss')

    def test_windows_code_static_contract(self):
        core = (ROOT / 'windows/JobObject.cs').read_text()
        self.assertIn('PROC_THREAD_ATTRIBUTE_JOB_LIST=0x0002000D', core)
        self.assertIn('KILL_ON_JOB_CLOSE=0x2000', core)
        self.assertIn('CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT', core)
        self.assertNotIn('taskkill', core.lower())
        self.assertNotIn('GetProcessesByName', core)
        entry = (ROOT / 'windows/Worker.ps1').read_text()
        self.assertIn("'C:\\BuildWorker-Production'", entry)
        self.assertIn("$Mode = 'Check'", entry)
        self.assertNotIn('Register-ScheduledTask', entry)
        example = json.loads((ROOT / 'windows/worker.example.json').read_text())
        self.assertFalse(example['enabled'])
        self.assertEqual(example['profiles'], [])


if __name__ == '__main__':
    unittest.main()
