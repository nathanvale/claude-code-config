#!/bin/bash

set -euo pipefail

# Resolve QMD CLI: prefer npm global, fall back to bun global
QMD_CLI="${QMD_NODE_CLI:-}"
if [[ -z "$QMD_CLI" ]]; then
	NPM_GLOBAL="$(npm root -g 2>/dev/null || true)"
	if [[ -n "$NPM_GLOBAL" && -f "$NPM_GLOBAL/@tobilu/qmd/dist/cli/qmd.js" ]]; then
		QMD_CLI="$NPM_GLOBAL/@tobilu/qmd/dist/cli/qmd.js"
	elif [[ -f "$HOME/.bun/install/global/node_modules/@tobilu/qmd/dist/cli/qmd.js" ]]; then
		QMD_CLI="$HOME/.bun/install/global/node_modules/@tobilu/qmd/dist/cli/qmd.js"
	fi
fi

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

if [[ -z "${QMD_CLI:-}" || ! -f "$QMD_CLI" ]]; then
	echo "QMD CLI not found. Install with: npm install -g @tobilu/qmd" >&2
	exit 1
fi

exec node "$QMD_CLI" "$@"
