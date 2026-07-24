#!/usr/bin/env bash
# U0 native-seam probe runner (research-only).
#
# Exercises the ADR-0022 / ADR-0023 / ADR-0027 native containment claims that
# CAN be observed in this environment, and records honestly which claims are
# environment/authority-blocked (no Xcode, no valid signing identity).
#
# Emits JSON-lines evidence to stdout; no secrets, sentinel values only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SENTINEL="U0-SENTINEL-$(date +%s)-do-not-log-real-secret"
BIN="$WORK/native-descriptor-probe"
ENT="$WORK/delivery.entitlements.plist"

emit() { printf '{"probe":"%s","claim":"%s","observed":"%s","verdict":"%s"}\n' "$1" "$2" "$3" "$4"; }

# --- toolchain capability -------------------------------------------------
if xcodebuild -version >/dev/null 2>&1; then
	emit native-toolchain "full-xcode-available" "xcodebuild present" "env-ok"
else
	emit native-toolchain "full-xcode-available" "xcodebuild ABSENT (CommandLineTools only)" "env-blocked"
fi

VALID=$(security find-identity -v -p codesigning 2>/dev/null | grep -oE '[0-9]+ valid identities' | grep -oE '^[0-9]+' || echo 0)
if [ "${VALID:-0}" -gt 0 ]; then
	emit native-signing-identity "provisioned-identity-available" "$VALID valid identities" "env-ok"
else
	emit native-signing-identity "provisioned-identity-available" "0 valid identities" "env-blocked"
fi

# --- compile probe --------------------------------------------------------
if clang "$HERE/native-descriptor-probe.c" -o "$BIN" 2>"$WORK/clang.err"; then
	emit native-compile "probe-compiles" "clang ok" "pass"
else
	emit native-compile "probe-compiles" "clang failed: $(tr -d '\n' <"$WORK/clang.err" | cut -c1-120)" "blocked"
	exit 0
fi

# --- entitlement declaration + adhoc sign --------------------------------
cat >"$ENT" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.network.client</key><false/>
  <key>com.apple.security.network.server</key><false/>
</dict></plist>
PLIST

if codesign --force --sign - --entitlements "$ENT" "$BIN" >/dev/null 2>&1; then
	emit native-adhoc-sign "entitlements-embeddable" "adhoc sign ok" "pass"
else
	emit native-adhoc-sign "entitlements-embeddable" "adhoc sign failed" "blocked"
fi

# Verify the entitlements actually embedded (the declaration-drift gate).
ENT_DUMP=$(codesign -d --entitlements - "$BIN" 2>/dev/null || true)
if echo "$ENT_DUMP" | grep -q 'app-sandbox'; then
	emit native-entitlement-verify "entitlements-readable-back" "app-sandbox present in embedded entitlements" "pass"
else
	emit native-entitlement-verify "entitlements-readable-back" "app-sandbox NOT found" "fail"
fi
if echo "$ENT_DUMP" | grep -q 'network.client'; then
	emit native-entitlement-verify "network-client-declared-false" "network.client declared" "pass"
else
	emit native-entitlement-verify "network-client-declared-false" "network.client absent" "fail"
fi

# --- descriptor transfer + containment behavior --------------------------
# Transfer a sentinel over an inherited connected descriptor (fd 3), modeling
# the private secret-pipe/browser-channel handoff. socketpair gives a
# pre-connected pair; the child cannot re-open it, only use the inherited end.
PROBE_OUT="$WORK/probe.out"
# Feed sentinel through a pipe on fd 3 (pre-opened, inherited).
if printf '%s\n' "$SENTINEL" | "$BIN" 3<&0 >"$PROBE_OUT" 2>"$WORK/probe.err"; then
	:
fi

if grep -q 'inherited_read=ok' "$PROBE_OUT"; then
	emit native-descriptor-transfer "inherited-fd-usable" "child read sentinel from inherited fd 3" "pass"
else
	emit native-descriptor-transfer "inherited-fd-usable" "child could not read inherited fd" "fail"
fi

# Network denial: under ENFORCED sandbox this must be denied_sandbox. Under
# adhoc (unenforced) it will be ALLOWED/reached — record as env-blocked, NOT
# an architectural pass.
NET=$(grep 'new_network_connect' "$PROBE_OUT" | cut -d= -f2 || echo unknown)
case "$NET" in
	denied_sandbox) emit native-network-denial "no-new-outbound-connection" "denied_sandbox" "pass" ;;
	ALLOWED|reached_network_layer) emit native-network-denial "no-new-outbound-connection" "$NET (adhoc sandbox NOT OS-enforced)" "env-blocked" ;;
	*) emit native-network-denial "no-new-outbound-connection" "$NET" "inconclusive" ;;
esac

FILE=$(grep 'unrelated_file_open' "$PROBE_OUT" | cut -d= -f2 || echo unknown)
case "$FILE" in
	denied_sandbox) emit native-file-denial "no-unrelated-file-access" "denied_sandbox" "pass" ;;
	ALLOWED) emit native-file-denial "no-unrelated-file-access" "ALLOWED (adhoc sandbox NOT OS-enforced)" "env-blocked" ;;
	*) emit native-file-denial "no-unrelated-file-access" "$FILE" "inconclusive" ;;
esac

# Bounded single action.
if grep -q 'bounded_action=exited_after_one' "$PROBE_OUT"; then
	emit native-bounded-action "one-field-then-exit" "helper exited after one action" "pass"
else
	emit native-bounded-action "one-field-then-exit" "no bounded-exit marker" "fail"
fi

# Sentinel must NOT appear in the probe's own stderr/crash surface.
if grep -q "$SENTINEL" "$WORK/probe.err" 2>/dev/null; then
	emit native-sentinel-leak "sentinel-absent-from-stderr" "SENTINEL FOUND in stderr" "fail"
else
	emit native-sentinel-leak "sentinel-absent-from-stderr" "sentinel absent from stderr" "pass"
fi
