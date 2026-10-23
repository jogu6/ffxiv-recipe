import hashlib
import os
import stat
import subprocess
import tarfile
import tempfile
from pathlib import Path
from .common import (require, open_directory, open_file_beneath, portable_path,
                     unique_paths, fsync_directory)

# Deliberately conservative: an include allowlist is also mandatory.
_DENIED_DIRS = {'.git', '.ssh', '.aws', '.azure', '.gnupg', '.codex', '.agents',
               'node_modules', 'target', '__pycache__', '.cache', 'cache', 'caches',
               'reports', 'state', 'secrets', 'credentials', 'artifacts', '.venv', 'venv'}
_DENIED_FILES = {'.npmrc', '.pypirc', '.netrc', 'credentials', 'id_rsa', 'id_ed25519',
                 'id_ecdsa', 'authorized_keys', 'known_hosts'}
_DENIED_SUFFIX = ('.pem', '.key', '.pfx', '.p12', '.jks', '.keystore', '.sqlite',
                  '.sqlite3', '.db', '.log')


def excluded(path, project):
    parts = path.lower().split('/')
    if any(part in _DENIED_DIRS or part.startswith('.env') for part in parts):
        return True
    if (parts[-1] in _DENIED_FILES or parts[-1].endswith(_DENIED_SUFFIX)
            or parts[-1].startswith(('secret.', 'secrets.', 'credential.', 'credentials.'))):
        return True
    return any(path == p or path.startswith(p + '/') for p in project['exclude'])


def included(path, project):
    return any(path == p or path.startswith(p + '/') for p in project['include'])


def inventory(project):
    source = project['sourceRoot']
    # Do not inherit Git config injection, credentials, alternate indexes or a shell.
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LC_ALL': 'C',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_OPTIONAL_LOCKS': '0'}
    args = ['/usr/bin/git', '-C', source, '-c', 'core.fsmonitor=false',
            '-c', 'core.hooksPath=/dev/null', 'ls-files', '--cached', '--stage', '-z']
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env) as proc:
        try:
            # Bounded output even for an accidentally selected huge repository.
            output = proc.stdout.read(16 * 1024**2 + 1)
            require(len(output) <= 16 * 1024**2, message='Git inventory exceeds limit')
            require(proc.wait(timeout=30) == 0, message='Git source inventory failed')
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    paths = set()
    for record in output.split(b'\x00'):
        if not record:
            continue
        try:
            header, raw_path = record.split(b'\t', 1)
            mode, _, stage = header.split(b' ')
            path = raw_path.decode('utf-8')
        except (ValueError, UnicodeError):
            require(False, message='Invalid Git inventory')
        if excluded(path, project) or not included(path, project):
            continue
        portable_path(path)
        require(mode in (b'100644', b'100755') and stage == b'0',
                message='Symlink, submodule or unresolved index is unsupported')
        paths.add(path)
    for path in project['extraFiles']:
        require(included(path, project) and not excluded(path, project),
                message='Extra file is outside allowed source')
        paths.add(path)
    # Uncommitted deletions are reflected by absence; links and inaccessible files fail closed.
    fd = open_directory(source)
    present = []
    try:
        for path in sorted(paths):
            try:
                file_fd = open_file_beneath(fd, path)
            except FileNotFoundError:
                require(path not in project['extraFiles'], message='Explicit extra file is missing')
                continue
            os.close(file_fd)
            present.append(path)
    finally:
        os.close(fd)
    paths = set(present)
    unique_paths(sorted(paths))
    require(0 < len(paths) <= project['limits']['maxFiles'], message='Source file count outside limits')
    return sorted(paths)


