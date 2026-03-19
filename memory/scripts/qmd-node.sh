#!/bin/bash

set -euo pipefail

QMD_CLI="${QMD_NODE_CLI:-$HOME/.bun/install/global/node_modules/@tobilu/qmd/dist/cli/qmd.js}"

if [[ ! -f "$QMD_CLI" ]]; then
	echo "QMD Node CLI not found at: $QMD_CLI" >&2
	echo "Install QMD first with: bun install -g @tobilu/qmd" >&2
	exit 1
fi

exec node "$QMD_CLI" "$@"
