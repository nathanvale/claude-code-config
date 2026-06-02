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
CODEX_HOME="${HOME}/.codex"
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
	"${CLAUDE_HOME}/runbooks|${SCRIPT_DIR}/runbooks"
	"${CLAUDE_HOME}/hooks|${SCRIPT_DIR}/hooks"
	"${CLAUDE_HOME}/hooks.json|${SCRIPT_DIR}/hooks.json"
	"${CLAUDE_HOME}/settings.json|${SCRIPT_DIR}/settings.json"
	"${CLAUDE_HOME}/.mcp.json|${SCRIPT_DIR}/.mcp.json"
	"${CODEX_HOME}/AGENTS.md|${SCRIPT_DIR}/AGENTS.md"
	"${CONFIG_HOME}/memory|${SCRIPT_DIR}/memory"
)

create_links() {
	echo "Creating symlinks..."
	mkdir -p "$CODEX_HOME"
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
				echo "  WRONG: $link -> $(readlink "$link")"
				echo "         Remove the managed symlink manually first, then re-run."
			fi
		elif [[ -e "$link" ]]; then
			echo "  EXISTS (not a symlink): $link"
			echo "         Remove it manually first, then re-run."
		else
			ln -s "$target" "$link"
			echo "  CREATED: $link -> $target"
		fi
	done

	# Install tracked git hooks (pre-commit drift gate, etc.)
	if [[ -x "${SCRIPT_DIR}/scripts/install-git-hooks.sh" ]]; then
		echo ""
		echo "Installing git hooks..."
		"${SCRIPT_DIR}/scripts/install-git-hooks.sh"
	fi

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

	if [[ -x "${SCRIPT_DIR}/scripts/agent-instructions.sh" ]]; then
		"${SCRIPT_DIR}/scripts/agent-instructions.sh" status
		echo ""
	fi

	check_v2_artifact_presence
}

# U6: verify the v2 issue-to-pr install topology resolves through the
# installed symlink path. Walks references/, templates/, cli.ts, and lib/
# under ${CLAUDE_HOME}/runbooks/issue-to-pr-v2/. A subdirectory counts as
# present iff it contains at least one regular file (recursive). Preserves
# the symlink-only install topology - no cp -r, no copy install path.
check_v2_artifact_presence() {
	local v2_root="${CLAUDE_HOME}/runbooks/issue-to-pr-v2"

	echo "Issue-to-PR v2 install artifacts (under ${v2_root/#$HOME/~})"
	printf "%-40s %s\n" "ARTIFACT" "STATUS"
	printf "%-40s %s\n" "--------" "------"

	if [[ ! -e "$v2_root" ]]; then
		printf "%-40s \033[31m%s\033[0m\n" "(v2 install root)" "MISSING"
		printf "         re-run ./install.sh to create the runbooks symlink.\n"
		return
	fi

	v2_check_file "$v2_root/cli.ts" "cli.ts"
	v2_check_dir_recursive "$v2_root/lib" "lib/"
	v2_check_dir_recursive "$v2_root/references" "references/"
	v2_check_dir_recursive "$v2_root/templates" "templates/"
	echo ""
}

v2_check_file() {
	local path="$1"
	local label="$2"
	if [[ -f "$path" ]]; then
		printf "%-40s \033[32m%s\033[0m\n" "$label" "PRESENT"
	else
		printf "%-40s \033[31m%s\033[0m\n" "$label" "MISSING"
	fi
}

v2_check_dir_recursive() {
	local path="$1"
	local label="$2"
	if [[ ! -d "$path" ]]; then
		printf "%-40s \033[31m%s\033[0m\n" "$label" "MISSING"
		return
	fi
	# -L follows symlinks so the installed symlink topology is honored.
	# -type f returns regular files; head -n 1 short-circuits to one match.
	if [[ -n "$(find -L "$path" -type f -print -quit 2>/dev/null)" ]]; then
		printf "%-40s \033[32m%s\033[0m\n" "$label" "PRESENT (recursive)"
	else
		printf "%-40s \033[33m%s\033[0m\n" "$label" "EMPTY"
	fi
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
