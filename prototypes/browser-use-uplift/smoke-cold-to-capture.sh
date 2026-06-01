#!/usr/bin/env bash
# PROTOTYPE — throwaway. FULL clean-machine smoke: cold (no Chrome) → launch warm
# real Chrome → agent-browser connect → drive → durable selector capture.
# Chains the individually-proven steps into ONE run from a truly-cold state.
#
# Run after killing all Chrome (or a real reboot) to prove the whole chain.
# Usage: bash smoke-cold-to-capture.sh
set -uo pipefail

PORT=9444
PROFILE="$HOME/.agent-warm-profile"
REAL="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL="https://iteraterecruitment.oncoreservices.com"
S="smoke-$$"
B="\033[1m"; G="\033[32m"; Rd="\033[31m"; D="\033[2m"; R="\033[0m"
pass=0; fail=0
ok(){ echo -e "  ${G}✓ $*${R}"; pass=$((pass+1)); }
no(){ echo -e "  ${Rd}✗ $*${R}"; fail=$((fail+1)); }

echo -e "${B}SMOKE: cold → warm Chrome → connect → capture${R}"

# ── STEP 0: assert COLD (no Chrome, port down) ───────────────────────────────
echo -e "${B}0. assert cold start${R}"
if pgrep -x "Google Chrome" >/dev/null 2>&1; then no "Chrome still running — not cold (kill it first)"; else ok "no Chrome process"; fi
if curl -sf -m2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then no "port $PORT already up — not cold"; else ok "port $PORT down"; fi
agent-browser close --all >/dev/null 2>&1

# ── STEP 1: launch warm real Chrome (the recipe) ─────────────────────────────
echo -e "${B}1. launch warm real Chrome${R}"
"$REAL" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
        --no-first-run --no-default-browser-check "$URL" >/dev/null 2>&1 &
for i in $(seq 1 10); do
  curl -sf -m2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf -m2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 \
  && ok "real Chrome up + HTTP discovery on $PORT" || { no "Chrome failed to launch"; echo "ABORT"; exit 1; }

# ── STEP 2: agent-browser connect (clean, no dialog) ─────────────────────────
echo -e "${B}2. agent-browser connect${R}"
RES=$(agent-browser --session "$S" connect "$PORT" 2>&1)
echo "$RES" | grep -qi "done\|connected\|✓" && ok "connect: ${RES//$'\n'/ }" || no "connect failed: $RES"

# ── STEP 3: real tab present (not Chrome for Testing / blank) ─────────────────
echo -e "${B}3. drive to portal + verify real tab${R}"
sleep 3
TABS=$(agent-browser --session "$S" tab list 2>&1)
echo "$TABS" | grep -qi "oncore\|iterate" && ok "real portal tab present" || no "no real tab: $TABS"

# ── STEP 4: durable selector capture ─────────────────────────────────────────
echo -e "${B}4. capture durable selectors${R}"
agent-browser --session "$S" snapshot -i >/dev/null 2>&1
SEL=$(agent-browser --session "$S" get attr @e7 id 2>&1 | tr -d '\n')
echo "$SEL" | grep -qi "UserName\|login\|user" && ok "resolved durable selector: #$SEL" || no "selector resolve weak: '$SEL'"

# ── verdict ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${B}SMOKE RESULT: ${G}$pass passed${R}, ${Rd}$fail failed${R}"
[ "$fail" -eq 0 ] && echo -e "${G}✓ full cold→capture chain works.${R}" || echo -e "${Rd}✗ chain has gaps (see above).${R}"
echo -e "${D}session $S left live on real Chrome.${R}"
