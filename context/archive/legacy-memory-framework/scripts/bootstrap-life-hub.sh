#!/bin/bash

set -euo pipefail

MEMORY_HOME="${MEMORY_HOME:-$HOME/.config/memory}"
TARGET_REPO=""
REPO_NAME="my-second-brain"

usage() {
	echo "Usage: bootstrap-life-hub.sh --repo <path> [--name <repo-name>]"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--repo)
			TARGET_REPO="${2:-}"
			shift 2
			;;
		--name)
			REPO_NAME="${2:-}"
			shift 2
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

if [[ -z "$TARGET_REPO" ]]; then
	usage >&2
	exit 1
fi

if [[ -e "$TARGET_REPO" ]]; then
	echo "Target path already exists: $TARGET_REPO" >&2
	exit 1
fi

AGENTS_TEMPLATE="$MEMORY_HOME/templates/repo-bootstrap/AGENTS.life-hub.md"
CLAUDE_TEMPLATE="$MEMORY_HOME/templates/repo-bootstrap/CLAUDE.life-hub.md"

if [[ ! -f "$AGENTS_TEMPLATE" || ! -f "$CLAUDE_TEMPLATE" ]]; then
	echo "Required life-hub templates are missing under: $MEMORY_HOME/templates/repo-bootstrap" >&2
	exit 1
fi

mkdir -p \
	"$TARGET_REPO/docs/research" \
	"$TARGET_REPO/docs/plans" \
	"$TARGET_REPO/docs/specs" \
	"$TARGET_REPO/docs/decisions" \
	"$TARGET_REPO/docs/logs" \
	"$TARGET_REPO/docs/artifacts" \
	"$TARGET_REPO/context/people" \
	"$TARGET_REPO/context/pets" \
	"$TARGET_REPO/context/projects" \
	"$TARGET_REPO/context/context"

sed "s/<Repo Name> Agent Rules/$REPO_NAME Agent Rules/g" "$AGENTS_TEMPLATE" >"$TARGET_REPO/AGENTS.md"
cp "$CLAUDE_TEMPLATE" "$TARGET_REPO/CLAUDE.md"

echo "# $REPO_NAME" >"$TARGET_REPO/README.md"
echo >>"$TARGET_REPO/README.md"
echo "This repo is a fresh my-second-brain bootstrap created from Nathan's shared Memory OS contract." >>"$TARGET_REPO/README.md"

echo "Bootstrapped my-second-brain repo at: $TARGET_REPO"
echo "Next steps:"
echo "  1. git init \"$TARGET_REPO\""
echo "  2. add the repo to ~/.config/context/federation/roster.yml"
echo "  3. run ~/.config/context/scripts/qmd-refresh.sh --skip-embed"
echo "  4. migrate durable notes in curated batches"
