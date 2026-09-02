from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import time
from urllib.parse import urlsplit


LOCAL_ASSET_VERSION = str(time.time_ns())
LOCAL_SOURCE_PATTERN = re.compile(r'(?P<prefix>(?:src|href)="?)(?P<path>\./[^"?]+\.(?:css|js))(?P<suffix>"?)')


class LocalAppHandler(SimpleHTTPRequestHandler):
    def local_html(self) -> bytes | None:
        request_path = urlsplit(self.path).path
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
        if not self.send_local_html(include_body=True):
            super().do_GET()

    def do_HEAD(self) -> None:
        if not self.send_local_html(include_body=False):
            super().do_HEAD()

    def end_headers(self) -> None:
        request_path = urlsplit(self.path).path.lower()
        if request_path.endswith(("/", ".html", ".css", ".js", ".webmanifest")):
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
