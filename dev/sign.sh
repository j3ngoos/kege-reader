#!/usr/bin/env bash
# Sign the current release build with AMO (unlisted = instant automated signing).
# After it finishes: copy the signed xpi into docs/ + update docs/kege-reader-updates.json,
# git push (GitHub Pages serves updates; Firefox auto-updates the installed ext).
set -euo pipefail
cd "$(dirname "$0")/.."
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
python3 dev/build.py
rm -rf dev/signsrc && mkdir -p dev/signsrc/lib
cp manifest.json content.css content.js bg.js dev/signsrc/
cp lib/kp-render.js dev/signsrc/lib/
set -a; . ~/.hermes/secrets/amo.env; set +a
~/.webext/node_modules/.bin/web-ext sign \
  --source-dir dev/signsrc \
  --artifacts-dir /tmp/amo-out \
  --channel unlisted \
  --api-key "$WEBEXT_API_JWT_ISSUER" \
  --api-secret "$WEBEXT_API_JWT_SECRET" \
  --approval-timeout 1200 \
  || true
SIGNED=$(ls -t /tmp/amo-out/kege-reader-*.xpi 2>/dev/null | grep -v source | head -1 || true)
echo "version=$V signed=$SIGNED"
echo "next: cp \$SIGNED docs/kege-reader.xpi; bump docs/kege-reader-updates.json; git push"
