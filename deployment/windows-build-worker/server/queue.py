import contextlib
import hashlib
import hmac
import os
import secrets
import sqlite3
import stat
import time
import uuid
from pathlib import Path
from .common import (Rejected, require, fields, identifier, integer, hexhash, canonical,
                     parse_json, secure_root, open_directory, open_file_beneath, fsync_directory)
from .policy import Policy
from .snapshot import create_snapshot, verify_snapshot

ACTIVE = ('claimed', 'building', 'uploading', 'interrupted', 'recovery-required')
LIVE = ('claimed', 'building', 'uploading')
TERMINAL = ('succeeded', 'failed')
CHUNK = 1024 * 1024
LEASE_SECONDS = 300

SCHEMA = '''
CREATE TABLE IF NOT EXISTS metadata(version INTEGER NOT NULL);
INSERT INTO metadata SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM metadata);
CREATE TABLE IF NOT EXISTS snapshots(
 sha TEXT PRIMARY KEY, descriptor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY, project TEXT NOT NULL, profile TEXT NOT NULL,
 revision TEXT NOT NULL, snapshot TEXT NOT NULL REFERENCES snapshots(sha),
 idempotency TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
 attempt INTEGER NOT NULL DEFAULT 0, worker TEXT, token_hash TEXT,
 lease_until REAL, created REAL NOT NULL, updated REAL NOT NULL,
 result TEXT, reason TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_project ON jobs(project)
 WHERE state IN ('claimed','building','uploading','interrupted','recovery-required');
CREATE UNIQUE INDEX IF NOT EXISTS one_active_worker ON jobs(worker)
 WHERE state IN ('claimed','building','uploading','interrupted','recovery-required');
CREATE INDEX IF NOT EXISTS pending_jobs ON jobs(state, created);
CREATE TABLE IF NOT EXISTS uploads(
 id TEXT PRIMARY KEY, job TEXT NOT NULL UNIQUE REFERENCES jobs(id),
 attempt INTEGER NOT NULL, manifest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS latest(
 project TEXT NOT NULL, profile TEXT NOT NULL, job TEXT NOT NULL REFERENCES jobs(id),
 attempt INTEGER NOT NULL, PRIMARY KEY(project, profile));
CREATE TABLE IF NOT EXISTS events(
 id INTEGER PRIMARY KEY, job TEXT NOT NULL REFERENCES jobs(id),
 timestamp REAL NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL);
'''


