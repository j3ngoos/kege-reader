#!/usr/bin/env python3
"""Poll AMO upload uuid (web-ext .amo-upload-uuid) until signed, download the xpi.
Usage: WEBEXT_API_JWT_ISSUER/SECRET env; args: uploadUuid outPath"""
import json, time, urllib.request, secrets, hmac, base64, os, hashlib, sys

KEY = os.environ["WEBEXT_API_JWT_ISSUER"]
SECRET = os.environ["WEBEXT_API_JWT_SECRET"]
UUID = sys.argv[1]
OUT = os.path.expanduser(sys.argv[2])
API = "https://addons.mozilla.org/api/v5"


def b64(d):
    return base64.urlsafe_b64encode(d).rstrip(b"=").decode()


def jwt():
    iat = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({"iss": KEY, "sub": "sdk-feedback@addons.mozilla.org",
                              "jti": secrets.token_hex(6), "iat": iat, "exp": iat + 300}).encode())
    msg = (head + "." + payload).encode()
    return msg.decode() + "." + b64(hmac.new(SECRET.encode(), msg, hashlib.sha256).digest())


def get(url):
    req = urllib.request.Request(url, headers={"Authorization": "JWT " + jwt(),
                                               "User-Agent": "kege-reader-signpoll/1.0"})
    return urllib.request.urlopen(req, timeout=90)


deadline = time.time() + 12 * 3600
while time.time() < deadline:
    try:
        r = json.loads(get(f"{API}/addons/upload/{UUID}/").read().decode())
    except Exception as e:
        print(time.strftime("%H:%M:%S"), "poll err:", str(e)[:120], flush=True)
        time.sleep(180)
        continue
    ver = r.get("version") or {}
    finfo = ver.get("file") or {}
    val = r.get("validation") or {}
    keys = list(val.keys())
    nval = val.get("summary", {}).get("total", {}).get("errors") if isinstance(val.get("summary"), dict) else None
    print(time.strftime("%H:%M:%S"), "processed:", r.get("processed"),
          "ver:", ver.get("version"), "file:", finfo.get("status"),
          "dl:", bool(finfo.get("download_url")), "errs:", nval, flush=True)
    if finfo.get("download_url"):
        with get(finfo["download_url"]) as src, open(OUT, "wb") as f:
            f.write(src.read())
        print("SIGNED_DOWNLOADED", OUT, os.path.getsize(OUT), flush=True)
        sys.exit(0)
    if r.get("processed") and not ver:
        print("UPLOAD_PROCESSED_NO_VERSION", json.dumps(r)[:400], flush=True)
        sys.exit(1)
    time.sleep(180)
print("SIGN_TIMEOUT_12H", flush=True)
sys.exit(2)
