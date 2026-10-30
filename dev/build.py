#!/usr/bin/env python3
"""Build: dist/kompege-pip.xpi (release) + dev/ffext/ (unpacked, localhost enabled)."""
import json, os, shutil, zipfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(SRC, "dist")
FFEXT = os.path.join(SRC, "dev", "ffext")

FILES = ["content.css", "content.js", "bg.js", "lib/kp-render.js"]
ZFILES = ["manifest.json"] + FILES


def build():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(FFEXT):
        shutil.rmtree(FFEXT)
    os.makedirs(os.path.join(FFEXT, "lib"))
    for f in FILES:
        dst = os.path.join(FFEXT, f)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(SRC, f), dst)
    man = json.load(open(os.path.join(SRC, "manifest.json")))
    dev = json.loads(json.dumps(man))
    dev["content_scripts"][0]["matches"].append("http://localhost/*")
    json.dump(dev, open(os.path.join(FFEXT, "manifest.json"), "w"),
              ensure_ascii=False, indent=2)
    dxpi = os.path.join(SRC, "dev", "ffext.xpi")
    if os.path.exists(dxpi):
        os.remove(dxpi)
    with zipfile.ZipFile(dxpi, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ZFILES:
            z.write(os.path.join(FFEXT, f), f)
    xpi = os.path.join(DIST, "kompege-pip.xpi")
    if os.path.exists(xpi):
        os.remove(xpi)
    with zipfile.ZipFile(xpi, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ZFILES:
            z.write(os.path.join(SRC, f), f)
    print("built:", xpi, os.path.getsize(xpi), "bytes; dev ext:", FFEXT)


if __name__ == "__main__":
    build()
