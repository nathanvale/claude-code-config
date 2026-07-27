#!/usr/bin/env bash
# Auth U0 signed-native rerun gate and dispatcher.
#
# This script never builds or ad-hoc-signs a substitute. It dispatches a
# product-owned probe only after the ADR 0028 operator prerequisites pass.
set -euo pipefail

EX_USAGE=64
EX_CONFIG=78
provisioning_profile=""
notary_keychain_profile=""
profile_plist=""
blocked=0

cleanup() {
	if [[ -n "$profile_plist" && -f "$profile_plist" ]]; then
		rm -f "$profile_plist"
	fi
}
trap cleanup EXIT

emit() {
	printf '{"check":"%s","status":"%s","code":"%s"}\n' "$1" "$2" "$3"
}

usage() {
	printf '%s\n' \
		"usage: browser-auth-u0-rerun.sh \\" \
		"  --provisioning-profile PATH \\" \
		"  --notary-keychain-profile NAME \\" \
		"  -- SIGNED_PRODUCT_PROBE [ARGS...]"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--provisioning-profile)
			[[ $# -ge 2 ]] || {
				usage >&2
				exit "$EX_USAGE"
			}
			provisioning_profile="$2"
			shift 2
			;;
		--notary-keychain-profile)
			[[ $# -ge 2 ]] || {
				usage >&2
				exit "$EX_USAGE"
			}
			notary_keychain_profile="$2"
			shift 2
			;;
		--)
			shift
			break
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			usage >&2
			exit "$EX_USAGE"
			;;
	esac
done

developer_dir="$(xcode-select -p 2>/dev/null || true)"
if [[ "$developer_dir" == */Contents/Developer ]] &&
	xcodebuild -version >/dev/null 2>&1 &&
	xcrun --find notarytool >/dev/null 2>&1; then
	emit "full-xcode" "pass" "full-xcode-active"
else
	emit "full-xcode" "blocked" "full-xcode-required"
	blocked=1
fi

developer_id_count="$(
	security find-identity -v -p codesigning 2>/dev/null |
		awk '/Developer ID Application:/{count++} END {print count + 0}'
)" || developer_id_count=0
if [[ "$developer_id_count" -gt 0 ]]; then
	emit "signing-identity" "pass" "developer-id-application-present"
else
	emit "signing-identity" "blocked" "developer-id-application-required"
	blocked=1
fi

if [[ -z "$provisioning_profile" ]]; then
	emit "provisioning-profile" "blocked" "profile-path-required"
	blocked=1
elif [[ ! -f "$provisioning_profile" ]]; then
	emit "provisioning-profile" "blocked" "profile-not-found"
	blocked=1
else
	profile_plist="$(mktemp "${TMPDIR:-/tmp}/browser-auth-u0-profile.XXXXXX")"
	if security cms -D -i "$provisioning_profile" >"$profile_plist" 2>/dev/null; then
		team_id="$(
			/usr/libexec/PlistBuddy -c "Print :TeamIdentifier:0" \
				"$profile_plist" 2>/dev/null || true
		)"
		keychain_groups="$(
			/usr/libexec/PlistBuddy -c "Print :Entitlements:keychain-access-groups" \
				"$profile_plist" 2>/dev/null || true
		)"
		expiration="$(
			/usr/libexec/PlistBuddy -c "Print :ExpirationDate" \
				"$profile_plist" 2>/dev/null || true
		)"
		expiration_epoch="$(
			LC_ALL=C date -j -f "%a %b %d %T %Z %Y" "$expiration" "+%s" \
				2>/dev/null || printf '0'
		)"
		minimum_expiration_epoch="$(( $(date +%s) + 30 * 24 * 60 * 60 ))"

		if [[ -n "$team_id" &&
			"$keychain_groups" == *"$team_id"* &&
			"$expiration_epoch" -ge "$minimum_expiration_epoch" ]]; then
			emit "provisioning-profile" "pass" "stable-keychain-profile-present"
		else
			emit "provisioning-profile" "blocked" "stable-keychain-profile-required"
			blocked=1
		fi
	else
		emit "provisioning-profile" "blocked" "profile-decode-failed"
		blocked=1
	fi
fi

if [[ -z "$notary_keychain_profile" ]]; then
	emit "notarization-access" "blocked" "notary-keychain-profile-required"
	blocked=1
elif [[ "$blocked" -eq 0 ]]; then
	if xcrun notarytool history \
		--keychain-profile "$notary_keychain_profile" \
		--output-format json >/dev/null 2>&1; then
		emit "notarization-access" "pass" "notary-service-reachable"
	else
		emit "notarization-access" "blocked" "notary-service-unavailable"
		blocked=1
	fi
else
	emit "notarization-access" "blocked" "prerequisite-checks-failed"
fi

if [[ "$blocked" -ne 0 ]]; then
	emit "u0-rerun" "blocked" "upstream-change-required"
	exit "$EX_CONFIG"
fi

if [[ $# -eq 0 ]]; then
	emit "u0-rerun" "blocked" "signed-product-probe-required"
	exit "$EX_USAGE"
fi

emit "u0-rerun" "ready" "dispatching-signed-product-probe"
exec "$@"
