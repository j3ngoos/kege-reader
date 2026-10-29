#!/usr/bin/env bash
# Launch (or reuse) a headless test Firefox with BiDi over the debugging port.
PORT="${KP_PORT:-9333}"
FF="$HOME/.local/firefox-158/firefox"
PROF="${KP_PROFILE:-$HOME/.hermes/cache/scratch/kp-ff-profile}"
W="${KP_W:-1280}"
H="${KP_H:-900}"
if ss -tln 2>/dev/null | grep -q "127.0.0.1:$PORT "; then
  echo "firefox already listening on $PORT"; exit 0
fi
mkdir -p "$PROF"
echo "user_pref(\"marionette.port\", ${KP_MPORT:-29313});" > "$PROF/user.js"
nohup "$FF" --headless --marionette \
  --remote-debugging-port "$PORT" --width "$W" --height "$H" \
  --profile "$PROF" --no-remote --new-window about:blank \
  > "$PROF/ff.log" 2>&1 &
echo "launched firefox pid $! on port $PORT"
