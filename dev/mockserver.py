#!/usr/bin/env python3
"""Mock SPA server for kompege TaskPage replica: serves index.html on / and /task/<id>."""
import http.server, os, sys, socketserver

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)
    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/task/") or path in ("/", "/index.html"):
            self.path = "/index.html"
        return super().do_GET()
    def log_message(self, *a):
        pass

with socketserver.TCPServer(("127.0.0.1", PORT), H) as httpd:
    print(f"serving mock on {PORT}")
    httpd.serve_forever()
