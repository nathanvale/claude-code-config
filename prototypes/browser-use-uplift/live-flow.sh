#!/usr/bin/env bash
# PROTOTYPE — throwaway. Full live flow for the dual-mode browser-use uplift.
# Drives REAL agent-browser, then lazy-resolves acted-on refs at passover.
#
# Usage: bash live-flow.sh <PORT> [URL]
# Browser-session-safety: ephemeral --session, connect, --headed, read-only on auth.
set -uo pipefail

PORT="${1:-9223}"
URL="${2:-https://iteraterecruitment.oncoreservices.com}"
S="uplift-proto-$$"

B="\033[1m"; D="\033[2m"; G="\033[32m"; Y="\033[33m"; R="\033[0m"
step() { echo -e "\n${B}── $* ──${R}"; }
note() { echo -e "  ${D}$*${R}"; }

cleanup() { echo -e "\n${D}cleanup: closing ephemeral session $S${R}"; agent-browser --session "$S" close >/dev/null 2>&1; }
trap cleanup EXIT

echo -e "${B}dual-mode browser-use uplift — live flow prototype${R}"
note "session=$S  port=$PORT  url=$URL  mode=agent-browser (default)"

# ── 1. connect (the unchanged 'attach to existing Chrome' contract) ──────────
step "1. connect (agent-browser mode)"
agent-browser --session "$S" connect "$PORT" 2>&1 | tail -2
if ! agent-browser --session "$S" tab list >/dev/null 2>&1; then
  note "${Y}no browser on $PORT — opening one (auto-launch)${R}"
fi
agent-browser --session "$S" tab new "$URL" >/dev/null 2>&1
sleep 3
note "landed: $(agent-browser --session "$S" get url 2>&1) / $(agent-browser --session "$S" get title 2>&1)"

# ── 2. drive on cheap refs (the live run — no capture ceremony) ──────────────
step "2. drive on cheap refs (snapshot -i)"
SNAP="$(agent-browser --session "$S" snapshot -i 2>&1)"
echo "$SNAP" | head -12

# ── 3. act on a couple of fields, TRACK which refs we touched ─────────────────
# (stands in for what browser-use tracks during a real session)
step "3. act on fields + track acted-on refs"
ACTED=()
# pick the first two textbox refs + the first button ref from the snapshot
TEXTBOXES=$(echo "$SNAP" | grep -iE 'textbox|input' | grep -oE 'ref=e[0-9]+' | sed 's/ref=//' | head -2)
BUTTON=$(echo "$SNAP" | grep -iE 'button' | grep -oE 'ref=e[0-9]+' | sed 's/ref=//' | head -1)
for ref in $TEXTBOXES; do
  note "type into @$ref (value SHAPE only — never a real secret)"
  agent-browser --session "$S" fill "@$ref" "PROTO_PLACEHOLDER" >/dev/null 2>&1
  ACTED+=("$ref:change")
done
[ -n "${BUTTON:-}" ] && { note "would click @$BUTTON (not clicked — avoid auth/navigation)"; ACTED+=("$BUTTON:click"); }
note "acted-on refs tracked: ${ACTED[*]:-none}"

# ── 4. PASSOVER: lazy-resolve ONLY acted-on refs to durable selectors ─────────
# Re-snapshot first (refs go stale after fills) — in the real flow the resolve
# happens at end-of-session when browser-domain-memory asks "what did you act on?"
step "4. PASSOVER — lazy-resolve acted-on refs → durable selectors"
note "(re-snapshot so refs are fresh, then resolve each acted-on ref)"
agent-browser --session "$S" snapshot -i >/dev/null 2>&1
HANDOFF_JSON="["
first=1
for entry in "${ACTED[@]}"; do
  ref="${entry%%:*}"; action="${entry##*:}"
  id="$(agent-browser --session "$S" get attr "@$ref" id 2>&1 | tr -d '\n')"
  name="$(agent-browser --session "$S" get attr "@$ref" name 2>&1 | tr -d '\n')"
  # prefer #id, fall back to [name=...]; '✓ Done' means empty
  sel=""
  [ -n "$id" ] && [ "$id" != "✓ Done" ] && sel="#$id"
  [ -z "$sel" ] && [ -n "$name" ] && [ "$name" != "✓ Done" ] && sel="[name=\"$name\"]"
  [ -z "$sel" ] && sel="UNRESOLVED(@$ref)"
  vshape="redacted:field"; [ "$action" = "click" ] && vshape="n/a"
  echo -e "  @$ref ${D}($action)${R} → ${G}$sel${R}  value=$vshape"
  [ $first -eq 0 ] && HANDOFF_JSON+=","
  HANDOFF_JSON+="{\"action\":\"$action\",\"selector\":\"$sel\",\"value\":\"$vshape\"}"
  first=0
done
HANDOFF_JSON+="]"

# ── 5. emit the handoff list build-scratch would consume ──────────────────────
step "5. handoff payload → build-scratch (Gate 1: shape-only values)"
echo "$HANDOFF_JSON" | (command -v jq >/dev/null && jq . || cat)

echo -e "\n${B}${G}flow complete.${R} ${D}durable selectors resolved only for acted-on refs, at passover.${R}"
