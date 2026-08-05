#!/usr/bin/env bash
# PROTOTYPE: compose verified Browser Connect handoffs with three native CLI lanes.
set -euo pipefail

usage() {
	printf 'Usage: %s [--adapter agent-browser|playwright-cdp|chrome-devtools-mcp] --url <http(s)-url> --marker <css-selector> --out <png-path>\n' "$0" >&2
	exit 2
}

adapter="agent-browser"
url=""
marker=""
out=""
while (($#)); do
	case "$1" in
		--adapter) adapter=${2:-}; shift 2 ;;
		--url) url=${2:-}; shift 2 ;;
		--marker) marker=${2:-}; shift 2 ;;
		--out) out=${2:-}; shift 2 ;;
		*) usage ;;
	esac
done

[[ -n "$url" && -n "$marker" && -n "$out" ]] || usage
case "$adapter" in
	agent-browser|playwright-cdp|chrome-devtools-mcp) ;;
	*) usage ;;
esac
[[ "$url" == http://* || "$url" == https://* ]] || {
	printf 'REFUSED invalid_url_scheme\n' >&2
	exit 20
}

handoff=$(browser-connect connect "$adapter" --json 2>/dev/null)
executable=$(jq -er '.data.attachment.probe_executable' <<<"$handoff")
endpoint_http=$(jq -er '.data.endpoint.http' <<<"$handoff")
endpoint_ws=$(jq -er '.data.endpoint.ws' <<<"$handoff")
requested_origin=$(bun -e 'process.stdout.write(new URL(process.argv[1]).origin)' "$url")
session="dashboard-shot-$$-$adapter"
target_ref=""
observed_url=""
prototype_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

refuse_wrong_origin() {
	local observed_origin
	observed_origin=$(bun -e 'process.stdout.write(new URL(process.argv[1]).origin)' "$observed_url")
	[[ "$observed_origin" == "$requested_origin" ]] || {
		printf 'REFUSED redirected_off_origin requested=%s observed=%s\n' "$requested_origin" "$observed_origin" >&2
		exit 20
	}
}

run_agent_browser() {
	"$executable" --cdp "$endpoint_ws" --session "$session" "$@"
}

run_playwright() {
	"$executable" --session="$session" "$@"
}

mkdir -p "$(dirname "$out")"

case "$adapter" in
	agent-browser)
		tab_json=$(run_agent_browser tab new "$url" --json)
		target_ref=$(jq -er '.data.tabId | select(type == "string" and length > 0)' <<<"$tab_json")
		run_agent_browser tab "$target_ref" --json >/dev/null
		observed_url=$(run_agent_browser get url --json | jq -er '.data.url')
		refuse_wrong_origin
		if ! run_agent_browser wait "$marker" --json >/dev/null; then
			printf 'BLOCKED dashboard_marker_missing adapter=%s url=%s marker=%s\n' "$adapter" "$observed_url" "$marker" >&2
			exit 20
		fi
		if ! run_agent_browser is visible "$marker" --json | jq -e '.data.visible == true' >/dev/null; then
			printf 'BLOCKED dashboard_marker_missing adapter=%s url=%s marker=%s\n' "$adapter" "$observed_url" "$marker" >&2
			exit 20
		fi
		run_agent_browser screenshot "$out" --json >/dev/null
		;;
	playwright-cdp)
		"$executable" attach --cdp="$endpoint_http" --session="$session" --json >/dev/null
		trap '"$executable" --session="$session" detach --json >/dev/null 2>&1 || true' EXIT
		tabs=$(run_playwright tab-new "$url" --json)
		target_ref=$(jq -er '.result | capture("- (?<tab>[0-9]+): \\(current\\)").tab' <<<"$tabs")
		observed_url=$(run_playwright --raw eval '() => location.href' | jq -er '.')
		refuse_wrong_origin
		marker_function=$(jq -nr --arg selector "$marker" '
			"async () => { for (let attempt = 0; attempt < 50; attempt++) { if (document.querySelector(" + ($selector | tojson) + ")) return true; await new Promise(resolve => setTimeout(resolve, 100)); } return false; }"
		')
		if [[ $(run_playwright --raw eval "$marker_function") != "true" ]]; then
			printf 'BLOCKED dashboard_marker_missing adapter=%s url=%s marker=%s\n' "$adapter" "$observed_url" "$marker" >&2
			exit 20
		fi
		run_playwright screenshot --filename="$out" --full-page --json >/dev/null
		"$executable" --session="$session" detach --json >/dev/null
		trap - EXIT
		;;
	chrome-devtools-mcp)
		chrome_result=$(bun "$prototype_dir/chrome-mcp-session.mjs" \
			"$executable" "$endpoint_http" "$url" "$marker" "$out" "$requested_origin")
		target_ref="adapter-session"
		observed_url=$(jq -er '.observed_url' <<<"$chrome_result")
		refuse_wrong_origin
		if [[ $(jq -r '.marker_present' <<<"$chrome_result") != "true" ]]; then
			printf 'BLOCKED dashboard_marker_missing adapter=%s url=%s marker=%s\n' "$adapter" "$observed_url" "$marker" >&2
			exit 20
		fi
		;;
esac

[[ -s "$out" ]] || {
	printf 'FAILED screenshot_missing adapter=%s path=%s\n' "$adapter" "$out" >&2
	exit 1
}

printf 'CONFIRMED adapter=%s target=%s dashboard=%s screenshot=%s\n' "$adapter" "$target_ref" "$observed_url" "$out"
