#!/usr/bin/env python3
"""Mock SPA server for kompege TaskPage replica: serves index.html on / and /task/<id>."""
import http.server, os, sys, socketserver

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def do_GET(self):
        full = self.path
        path = full.split("?")[0]
        if path == "/task" and "id=" not in full:
            # SPA landing replica: empty taskList, tasks load only after "Найти все задачи"
            self.path = "/landing/index.html"
        elif path.startswith("/jobs/"):
            # homework (jobs) replica: .block strip + one .task .text
            self.path = "/hw/index.html"
        elif path.startswith("/task/") or path in ("/task", "/", "/index.html"):
            # relative asset refs from /task/<id> pages (e.g. src="wide.svg")
            # resolve to /task/wide.svg -> serve the basename from mock root
            base = os.path.basename(path)
            if base and "." in base and os.path.exists(os.path.join(ROOT, base)):
                self.path = "/" + base
            else:
                self.path = "/index.html"
        return super().do_GET()
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a):
        pass

with socketserver.TCPServer(("127.0.0.1", PORT), H) as httpd:
    print(f"serving mock on {PORT}")
    httpd.serve_forever()