class Queue:
    def __init__(self, root, clock=time.time):
        self.root = secure_root(root)
        self.policy = Policy(self.root)
        self.clock = clock
        for name in ('snapshots', 'staging', 'artifacts', 'results', 'queue', 'running'):
            p = self.root / name
            p.mkdir(mode=0o700, exist_ok=True)
            info = p.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
                    and not info.st_mode & 0o077, 'permissions', 'Unsafe worker data directory')
        db = self.root / 'jobs.sqlite3'
        fd = os.open(db, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
                    and info.st_uid == os.geteuid() and not info.st_mode & 0o077,
                    'permissions', 'Unsafe database permissions')
        finally:
            os.close(fd)
        self.db = sqlite3.connect(db, timeout=30, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA journal_mode=DELETE')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript(SCHEMA)
        require(self.db.execute('SELECT version FROM metadata').fetchone()[0] == 1,
                message='Unsupported database schema')
        fsync_directory(self.root)

    def close(self):
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    @contextlib.contextmanager
    def transaction(self):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def event(self, job, state, reason):
        self.db.execute('INSERT INTO events(job,timestamp,state,reason) VALUES(?,?,?,?)',
                        (job, self.clock(), state, reason))

    def _row(self, job_id):
        identifier(job_id)
        row = self.db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        require(row is not None, 'not_found', 'Job not found')
        return row

    def _expire(self):
        for row in self.db.execute("SELECT id FROM jobs WHERE state IN ('claimed','building','uploading') AND lease_until<=?",
                                   (self.clock(),)).fetchall():
            self.db.execute("UPDATE jobs SET state='recovery-required',reason='lease_expired',updated=? WHERE id=?",
                            (self.clock(), row['id']))
            self.event(row['id'], 'recovery-required', 'lease_expired')

    def _public(self, row):
        value = {k: row[k] for k in ('id', 'project', 'profile', 'revision', 'snapshot', 'state',
                                    'attempt', 'worker', 'lease_until', 'created', 'updated', 'reason')}
        value['result'] = parse_json(row['result']) if row['result'] else None
        return value

    def status(self, job_id, worker=None):
        with self.transaction():
            self._expire()
            row = self._row(job_id)
            if worker is not None:
                self.policy.worker(worker)
                require(row['worker'] == worker, 'denied', 'Job is not owned by this worker')
            return self._public(row)

    def list_jobs(self):
        with self.transaction():
            self._expire()
            return [self._public(row) for row in self.db.execute('SELECT * FROM jobs ORDER BY created,id LIMIT 1000')]

    def submit(self, project_id, profile_id, request_id=None):
        import fcntl
        self.policy.profile(project_id, profile_id)
        if request_id is not None:
            identifier(request_id)
        lock = self.root / 'snapshot.lock'
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            require(stat.S_ISREG(os.fstat(fd).st_mode) and os.fstat(fd).st_nlink == 1)
            fcntl.flock(fd, fcntl.LOCK_EX)
            descriptor = create_snapshot(self.root, self.policy.projects[project_id])
            revision = self.policy.revision(project_id, profile_id)
            key = hashlib.sha256(canonical([project_id, profile_id, revision,
                                           descriptor['sha256'], request_id])).hexdigest()
            with self.transaction():
                old = self.db.execute('SELECT * FROM jobs WHERE idempotency=?', (key,)).fetchone()
                if old:
                    return self._public(old)
                now = self.clock()
                job = str(uuid.uuid4())
                self.db.execute('INSERT OR IGNORE INTO snapshots VALUES(?,?)',
                                (descriptor['sha256'], canonical(descriptor).decode()))
                self.db.execute('''INSERT INTO jobs
                 (id,project,profile,revision,snapshot,idempotency,state,created,updated)
                 VALUES(?,?,?,?,?,?,'queued',?,?)''',
                                (job, project_id, profile_id, revision, descriptor['sha256'], key, now, now))
                self.event(job, 'queued', 'submitted')
                return self._public(self._row(job))
        finally:
            os.close(fd)

    def claim(self, worker, capabilities):
        capabilities = self.policy.capabilities(worker, capabilities)
        with self.transaction():
            self._expire()
            occupied = self.db.execute("SELECT id FROM jobs WHERE worker=? AND state IN ('claimed','building','uploading','interrupted','recovery-required')",
                                       (worker,)).fetchone()
            require(occupied is None, 'worker_busy', 'Existing job must be completed or recovered')
            row = None
            for candidate in self.db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created,id"):
                match = {'projectId': candidate['project'], 'profileId': candidate['profile'],
                         'revision': candidate['revision']}
                if match not in capabilities:
                    continue
                busy = self.db.execute("SELECT 1 FROM jobs WHERE project=? AND state IN ('claimed','building','uploading','interrupted','recovery-required')",
                                       (candidate['project'],)).fetchone()
                if not busy:
                    row = candidate
                    break
            if row is None:
                return None
            descriptor = self._snapshot_descriptor(row)
            # Verify the complete archive before handing out a job.
            verify_snapshot(self.root, descriptor)
            token = secrets.token_urlsafe(32)
            now = self.clock()
            self.db.execute("UPDATE jobs SET state='claimed',attempt=attempt+1,worker=?,token_hash=?,lease_until=?,updated=?,reason=NULL WHERE id=? AND state='queued'",
                            (worker, hashlib.sha256(token.encode()).hexdigest(), now + LEASE_SECONDS, now, row['id']))
            self.event(row['id'], 'claimed', 'worker_claimed')
            result = self._public(self._row(row['id']))
            result['token'] = token
            result['source'] = descriptor
            return result

    def _owned(self, worker, job_id, attempt, token, terminal=False):
        self.policy.worker(worker)
        integer(attempt, 1, 1000000)
        require(type(token) is str and 20 <= len(token) <= 128, 'denied', 'Invalid ownership token')
        row = self._row(job_id)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        require(row['worker'] == worker and row['attempt'] == attempt
                and row['token_hash'] is not None
                and hmac.compare_digest(row['token_hash'], token_hash),
                'denied', 'Job ownership does not match')
        self.policy.capabilities(worker, [{'projectId': row['project'], 'profileId': row['profile'],
                                          'revision': row['revision']}])
        if terminal and row['state'] in TERMINAL:
            return row
        require(row['state'] in LIVE and row['lease_until'] > self.clock(),
                'recovery_required', 'Job is not live; explicit recovery is required')
        return row

    def heartbeat(self, worker, job_id, attempt, token):
        with self.transaction():
            self._owned(worker, job_id, attempt, token)
            self.db.execute('UPDATE jobs SET lease_until=?,updated=? WHERE id=?',
                            (self.clock() + LEASE_SECONDS, self.clock(), job_id))
            return self._public(self._row(job_id))

    def start(self, worker, job_id, attempt, token):
        with self.transaction():
            row = self._owned(worker, job_id, attempt, token)
            require(row['state'] in ('claimed', 'building'), message='Invalid build transition')
            if row['state'] == 'claimed':
                self.db.execute("UPDATE jobs SET state='building',updated=? WHERE id=?", (self.clock(), job_id))
                self.event(job_id, 'building', 'worker_started')
            return self._public(self._row(job_id))

    def _snapshot_descriptor(self, row):
        value = self.db.execute('SELECT descriptor FROM snapshots WHERE sha=?', (row['snapshot'],)).fetchone()
        require(value is not None, 'integrity', 'Snapshot record missing')
        return parse_json(value['descriptor'])

    def download(self, worker, job_id, attempt, token, offset, length):
        integer(offset, 0, 2 * 1024**3)
        integer(length, 1, CHUNK)
        with self.transaction():
            row = self._owned(worker, job_id, attempt, token)
            descriptor = self._snapshot_descriptor(row)
            require(offset <= descriptor['size'], message='Download offset outside archive')
            fd = open_directory(self.root / 'snapshots')
            try:
                file_fd = open_file_beneath(fd, descriptor['sha256'] + '.tar')
            finally:
                os.close(fd)
            with os.fdopen(file_fd, 'rb') as f:
                require(os.fstat(f.fileno()).st_size == descriptor['size'], 'integrity', 'Snapshot size changed')
                f.seek(offset)
                data = f.read(min(length, descriptor['size'] - offset))
            return {'offset': offset, 'size': descriptor['size'], 'sha256': descriptor['sha256'],
                    'chunkSha256': hashlib.sha256(data).hexdigest()}, data

    def begin_upload(self, worker, job_id, attempt, token, manifest):
        with self.transaction():
            row = self._owned(worker, job_id, attempt, token)
            require(row['state'] in ('building', 'uploading'), message='Build must start before upload')
            approved = self.policy.profile(row['project'], row['profile'])['artifacts']
            require(type(manifest) is list and len(manifest) == len(approved), message='Artifact set does not match profile')
            expected = {a['path']: a['maxBytes'] for a in approved}
            seen = set()
            for item in manifest:
                fields(item, ('path', 'size', 'sha256'))
                require(type(item['path']) is str and item['path'] in expected and item['path'] not in seen,
                        message='Unapproved or duplicate artifact')
                integer(item['size'], 1, expected[item['path']])
                hexhash(item['sha256'])
                seen.add(item['path'])
            manifest = sorted(manifest, key=lambda v: v['path'])
            prior = self.db.execute('SELECT * FROM uploads WHERE job=?', (job_id,)).fetchone()
            if prior:
                require(prior['attempt'] == attempt and parse_json(prior['manifest']) == manifest,
                        message='Upload manifest cannot change during an attempt')
                upload_id = prior['id']
            else:
                upload_id = str(uuid.uuid4())
                self.db.execute('INSERT INTO uploads VALUES(?,?,?,?)',
                                (upload_id, job_id, attempt, canonical(manifest).decode()))
            stage = self.root / 'staging' / upload_id
            stage.mkdir(mode=0o700, exist_ok=True)
            require(not stage.is_symlink(), 'integrity', 'Unsafe upload directory')
            fsync_directory(stage)
            fsync_directory(self.root / 'staging')
            self.db.execute("UPDATE jobs SET state='uploading',updated=? WHERE id=?", (self.clock(), job_id))
            if row['state'] != 'uploading':
                self.event(job_id, 'uploading', 'upload_started')
            offsets = []
            final = self._final_dir(row)
            for i, item in enumerate(manifest):
                p = (final if final.exists() else stage) / str(i)
                if p.exists():
                    info = p.lstat()
                    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= item['size'],
                            'integrity', 'Unsafe upload file')
                    offsets.append(info.st_size)
                else:
                    offsets.append(0)
            return {'uploadId': upload_id, 'offsets': offsets}

    def _upload(self, job_id, attempt, upload_id):
        identifier(upload_id)
        upload = self.db.execute('SELECT * FROM uploads WHERE job=? AND id=? AND attempt=?',
                                 (job_id, upload_id, attempt)).fetchone()
        require(upload is not None, 'not_found', 'Upload not found')
        return parse_json(upload['manifest'])

    def upload_chunk(self, worker, job_id, attempt, token, upload_id, index, offset, sha256, data):
        integer(index, 0, 31)
        integer(offset, 0, 1024**3)
        hexhash(sha256)
        require(type(data) is bytes and 0 < len(data) <= CHUNK, message='Invalid chunk length')
        require(hashlib.sha256(data).hexdigest() == sha256, 'integrity', 'Chunk SHA-256 mismatch')
        with self.transaction():
            row = self._owned(worker, job_id, attempt, token)
            require(row['state'] == 'uploading', message='Job is not uploading')
            manifest = self._upload(job_id, attempt, upload_id)
            require(index < len(manifest) and offset + len(data) <= manifest[index]['size'],
                    message='Chunk exceeds artifact limit')
            stage = self.root / 'staging' / upload_id
            require(not self._final_dir(row).exists(), message='Artifacts already staged for finalization')
            fd = open_directory(stage)
            try:
                file_fd = os.open(str(index), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK,
                                  0o600, dir_fd=fd)
            finally:
                os.close(fd)
            with os.fdopen(file_fd, 'r+b') as f:
                info = os.fstat(f.fileno())
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'integrity', 'Unsafe upload file')
                size = info.st_size
                require(size <= manifest[index]['size'], 'integrity', 'Oversized upload file')
                if offset < size:
                    require(offset + len(data) <= size, message='Partial overlap is not accepted')
                    f.seek(offset)
                    require(f.read(len(data)) == data, 'integrity', 'Replayed chunk differs')
                    return {'offset': size}
                require(offset == size, message='Upload offset is not contiguous')
                f.seek(offset)
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            fsync_directory(stage)
            return {'offset': size + len(data)}

    def _final_dir(self, row):
        return self.root / 'artifacts' / row['project'] / row['profile'] / row['id'] / str(row['attempt'])

    def finish(self, worker, job_id, attempt, token, outcome, message=''):
        require(outcome in ('succeeded', 'failed'), message='Invalid result outcome')
        require(type(message) is str and len(message) <= 1000 and '\x00' not in message,
                message='Invalid result message')
        with self.transaction():
            row = self._owned(worker, job_id, attempt, token, terminal=True)
            if row['state'] in TERMINAL:
                require(row['state'] == outcome, message='Final result cannot be changed')
                return self._public(row)
            result = {'outcome': outcome, 'message': message}
            if outcome == 'succeeded':
                require(row['state'] == 'uploading', message='Artifacts must be uploaded before success')
                upload = self.db.execute('SELECT * FROM uploads WHERE job=? AND attempt=?', (job_id, attempt)).fetchone()
                require(upload is not None, message='No upload to finalize')
                manifest = parse_json(upload['manifest'])
                final = self._final_dir(row)
                stage = self.root / 'staging' / upload['id']
                folder = final if final.exists() else stage
                fd = open_directory(folder)
                try:
                    for i, item in enumerate(manifest):
                        file_fd = open_file_beneath(fd, str(i))
                        with os.fdopen(file_fd, 'rb') as f:
                            require(os.fstat(f.fileno()).st_size == item['size']
                                    and hashlib.file_digest(f, 'sha256').hexdigest() == item['sha256'],
                                    'integrity', 'Artifact SHA-256 mismatch')
                finally:
                    os.close(fd)
                if not final.exists():
                    final.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    # Root is private; only this process may manage these directories.
                    ancestor_fd = open_directory(final.parent)
                    os.close(ancestor_fd)
                    os.rename(stage, final)
                    fsync_directory(final.parent)
                    fsync_directory(self.root / 'staging')
                # Make the immutable generation understandable without querying SQLite.
                descriptor = canonical({'schemaVersion': 1, 'jobId': job_id, 'attempt': attempt,
                                        'projectId': row['project'], 'profileId': row['profile'],
                                        'revision': row['revision'], 'artifacts': manifest})
                manifest_path = final / 'manifest.json'
                if manifest_path.exists():
                    fd = open_directory(final)
                    try:
                        file_fd = open_file_beneath(fd, 'manifest.json')
                    finally:
                        os.close(fd)
                    with os.fdopen(file_fd, 'rb') as f:
                        require(f.read(len(descriptor) + 1) == descriptor,
                                'integrity', 'Stored result manifest differs')
                else:
                    temporary = final / ('.manifest-' + uuid.uuid4().hex)
                    try:
                        with temporary.open('xb') as f:
                            f.write(descriptor)
                            f.flush()
                            os.fsync(f.fileno())
                        os.replace(temporary, manifest_path)
                        fsync_directory(final)
                    finally:
                        temporary.unlink(missing_ok=True)
                # Persist all newly-created parent directory entries before DB publication.
                directory = final
                while directory != self.root:
                    fsync_directory(directory)
                    directory = directory.parent
                fsync_directory(self.root)
                result['artifacts'] = manifest
                result['directory'] = str(final.relative_to(self.root))
            self.db.execute('UPDATE jobs SET state=?,result=?,reason=NULL,lease_until=NULL,updated=? WHERE id=?',
                            (outcome, canonical(result).decode(), self.clock(), job_id))
            if outcome == 'succeeded':
                self.db.execute('''INSERT INTO latest VALUES(?,?,?,?)
                 ON CONFLICT(project,profile) DO UPDATE SET job=excluded.job,attempt=excluded.attempt''',
                                (row['project'], row['profile'], job_id, attempt))
            self.event(job_id, outcome, 'worker_finalized')
            return self._public(self._row(job_id))

    def latest(self, project_id, profile_id):
        self.policy.profile(project_id, profile_id)
        value = self.db.execute('SELECT job FROM latest WHERE project=? AND profile=?',
                                (project_id, profile_id)).fetchone()
        return self._public(self._row(value['job'])) if value else None

    def interrupt(self, worker, job_id, attempt, token):
        with self.transaction():
            self._owned(worker, job_id, attempt, token)
            self.db.execute("UPDATE jobs SET state='interrupted',reason='worker_interrupted',updated=? WHERE id=?",
                            (self.clock(), job_id))
            self.event(job_id, 'interrupted', 'worker_interrupted')
            return self._public(self._row(job_id))

    def recover(self, job_id, reason, confirm_stopped=False):
        require(confirm_stopped is True, 'confirmation_required', 'Operator must independently confirm the build stopped')
        require(type(reason) is str and 1 <= len(reason) <= 500 and '\x00' not in reason,
                message='Recovery requires an audit reason')
        with self.transaction():
            self._expire()
            row = self._row(job_id)
            require(row['state'] in ('interrupted', 'recovery-required', 'failed'),
                    message='Job is not recoverable')
            self.db.execute("UPDATE jobs SET state='queued',worker=NULL,token_hash=NULL,lease_until=NULL,result=NULL,reason=?,updated=? WHERE id=?",
                            (reason, self.clock(), job_id))
            self.db.execute('DELETE FROM uploads WHERE job=?', (job_id,))
            self.event(job_id, 'queued', reason)
            # Old staged/final files remain untouched. New attempt has new paths and token.
            return self._public(self._row(job_id))
