#!/usr/bin/env bash
set -euo pipefail

prototype_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(git -C "$prototype_dir" rev-parse --show-toplevel)
built_cli="$repo_root/skills/browser-use/dist/browser-use.js"

allocate_fixture_port() {
	bun -e '
		const server = Bun.serve({
			hostname: "localhost",
			port: 0,
			fetch() { return new Response(); },
		});
		process.stdout.write(String(server.port));
		server.stop(true);
	'
}

fixture_port=$(allocate_fixture_port)
fixture_origin="http://localhost:$fixture_port"
zero_origin="http://127.0.0.1:$fixture_port"
primary_url="$fixture_origin/fixture.html?case=primary"
secondary_url="$fixture_origin/fixture.html?case=secondary"
primary_tab=""
secondary_tab=""

browser_connect() {
	browser-connect run agent-browser --json -- "$@" 2>/dev/null
}

select_tab() {
	browser_connect agent-browser tab "$1" --json >/dev/null
}

close_tab() {
	local tab_id=$1
	select_tab "$tab_id" || return 0
	browser_connect agent-browser tab close --json >/dev/null || true
}

open_tab() {
	local expected_url=$1
	local output
	output=$(browser_connect agent-browser tab new "$expected_url" --json)
	jq -er --arg url "$expected_url" '
		if .success == true
			and .error == null
			and (.data.tabId | type == "string")
			and ((.data.tabId | length) > 0)
			and .data.url == $url
		then .data.tabId
		else error("agent-browser tab new returned an invalid response")
		end
	' <<<"$output"
}

cleanup() {
	if [[ -n "$secondary_tab" ]]; then close_tab "$secondary_tab"; fi
	if [[ -n "$primary_tab" ]]; then close_tab "$primary_tab"; fi
	if [[ -n "${server_pid:-}" ]]; then
		kill "$server_pid" 2>/dev/null || true
		wait "$server_pid" 2>/dev/null || true
	fi
}
trap cleanup EXIT

wait_for_tab() {
	local tab_id=$1
	local expected_url=$2
	local observed_tab_id=""
	for _ in $(seq 1 50); do
		observed_tab_id=$(
			browser_connect agent-browser tab list --json |
				jq -er --arg id "$tab_id" --arg url "$expected_url" \
					'.data.tabs[] | select(.tabId == $id and .url == $url) | .tabId' \
					2>/dev/null || true
		)
		[[ "$observed_tab_id" == "$tab_id" ]] && return 0
		sleep 0.1
	done
	return 1
}

read_state() {
	select_tab "$1"
	browser_connect agent-browser get text '#state' --json | jq -er '.data.text'
}

run_built_task() {
	local allowed_origin=$1
	set +e
	local output
	output=$(bun "$built_cli" task run \
		--intent routine-automation \
		--allowed-origin "$allowed_origin" \
		--click-role button \
		--click-name 'Commit marker' \
		--postcondition-id committed \
		--expect-visible '#committed' \
		--caller matest-implicit-target-accept \
		--json)
	local exit_code=$?
	set -e
	printf '%s\t%s\n' "$exit_code" "$(jq -c . <<<"$output")"
}

bun "$prototype_dir/serve.mjs" "$fixture_port" >/dev/null 2>&1 &
server_pid=$!
for _ in $(seq 1 50); do
	if curl --fail --silent "$fixture_origin/fixture.html" >/dev/null; then break; fi
	sleep 0.1
done
curl --fail --silent "$fixture_origin/fixture.html" >/dev/null

primary_tab=$(open_tab "$primary_url")
wait_for_tab "$primary_tab" "$primary_url"
primary_initial=$(read_state "$primary_tab")

zero_result=$(run_built_task "$zero_origin")
zero_exit=${zero_result%%$'\t'*}
zero_json=${zero_result#*$'\t'}
zero_after=$(read_state "$primary_tab")
[[ "$zero_exit" == "20" ]]
[[ $(jq -r '.data.lane_outcome' <<<"$zero_json") == "agent_browser_target_unavailable" ]]
[[ "$primary_initial" == "$zero_after" ]]
printf 'PASS zero-target fails closed; state=%s\n' "$zero_after"

positive_result=$(run_built_task "$fixture_origin")
positive_exit=${positive_result%%$'\t'*}
positive_json=${positive_result#*$'\t'}
positive_after=$(read_state "$primary_tab")
[[ "$positive_exit" == "0" ]]
[[ $(jq -r '.data.run.state' <<<"$positive_json") == "confirmed" ]]
[[ $(jq -r '.data.run.mutation_dispatched' <<<"$positive_json") == "true" ]]
[[ "$positive_after" == "clicks=1;committed=true" ]]
printf 'PASS single-target selects, clicks, and proves; state=%s\n' "$positive_after"

secondary_tab=$(open_tab "$secondary_url")
wait_for_tab "$secondary_tab" "$secondary_url"
primary_before_multiple=$(read_state "$primary_tab")
secondary_before_multiple=$(read_state "$secondary_tab")

multiple_result=$(run_built_task "$fixture_origin")
multiple_exit=${multiple_result%%$'\t'*}
multiple_json=${multiple_result#*$'\t'}
primary_after_multiple=$(read_state "$primary_tab")
secondary_after_multiple=$(read_state "$secondary_tab")
[[ "$multiple_exit" == "20" ]]
[[ $(jq -r '.data.lane_outcome' <<<"$multiple_json") == "agent_browser_target_ambiguous" ]]
[[ "$primary_before_multiple" == "$primary_after_multiple" ]]
[[ "$secondary_before_multiple" == "$secondary_after_multiple" ]]
printf 'PASS multiple-target fails closed; states=%s,%s\n' \
	"$primary_after_multiple" "$secondary_after_multiple"
