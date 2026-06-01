#!/usr/bin/env bash
# PROTOTYPE — throwaway. Proves THE vision:
#   ONE Chrome, ONE port, MANY warm portal tabs. Jump back to any → still warm.
#   No port-hopping, no whack-a-mole, no cookies trashed.
#
# Instruments the PORT the whole time so we can SEE if it stays on one port
# or spawns new ones. Uses a SAFE profile (Monash QA) — no precious session.
#
# Usage: bash one-browser-many-portals.sh
set -uo pipefail

PROFILE="Profile 8"   # Monash QA — safe throwaway
B="\033[1m"; D="\033[2m"; G="\033[32m"; Y="\033[33m"; C="\033[36m"; R="\033[0m"
step(){ echo -e "\n${B}── $* ──${R}"; }
note(){ echo -e "  ${D}$*${R}"; }

# Portals to open as warm tabs in ONE browser
declare -a PORTALS=(
  "https://example.com"
  "https://iteraterecruitment.oncoreservices.com"
  "https://manpowergroup.fasttrack360.com.au"
)

# --- helper: which CDP ports are alive right now? (the whack-a-mole detector) ---
live_ports(){
  for p in $(seq 9222 9240); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -m1 "http://127.0.0.1:$p/json/version" 2>/dev/null)
    [ "$code" = "200" ] && echo -n "$p "
  done
  echo
}

cleanup(){ echo -e "\n${D}cleanup: leaving the profile browser open (warm). Not closing — that's the point.${R}"; }
trap cleanup EXIT

echo -e "${B}ONE browser, MANY warm portals — port behavior proof${R}"
note "profile='$PROFILE' (Monash QA, safe)"
note "ports alive BEFORE: $(live_ports)"

# ── 1. open the FIRST portal via --profile (this launches/attaches the warm Chrome) ──
step "1. open first portal (example.com) via --profile"
agent-browser --profile "$PROFILE" --headed open "${PORTALS[0]}" 2>&1 | tail -3
sleep 3
note "url: $(agent-browser --profile "$PROFILE" get url 2>&1)"
note "${C}ports alive AFTER portal 1: $(live_ports)${R}  ${D}<- remember this number${R}"

# ── 2. open the OTHER portals — do they join the SAME browser/port, or spawn new? ──
step "2. open the other portals — same browser or new ports?"
for url in "${PORTALS[@]:1}"; do
  note "opening $url ..."
  agent-browser --profile "$PROFILE" --headed tab new "$url" 2>&1 | tail -1
  sleep 2
  note "${C}ports alive now: $(live_ports)${R}"
done

# ── 3. list tabs — are all portals in ONE browser? ──
step "3. tabs in the browser (all portals in one Chrome?)"
agent-browser --profile "$PROFILE" --headed tab list 2>&1 | head -15

# ── 4. JUMP BACK to a portal we opened earlier — is it still warm? ──
step "4. jump back to portal 2 (oncore) — still the warm session?"
agent-browser --profile "$PROFILE" --headed tab list 2>&1 | grep -i "oncore" || note "(find oncore tab above)"
note "re-snapshot oncore to confirm it's the SAME warm page, not a fresh load"
# (in real use: agent-browser --profile "$PROFILE" tab <n> to focus it)

# ── 5. verdict on ports ──
step "5. PORT VERDICT"
FINAL_PORTS=$(live_ports)
note "${C}final live ports: $FINAL_PORTS${R}"
note "if that's ONE port the whole time → Model A (one browser, your vision) ✅"
note "if it grew per portal → Model B (port-per-session, whack-a-mole) ✗"
