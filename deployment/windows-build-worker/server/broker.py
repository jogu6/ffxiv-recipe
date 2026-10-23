"""One bounded framed request per SSH connection; no shell or arbitrary filesystem API."""
import sqlite3
import argparse
import os
import signal
import resource
import struct
import sys
from pathlib import Path
from .common import Rejected, require, fields, integer, parse_json, canonical
from .queue import Queue, CHUNK
from . import job_logs, package_download

HEADER_LIMIT = 64 * 1024
OPS = {
    'ping': (),
    'claim': ('profiles',),
    'package-info': (),
    'download-package': ('offset', 'length'),
    'log-status': ('jobId', 'attempt', 'token'),
    'upload-log': ('jobId', 'attempt', 'token', 'offset', 'sha256', 'dataLength'),
    'seal-log': ('jobId', 'attempt', 'token', 'size', 'sha256'),
    'status': ('jobId',),
    'heartbeat': ('jobId', 'attempt', 'token'),
    'start': ('jobId', 'attempt', 'token'),
    'download': ('jobId', 'attempt', 'token', 'offset', 'length'),
    'begin-upload': ('jobId', 'attempt', 'token', 'manifest'),
    'upload-chunk': ('jobId', 'attempt', 'token', 'uploadId', 'index', 'offset', 'sha256', 'dataLength'),
    'finish': ('jobId', 'attempt', 'token', 'outcome', 'message'),
    'interrupt': ('jobId', 'attempt', 'token'),
}


def read_exact(stream, size):
    parts = bytearray()
    while len(parts) < size:
        chunk = stream.read(size - len(parts))
        require(chunk, 'truncated', 'Incomplete frame')
        parts.extend(chunk)
    return bytes(parts)


def read_request(stream):
    size = struct.unpack('!I', read_exact(stream, 4))[0]
    integer(size, 2, HEADER_LIMIT)
    request = parse_json(read_exact(stream, size))
    require(type(request) is dict and type(request.get('op')) is str and request['op'] in OPS,
            message='Unknown operation')
    fields(request, ('version', 'op') + OPS[request['op']])
    require(type(request['version']) is int and request['version'] == 1, message='Unknown protocol version')
    data = b''
    if request['op'] in ('upload-chunk', 'upload-log'):
        length = integer(request['dataLength'], 1, job_logs.CHUNK if request['op'] == 'upload-log' else CHUNK)
        data = read_exact(stream, length)
    # Client must close stdin after one request. Reject trailing frames/data.
    require(stream.read(1) == b'', message='Trailing request data')
    return request, data


def respond(stream, header, data=b''):
    header = dict(header, version=1, dataLength=len(data))
    raw = canonical(header)
    # Claim descriptors may include up to 20k file records; responses have a separate limit.
    require(len(raw) <= 8 * 1024**2, message='Response exceeds limit')
    stream.write(struct.pack('!I', len(raw)))
    stream.write(raw)
    stream.write(data)
    stream.flush()


def dispatch(queue, worker, request, data):
    op = request['op']
    if op == 'ping':
        queue.policy.worker(worker)
        return {'ready': True}, b''
    if op == 'package-info':
        return package_download.download(queue.root)
    if op == 'download-package':
        integer(request['length'], 1, CHUNK)
        return package_download.download(queue.root, request['offset'], request['length'])
    if op == 'claim':
        return queue.claim(worker, request['profiles']), b''
    if op == 'status':
        return queue.status(request['jobId'], worker=worker), b''
    base = (worker, request['jobId'], request['attempt'], request['token'])
    if op == 'log-status':
        return job_logs.status(queue, *base), b''
    if op == 'upload-log':
        return job_logs.append(queue, *base, request['offset'], request['sha256'], data), b''
    if op == 'seal-log':
        return job_logs.seal(queue, *base, request['size'], request['sha256']), b''
    if op == 'heartbeat':
        return queue.heartbeat(*base), b''
    if op == 'start':
        return queue.start(*base), b''
    if op == 'download':
        return queue.download(*base, request['offset'], request['length'])
    if op == 'begin-upload':
        return queue.begin_upload(*base, request['manifest']), b''
    if op == 'upload-chunk':
        return queue.upload_chunk(*base, request['uploadId'], request['index'], request['offset'],
                                  request['sha256'], data), b''
    if op == 'finish':
        return queue.finish(*base, request['outcome'], request['message']), b''
    if op == 'interrupt':
        return queue.interrupt(*base), b''
    require(False, message='Unknown operation')


def serve(queue, worker, input_stream, output_stream):
    try:
        queue.policy.worker(worker)
        request, data = read_request(input_stream)
        result, binary = dispatch(queue, worker, request, data)
        respond(output_stream, {'ok': True, 'result': result}, binary)
        return 0
    except Rejected as exc:
        respond(output_stream, {'ok': False, 'error': exc.code, 'message': str(exc)})
        return 2
    except (OSError, ValueError, TypeError, KeyError, OverflowError, sqlite3.Error):
        # Do not expose paths, SQL, environment, request bodies or credentials.
        respond(output_stream, {'ok': False, 'error': 'operation_failed', 'message': 'Operation failed; operator review required'})
        return 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', required=True, help='Administrator-bound identity, never client supplied')
    args = parser.parse_args()
    os.umask(0o077)
    # Per-request bounds supplement the existing user slice CPU/memory limits.
    for name, ceiling in ((resource.RLIMIT_AS, 512 * 1024**2), (resource.RLIMIT_CPU, 60)):
        soft, hard = resource.getrlimit(name)
        limit = ceiling if hard == resource.RLIM_INFINITY else min(hard, ceiling)
        if soft != resource.RLIM_INFINITY:
            limit = min(limit, soft)
        resource.setrlimit(name, (limit, limit))
    root = Path(__file__).resolve().parents[1]
    require(os.environ.get('SSH_ORIGINAL_COMMAND', '') in ('', 'build-worker-v1'),
            'denied', 'SSH command is not approved')
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Rejected('timeout', 'Request timed out')))
    signal.alarm(120)
    try:
        with Queue(root) as queue:
            return serve(queue, args.worker, sys.stdin.buffer, sys.stdout.buffer)
    finally:
        signal.alarm(0)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(1)
    except (Rejected, OSError, ValueError, TypeError, KeyError, sqlite3.Error):
        # Startup/configuration errors also have a framed, sanitized response.
        respond(sys.stdout.buffer, {'ok': False, 'error': 'startup_failed', 'message': 'Broker configuration or startup rejected'})
        sys.exit(2)
