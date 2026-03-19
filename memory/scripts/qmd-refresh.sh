#!/bin/bash

set -euo pipefail

MEMORY_HOME="${MEMORY_HOME:-$HOME/.config/memory}"
ROSTER_SYNC="$MEMORY_HOME/scripts/qmd-roster-sync.ts"
QMD_NODE="$MEMORY_HOME/scripts/qmd-node.sh"
SKIP_EMBED=false

usage() {
	echo "Usage: qmd-refresh.sh [--skip-embed]"
	echo ""
	echo "Refresh the shared QMD federation sequentially:"
	echo "  1. Re-apply the roster"
	echo "  2. Re-index collections"
	echo "  3. Refresh embeddings (unless --skip-embed)"
	echo "  4. Print final status"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--skip-embed)
			SKIP_EMBED=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown argument: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

if [[ ! -f "$ROSTER_SYNC" ]]; then
	echo "QMD roster sync script not found at: $ROSTER_SYNC" >&2
	exit 1
fi

if [[ ! -x "$QMD_NODE" ]]; then
	echo "QMD Node wrapper not found or not executable at: $QMD_NODE" >&2
	exit 1
fi

echo "==> Applying roster"
bun run "$ROSTER_SYNC" apply

echo ""
echo "==> Re-indexing collections"
"$QMD_NODE" update

if [[ "$SKIP_EMBED" == false ]]; then
	echo ""
	echo "==> Refreshing embeddings"
	"$QMD_NODE" embed
fi

echo ""
echo "==> Final status"
"$QMD_NODE" status
