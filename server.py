from __future__ import annotations

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from conversation_importer import ImporterError, parse_share_page, retrieve_share_page
from project_container import MAX_ARCHIVE_BYTES, ProjectContainerError, pack_project, unpack_project

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/import":
            self._import_share()
        elif self.path == "/api/project/pack":
            self._pack_project()
        elif self.path == "/api/project/unpack":
            self._unpack_project()
        else:
            self.send_error(404)

    def _import_share(self) -> None:
        try:
            request = json.loads(self._read_body(16_384))
            if not isinstance(request, dict) or not isinstance(request.get("url"), str):
                raise ValueError("request must contain a URL")
            page = retrieve_share_page(request["url"])
            payload = {"document": parse_share_page(page.html).to_dict(), "source_url": page.final_url}
            self._json(200, payload)
        except (ImporterError, ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})

    def _pack_project(self) -> None:
        try:
            request = json.loads(self._read_body(MAX_ARCHIVE_BYTES * 2))
            archive = pack_project(request)
            self._bytes(200, archive, "application/vnd.rend.project")
        except (ProjectContainerError, ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})

    def _unpack_project(self) -> None:
        try:
            self._json(200, unpack_project(self._read_body(MAX_ARCHIVE_BYTES)))
        except (ProjectContainerError, ValueError) as exc:
            self._json(400, {"error": str(exc)})

    def _read_body(self, maximum: int) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > maximum:
            raise ValueError("invalid request size")
        return self.rfile.read(length)

    def _json(self, status: int, value: object) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="rend - A ChatGPT Conversation Renderer")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("the milestone server may only bind to a loopback address")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Viewer running at http://{args.host}:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