def copy_hash(root_fd, relative, max_bytes, destination=None):
    fd = open_file_beneath(root_fd, relative)
    with os.fdopen(fd, 'rb') as f:
        before = os.fstat(f.fileno())
        require(before.st_size <= max_bytes, message='Source file exceeds limit')
        sha = hashlib.sha256()
        total = 0
        tail = b''
        out = open(destination, 'xb') if destination else None
        try:
            while chunk := f.read(256 * 1024):
                total += len(chunk)
                require(total <= max_bytes, message='Source file grew beyond limit')
                if total == len(chunk):
                    require(not chunk.startswith(b'version https://git-lfs.github.com/spec/v1'),
                            'unsupported_source', 'Git LFS pointers are unsupported')
                scan = tail + chunk
                require(not any(marker in scan for marker in (b'-----BEGIN PRIVATE KEY-----',
                        b'-----BEGIN RSA PRIVATE KEY-----', b'-----BEGIN OPENSSH PRIVATE KEY-----',
                        b'-----BEGIN EC PRIVATE KEY-----', b'-----BEGIN ENCRYPTED PRIVATE KEY-----')),
                        'secret_detected', 'Private key material is not allowed in source')
                tail = scan[-128:]
                sha.update(chunk)
                if out:
                    out.write(chunk)
            if out:
                out.flush()
                os.fsync(out.fileno())
        finally:
            if out:
                out.close()
        after = os.fstat(f.fileno())
        signature = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_nlink,
                               s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        require(signature(before) == signature(after) and total == before.st_size,
                'source_changed', 'Source changed while copying')
        return {'path': relative, 'size': total, 'sha256': sha.hexdigest(),
                'mode': 0o755 if before.st_mode & stat.S_IXUSR else 0o644,
                '_signature': signature(before)}


def create_snapshot(root, project):
    root = Path(root)
    source_fd = open_directory(project['sourceRoot'])
    snapshots = root / 'snapshots'
    snapshots.mkdir(mode=0o700, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix='.creating-', dir=snapshots) as scratch:
            scratch = Path(scratch)
            paths = inventory(project)
            entries = []
            total = 0
            for i, path in enumerate(paths):
                entry = copy_hash(source_fd, path, project['limits']['maxFileBytes'], scratch / str(i))
                total += entry['size']
                require(total <= project['limits']['maxSourceBytes'], message='Source exceeds total limit')
                entries.append(entry)
            require(inventory(project) == paths, 'source_changed', 'Source inventory changed')
            for entry in entries:
                check = copy_hash(source_fd, entry['path'], project['limits']['maxFileBytes'])
                require(check == entry, 'source_changed', 'Source changed during snapshot')
            require(inventory(project) == paths, 'source_changed', 'Source inventory changed')
            source_info = os.fstat(source_fd)
            named_info = os.stat(project['sourceRoot'], follow_symlinks=False)
            require((source_info.st_dev, source_info.st_ino) == (named_info.st_dev, named_info.st_ino),
                    'source_changed', 'Source root was replaced')
            archive = scratch / 'source.tar'
            with tarfile.open(archive, 'w', format=tarfile.USTAR_FORMAT) as tar:
                for i, entry in enumerate(entries):
                    info = tarfile.TarInfo(entry['path'])
                    info.size = entry['size']
                    info.mode = entry['mode']
                    with (scratch / str(i)).open('rb') as f:
                        tar.addfile(info, f)
            with archive.open('rb') as f:
                os.fsync(f.fileno())
                sha = hashlib.file_digest(f, 'sha256').hexdigest()
            descriptor = {'sha256': sha, 'size': archive.stat().st_size,
                          'expandedBytes': total, 'files': [
                              {k: v for k, v in e.items() if k != '_signature'} for e in entries]}
            target = snapshots / (sha + '.tar')
            # Content-addressed files are never overwritten.
            if target.exists():
                verify_snapshot(root, descriptor)
            else:
                os.link(archive, target, follow_symlinks=False)
                fsync_directory(snapshots)
            return descriptor
    finally:
        os.close(source_fd)


def verify_snapshot(root, descriptor):
    fd = open_directory(Path(root) / 'snapshots')
    try:
        file_fd = open_file_beneath(fd, descriptor['sha256'] + '.tar')
    finally:
        os.close(fd)
    with os.fdopen(file_fd, 'rb') as f:
        require(os.fstat(f.fileno()).st_size == descriptor['size']
                and hashlib.file_digest(f, 'sha256').hexdigest() == descriptor['sha256'],
                'integrity', 'Snapshot SHA-256 mismatch')
