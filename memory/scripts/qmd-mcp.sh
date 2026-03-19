#!/bin/bash

set -euo pipefail

MEMORY_HOME="${MEMORY_HOME:-$HOME/.config/memory}"
QMD_NODE="${QMD_NODE:-$MEMORY_HOME/scripts/qmd-node.sh}"

if [[ ! -x "$QMD_NODE" ]]; then
	echo "QMD Node wrapper not found or not executable at: $QMD_NODE" >&2
	exit 1
fi

exec "$QMD_NODE" mcp "$@"
