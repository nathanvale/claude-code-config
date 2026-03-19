#!/bin/bash

set -euo pipefail

MEMORY_HOME="${MEMORY_HOME:-$HOME/.config/memory}"
QMD_NODE="${QMD_NODE:-$MEMORY_HOME/scripts/qmd-node.sh}"
MODE="search"

usage() {
	echo "Usage: qmd-recall.sh [--rich] <query>"
	echo ""
	echo "Default mode is lightweight keyword recall."
	echo "  --rich     Use full qmd query (may download larger local models)"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--rich)
			MODE="query"
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			break
			;;
	esac
done

if [[ $# -eq 0 ]]; then
	usage >&2
	exit 1
fi

if [[ ! -x "$QMD_NODE" ]]; then
	echo "QMD Node wrapper not found or not executable at: $QMD_NODE" >&2
	exit 1
fi

exec "$QMD_NODE" "$MODE" "$*"
