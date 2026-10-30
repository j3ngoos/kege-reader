#!/usr/bin/env python3
"""Fetch the AMO-signed xpi for an uploaded version.
AMO signs unlisted uploads instantly; web-ext's approval poll is useless when the
add-on is status=incomplete (file.status never becomes 'public' there).
Endpoints (owner JWT scheme is literally "JWT", not "Bearer"):
  numeric addon id:  /api/v5/addons/addon/?author=<uid>&for_user=1
  version detail:    /api/v5/addons/addon/<numeric_id>/versions/<version_id>/?for_user=1
  signed file:       version.file.url (addons.mozilla.org/firefox/downloads/file/...) with the same JWT
Usage: version_id [out_path]  (env WEBEXT_API_JWT_ISSUER/SECRET)"""
import json, time, urllib.request, secrets, hmac, base64, os, hashlib, sys

KEY = os.environ["WEBEXT_API_JWT_ISSUER"]
SECRET = os.environ["WEBEXT_API_JWT_SECRET"]
ADDON_ID = os.environ.get("AMO_ADDON_ID", "3113252")  # kege-reader@j3ngoos.github.io
VID = sys.argv[1]
OUT = os.path.expanduser(sys.argv[2] if len(sys.argv) > 2
                         else f"dist/kege-reader-signed.xpi")


def b64(d):
    return base64.urlsafe_b64encode(d).rstrip(b"=").decode()


def jwt():
    iat = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({"iss": KEY, "sub": "sdk-feedback@addons.mozilla.org",
                              "jti": secrets.token_hex(8), "iat": iat, "exp": iat + 300}).encode())
    msg = (head + "." + payload).encode()
    return msg.decode() + "." + b64(hmac.new(SECRET.encode(), msg, hashlib.sha256).digest())


def get(url, raw=False):
    req = urllib.request.Request(url, headers={"Authorization": "JWT " + jwt(),
                                               "User-Agent": "Mozilla/5.0 (kege-reader)"})
    data = urllib.request.urlopen(req, timeout=120).read()
    return data if raw else json.loads(data.decode())


base = "https://addons.mozilla.org/api/v5/"
v = get(base + f"addons/addon/{ADDON_ID}/versions/{VID}/?for_user=1")
f = v.get("file") or {}
print("version:", v.get("version"), "file_status:", f.get("status"))
if not f.get("url"):
    sys.exit("no file.url (upload not submitted?)")
data = get(f["url"], raw=True)
assert data[:2] == b"PK", "not an xpi"
os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
open(OUT, "wb").write(data)
print("SIGNED_XPI", OUT, len(data), "sha256", hashlib.sha256(data).hexdigest())
