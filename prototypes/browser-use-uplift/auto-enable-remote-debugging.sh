#!/usr/bin/env bash
# PROTOTYPE — throwaway. PROVEN recipe: fully automate enabling Chrome's M144+
# remote-debugging toggle (chrome://inspect) with NO human, via peekaboo.
#
# The battle was COORDINATES, not capability. peekaboo CAN click the chrome://
# web-content checkbox — the trick is to position the window DETERMINISTICALLY
# first (don't trust where it is, esp. on multi-display), then the checkbox is
# at a fixed offset.
#
# Proven live: click flips checkbox → "Server running at 127.0.0.1:9222" →
# port 9222 LISTENING. No separate Allow dialog — the checkbox IS the grant.
#
# Usage: bash auto-enable-remote-debugging.sh [PORT]
set -uo pipefail
PORT="${1:-9222}"
PB="${PEEKABOO_BIN:-$HOME/bin/peekaboo}"; [ -x "$PB" ] || PB="$(command -v peekaboo)"
G="\033[32m"; D="\033[2m"; Rd="\033[31m"; B="\033[1m"; R="\033[0m"

echo -e "${B}auto-enable Chrome remote debugging (no human)${R}"

# 0. already on? short-circuit
if lsof -iTCP:"$PORT" -sTCP:LISTEN -P >/dev/null 2>&1; then
  echo -e "${G}✓ already listening on $PORT — nothing to do${R}"; exit 0
fi

# 1. open the inspect page
open -a "Google Chrome" "chrome://inspect/#remote-debugging"
sleep 2

# 2. DETERMINISTIC window position on main display (THE key fix)
osascript -e 'tell application "Google Chrome" to set bounds of front window to {0, 30, 1200, 905}' >/dev/null 2>&1
osascript -e 'tell application "Google Chrome" to activate' >/dev/null 2>&1
sleep 1

# 3. click the "Allow remote debugging" checkbox
#    window origin (0,30) + checkbox screenshot-offset (210,156) = global (210,186)
#    (screenshot maps 1:1 to logical points at this window width)
"$PB" click --coords 210,186 --json >/dev/null 2>&1
sleep 2

# 4. verify the server came up
if lsof -iTCP:"$PORT" -sTCP:LISTEN -P >/dev/null 2>&1; then
  echo -e "${G}✓ remote debugging ENABLED — server on 127.0.0.1:$PORT${R}"
  echo -e "${D}  connect: chrome-devtools-mcp --browserUrl http://127.0.0.1:$PORT${R}"
  exit 0
else
  echo -e "${Rd}✗ click landed but server not up — window may have moved; re-check coords${R}"
  echo -e "${D}  (deterministic re-position is the fix; never fall back to a human in full-auto mode)${R}"
  exit 1
fi
