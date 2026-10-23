import concurrent.futures
import copy
import hashlib
import io
import json
import multiprocessing
import os
import sqlite3
import struct
import subprocess
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from server.broker import serve, read_request, HEADER_LIMIT
from server.common import Rejected, canonical, digest, portable_path, unique_paths
from server.policy import Policy
from server.queue import Queue, CHUNK, LEASE_SECONDS
from server.snapshot import verify_snapshot


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='build-worker-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'worker'
        self.root.mkdir(mode=0o700)
        (self.root / 'config').mkdir(mode=0o700)
        self.source = self.base / 'source'
        self.source.mkdir()
        (self.source / 'src').mkdir()
        (self.source / 'src/main.txt').write_text('original\n')
        (self.source / 'package.json').write_text('{}\n')
        self.git('init', '--quiet')
        self.git('add', '--', 'src/main.txt', 'package.json')
        self.definition = {'steps': [{'tool': 'node', 'args': ['tools/build.mjs'], 'cwd': '.'}],
                           'artifacts': [{'path': 'dist/app.exe', 'maxBytes': 1024}], 'timeoutSeconds': 600}
        project = {'sourceRoot': str(self.source), 'include': ['src', 'package.json'],
                   'extraFiles': [], 'exclude': [], 'limits': {
                       'maxFiles': 100, 'maxFileBytes': 1024 * 1024, 'maxSourceBytes': 2 * 1024 * 1024},
                   'profiles': {'exe': self.definition}}
        self.projects = {'schemaVersion': 1, 'projects': {'alpha': project}}
        self.cap = {'projectId': 'alpha', 'profileId': 'exe', 'revision': digest(self.definition)}
        self.workers = {'schemaVersion': 1, 'workers': {
            'win1': {'profiles': [self.cap]}, 'win2': {'profiles': [self.cap]}}}
        self.write_config()
        self.now = 10000.0

    def git(self, *args):
        return subprocess.run(['/usr/bin/git', '-C', str(self.source), *args], check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env={'PATH': '/usr/bin:/bin', 'HOME': str(self.base),
                                   'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'})

    def write_config(self):
        for name, value in [('projects', self.projects), ('workers', self.workers)]:
            p = self.root / 'config' / (name + '.json')
            p.write_bytes(canonical(value))
            p.chmod(0o600)

    def q(self):
        return Queue(self.root, clock=lambda: self.now)

    def submit(self, q, request=None):
        return q.submit('alpha', 'exe', request)

    def claim(self, q, worker='win1'):
        value = q.claim(worker, [self.cap])
        self.assertIsNotNone(value)
        return value

    def auth(self, job, worker='win1'):
        return worker, job['id'], job['attempt'], job['token']

    def upload(self, q, job, data=b'EXE-success'):
        q.start(*self.auth(job))
        manifest = [{'path': 'dist/app.exe', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]
        upload = q.begin_upload(*self.auth(job), manifest)
        q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 0, hashlib.sha256(data).hexdigest(), data)
        return upload

    def wire(self, q, request, data=b'', worker='win1'):
        raw = canonical(dict(version=1, **request))
        output = io.BytesIO()
        code = serve(q, worker, io.BytesIO(struct.pack('!I', len(raw)) + raw + data), output)
        frame = output.getvalue()
        size = struct.unpack('!I', frame[:4])[0]
        return code, json.loads(frame[4:4 + size]), frame[4 + size:]


