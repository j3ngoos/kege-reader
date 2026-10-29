#!/usr/bin/env python3
import json, socket, sys, time

port = int(sys.argv[1]) if len(sys.argv) > 1 else 29313
sock = socket.create_connection(("127.0.0.1", port), timeout=30)
f = sock.makefile("rwb")

def send(obj):
    s = json.dumps(obj).encode()
    f.write(b"%d:%s" % (len(s), s)); f.flush()
    print(">>", s.decode()[:300])

def recv(label, timeout=30):
    sock.settimeout(timeout)
    try:
        line = f.readline()
    except socket.timeout:
        print(f"<< {label}: TIMEOUT")
        return None
    if not line:
        print(f"<< {label}: EOF"); return None
    line = line.strip()
    n = int(line.split(b":", 1)[0]); payload = line.split(b":", 1)[1]
    while len(payload) < n:
        payload += sock.recv(n - len(payload))
    data = json.loads(payload.decode())
    print(f"<< {label}:", json.dumps(data, ensure_ascii=False)[:800])
    return data

recv("greeting-on-accept", 5)                      # expect timeout
send({"format": "json", "protocols": ["geckodriver", "webext"]})
recv("after-format", 20)
send({"format": "json", "path": "/session", "method": "POST",
      "body": {"capabilities": {"alwaysMatch": {"browserName": "firefox", "se:bidi": True}}}})
recv("new-session", 30)
send({"format": "json", "path": "/status", "method": "GET", "sessionId": None})
recv("status", 15)
