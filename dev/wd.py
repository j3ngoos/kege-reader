#!/usr/bin/env python3
"""W3C WebDriver client over geckodriver (http://127.0.0.1:4445)."""
import base64, json, os, urllib.request, urllib.error

BASE = os.environ.get("KP_WD", "http://127.0.0.1:4445")

class WD:
    def __init__(self, base=BASE):
        self.base = base
        self.sid = None

    def call(self, method, path, body=None):
        url = self.base + (f"/session/{self.sid}" if self.sid and path not in ("/status", "/session", "/sessions") else "") + path
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                out = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            out = json.loads(e.read().decode())
        val = out.get("value", {})
        if isinstance(val, dict) and val.get("error"):
            raise RuntimeError(f"wd {method} {path}: {val.get('error')}: {val.get('message','')[:300]}")
        return val

    def new_session(self, caps=None):
        caps = caps or {"alwaysMatch": {"browserName": "firefox", "se:bidi": True}}
        sidfile = "/tmp/kp_wd_sid"
        if os.path.exists(sidfile):
            old = open(sidfile).read().strip()
            if old:
                self.sid = old
                try: self.call("DELETE", "")
                except Exception: pass
                self.sid = None
        r = self.call("POST", "/session", {"capabilities": caps})
        self.sid = r["sessionId"]
        open(sidfile, "w").write(self.sid)
        return r["capabilities"]

    def delete_session(self):
        try: self.call("DELETE", "")
        except Exception: pass

    def get(self, url):
        return self.call("POST", "/url", {"url": url})

    def current_url(self):
        return self.call("GET", "/url")

    def title(self):
        return self.call("GET", "/title")

    def js(self, script, args=None):
        return self.call("POST", "/execute/sync", {"script": script, "args": args or []})

    def js_async(self, script, args=None, timeout=None):
        if timeout:
            self.timeouts("script", timeout)
        return self.call("POST", "/execute/async", {"script": script, "args": args or []})

    def screenshot(self, path):
        b = self.call("GET", "/screenshot")
        with open(path, "wb") as f:
            f.write(base64.b64decode(b))
        return path

    def timeouts(self, kind, ms):
        return self.call("POST", "/timeouts", {kind: ms})

    def windows(self):
        return self.call("GET", "/window/handles")

    def window(self, handle):
        return self.call("POST", "/window", {"handle": handle})

    def install_addon(self, path, temporary=True):
        return self.call("POST", "/moz/addon/install",
                         {"path": os.path.abspath(path), "temporary": temporary})

    def click_xy(self, x, y):
        self.call("POST", "/actions", {"actions": [
            {"type": "pointer", "id": "k", "parameters": {"pointerType": "mouse"},
             "actions": [
                 {"type": "pointerMove", "duration": 0, "x": int(x), "y": int(y)},
                 {"type": "pointerDown", "button": 0, "duration": 50},
                 {"type": "pointerUp", "button": 0, "duration": 50}]}]})
        self.call("DELETE", "/actions")

    def key(self, *keys):
        acts = [{"type": "key", "id": "kb", "actions": []}]
        for k in keys:
            acts[0]["actions"].append({"type": "keyDown", "value": k})
            acts[0]["actions"].append({"type": "keyUp", "value": k})
        self.call("POST", "/actions", {"actions": acts})
        self.call("DELETE", "/actions")

if __name__ == "__main__":
    wd = WD()
    caps = wd.new_session()
    print("session ok, bidi ws:", caps.get("webSocketUrl"))
    wd.get("https://kompege.ru/task/31112")
    print("title:", wd.title())
    print("url:", wd.current_url())
