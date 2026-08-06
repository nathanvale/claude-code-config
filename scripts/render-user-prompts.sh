#!/usr/bin/env bash
# Compatibility shim. Prompt fragment rendering retired.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." >/dev/null && pwd)"

case "${1:-}" in
--check | "")
	"${SCRIPT_DIR}/scripts/agent-instructions.sh" check
	;;
--diff)
	echo "Prompt rendering retired. AGENTS.md is the canonical startup source."
	;;
--write)
	echo "Prompt rendering retired; refusing to generate prompt content." >&2
	echo "Edit AGENTS.md or owner docs, then run scripts/agent-instructions.sh check." >&2
	exit 2
	;;
-h | --help)
	cat <<'HELP'
Usage:
  scripts/render-user-prompts.sh --check
  scripts/render-user-prompts.sh --diff

Prompt fragment rendering is retired. Use AGENTS.md as the canonical startup
source and scripts/agent-instructions.sh for health checks.
HELP
	;;
*)
	echo "Unknown argument: $1" >&2
	exit 2
	;;
esac
