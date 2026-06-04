#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_MODE="plain"
RUN_ID="${TEST_RUNNER_RUN_ID:-test-runner-shell-$$}"

scan_args=("$@")
index=0
while [[ $index -lt ${#scan_args[@]} ]]; do
	arg="${scan_args[$index]}"
	case "$arg" in
	--)
		break
		;;
	--json)
		OUTPUT_MODE="json"
		;;
	--plain)
		OUTPUT_MODE="plain"
		;;
	--run-id)
		if [[ $((index + 1)) -lt ${#scan_args[@]} ]]; then
			RUN_ID="${scan_args[$((index + 1))]}"
			index=$((index + 1))
		fi
		;;
	--run-id=*)
		RUN_ID="${arg#--run-id=}"
		;;
	esac
	index=$((index + 1))
done

if [[ ! "$RUN_ID" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
	RUN_ID="test-runner-shell-$$"
fi

if ! command -v bun >/dev/null 2>&1; then
	if [[ "$OUTPUT_MODE" == "json" ]]; then
		printf '{"status":"error","run_id":"%s","error":{"run_id":"%s","code":"missing_bun","message":"Required test runtime is missing.","exit_code":1,"severity":"fatal","recoverability":"repair_state","retryable":false,"failure_domain":"runtime_diagnostics","hint":{"summary":"Install the required runtime, then rerun.","action":"repair_state"}},"data":{"action":"runner_error","contract":"test-runner.bun-test","schema_version":"1","status":"error","command":"run","cwd":null,"bun_command":null,"bun_args":[],"exit_code":1,"run_id":"%s","duration_ms":0,"summary":{"files":null,"tests":null,"passed":null,"failed":null,"expect_calls":null},"failures":[],"diagnostic":{"code":"missing_bun","message":"Required test runtime is missing.","cause":"runtime executable was not found on PATH.","retryable":false,"next_action":"Install the required runtime or expose it on PATH, then rerun."}}}\n' "$RUN_ID" "$RUN_ID" "$RUN_ID"
	else
		printf 'test_runner missing_bun: Required test runtime is missing. next=Install the required runtime or expose it on PATH, then rerun. run_id=%s\n' "$RUN_ID" >&2
	fi
	exit 1
fi

exec bun run "$SCRIPT_DIR/test-runner.ts" "$@"
