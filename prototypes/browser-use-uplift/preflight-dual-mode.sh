#!/usr/bin/env bash
# PROTOTYPE — throwaway. Proves the pre-flight + dual-mode warm-connection +
# state-record flow for the uplifted browser-use skill.
#
# Question: can a pre-flight (a) detect a warm real Chrome, (b) record that it's
# configured so the next run skips the ask, and (c) connect warm in BOTH modes?
#
#   chrome-devtools mode → real Chrome via the M144 toggle + --browserUrl 9222
#   agent-browser  mode → dedicated --user-data-dir + classic --remote-debugging-port
#                         (the toggle's port is NOT classic CDP, so this mode
#                          needs its own warm recipe)
#
# Usage: bash preflight-dual-mode.sh [chrome-devtools|agent-browser]
set -uo pipefail

MODE="${1:-chrome-devtools}"
STATE="/tmp/browser-use-preflight-state.json"   # temp; real location TBD (a brainstorm/plan decision)
TOGGLE_PORT=9222          # where the M144 chrome://inspect toggle server runs (proven)
AB_PORT=9333              # dedicated classic-CDP port for agent-browser mode
AB_PROFILE_DIR="/tmp/browser-use-ab-profile"   # dedicated non-default profile (Chrome 136+ requires non-default)
REAL_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

B="\033[1m"; D="\033[2m"; G="\033[32m"; Y="\033[33m"; Rd="\033[31m"; R="\033[0m"
step(){ echo -e "\n${B}── $* ──${R}"; }
ok(){ echo -e "  ${G}✓ $*${R}"; }
no(){ echo -e "  ${Rd}✗ $*${R}"; }
note(){ echo -e "  ${D}$*${R}"; }

# ── state helpers (the "don't re-ask next time" mechanism) ───────────────────
read_state(){ [ -f "$STATE" ] && cat "$STATE" || echo "{}"; }
state_has(){ grep -q "\"$1\": *true" "$STATE" 2>/dev/null; }
record_state(){ # key
  local key="$1"
  # naive JSON merge for the prototype — real impl uses jq/proper store
  printf '{"%s": true, "port": %s, "mode": "%s", "recorded_at": "proto"}\n' \
    "$key" "$([ "$MODE" = agent-browser ] && echo $AB_PORT || echo $TOGGLE_PORT)" "$MODE" > "$STATE"
  ok "recorded state → $STATE"
}

# ── pre-flight reachability check (mode-specific) ────────────────────────────
cdp_http_alive(){ curl -sf -m2 "http://127.0.0.1:$1/json/version" >/dev/null 2>&1; }
toggle_port_listening(){ lsof -iTCP:"$1" -sTCP:LISTEN -P >/dev/null 2>&1; }

echo -e "${B}browser-use pre-flight + dual-mode warm connection${R}  ${D}(mode=$MODE)${R}"

# ── 0. STATE SHORT-CIRCUIT: already configured? skip the setup ask ───────────
step "0. pre-flight state check"
note "state file: $STATE"
if state_has "configured_$MODE"; then
  ok "already configured for $MODE (recorded earlier) — skipping setup ask"
  note "state: $(read_state)"
else
  note "not yet configured for $MODE — running setup checks"
fi

# ── 1. mode-specific warm reachability ───────────────────────────────────────
if [ "$MODE" = "chrome-devtools" ]; then
  step "1. chrome-devtools mode — real warm Chrome via M144 toggle (port $TOGGLE_PORT)"
  if toggle_port_listening "$TOGGLE_PORT"; then
    ok "Chrome listening on $TOGGLE_PORT (toggle server up)"
    note "note: M144 toggle does NOT serve classic /json/version (404 expected) — it uses --browserUrl"
    step "2. connect chrome-devtools-mcp --browserUrl http://127.0.0.1:$TOGGLE_PORT"
    if echo '{}' | timeout 25 npx -y chrome-devtools-mcp@latest --browserUrl "http://127.0.0.1:$TOGGLE_PORT" --logFile /tmp/cdm-proto.log >/dev/null 2>&1; sleep 1; grep -q "connected" /tmp/cdm-proto.log 2>/dev/null; then
      ok "chrome-devtools-mcp CONNECTED to real warm Chrome"
      record_state "configured_chrome-devtools"
    else
      no "could not connect — check toggle at chrome://inspect/#remote-debugging"
    fi
  else
    no "nothing on $TOGGLE_PORT — FAIL CLOSED"
    note "ASK USER: open chrome://inspect/#remote-debugging and turn ON remote debugging"
    note "(never auto-launch Chrome for Testing)"
  fi

elif [ "$MODE" = "agent-browser" ]; then
  step "1. agent-browser mode — dedicated warm profile + classic CDP (port $AB_PORT)"
  if cdp_http_alive "$AB_PORT"; then
    ok "classic CDP alive on $AB_PORT (dedicated warm Chrome already up)"
  else
    no "no classic-CDP Chrome on $AB_PORT"
    note "agent-browser needs CLASSIC CDP (the M144 toggle won't work — not classic)."
    note "warm recipe: launch real Chrome with a DEDICATED non-default profile + debug port:"
    note "  '$REAL_CHROME' --remote-debugging-port=$AB_PORT --user-data-dir='$AB_PROFILE_DIR'"
    note "(Chrome 136+ blocks debug-port on the DEFAULT profile, so a dedicated dir is required)"
    note "ASK USER to start it (or skill launches the REAL chrome binary — never Chrome for Testing)"
  fi
  step "2. (if up) agent-browser connect $AB_PORT + verify NOT Chrome for Testing"
  if cdp_http_alive "$AB_PORT"; then
    VER=$(curl -s "http://127.0.0.1:$AB_PORT/json/version" 2>/dev/null)
    echo "$VER" | grep -qi "Chrome for Testing" && no "got Chrome for Testing — FAIL CLOSED" || ok "real Chrome confirmed"
    record_state "configured_agent-browser"
  else
    note "skipped — no warm classic-CDP Chrome to connect to"
  fi
else
  no "unknown mode '$MODE' (use chrome-devtools|agent-browser)"; exit 1
fi

step "verdict"
note "re-run this script to prove the state short-circuit (step 0 should say 'already configured')."
note "final state: $(read_state)"
