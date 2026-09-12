from __future__ import annotations

import argparse
import json
import secrets
import threading
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import time
from urllib.parse import urlsplit, parse_qs


LOCAL_ASSET_VERSION = str(time.time_ns())
LOCAL_PROFILE_TOKEN = secrets.token_hex(24)
PROFILE_ROOT = Path(__file__).resolve().parents[1] / 'pipeline/reports/macro-profiles/received'
PROFILE_LOCK = threading.Lock()
LOCAL_SOURCE_PATTERN = re.compile(r'(?P<prefix>(?:src|href)="?)(?P<path>\./[^"?]+\.(?:css|js))(?P<suffix>"?)')


class LocalAppHandler(SimpleHTTPRequestHandler):
    def local_html(self) -> bytes | None:
        request_path = urlsplit(self.path).path
        if request_path == '/macro-app/web/index.html':
            source = (Path(self.directory) / 'macro-app/web/index.html').read_text(encoding='utf-8')
            injection = f'<script src="/__local/macro-client.js" data-token="{LOCAL_PROFILE_TOKEN}"></script>'
            return source.replace('</head>', injection + '</head>').encode('utf-8')
        if request_path not in ("/", "/index.html"):
            return None
        source = (Path(self.directory) / "index.html").read_text(encoding="utf-8")
        rendered = LOCAL_SOURCE_PATTERN.sub(
            lambda match: (
                f'{match.group("prefix")}{match.group("path")}?local={LOCAL_ASSET_VERSION}'
                f'{match.group("suffix")}'
            ),
            source,
        )
        return rendered.encode("utf-8")

    def send_local_html(self, include_body: bool) -> bool:
        content = self.local_html()
        if content is None:
            return False
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        if include_body:
            self.wfile.write(content)
        return True

    def do_GET(self) -> None:
        request = urlsplit(self.path)
        if request.path in ('/macro-app/web/app.js', '/macro-app/web/solver-worker.js'):
            source = (Path(self.directory) / request.path.lstrip('/')).read_text(encoding='utf-8')
            if request.path.endswith('/app.js'):
                source = source.replace('async function ensureSolverWorkers(signal) {',
                    'async function ensureSolverWorkers(signal) {\n'
                    '  if (globalThis.__localMobileMode !== globalThis.__localMobileLimits?.().enabled) terminateSolverWorkers();')
                source = source.replace('profiler.start(input, {',
                    'profiler.start(input, {\n    localResourceTest: globalThis.__localMobileApplied,')
            elif parse_qs(request.query).get('localMobile') == ['1']:
                source = Path(__file__).with_name('local-mobile-worker.js').read_text(encoding='utf-8') + '\n' + source
                source = source.replace('await openIndexedSearchStore()', 'globalThis.__localMobileTrackStore(await openIndexedSearchStore())')
                source = source.replace('snapshot: { ...JSON.parse(json),',
                    'snapshot: { ...JSON.parse(json), localSimulatedSleepMs: globalThis.__localMobileSleepMs,')
            content = source.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        if urlsplit(self.path).path == '/__local/macro-client.js':
            content = Path(__file__).with_name('local-macro-client.js').read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        if urlsplit(self.path).path == '/__local/macro-status':
            with PROFILE_LOCK:
                status = []
                for file in sorted(PROFILE_ROOT.glob('*.json')):
                    saved = json.loads(file.read_text(encoding='utf-8'))
                    latest = saved.get('samples', [])[-1:]
                    received = saved.get('reception', {}).get('receivedAt')
                    status.append({'runId': file.stem, 'status': saved.get('status'),
                                   'metadata': saved.get('metadata'), 'latest': latest,
                                   'secondsSinceReceipt': (datetime.now().astimezone() - datetime.fromisoformat(received)).total_seconds() if received else None,
                                   'reception': saved.get('reception')})
            self.send_json(status)
            return
        if not self.send_local_html(include_body=True):
            super().do_GET()

    def send_json(self, value, status=200):
        content = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        if urlsplit(self.path).path != '/__local/macro-profile':
            self.send_error(404)
            return
        if (self.headers.get('Origin') != 'http://' + self.headers.get('Host', '')
                or self.headers.get('X-Local-Profile-Token') != LOCAL_PROFILE_TOKEN):
            self.send_error(403)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2 * 1024 * 1024:
                self.send_error(413)
                return
            self.connection.settimeout(5)
            payload = json.loads(self.rfile.read(length))
            run_id = payload['runId']
            profile = payload['profile']
            sequence = payload['sequence']
            samples = payload['samples']
            if (not isinstance(run_id, str) or not re.fullmatch(r'[a-f0-9]{32}', run_id)
                    or not isinstance(profile, dict) or profile.get('schemaVersion') != 1
                    or not isinstance(sequence, int) or sequence < 1
                    or not isinstance(samples, list) or len(samples) > 2400
                    or not all(isinstance(s, dict) and isinstance(s.get('elapsedMs'), (int, float)) for s in samples)):
                raise ValueError('Invalid measurement')
            reception = {'receivedAt': datetime.now().astimezone().isoformat(),
                         'clientAddress': self.client_address[0], 'sequence': sequence,
                         'heartbeat': payload.get('heartbeat')}
            with PROFILE_LOCK:
                PROFILE_ROOT.mkdir(parents=True, exist_ok=True)
                target = PROFILE_ROOT / (run_id + '.json')
                previous = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {}
                if sequence > previous.get('reception', {}).get('sequence', 0):
                    old_samples = previous.get('samples', [])
                    last_time = old_samples[-1]['elapsedMs'] if old_samples else -1
                    profile['samples'] = (old_samples + [s for s in samples if s['elapsedMs'] > last_time])[-2400:]
                    profile['reception'] = reception
                    # Journal preserves all received deltas; JSON is the bounded current view.
                    with target.with_suffix('.jsonl').open('a', encoding='utf-8') as stream:
                        stream.write(json.dumps({**payload, 'profile': {k: v for k, v in profile.items() if k != 'samples'},
                                                 'reception': reception}, ensure_ascii=False) + '\n')
                    temporary = target.with_suffix('.tmp')
                    temporary.write_text(json.dumps(profile, ensure_ascii=False), encoding='utf-8')
                    temporary.replace(target)
            self.send_json({'ok': True, 'sequence': sequence})
        except (ValueError, KeyError, TypeError):
            self.send_error(400)
        except (OSError, TimeoutError):
            self.send_error(503)

    def do_HEAD(self) -> None:
        if not self.send_local_html(include_body=False):
            super().do_HEAD()

    def end_headers(self) -> None:
        request_path = urlsplit(self.path).path.lower()
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        shared_document = request_path.startswith(('/docs/', '/vendor/'))
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin" if shared_document else "same-origin")
        if shared_document:
            self.send_header("Access-Control-Allow-Origin", "*")
        if request_path.startswith('/__local/') or request_path.endswith(("/", ".html", ".css", ".js", ".webmanifest")):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the local web app without stale source caches.")
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--directory", type=Path, default=Path("site"))
    parser.add_argument("--owner-token", help=argparse.SUPPRESS)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    directory = args.directory.resolve()
    handler = partial(LocalAppHandler, directory=str(directory))
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f"Serving {directory} at http://{args.bind}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
