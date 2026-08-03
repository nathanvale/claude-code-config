#!/usr/bin/env bash
# PROTOTYPE: one-command falsification against real Agent Chrome.
set -euo pipefail

prototype_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
artifact_dir=$(mktemp -d "${TMPDIR:-/tmp}/dashboard-shot.XXXXXX")
server_log="$artifact_dir/server.log"

cleanup() {
	if [[ -n "${server_pid:-}" ]]; then
		kill "$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
}
trap cleanup EXIT

bun "$prototype_dir/serve.mjs" 0 >"$server_log" 2>&1 &
server_pid=$!

for _ in $(seq 1 50); do
	[[ -s "$server_log" ]] && break
	sleep 0.1
done
fixture_url=$(sed -n 's/^fixture=//p' "$server_log")
[[ -n "$fixture_url" ]]
fixture_origin=${fixture_url%/fixture.html}

adapters=(agent-browser playwright-cdp chrome-devtools-mcp)
endpoints=()
for adapter in "${adapters[@]}"; do
	dashboard_png="$artifact_dir/$adapter-dashboard.png"
	"$prototype_dir/dashboard-shot.sh" \
		--adapter "$adapter" \
		--url "$fixture_url?state=dashboard" \
		--marker '[data-dashboard-ready="true"]' \
		--out "$dashboard_png"
	[[ -s "$dashboard_png" ]]
	printf 'PASS %s dashboard marker produces screenshot: %s\n' "$adapter" "$dashboard_png"

	login_png="$artifact_dir/$adapter-login.png"
	set +e
	login_output=$("$prototype_dir/dashboard-shot.sh" \
		--adapter "$adapter" \
		--url "$fixture_url?state=login" \
		--marker '[data-dashboard-ready="true"]' \
		--out "$login_png" 2>&1)
	login_exit=$?
	set -e
	[[ "$login_exit" == "20" ]]
	[[ "$login_output" == BLOCKED\ dashboard_marker_missing* ]]
	[[ ! -e "$login_png" ]]
	printf 'PASS %s login wall cannot masquerade as dashboard\n' "$adapter"

	redirect_png="$artifact_dir/$adapter-redirect.png"
	set +e
	redirect_output=$("$prototype_dir/dashboard-shot.sh" \
		--adapter "$adapter" \
		--url "$fixture_origin/redirect" \
		--marker '[data-dashboard-ready="true"]' \
		--out "$redirect_png" 2>&1)
	redirect_exit=$?
	set -e
	[[ "$redirect_exit" == "20" ]]
	[[ "$redirect_output" == REFUSED\ redirected_off_origin* ]]
	[[ ! -e "$redirect_png" ]]
	printf 'PASS %s off-origin redirect is refused before screenshot\n' "$adapter"

	endpoints+=("$(browser-connect connect "$adapter" --json 2>/dev/null | jq -er '.data.endpoint.ws')")
done

[[ "${endpoints[0]}" == "${endpoints[1]}" && "${endpoints[1]}" == "${endpoints[2]}" ]]
printf 'PASS all adapters used the same verified Warm Chrome endpoint\n'

printf 'VERDICT PASS artifacts=%s\n' "$artifact_dir"
