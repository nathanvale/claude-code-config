#!/bin/bash
# check-prompt-drift-on-stop.sh
# Soft drift check for the prompt system. Runs on Stop hook.
# Only fires when invoked from inside the claude-code-config repo.
# Never blocks — prints a warning if drift is detected, otherwise silent.

set -uo pipefail

REPO_ROOT="${HOME}/code/claude-code-config"
RENDER_SCRIPT="${REPO_ROOT}/scripts/render-user-prompts.sh"

# Only run if we're operating in or under the claude-code-config repo
case "${PWD}" in
  "${REPO_ROOT}"|"${REPO_ROOT}"/*) ;;
  *) exit 0 ;;
esac

# Only run if the render script exists
[[ -x "${RENDER_SCRIPT}" ]] || exit 0

# Run check; capture output
output=$("${RENDER_SCRIPT}" --check 2>&1)
status=$?

if [[ $status -ne 0 ]]; then
  echo ""
  echo "⚠️  Prompt system drift detected:"
  echo "${output}" | grep -E "^(DRIFT|BROKEN|HYGIENE|ORPHAN):" || echo "${output}"
  echo ""
  echo "Run: ${RENDER_SCRIPT} --write"
fi

# Always exit 0 — this hook informs, it does not block
exit 0
