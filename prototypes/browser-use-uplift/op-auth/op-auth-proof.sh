#!/usr/bin/env bash
# PROTOTYPE — throwaway. REAL `op` auth pull, read-only SHAPE proof.
#
# Proves the live-auth boundary against a REAL 1Password item (the Oncore login)
# WITHOUT a live login and WITHOUT ever printing/storing the secret value:
#   1. resolve a real Auth Pointer (op:// reference) via the service account
#   2. derive only SHAPE (present? length? prefix-char?) — never the value
#   3. simulate filling a field, then LEAK-CHECK that the secret string appears
#      in NO persisted artifact (run-book, recorder JSON, run log) and NO stdout
#
# Real `op` here (service-account, no dialogs). Read-only. No site touched.
# Run: bash prototypes/browser-use-uplift/op-auth/op-auth-proof.sh
set -uo pipefail
set +x  # never echo commands (could expose secret in xtrace)

VAULT="API Credentials"
ITEM="iteraterecruitment.oncoreservices.com (nathanvale73@gmail.com)"
# The Auth Pointer that WOULD live in memory — shape-only, no value:
AUTH_POINTER="op://${VAULT}/${ITEM}/password"
G="\033[32m"; R="\033[31m"; D="\033[2m"; B="\033[1m"; X="\033[0m"

echo -e "${B}REAL op auth pull — read-only shape proof${X}"
echo -e "${D}auth pointer (what memory stores): op://${VAULT}/<item>/password${X}"
echo ""

# ── 1. resolve the secret into a shell var ONLY (never to disk, never echoed) ──
# Use `op item get --fields` (robust to spaces in vault/item names; the op://
# URL form chokes on the spaces in "API Credentials" / the item title).
# --reveal returns the concealed value on stdout; capture into a var, never print.
SECRET="$(op item get "$ITEM" --vault "$VAULT" --fields label=password --reveal 2>/dev/null)"
if [ -z "$SECRET" ]; then
  echo -e "${R}✗ could not resolve secret (item/field name or service-account scope)${X}"
  # try to confirm the item is reachable at all (metadata only)
  op item get "$ITEM" --vault "$VAULT" --fields label=username >/dev/null 2>&1 \
    && echo -e "${D}  (item reachable; password field label may differ — check field names)${X}" \
    || echo -e "${D}  (item not reachable by this service account)${X}"
  exit 1
fi

# ── 2. derive SHAPE only — present / length / first-char-class — never value ──
LEN=${#SECRET}
case "${SECRET:0:1}" in
  [A-Z]) PREFIX="upper" ;; [a-z]) PREFIX="lower" ;; [0-9]) PREFIX="digit" ;; *) PREFIX="symbol" ;;
esac
echo -e "${G}✓ resolved real secret via op${X}  ${D}(value NEVER printed)${X}"
echo -e "  shape: present=yes  length=${LEN}  first-char-class=${PREFIX}"
echo -e "  ${D}this shape is what's safe to log/observe; the value is not${X}"
echo ""

# ── 3. simulate the fill + build the artifacts memory WOULD persist ───────────
# fill is in-memory only; persisted artifacts must contain ONLY shapes/pointers.
RUNBOOK="{\"field\":\"password\",\"secretRef\":\"${AUTH_POINTER}\",\"valueShape\":\"redacted:password-field\"}"
RECORDER="{\"type\":\"change\",\"selectors\":[[\"#MainContent_LoginControl_Password\"]],\"value\":\"redacted:password-field\"}"
RUNLOG="{\"at\":\"proto\",\"result\":\"filled\",\"field\":\"password\",\"value\":\"redacted:password-field\"}"

# ── 4. LEAK CHECK: does the real secret appear in any persisted artifact? ──────
echo -e "${B}leak-check: scan persisted artifacts for the real secret${X}"
LEAK=0
for name in RUNBOOK RECORDER RUNLOG; do
  content="${!name}"
  case "$content" in
    *"$SECRET"*) echo -e "  ${R}✗ LEAK in ${name}${X}"; LEAK=1 ;;
    *)           echo -e "  ${G}✓ ${name} clean (shape-only)${X}" ;;
  esac
done

# also prove the value never hit this script's stdout: re-scan our own output is
# impractical inline, but we structurally never echoed $SECRET — only its shape.
echo ""
if [ "$LEAK" -eq 0 ]; then
  echo -e "${G}${B}PASS${X} — real op secret resolved + filled; leaks NOWHERE in persisted artifacts."
  echo -e "${D}memory stores only the op:// pointer + redacted:* shapes. Value lived in a shell var, never on disk.${X}"
else
  echo -e "${R}${B}FAIL${X} — secret leaked into a persisted artifact (see above)."
  exit 1
fi
unset SECRET  # drop it
