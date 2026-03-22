#!/bin/bash
# install.sh - Create symlinks from ~/.claude/ to this repo
#
# Usage:
#   ./install.sh           Create symlinks
#   ./install.sh --unlink  Remove symlinks
#   ./install.sh --status  Show current status

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_HOME="${HOME}/.claude"
CONFIG_HOME="${HOME}/.config"

# Symlinks: "link_path|target_path"
symlinks=(
	"${CLAUDE_HOME}/CLAUDE.md|${SCRIPT_DIR}/CLAUDE.md"
	"${CLAUDE_HOME}/AGENTS.md|${SCRIPT_DIR}/AGENTS.md"
	"${CLAUDE_HOME}/context|${SCRIPT_DIR}/context"
	"${CLAUDE_HOME}/rules|${SCRIPT_DIR}/rules"
	"${CLAUDE_HOME}/commands|${SCRIPT_DIR}/commands"
	"${CLAUDE_HOME}/skills|${SCRIPT_DIR}/skills"
	"${CLAUDE_HOME}/agents|${SCRIPT_DIR}/agents"
	"${CLAUDE_HOME}/.mcp.json|${SCRIPT_DIR}/.mcp.json"
	"${CONFIG_HOME}/memory|${SCRIPT_DIR}/memory"
)

create_links() {
	echo "Creating symlinks..."
	for entry in "${symlinks[@]}"; do
		local link="${entry%%|*}"
		local target="${entry##*|}"
		local parent
		parent="$(dirname "$link")"

		mkdir -p "$parent"

		if [[ ! -e "$target" ]]; then
			echo "  SKIP (target missing): $target"
			continue
		fi

		if [[ -L "$link" ]]; then
			if [[ "$(readlink "$link")" == "$target" ]]; then
				echo "  OK:   $link"
			else
				ln -sf "$target" "$link"
				echo "  UPDATED: $link -> $target"
			fi
		elif [[ -e "$link" ]]; then
			echo "  EXISTS (not a symlink): $link"
			echo "         Remove it manually first, then re-run."
		else
			ln -s "$target" "$link"
			echo "  CREATED: $link -> $target"
		fi
	done

	# Render prompt files from fragments
	echo ""
	echo "Rendering user prompt files..."
	"${SCRIPT_DIR}/scripts/render-user-prompts.sh" --write

	echo ""
	echo "Done."
}

remove_links() {
	echo "Removing symlinks..."
	for entry in "${symlinks[@]}"; do
		local link="${entry%%|*}"
		if [[ -L "$link" ]]; then
			rm "$link"
			echo "  REMOVED: $link"
		else
			echo "  SKIP (not a symlink): $link"
		fi
	done
	echo "Done."
}

show_status() {
	echo "Claude Code Config Symlinks"
	echo "Repo: $SCRIPT_DIR"
	echo ""
	printf "%-40s %-10s %s\n" "LINK" "STATUS" "TARGET"
	printf "%-40s %-10s %s\n" "----" "------" "------"

	for entry in "${symlinks[@]}"; do
		local link="${entry%%|*}"
		local target="${entry##*|}"
		local display="${link/#$HOME/~}"

		if [[ -L "$link" ]]; then
			local actual
			actual="$(readlink "$link")"
			if [[ "$actual" == "$target" ]]; then
				printf "%-40s \033[32m%-10s\033[0m %s\n" "$display" "OK" "${actual/#$SCRIPT_DIR/\$REPO}"
			else
				printf "%-40s \033[33m%-10s\033[0m %s\n" "$display" "WRONG" "${actual/#$HOME/~}"
			fi
		elif [[ -e "$link" ]]; then
			printf "%-40s \033[33m%-10s\033[0m %s\n" "$display" "EXISTS" "(not a symlink)"
		else
			printf "%-40s \033[31m%-10s\033[0m %s\n" "$display" "MISSING" "-"
		fi
	done
	echo ""
}

case "${1:-}" in
--unlink)
	remove_links
	;;
--status)
	show_status
	;;
*)
	create_links
	;;
esac
