"""Bounded, resumable per-attempt logs; no client-controlled filenames."""
import hashlib
import os
from .common import require, identifier, integer, hexhash, canonical, parse_json, open_directory, open_file_beneath, fsync_directory

LIMIT = 2 * 1024 * 1024
CHUNK = 65536


def folder(queue, job_id, attempt):
    identifier(job_id)
    integer(attempt, 1, 1000000)
    path = queue.root / 'results' / job_id / str(attempt)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = open_directory(path)
    os.close(fd)
    return path


def status(queue, worker, job_id, attempt, token):
    with queue.transaction():
        queue._owned(worker, job_id, attempt, token, terminal=True)
        path = folder(queue, job_id, attempt)
        sealed = (path / 'build.log').exists()
        name = 'build.log' if sealed else 'build.log.part'
        fd = open_directory(path)
        try:
            try:
                file_fd = open_file_beneath(fd, name)
            except FileNotFoundError:
                return {'offset': 0, 'sealed': False}
        finally:
            os.close(fd)
        with os.fdopen(file_fd, 'rb') as f:
            size = os.fstat(f.fileno()).st_size
            require(size <= LIMIT, 'integrity', 'Oversized stored log')
            return {'offset': size, 'sealed': sealed, 'sha256': hashlib.file_digest(f, 'sha256').hexdigest()}


def append(queue, worker, job_id, attempt, token, offset, sha256, data):
    integer(offset, 0, LIMIT)
    hexhash(sha256)
    require(type(data) is bytes and 0 < len(data) <= CHUNK and offset + len(data) <= LIMIT)
    require(hashlib.sha256(data).hexdigest() == sha256, 'integrity', 'Log chunk hash differs')
    with queue.transaction():
        queue._owned(worker, job_id, attempt, token, terminal=True)
        path = folder(queue, job_id, attempt)
        require(not (path / 'build.log').exists(), message='Log already sealed')
        fd = open_directory(path)
        try:
            file_fd = os.open('build.log.part', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=fd)
        finally:
            os.close(fd)
        with os.fdopen(file_fd, 'r+b') as f:
            import stat
            info = os.fstat(f.fileno())
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= LIMIT)
            if offset < info.st_size:
                require(offset + len(data) <= info.st_size, message='Partial log overlap')
                f.seek(offset)
                require(f.read(len(data)) == data, 'integrity', 'Replayed log differs')
                return {'offset': info.st_size}
            require(offset == info.st_size, message='Noncontiguous log chunk')
            f.seek(offset)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
            size = f.tell()
        fsync_directory(path)
        return {'offset': size}


def seal(queue, worker, job_id, attempt, token, size, sha256):
    integer(size, 0, LIMIT)
    hexhash(sha256)
    with queue.transaction():
        queue._owned(worker, job_id, attempt, token, terminal=True)
        path = folder(queue, job_id, attempt)
        final = path / 'build.log'
        if size == 0 and not final.exists() and not (path / 'build.log.part').exists():
            fd = os.open(path / 'build.log.part', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(fd)
        fd = open_directory(path)
        try:
            file_fd = open_file_beneath(fd, 'build.log' if final.exists() else 'build.log.part')
        finally:
            os.close(fd)
        with os.fdopen(file_fd, 'rb') as f:
            require(os.fstat(f.fileno()).st_size == size and hashlib.file_digest(f, 'sha256').hexdigest() == sha256,
                    'integrity', 'Log hash differs')
        if not final.exists():
            os.rename(path / 'build.log.part', final)
        value = {'size': size, 'sha256': sha256, 'directory': str(path.relative_to(queue.root)), 'sealed': True}
        temporary = path / 'build.log.json.tmp'
        # Only server-generated names in the private, verified directory.
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(canonical(value)); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, path / 'build.log.json')
        current = path
        while current != queue.root:
            fsync_directory(current); current = current.parent
        fsync_directory(queue.root)
        return value
