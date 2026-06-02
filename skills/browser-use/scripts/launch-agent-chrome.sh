#!/usr/bin/env bash
# Legacy helper. Warm Chrome Preflight owns defaults, launch, repair, and proof.
#
# Usage: launch-agent-chrome.sh [PORT] [PROFILE_DIR] [preflight options]

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ARGS=("launch" "--plain")

if [[ $# -gt 0 && "$1" != -* ]]; then
	ARGS+=("--port" "$1")
	shift
fi

if [[ $# -gt 0 && "$1" != -* ]]; then
	ARGS+=("--profile" "$1")
	shift
fi

ARGS+=("$@")

exec "$SCRIPT_DIR/preflight-warm-chrome.sh" "${ARGS[@]}"
