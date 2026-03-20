#!/bin/bash

set -euo pipefail

QMD_CLI="${QMD_NODE_CLI:-$HOME/.bun/install/global/node_modules/@tobilu/qmd/dist/cli/qmd.js}"

if [[ -z "${BREW_PREFIX:-}" ]]; then
	if command -v brew >/dev/null 2>&1; then
		BREW_PREFIX="$(brew --prefix 2>/dev/null || true)"
	fi

	if [[ -z "${BREW_PREFIX:-}" ]]; then
		for candidate in /opt/homebrew /usr/local; do
			if [[ -d "$candidate/opt/sqlite" ]]; then
				BREW_PREFIX="$candidate"
				break
			fi
		done
	fi

	if [[ -n "${BREW_PREFIX:-}" ]]; then
		export BREW_PREFIX
	fi
fi

if [[ ! -f "$QMD_CLI" ]]; then
	echo "QMD Node CLI not found at: $QMD_CLI" >&2
	echo "Install QMD first with: bun install -g @tobilu/qmd" >&2
	exit 1
fi

exec node "$QMD_CLI" "$@"
