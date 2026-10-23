import hashlib
import json
import os
import re
import stat
from pathlib import Path


class Rejected(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def require(condition, code='invalid', message='Request rejected'):
    if not condition:
        raise Rejected(code, message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                      allow_nan=False).encode('ascii')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def parse_json(data):
    def pairs(items):
        result = {}
        for k, v in items:
            require(k not in result, message='Duplicate JSON key')
            result[k] = v
        return result
    try:
        return json.loads(data, object_pairs_hook=pairs,
                          parse_constant=lambda _: require(False, message='Non-finite JSON value'))
    except (ValueError, UnicodeError, RecursionError):
        raise Rejected('invalid', 'Invalid JSON') from None


def fields(obj, required, optional=()):
    require(type(obj) is dict and set(required) <= set(obj) <= set(required) | set(optional),
            message='Unexpected or missing fields')


def identifier(value):
    require(type(value) is str and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', value),
            message='Invalid identifier')
    return value


def hexhash(value):
    require(type(value) is str and re.fullmatch(r'[0-9a-f]{64}', value), message='Invalid SHA-256')
    return value


def integer(value, low, high):
    require(type(value) is int and low <= value <= high, message='Integer outside limits')
    return value


_RESERVED = re.compile(r'^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)', re.I)


def portable_path(value):
    require(type(value) is str and 0 < len(value) <= 240, message='Invalid relative path')
    require(value.isascii(), message='Only ASCII portable paths are supported in stage one')
    parts = value.split('/')
    for part in parts:
        require(part not in ('', '.', '..') and not part.endswith(('.', ' '))
                and not _RESERVED.match(part)
                and not any(ord(c) < 32 or c in '\\:<>"|?*' for c in part),
                message='Unsafe Windows path')
    return value


def unique_paths(paths):
    files = set()
    spelling = {}
    for value in paths:
        portable_path(value)
        lower = value.lower()
        require(lower not in files, message='Duplicate or case-colliding paths')
        files.add(lower)
        parts = value.split('/')
        for i in range(1, len(parts) + 1):
            prefix = '/'.join(parts[:i])
            folded = prefix.lower()
            require(folded not in spelling or spelling[folded] == prefix,
                    message='Case-colliding path components')
            spelling[folded] = prefix
    for value in paths:
        parts = value.lower().split('/')
        for i in range(1, len(parts)):
            require('/'.join(parts[:i]) not in files, message='File/directory collision')


def open_directory(path):
    """Open every component without following symlinks, including ancestors."""
    p = Path(path)
    require(p.is_absolute() and '..' not in p.parts, message='Absolute canonical directory required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in p.parts[1:]:
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_file_beneath(root_fd, relative):
    portable_path(relative)
    fd = os.dup(root_fd)
    try:
        parts = relative.split('/')
        for part in parts[:-1]:
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
        result = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        try:
            info = os.fstat(result)
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                    message='Only regular, non-hardlinked files are accepted')
        except BaseException:
            os.close(result)
            raise
        return result
    finally:
        os.close(fd)


def secure_root(path):
    root = Path(path)
    fd = open_directory(root)
    try:
        info = os.fstat(fd)
        require(info.st_uid == os.geteuid() and info.st_mode & 0o077 == 0,
                'permissions', 'Worker root must be owned by this user and mode 0700')
    finally:
        os.close(fd)
    return root


def read_private_json(root, relative, limit=1024 * 1024):
    fd = open_directory(root)
    try:
        file_fd = open_file_beneath(fd, relative)
    finally:
        os.close(fd)
    with os.fdopen(file_fd, 'rb') as f:
        info = os.fstat(f.fileno())
        require(info.st_uid == os.geteuid() and not info.st_mode & 0o022,
                'permissions', 'Configuration must be owned and not writable by other users')
        data = f.read(limit + 1)
        require(len(data) <= limit, message='Configuration too large')
        return parse_json(data)


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
