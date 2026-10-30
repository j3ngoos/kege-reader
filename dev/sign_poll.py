#!/usr/bin/env python3
"""Poll AMO until version 6643639 is signed, then download the signed xpi."""
import json, time, urllib.request, secrets, hmac, base64, os, sys

KEY = os.environ["WEBEXT_API_JWT_ISSUER"]
SECRET = os.environ["WEBEXT_API_JWT_SECRET"]
VER = "6643639"
OUT = os.path.expanduser("~/src/kompege-pip/dist/kege-reader-signed-0.3.13.xpi")
API = "https://addons.mozilla.org/api/v5"


def b64(d):
    return base64.urlsafe_b64encode(d).rstrip(b"=").decode()


def jwt():
    iat = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({"iss": KEY, "sub": "sdk-feedback@addons.mozilla.org",
                              "jti": secrets.token_hex(6), "iat": iat, "exp": iat + 300}).encode())
    msg = (head + "." + payload).encode()
    sig = b64(hmac.new(SECRET.encode(), msg, hashlib.sha256).digest())
    return msg.decode() + "." + sig


import hashlib  # noqa: E402  (used in jwt)


def api(path):
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + jwt(),
                                                      "User-Agent": "kege-reader-signpoll/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


deadline = time.time() + 6 * 3600
while time.time() < deadline:
    try:
        v = api(f"/versions/{VER}/")
    except Exception as e:
        print("api err:", str(e)[:120], flush=True)
        time.sleep(60)
        continue
    finfo = (v.get("version") or v).get("file") if isinstance(v, dict) else None
    status = (finfo or {}).get("status")
    print(time.strftime("%H:%M:%S"), "file status:", status, flush=True)
    if status == "signed":
        url = finfo["download_url"]
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + jwt(),
                                                   "User-Agent": "kege-reader-signpoll/1.0"})
        with urllib.request.urlopen(req, timeout=120) as r, open(OUT, "wb") as f:
            f.write(r.read())
        print("SIGNED_DOWNLOADED", OUT, os.path.getsize(OUT), flush=True)
        sys.exit(0)
    if status in ("rejected", "failed"):
        print("SIGN_" + str(status).upper(), json.dumps(v)[:600], flush=True)
        sys.exit(1)
    time.sleep(60)
print("SIGN_TIMEOUT_6H", flush=True)
sys.exit(2)