class SnapshotTests(Fixture):
    def test_uncommitted_modification_and_explicit_untracked_are_frozen(self):
        (self.source / 'src/main.txt').write_text('uncommitted\n')
        (self.source / 'src/new.txt').write_text('explicit\n')
        (self.source / 'src/other.txt').write_text('not approved\n')
        self.projects['projects']['alpha']['extraFiles'] = ['src/new.txt']
        self.write_config()
        with self.q() as q:
            job = self.submit(q)
            archive = self.root / 'snapshots' / (job['snapshot'] + '.tar')
            with tarfile.open(archive) as tar:
                self.assertEqual(tar.extractfile('src/main.txt').read(), b'uncommitted\n')
                self.assertEqual(tar.extractfile('src/new.txt').read(), b'explicit\n')
                self.assertNotIn('src/other.txt', tar.getnames())
            (self.source / 'src/main.txt').write_text('changed after registration\n')
            claim = self.claim(q)
            verify_snapshot(self.root, claim['source'])
            with tarfile.open(archive) as tar:
                self.assertEqual(tar.extractfile('src/main.txt').read(), b'uncommitted\n')

    def test_uncommitted_deletion_is_absent(self):
        (self.source / 'src/main.txt').unlink()
        with self.q() as q:
            job = self.submit(q)
            with tarfile.open(self.root / 'snapshots' / (job['snapshot'] + '.tar')) as tar:
                self.assertEqual(tar.getnames(), ['package.json'])

    def test_sensitive_cache_and_operational_data_are_excluded_even_if_tracked(self):
        for name in ['src/.env', 'src/private.key', 'src/secrets.json', 'src/cache/x',
                     'src/reports/x', 'src/state/x', 'src/.ssh/id_ed25519', 'src/local.db']:
            p = self.source / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text('do not transfer')
            self.git('add', '--', name)
        with self.q() as q:
            job = self.submit(q)
            with tarfile.open(self.root / 'snapshots' / (job['snapshot'] + '.tar')) as tar:
                self.assertEqual(tar.getnames(), ['package.json', 'src/main.txt'])

    def test_private_key_in_innocent_file_is_rejected(self):
        (self.source / 'src/main.txt').write_text('-----BEGIN OPENSSH PRIVATE KEY-----\nsecret')
        with self.q() as q:
            with self.assertRaises(Rejected):
                self.submit(q)
            self.assertEqual(q.list_jobs(), [])

    def test_tracked_symlink_rejected(self):
        p = self.source / 'src/link'
        p.symlink_to('/etc/passwd')
        self.git('add', '--', 'src/link')
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)

    def test_replaced_tracked_file_symlink_rejected(self):
        p = self.source / 'src/main.txt'
        p.unlink()
        p.symlink_to('/etc/passwd')
        with self.q() as q, self.assertRaises((Rejected, OSError)):
            self.submit(q)

    def test_symlink_directory_rejected(self):
        old = self.source / 'src'
        old.rename(self.source / 'original')
        old.symlink_to(self.source / 'original', target_is_directory=True)
        with self.q() as q, self.assertRaises(OSError):
            self.submit(q)

    def test_hardlink_and_fifo_rejected(self):
        target = self.source / 'src/main.txt'
        os.link(target, self.base / 'hardlink')
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)
        (self.base / 'hardlink').unlink()
        target.unlink()
        os.mkfifo(target)
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)

    def test_case_collision_rejected(self):
        (self.source / 'src/MAIN.txt').write_text('collision')
        self.git('add', '--', 'src/MAIN.txt')
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)

    def test_windows_reserved_name_rejected(self):
        (self.source / 'src/CON.txt').write_text('bad')
        self.git('add', '--', 'src/CON.txt')
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)

    def test_file_and_total_size_limits(self):
        self.projects['projects']['alpha']['limits']['maxFileBytes'] = 2
        self.write_config()
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)
        self.projects['projects']['alpha']['limits']['maxFileBytes'] = 1024
        self.projects['projects']['alpha']['limits']['maxSourceBytes'] = 2
        self.write_config()
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)

    def test_edit_during_snapshot_is_detected_and_no_job_registered(self):
        from server.snapshot import copy_hash
        calls = 0
        def change(*args, **kwargs):
            nonlocal calls
            value = copy_hash(*args, **kwargs)
            calls += 1
            if calls == 2:
                (self.source / 'src/main.txt').write_text('concurrent editor\n')
            return value
        with self.q() as q, patch('server.snapshot.copy_hash', side_effect=change):
            with self.assertRaises(Rejected):
                self.submit(q)
            self.assertEqual(q.list_jobs(), [])
            self.assertEqual(list((self.root / 'snapshots').iterdir()), [])

    def test_corrupt_snapshot_cannot_be_claimed(self):
        with self.q() as q:
            job = self.submit(q)
            (self.root / 'snapshots' / (job['snapshot'] + '.tar')).write_bytes(b'corrupt')
            with self.assertRaises(Rejected):
                self.claim(q)
            self.assertEqual(q.status(job['id'])['state'], 'queued')

    def test_duplicate_source_reuses_archive_and_job(self):
        with self.q() as q:
            first = self.submit(q)
            second = self.submit(q)
            self.assertEqual(first['id'], second['id'])
            self.assertEqual(len(list((self.root / 'snapshots').glob('*.tar'))), 1)

    def test_tracked_submodule_is_rejected(self):
        self.git('update-index', '--add', '--cacheinfo', '160000,' + '1' * 40 + ',src/module')
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)


