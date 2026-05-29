#!/usr/bin/env bash
# Launch the dedicated agent Chrome that chrome-devtools-mcp --auto-connect attaches to.
#
# Why this exists: --auto-connect ATTACHES, it does not launch. chrome-devtools-mcp discovers the
# browser via the DevToolsActivePort file inside the profile dir. A stale file misleads it; a
# missing one fails it. So step zero of any browser-use run is: ensure an agent Chrome is running
# on a known port + write a fresh DevToolsActivePort. This is the lean replacement for the
# ba-browse surface-manager launch machinery.
#
# Usage:  launch-agent-chrome.sh [PORT] [PROFILE_DIR]
# Default: PORT=9223  PROFILE_DIR=~/.cache/chrome-agent
#
# Safe to re-run: if a healthy agent Chrome is already on PORT, it does nothing.

set -euo pipefail

PORT="${1:-9223}"
PROFILE_DIR="${2:-$HOME/.cache/chrome-agent}"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# 1. Already healthy on PORT? Reuse it (warm reuse is the goal).
if curl -s -m 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "agent Chrome already live on :${PORT} — reusing"
else
  # 2. Clear any stale port file so nothing reads a dead port, then launch.
  rm -f "${PROFILE_DIR}/DevToolsActivePort"
  [ -x "$CHROME" ] || { echo "Chrome not found at: $CHROME (set CHROME_BIN)"; exit 1; }
  "$CHROME" \
    --remote-debugging-port="${PORT}" \
    --user-data-dir="${PROFILE_DIR}" \
    --no-first-run --no-default-browser-check \
    about:blank >/dev/null 2>&1 &
  # 3. Wait for the port to bind.
  for _ in $(seq 1 20); do
    curl -s -m 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

# 4. Write a fresh DevToolsActivePort pointing at the live browser (chrome-devtools-mcp reads this).
WS_PATH="$(curl -s -m 2 "http://127.0.0.1:${PORT}/json/version" | grep -o 'devtools/browser/[a-z0-9-]*' || true)"
if [ -z "$WS_PATH" ]; then
  echo "ERROR: agent Chrome did not come up on :${PORT}"; exit 2
fi
printf '%s\n/%s\n' "$PORT" "$WS_PATH" > "${PROFILE_DIR}/DevToolsActivePort"

echo "✅ agent Chrome ready on :${PORT}"
echo "   profile:  ${PROFILE_DIR}"
echo "   ws:       /${WS_PATH}"
echo "   chrome-devtools-mcp --auto-connect --userDataDir ${PROFILE_DIR} will now attach."
