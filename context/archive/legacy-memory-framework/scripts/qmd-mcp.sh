#!/bin/bash

set -euo pipefail

MEMORY_HOME="${MEMORY_HOME:-$HOME/.config/memory}"
QMD_NODE="${QMD_NODE:-$MEMORY_HOME/scripts/qmd-node.sh}"
QMD_CONFIG_DIR="$HOME/.config/qmd"

# Resolve profile-specific QMD index (same pattern as HyperFlow)
# Only activates when WORK_PROFILE is set and a matching index exists
if [[ -n "${WORK_PROFILE:-}" && -f "$QMD_CONFIG_DIR/index.${WORK_PROFILE}.yml" ]]; then
	cp "$QMD_CONFIG_DIR/index.${WORK_PROFILE}.yml" "$QMD_CONFIG_DIR/index.yml"
fi

if [[ ! -x "$QMD_NODE" ]]; then
	echo "QMD Node wrapper not found or not executable at: $QMD_NODE" >&2
	exit 1
fi

exec "$QMD_NODE" mcp "$@"
