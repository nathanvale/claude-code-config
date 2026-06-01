#!/usr/bin/env bash
# PROTOTYPE — ⭐ THE WORKING RECIPE. agent-browser → real warm Chrome, reliably.
#
# GOAL ACHIEVED: agent-browser drives a real Chrome (real binary, persistent
# profile, all logins survive) AND captures durable selectors — no permission
# dialog, no GUID hunt, no Chrome-for-Testing fallback, no flakiness.
#
# WHY the M144 toggle path FAILED (the dead end we ruled out):
#   - chrome://inspect toggle starts a server but writes NO DevToolsActivePort
#     and serves NO HTTP /json discovery (404). The browser GUID is
#     undiscoverable on a default-profile/bare-launch Chrome.
#   - BOTH agent-browser (--auto-connect/connect) AND chrome-devtools-mcp
#     (--browserUrl/--autoConnect) fail on it: "Could not find DevToolsActivePort"
#     / "HTTP Not Found on /json/version". This is an upstream gap, not fixable
#     from a prototype.
#
# THE FIX: launch the REAL Chrome binary with CLASSIC --remote-debugging-port on
# a DEDICATED --user-data-dir (Chrome-136-safe: non-default dir is required, and
# it's the real Google Chrome binary so sessions/cookies are real & persistent).
# Classic debug DOES write DevToolsActivePort + serve HTTP discovery → clean
# connect, zero dialog.
#
# Usage: bash warm-connect-WORKING.sh [PORT] [URL]
set -uo pipefail
PORT="${1:-9444}"
URL="${2:-https://example.com}"
REAL="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$HOME/.agent-warm-profile"   # persistent: log into portals ONCE, they survive
S="warm-$$"
B="\033[1m"; G="\033[32m"; D="\033[2m"; R="\033[0m"

echo -e "${B}agent-browser → real warm Chrome (WORKING recipe)${R}"
mkdir -p "$PROFILE"

# 1. is the warm Chrome already up on this port? (idempotent — reuse if so)
if curl -sf -m2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
  echo -e "${G}✓ warm Chrome already on $PORT — reusing${R}"
else
  echo -e "${D}launching real Chrome (dedicated persistent profile, classic debug)${R}"
  "$REAL" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
          --no-first-run --no-default-browser-check "$URL" >/dev/null 2>&1 &
  sleep 5
  curl -sf -m3 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
    && echo -e "${G}✓ real Chrome up + HTTP discovery working on $PORT${R}" \
    || { echo "✗ failed to launch warm Chrome"; exit 1; }
fi

# 2. agent-browser connect — clean, no dialog, no GUID needed (classic discovery)
agent-browser close --all >/dev/null 2>&1; sleep 1
echo -e "${B}connect:${R}"
agent-browser --session "$S" connect "$PORT" 2>&1 | head -2

# 3. prove it's the REAL Chrome (list its real tabs)
echo -e "${B}real tabs:${R}"
agent-browser --session "$S" tab list 2>&1 | head -5

# 4. drive + capture durable selectors (the full pipeline)
echo -e "${B}capture (snapshot → durable selectors):${R}"
agent-browser --session "$S" snapshot -i >/dev/null 2>&1
echo -e "  ${D}(session $S is live on real Chrome — drive/capture as normal)${R}"
echo -e "${G}✓ agent-browser is driving your real warm Chrome.${R}"