class QueueTests(Fixture):
    def test_unknown_project_and_worker_are_rejected(self):
        with self.q() as q:
            for project, profile in [('unknown', 'exe'), ('alpha', 'unknown')]:
                with self.assertRaises(Rejected):
                    q.submit(project, profile)
            with self.assertRaises(Rejected):
                q.claim('unknown', [self.cap])

    def test_profile_mismatch_and_unapproved_capability_are_rejected(self):
        with self.q() as q:
            self.submit(q)
            wrong = dict(self.cap, revision='0' * 64)
            with self.assertRaises(Rejected):
                q.claim('win1', [wrong])
        self.workers['workers']['win1']['profiles'] = []
        self.write_config()
        with self.q() as q, self.assertRaises(Rejected):
            q.claim('win1', [self.cap])

    def test_profile_change_invalidates_queued_job(self):
        with self.q() as q:
            job = self.submit(q)
        self.definition['timeoutSeconds'] = 601
        newcap = dict(self.cap, revision=digest(self.definition))
        for worker in self.workers['workers'].values():
            worker['profiles'] = [newcap]
        self.write_config()
        with self.q() as q:
            self.assertIsNone(q.claim('win1', [newcap]))
            self.assertEqual(q.status(job['id'])['state'], 'queued')

    def test_atomic_claim_competing_connections(self):
        with self.q() as q:
            job = self.submit(q)
        barrier = threading.Barrier(2)
        def compete(worker):
            with self.q() as q:
                barrier.wait(timeout=5)
                return q.claim(worker, [self.cap])
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(compete, ['win1', 'win2']))
        self.assertEqual(sum(r is not None for r in results), 1)
        self.assertEqual(next(r for r in results if r)['id'], job['id'])

    def test_only_one_active_job_for_a_project(self):
        with self.q() as q:
            self.submit(q, 'request1')
            self.submit(q, 'request2')
            first = self.claim(q)
            self.assertIsNone(q.claim('win2', [self.cap]))
            q.finish(*self.auth(first), 'failed', 'test failure')
            self.assertIsNotNone(q.claim('win2', [self.cap]))

    def test_worker_cannot_claim_twice(self):
        with self.q() as q:
            self.submit(q, 'one')
            self.submit(q, 'two')
            self.claim(q)
            with self.assertRaises(Rejected):
                self.claim(q)

    def test_wrong_worker_token_attempt_and_foreign_status_rejected(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            for auth in [('win2', job['id'], 1, job['token']),
                         ('win1', job['id'], 2, job['token']),
                         ('win1', job['id'], 1, 'x' * 40)]:
                with self.assertRaises(Rejected):
                    q.start(*auth)
            with self.assertRaises(Rejected):
                q.status(job['id'], worker='win2')
            self.assertNotIn('token', q.status(job['id']))
            raw = (self.root / 'jobs.sqlite3').read_bytes()
            self.assertNotIn(job['token'].encode(), raw)

    def test_heartbeat_extends_lease(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            self.now += 100
            state = q.heartbeat(*self.auth(job))
            self.assertEqual(state['lease_until'], self.now + LEASE_SECONDS)

    def test_expiry_blocks_reexecution_and_requires_confirmed_recovery(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            self.now += LEASE_SECONDS + 1
            self.assertEqual(q.status(job['id'])['state'], 'recovery-required')
            self.assertIsNone(q.claim('win2', [self.cap]))
            with self.assertRaises(Rejected):
                q.heartbeat(*self.auth(job))
            with self.assertRaises(Rejected):
                q.recover(job['id'], 'verified stopped')
            q.recover(job['id'], 'operator independently checked Windows', True)
            retried = self.claim(q)
            self.assertEqual(retried['attempt'], 2)
            self.assertNotEqual(retried['token'], job['token'])
            with self.assertRaises(Rejected):
                q.start(*self.auth(job))

    def test_interruption_retains_lock_until_recovery(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            q.interrupt(*self.auth(job))
            self.assertEqual(q.status(job['id'])['state'], 'interrupted')
            self.assertIsNone(q.claim('win2', [self.cap]))
            q.recover(job['id'], 'stopped confirmed', True)
            self.assertEqual(q.status(job['id'])['state'], 'queued')

    def test_rollback_after_process_death(self):
        with self.q() as q:
            job = self.submit(q)
        def die(root, job_id):
            db = sqlite3.connect(root / 'jobs.sqlite3', isolation_level=None)
            db.execute('BEGIN IMMEDIATE')
            db.execute("UPDATE jobs SET state='claimed' WHERE id=?", (job_id,))
            os._exit(77)
        proc = multiprocessing.get_context('fork').Process(target=die, args=(self.root, job['id']))
        proc.start()
        proc.join(timeout=5)
        self.assertEqual(proc.exitcode, 77)
        with self.q() as q:
            self.assertEqual(q.status(job['id'])['state'], 'queued')

    def test_database_symlink_rejected(self):
        outside = self.base / 'outside'
        outside.write_text('unchanged')
        (self.root / 'jobs.sqlite3').symlink_to(outside)
        with self.assertRaises(OSError):
            self.q()
        self.assertEqual(outside.read_text(), 'unchanged')


class TransferTests(Fixture):
    def test_ranged_download_and_integrity(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            data = bytearray()
            while len(data) < job['source']['size']:
                header, chunk = q.download(*self.auth(job), len(data), 1024)
                self.assertEqual(hashlib.sha256(chunk).hexdigest(), header['chunkSha256'])
                data.extend(chunk)
            self.assertEqual(hashlib.sha256(data).hexdigest(), job['snapshot'])
            with self.assertRaises(Rejected):
                q.download(*self.auth(job), len(data) + 1, 100)

    def test_resume_upload_after_restart_and_replayed_chunk(self):
        data = b'EXE-abcdef'
        manifest = [{'path': 'dist/app.exe', 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}]
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            q.start(*self.auth(job))
            upload = q.begin_upload(*self.auth(job), manifest)
            chunk = data[:4]
            for _ in range(2):
                self.assertEqual(q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 0,
                                               hashlib.sha256(chunk).hexdigest(), chunk)['offset'], 4)
        with self.q() as q:
            resumed = q.begin_upload(*self.auth(job), manifest)
            self.assertEqual(resumed, {'uploadId': upload['uploadId'], 'offsets': [4]})
            rest = data[4:]
            q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 4, hashlib.sha256(rest).hexdigest(), rest)
            self.assertEqual(q.finish(*self.auth(job), 'succeeded')['state'], 'succeeded')

    def test_unapproved_artifact_path_size_and_manifest_change_rejected(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            q.start(*self.auth(job))
            for path, size in [('../escape.exe', 10), ('dist/app.exe', 2048), ('C:/escape.exe', 10)]:
                with self.assertRaises(Rejected):
                    q.begin_upload(*self.auth(job), [{'path': path, 'size': size, 'sha256': '0' * 64}])
            original = [{'path': 'dist/app.exe', 'size': 4, 'sha256': '0' * 64}]
            q.begin_upload(*self.auth(job), original)
            with self.assertRaises(Rejected):
                q.begin_upload(*self.auth(job), [dict(original[0], size=5)])

    def test_wrong_chunk_hash_offset_and_bytes_rejected(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            q.start(*self.auth(job))
            upload = q.begin_upload(*self.auth(job), [{'path': 'dist/app.exe', 'size': 8, 'sha256': '0' * 64}])
            with self.assertRaises(Rejected):
                q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 0, '0' * 64, b'1234')
            with self.assertRaises(Rejected):
                q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 1, hashlib.sha256(b'1234').hexdigest(), b'1234')
            q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 0, hashlib.sha256(b'1234').hexdigest(), b'1234')
            with self.assertRaises(Rejected):
                q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 0, hashlib.sha256(b'xxxx').hexdigest(), b'xxxx')
            with self.assertRaises(Rejected):
                q.finish(*self.auth(job), 'succeeded')

    def test_failed_build_preserves_previous_success_and_idempotent_finalization(self):
        with self.q() as q:
            self.submit(q, 'first')
            good = self.claim(q)
            self.upload(q, good)
            result = q.finish(*self.auth(good), 'succeeded')
            self.assertEqual(q.finish(*self.auth(good), 'succeeded'), result)
            directory = self.root / result['result']['directory']
            original = (directory / '0').read_bytes()
            self.submit(q, 'second')
            bad = self.claim(q)
            q.finish(*self.auth(bad), 'failed', 'compiler failed')
            self.assertEqual(q.latest('alpha', 'exe')['id'], good['id'])
            self.assertEqual((directory / '0').read_bytes(), original)
            with self.assertRaises(Rejected):
                q.finish(*self.auth(good), 'failed')
            with self.assertRaises(Rejected):
                q.recover(good['id'], 'cannot retry success', True)

    def test_filesystem_publication_crash_can_be_finalized_after_restart(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            self.upload(q, job)
            with patch('server.queue.fsync_directory', side_effect=OSError('simulated power interruption')):
                with self.assertRaises(OSError):
                    q.finish(*self.auth(job), 'succeeded')
            self.assertIsNone(q.latest('alpha', 'exe'))
            self.assertEqual(q.status(job['id'])['state'], 'uploading')
        with self.q() as q:
            self.assertEqual(q.finish(*self.auth(job), 'succeeded')['state'], 'succeeded')
            self.assertEqual(q.latest('alpha', 'exe')['id'], job['id'])

    def test_corrupt_artifact_blocks_success_and_preserves_previous_pointer(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            upload = self.upload(q, job)
            (self.root / 'staging' / upload['uploadId'] / '0').write_bytes(b'bad')
            with self.assertRaises(Rejected):
                q.finish(*self.auth(job), 'succeeded')
            self.assertIsNone(q.latest('alpha', 'exe'))

    def test_staged_symlink_does_not_write_outside_root(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            q.start(*self.auth(job))
            upload = q.begin_upload(*self.auth(job), [{'path': 'dist/app.exe', 'size': 4, 'sha256': '0' * 64}])
            outside = self.base / 'outside'
            outside.write_bytes(b'safe')
            (self.root / 'staging' / upload['uploadId'] / '0').symlink_to(outside)
            with self.assertRaises(OSError):
                q.upload_chunk(*self.auth(job), upload['uploadId'], 0, 0, hashlib.sha256(b'evil').hexdigest(), b'evil')
            self.assertEqual(outside.read_bytes(), b'safe')


class ProtocolTests(Fixture):
    def test_claim_and_download_wire_protocol(self):
        with self.q() as q:
            self.submit(q)
            code, response, data = self.wire(q, {'op': 'claim', 'profiles': [self.cap]})
            self.assertEqual(code, 0)
            self.assertTrue(response['ok'])
            job = response['result']
            code, response, data = self.wire(q, {'op': 'download', 'jobId': job['id'],
                 'attempt': 1, 'token': job['token'], 'offset': 0, 'length': 1024})
            self.assertEqual(code, 0)
            self.assertEqual(response['dataLength'], len(data))
            self.assertEqual(len(data), 1024)

    def test_worker_cannot_submit_recover_or_inject_command_environment_path(self):
        with self.q() as q:
            for request in [{'op': 'submit', 'projectId': 'alpha'},
                            {'op': 'recover', 'jobId': 'x'},
                            {'op': 'claim', 'profiles': [self.cap], 'command': 'anything'},
                            {'op': 'claim', 'profiles': [self.cap], 'env': {'PATH': '/tmp'}},
                            {'op': 'claim', 'profiles': [self.cap], 'sourceRoot': '/etc'}]:
                code, response, data = self.wire(q, request)
                self.assertEqual(code, 2)
                self.assertFalse(response['ok'])
                self.assertEqual(data, b'')
            self.assertEqual(q.list_jobs(), [])

    def test_truncated_oversized_duplicate_and_trailing_frames_rejected(self):
        frames = [b'', b'\x00\x00', struct.pack('!I', HEADER_LIMIT + 1),
                  struct.pack('!I', 100) + b'{}']
        for raw in [b'{"version":1,"op":"claim","op":"claim","profiles":[]}',
                    b'{"version":NaN,"op":"claim","profiles":[]}']:
            frames.append(struct.pack('!I', len(raw)) + raw)
        raw = canonical({'version': 1, 'op': 'claim', 'profiles': []})
        frames.append(struct.pack('!I', len(raw)) + raw + b'extra')
        for frame in frames:
            with self.subTest(frame=frame[:20]), self.assertRaises(Rejected):
                read_request(io.BytesIO(frame))

    def test_truncated_upload_does_not_modify_staged_file(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            q.start(*self.auth(job))
            upload = q.begin_upload(*self.auth(job), [{'path': 'dist/app.exe', 'size': 10, 'sha256': '0' * 64}])
            request = {'op': 'upload-chunk', 'jobId': job['id'], 'attempt': 1, 'token': job['token'],
                       'uploadId': upload['uploadId'], 'index': 0, 'offset': 0, 'sha256': '0' * 64,
                       'dataLength': 10}
            code, response, _ = self.wire(q, request, b'only5')
            self.assertEqual(code, 2)
            self.assertEqual(response['error'], 'truncated')
            self.assertEqual(list((self.root / 'staging' / upload['uploadId']).iterdir()), [])

    def test_wrong_worker_and_path_jobid_rejected(self):
        with self.q() as q:
            for request, worker in [({'op': 'claim', 'profiles': []}, 'unknown'),
                                    ({'op': 'status', 'jobId': '../jobs.sqlite3'}, 'win1')]:
                code, response, _ = self.wire(q, request, worker=worker)
                self.assertEqual(code, 2)
                self.assertFalse(response['ok'])


class ValidationTests(Fixture):
    def test_portable_paths_and_component_collisions(self):
        for name in ['../x', '/x', 'C:/x', 'src\\x', 'src/../x', 'NUL', 'aux.txt',
                     'com1.exe', 'LPT9', 'x:y', 'x.', 'x ', 'x//y', 'x/\x01', '日本語.txt']:
            with self.subTest(name=name), self.assertRaises(Rejected):
                portable_path(name)
        for names in [['src/a', 'SRC/b'], ['a', 'a/b'], ['a/b', 'a'], ['A', 'a']]:
            with self.subTest(names=names), self.assertRaises(Rejected):
                unique_paths(names)
        unique_paths(['src/a', 'src/b'])

    def test_config_not_writable_by_others_and_no_duplicate_json(self):
        p = self.root / 'config/projects.json'
        p.chmod(0o666)
        with self.assertRaises(Rejected):
            Policy(self.root)
        p.chmod(0o600)
        p.write_text('{"schemaVersion":1,"projects":{},"projects":{}}')
        with self.assertRaises(Rejected):
            Policy(self.root)

    def test_config_symlink_and_worker_root_symlink_rejected(self):
        p = self.root / 'config/projects.json'
        original = self.base / 'project-copy.json'
        p.rename(original)
        p.symlink_to(original)
        with self.assertRaises(OSError):
            Policy(self.root)
        p.unlink()
        original.rename(p)
        link = self.base / 'linked-worker'
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError):
            Queue(link)

    def test_worker_config_revision_must_match_definition(self):
        self.workers['workers']['win1']['profiles'][0] = dict(self.cap, revision='1' * 64)
        self.write_config()
        with self.assertRaises(Rejected):
            Policy(self.root)

    def test_no_source_worker_overlap(self):
        self.projects['projects']['alpha']['sourceRoot'] = str(self.root)
        self.write_config()
        with self.assertRaises(Rejected):
            Policy(self.root)


class AdditionalRecoveryTests(Fixture):
    def test_claim_response_loss_does_not_reassign_job(self):
        with self.q() as q:
            self.submit(q)
            first = self.claim(q)
            self.assertIsNone(q.claim('win2', [self.cap]))
        with self.q() as q:
            with self.assertRaises(Rejected):
                q.claim('win1', [self.cap])
            self.assertEqual(q.status(first['id'])['attempt'], 1)

    def test_expired_upload_cannot_be_finalized_or_replace_latest(self):
        with self.q() as q:
            self.submit(q, 'good')
            good = self.claim(q)
            self.upload(q, good)
            q.finish(*self.auth(good), 'succeeded')
            self.submit(q, 'expired')
            expired = self.claim(q)
            self.upload(q, expired)
            self.now += LEASE_SECONDS + 1
            with self.assertRaises(Rejected):
                q.finish(*self.auth(expired), 'succeeded')
            self.assertEqual(q.latest('alpha', 'exe')['id'], good['id'])
            self.assertEqual(q.status(expired['id'])['state'], 'recovery-required')

    def test_revoked_profile_blocks_active_worker(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
        self.workers['workers']['win1']['profiles'] = []
        self.write_config()
        with self.q() as q:
            with self.assertRaises(Rejected):
                q.start(*self.auth(job))

    def test_success_generation_contains_manifest_and_finalized_files(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            self.upload(q, job)
            result = q.finish(*self.auth(job), 'succeeded')
            folder = self.root / result['result']['directory']
            manifest = json.loads((folder / 'manifest.json').read_bytes())
            self.assertEqual(manifest['jobId'], job['id'])
            self.assertEqual(manifest['artifacts'][0]['path'], 'dist/app.exe')
            self.assertEqual(hashlib.sha256((folder / '0').read_bytes()).hexdigest(),
                             manifest['artifacts'][0]['sha256'])

    def test_retry_uses_new_upload_and_leaves_old_staged_data(self):
        with self.q() as q:
            self.submit(q)
            first = self.claim(q)
            old_upload = self.upload(q, first)
            q.interrupt(*self.auth(first))
            q.recover(first['id'], 'independently verified stopped', True)
            second = self.claim(q)
            new_upload = self.upload(q, second)
            self.assertNotEqual(old_upload['uploadId'], new_upload['uploadId'])
            self.assertTrue((self.root / 'staging' / old_upload['uploadId'] / '0').exists())
            q.finish(*self.auth(second), 'succeeded')
            self.assertEqual(q.latest('alpha', 'exe')['attempt'], 2)

    def test_git_lfs_pointer_rejected(self):
        (self.source / 'src/main.txt').write_text('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n')
        with self.q() as q, self.assertRaises(Rejected):
            self.submit(q)

    def test_windows_console_device_names_rejected(self):
        for path in ['CONIN$', 'conout$.txt']:
            with self.subTest(path=path), self.assertRaises(Rejected):
                portable_path(path)

    def test_trailing_upload_data_is_rejected_without_writing(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            q.start(*self.auth(job))
            upload = q.begin_upload(*self.auth(job), [{'path': 'dist/app.exe', 'size': 4, 'sha256': '0' * 64}])
            request = {'op': 'upload-chunk', 'jobId': job['id'], 'attempt': 1, 'token': job['token'],
                       'uploadId': upload['uploadId'], 'index': 0, 'offset': 0,
                       'sha256': hashlib.sha256(b'data').hexdigest(), 'dataLength': 4}
            code, response, _ = self.wire(q, request, b'data-extra')
            self.assertEqual(code, 2)
            self.assertFalse(response['ok'])
            self.assertEqual(list((self.root / 'staging' / upload['uploadId']).iterdir()), [])

    def test_invalid_json_types_are_sanitized_and_cannot_mutate_jobs(self):
        with self.q() as q:
            for request in [{'op': 'claim', 'profiles': {'bad': 'type'}},
                            {'op': 'claim', 'profiles': [{'projectId': [], 'profileId': 'exe', 'revision': '0' * 64}]},
                            {'op': 'status', 'jobId': ['not', 'a', 'string']}]:
                code, response, _ = self.wire(q, request)
                self.assertEqual(code, 2)
                self.assertFalse(response['ok'])
            self.assertEqual(q.list_jobs(), [])

    def test_sqlite_unique_constraints_block_bypassing_project_exclusion(self):
        with self.q() as q:
            self.submit(q, 'a')
            self.submit(q, 'b')
            self.claim(q)
            pending = next(row for row in q.list_jobs() if row['state'] == 'queued')
            with self.assertRaises(sqlite3.IntegrityError):
                q.db.execute("UPDATE jobs SET state='claimed',worker='win2' WHERE id=?", (pending['id'],))
            self.assertEqual(q.status(pending['id'])['state'], 'queued')


class EntryPointTests(Fixture):
    def install_entrypoints(self):
        import shutil
        implementation = Path(__file__).resolve().parents[1]
        shutil.copytree(implementation / 'server', self.root / 'server',
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        for filename in ('broker.py', 'submit.py'):
            shutil.copy2(implementation / filename, self.root / filename)

    def test_local_cli_config_validation_does_not_create_database(self):
        self.install_entrypoints()
        result = subprocess.run(['/usr/bin/python3', '-E', '-s', '-B', str(self.root / 'submit.py'),
                                 'check-config'], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env={'PATH': '/usr/bin:/bin'}, check=True)
        value = json.loads(result.stdout)
        self.assertTrue(value['ok'])
        self.assertEqual(value['projects']['alpha']['exe'], self.cap['revision'])
        self.assertFalse((self.root / 'jobs.sqlite3').exists())

    def test_real_broker_entrypoint_and_binary_stream(self):
        self.install_entrypoints()
        with self.q() as q:
            self.submit(q)
        header = canonical({'version': 1, 'op': 'claim', 'profiles': [self.cap]})
        result = subprocess.run(['/usr/bin/python3', '-E', '-s', '-B', str(self.root / 'broker.py'),
                                 '--worker', 'win1'], input=struct.pack('!I', len(header)) + header,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env={'PATH': '/usr/bin:/bin', 'SSH_ORIGINAL_COMMAND': 'build-worker-v1'}, check=True)
        size = struct.unpack('!I', result.stdout[:4])[0]
        response = json.loads(result.stdout[4:4 + size])
        self.assertTrue(response['ok'])
        self.assertEqual(response['result']['state'], 'claimed')
        self.assertEqual(result.stderr, b'')
        self.assertFalse((self.root / 'server/__pycache__').exists())

    def test_unapproved_ssh_command_rejected_without_database_or_leaking_command(self):
        self.install_entrypoints()
        result = subprocess.run(['/usr/bin/python3', '-E', '-s', '-B', str(self.root / 'broker.py'),
                                 '--worker', 'win1'], input=b'', stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env={'PATH': '/usr/bin:/bin', 'SSH_ORIGINAL_COMMAND': 'echo SECRET_SENTINEL'})
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(b'SECRET_SENTINEL', result.stdout + result.stderr)
        self.assertFalse((self.root / 'jobs.sqlite3').exists())
        size = struct.unpack('!I', result.stdout[:4])[0]
        self.assertFalse(json.loads(result.stdout[4:4 + size])['ok'])


class MetadataRecoveryTests(Fixture):
    def test_manifest_interruption_can_be_retried_without_partial_publication(self):
        with self.q() as q:
            self.submit(q)
            job = self.claim(q)
            self.upload(q, job)
            with patch('server.queue.os.replace', side_effect=OSError('simulated metadata interruption')):
                with self.assertRaises(OSError):
                    q.finish(*self.auth(job), 'succeeded')
            self.assertIsNone(q.latest('alpha', 'exe'))
            self.assertEqual(q.status(job['id'])['state'], 'uploading')
            result = q.finish(*self.auth(job), 'succeeded')
            folder = self.root / result['result']['directory']
            self.assertTrue((folder / 'manifest.json').is_file())
            self.assertEqual(q.latest('alpha', 'exe')['id'], job['id'])


if __name__ == '__main__':
    unittest.main()
