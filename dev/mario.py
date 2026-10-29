#!/usr/bin/env python3
"""Raw Marionette protocol-v3 client. Frames: 'SIZE:json' back-to-back, no delimiters."""
import json, socket, sys

class Reader:
    def __init__(self, sock):
        self.sock = sock
        self.buf = b""

    def _fill(self):
        c = self.sock.recv(65536)
        if not c:
            raise RuntimeError("marionette closed connection")
        self.buf += c

    def read_frame(self):
        while b":" not in self.buf:
            self._fill()
        i = self.buf.index(b":")
        n = int(self.buf[:i])
        payload = self.buf[i + 1:]
        while len(payload) < n:
            self._fill()
            payload = self.buf[i + 1:]
        self.buf = payload[n:]
        return json.loads(payload[:n].decode())

class Marionette:
    def __init__(self, host="127.0.0.1", port=2828, timeout=25):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.r = Reader(self.sock)
        self.session = None
        self.greeting = self.r.read_frame()  # sent on accept

    def _send(self, obj):
        s = json.dumps(obj).encode()
        self.sock.sendall(b"%d:%s" % (len(s), s))

    def req(self, path, method="POST", body=None):
        msg = {"format": "json", "path": path, "method": method}
        if self.session is not None:
            msg["sessionId"] = self.session
        if body is not None:
            msg["body"] = body
        self._send(msg)
        return self.r.read_frame()

    def new_session(self, caps=None):
        caps = caps or {"alwaysMatch": {"browserName": "firefox", "se:bidi": True}}
        r = self.req("/session", "POST", {"capabilities": caps})
        val = r.get("value", {})
        self.session = val.get("sessionId")
        return val.get("capabilities", {}), self.session

    def w3c(self, sub, method="POST", body=None):
        path = "/status" if sub == "/status" else "/session/" + str(self.session) + sub
        return self.req(path, method, body)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 29313
    m = Marionette(port=port)
    print("greeting:", json.dumps(m.greeting))
    caps, sid = m.new_session()
    print("session:", sid)
    print("caps:", json.dumps(caps, ensure_ascii=False)[:900])
    print("url:", json.dumps(m.w3c("/url", "GET"), ensure_ascii=False)[:200])
    m.w3c("/url", "POST", {"url": "https://kompege.ru/task/31112"})
    print("navigated")
    r = m.w3c("/execute/sync", "POST", {"script": "return JSON.stringify({t:document.title,w:innerWidth,vw:document.documentElement.scrollWidth});", "args": []})
    print("eval:", json.dumps(r, ensure_ascii=False)[:300])
