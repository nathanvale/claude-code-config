#!/bin/bash
# check-prompt-drift-on-stop.sh
# Soft health check for startup instructions. Runs on Stop hook.
# Only fires when invoked from inside a repo with agent-instructions.sh.
# Never blocks — prints a warning if drift is detected, otherwise silent.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
CHECK_SCRIPT="${REPO_ROOT}/scripts/agent-instructions.sh"

# Only run if this repo owns the instruction health script.
[[ -n "${REPO_ROOT}" && -x "${CHECK_SCRIPT}" ]] || exit 0

# Run check; capture output
output=$("${CHECK_SCRIPT}" check 2>&1)
status=$?

if [[ $status -ne 0 ]]; then
  echo ""
  echo "Startup instruction health check failed:"
  echo "${output}" | grep -E "^(FAIL|WARN):" || echo "${output}"
  echo ""
  echo "Run: ${CHECK_SCRIPT} check"
fi

# Always exit 0 — this hook informs, it does not block
exit 0
