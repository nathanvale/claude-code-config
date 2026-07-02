#!/usr/bin/env bash
# Read-only instruction topology health checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." >/dev/null && pwd)"
COMMAND="check"
FORMAT="plain"
CONFIG_FILE="$SCRIPT_DIR/agent-instructions.config"
STARTUP_OWNER="$SCRIPT_DIR"

load_config() {
	if [[ ! -f "$CONFIG_FILE" ]]; then
		return
	fi

	while IFS='=' read -r key value; do
		case "$key" in
		startup_owner)
			STARTUP_OWNER="$(resolve_startup_owner "$value")"
			;;
		'' | \#*)
			;;
		*)
			add_warn "unknown agent instruction config key: $key"
			;;
		esac
	done < "$CONFIG_FILE"
}

startup_owner_has_files() {
	local owner="$1"
	[[ -f "$owner/AGENTS.md" || -f "$owner/CLAUDE.md" ]]
}

main_worktree_path() {
	git -C "$SCRIPT_DIR" worktree list --porcelain 2>/dev/null |
		awk 'NR == 1 && $1 == "worktree" { print substr($0, 10); exit }'
}

explicit_self_startup_owner() {
	local value="${1%/}"
	if [[ "$value" == *..* ]]; then
		return 1
	fi
	while [[ "$value" == ./* ]]; do
		value="${value#./}"
		value="${value%/}"
	done
	[[ "$value" == "." ]]
}

resolve_startup_owner() {
	local value="$1"
	if [[ "$value" == /* ]]; then
		canonical_path "$value"
		return
	fi

	local candidate
	candidate="$(canonical_path "$SCRIPT_DIR/$value")"
	local current_worktree
	current_worktree="$(canonical_path "$SCRIPT_DIR")"
	if explicit_self_startup_owner "$value"; then
		printf "%s" "$current_worktree"
		return
	fi

	local main_worktree
	main_worktree="$(main_worktree_path || true)"
	if [[ -n "$main_worktree" ]]; then
		main_worktree="$(canonical_path "$main_worktree")"
	fi

	local main_candidate=""
	if [[ -n "$main_worktree" && "$main_worktree" != "$current_worktree" ]]; then
		main_candidate="$(canonical_path "$main_worktree/$value")"
		if [[ "$candidate" == "$current_worktree" ]] &&
			! explicit_self_startup_owner "$value" &&
			startup_owner_has_files "$main_candidate"; then
			printf "%s" "$main_candidate"
			return
		fi
	fi

	if startup_owner_has_files "$candidate"; then
		canonical_path "$candidate"
		return
	fi

	if [[ -n "$main_candidate" ]] &&
		! explicit_self_startup_owner "$value" &&
		startup_owner_has_files "$main_candidate"; then
		canonical_path "$main_candidate"
		return
	fi

	canonical_path "$candidate"
}

if [[ $# -gt 0 ]]; then
	case "$1" in
	check | status | help)
		COMMAND="$1"
		shift
		;;
	-h | --help)
		COMMAND="help"
		shift
		;;
	esac
fi

while [[ $# -gt 0 ]]; do
	case "$1" in
	--json)
		FORMAT="json"
		shift
		;;
	-h | --help)
		COMMAND="help"
		shift
		;;
	*)
		echo "Unknown argument: $1" >&2
		exit 2
		;;
	esac
done

declare -a failures=()
declare -a warnings=()
declare -a passes=()

add_pass() {
	passes+=("$1")
}

add_warn() {
	warnings+=("$1")
}

add_fail() {
	failures+=("$1")
}

line_count() {
	local file="$1"
	wc -l < "$file" | tr -d ' '
}

canonical_path() {
	local path="$1"
	local dir
	local base
	dir="$(dirname "$path")"
	base="$(basename "$path")"
	if [[ -d "$dir" ]]; then
		printf "%s/%s" "$(cd "$dir" >/dev/null && pwd -P)" "$base"
	else
		printf "%s" "$path"
	fi
}

resolve_link_target() {
	local link="$1"
	local target
	target="$(readlink "$link")"
	if [[ "$target" != /* ]]; then
		target="$(dirname "$link")/$target"
	fi
	canonical_path "$target"
}

check_line_budget() {
	local label="$1"
	local file="$2"
	local max="$3"

	if [[ ! -f "$file" ]]; then
		add_fail "$label missing: $file"
		return
	fi

	local lines
	lines="$(line_count "$file")"
	if (( lines > max )); then
		add_fail "$label line budget exceeded: $lines > $max"
	else
		add_pass "$label line budget: $lines <= $max"
	fi
}

check_no_leakage() {
	local file="$1"
	if [[ ! -f "$file" ]]; then
		return 0
	fi

	if ! command -v rg >/dev/null 2>&1; then
		add_warn "rg missing; skipping global leakage scan: ${file#$SCRIPT_DIR/}"
		return
	fi

	local patterns=(
		'/Users/nathanvale/code/'
		'nathanvale/claude-code-config'
		'Applies in `claude-code-config` repo'
		'Issues and PRDs for `'
	)

	for pattern in "${patterns[@]}"; do
		if rg -n --fixed-strings "$pattern" "$file" >/dev/null 2>&1; then
			add_fail "global leakage in ${file#$SCRIPT_DIR/}: $pattern"
		fi
	done
}

check_owner_paths() {
	local required=(
			"skills/productivity-connectors/SKILL.md"
			"context/bun-runner.md"
			"skills/skill-author/SKILL.md"
			"skills/skill-author/CONTEXT.md"
			"skills/skill-author/references/skill-design-decision-runbook.md"
		"context/personal.md"
		"context/comms-style.md"
		"docs/git/conventions.md"
		"docs/git/workflows.md"
		"docs/git/worktree.md"
		"docs/agents/issue-tracker.md"
		"docs/agents/triage-labels.md"
		"docs/agents/domain.md"
		"skills/context-advisor/SKILL.md"
		"skills/context-advisor/references/storage-routing.md"
	)

	for path in "${required[@]}"; do
		if [[ -f "$SCRIPT_DIR/$path" ]]; then
			add_pass "owner exists: $path"
		else
			add_fail "owner missing: $path"
		fi
	done
}

check_appendices() {
	local dir="$SCRIPT_DIR/instruction-appendices"
	if [[ ! -d "$dir" ]]; then
		add_pass "instruction appendices absent"
		return
	fi

	local found=false
	while IFS= read -r file; do
		found=true
		local lines
		lines="$(line_count "$file")"
		if (( lines > 25 )); then
			add_fail "appendix line budget exceeded: ${file#$SCRIPT_DIR/} $lines > 25"
		else
			add_pass "appendix line budget: ${file#$SCRIPT_DIR/} $lines <= 25"
		fi
	done < <(find "$dir" -type f -name '*.md' | sort)

	if [[ "$found" == false ]]; then
		add_pass "instruction appendices empty"
	fi
}

check_projection_drift() {
	local codex_user="$HOME/.codex/AGENTS.md"
	local source="$STARTUP_OWNER/AGENTS.md"
	local expected_source
	expected_source="$(canonical_path "$source")"

	if [[ -L "$codex_user" ]]; then
		local target
		target="$(resolve_link_target "$codex_user")"
		if [[ "$target" == "$expected_source" ]]; then
			add_pass "Codex user startup symlinked to configured startup owner"
		else
			add_fail "Codex user startup symlink points elsewhere: $target"
		fi
	elif [[ -f "$codex_user" ]]; then
		if diff -q "$source" "$codex_user" >/dev/null 2>&1; then
			add_pass "Codex user startup managed copy matches configured startup owner"
		else
			add_fail "Codex user startup drift: ~/.codex/AGENTS.md"
		fi
	else
		add_warn "Codex user startup missing"
	fi

	local claude_file="$HOME/.claude/CLAUDE.md"
	local claude_agents="$HOME/.claude/AGENTS.md"
	local expected_claude
	expected_claude="$(canonical_path "$STARTUP_OWNER/CLAUDE.md")"
	if [[ -L "$claude_file" ]]; then
		local target
		target="$(resolve_link_target "$claude_file")"
		if [[ "$target" == "$expected_claude" ]]; then
			add_pass "Claude CLAUDE.md symlinked to configured startup owner"
		else
			add_fail "Claude CLAUDE.md symlink points elsewhere: $target"
		fi
	elif [[ -e "$claude_file" ]]; then
		add_warn "Claude startup exists but is not symlink"
	else
		add_fail "Claude CLAUDE.md missing"
	fi

	if [[ -L "$claude_agents" ]]; then
		local target
		target="$(resolve_link_target "$claude_agents")"
		if [[ "$target" == "$expected_source" ]]; then
			add_pass "Claude AGENTS.md symlinked to configured startup owner"
		else
			add_fail "Claude AGENTS.md symlink points elsewhere: $target"
		fi
	elif [[ -e "$claude_agents" ]]; then
		add_warn "Claude AGENTS.md exists but is not symlink"
	else
		add_fail "Claude AGENTS.md missing"
	fi
}

# Fail when a deploy target holds a real directory whose name also exists as a
# repo skill: a drifted duplicate of the canonical source. Codex-only dirs (no
# repo twin) are ignored automatically, so the check is self-maintaining — no
# allowlist to grow. Repair: back up the copy and symlink it, or run install.sh.
check_skill_deploy_drift() {
	local repo_skills="$STARTUP_OWNER/skills"
	local drift_found=false
	local target entry name
	for target in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
		[[ -d "$target" ]] || continue
		# A whole-folder symlink (Claude's model) is the source itself — its
		# children are repo skills, not per-skill drift. Only scan real
		# directories that mix sources (Codex's model).
		[[ -L "$target" ]] && continue
		for entry in "$target"/*/; do
			[[ -d "$entry" ]] || continue
			entry="${entry%/}"
			[[ -L "$entry" ]] && continue
			name="$(basename "$entry")"
			if [[ -d "$repo_skills/$name" ]]; then
				drift_found=true
				add_fail "Skill deploy drift: ${target/#$HOME/~}/$name is a real directory shadowing skills/$name; back it up and symlink, or run ./install.sh"
			fi
		done
	done
	if [[ "$drift_found" == false ]]; then
		add_pass "no skill deploy drift in ~/.claude/skills or ~/.codex/skills"
	fi
}

run_checks() {
	load_config
	check_line_budget "AGENTS.md" "$SCRIPT_DIR/AGENTS.md" 120
	check_line_budget "CLAUDE.md" "$SCRIPT_DIR/CLAUDE.md" 50
	if [[ -f "$HOME/.codex/AGENTS.md" ]]; then
		check_line_budget "Codex user startup" "$HOME/.codex/AGENTS.md" 150
	fi
	check_no_leakage "$SCRIPT_DIR/AGENTS.md"
	check_no_leakage "$HOME/.codex/AGENTS.md"
	check_owner_paths
	check_appendices
	check_projection_drift
	check_skill_deploy_drift
}

json_array() {
	local name="$1"
	shift
	printf '"%s":[' "$name"
	local first=true
	for item in "$@"; do
		if [[ "$first" == true ]]; then
			first=false
		else
			printf ','
		fi
		printf '%s' "$item" | sed 's/\\/\\\\/g; s/"/\\"/g; s/^/"/; s/$/"/'
	done
	printf ']'
}

print_report() {
	local status="ok"
	if (( ${#failures[*]} > 0 )); then
		status="fail"
	elif (( ${#warnings[*]} > 0 )); then
		status="warn"
	fi

	if [[ "$FORMAT" == "json" ]]; then
		printf '{"status":"%s",' "$status"
		json_array "passes" ${passes[@]+"${passes[@]}"}
		printf ','
		json_array "warnings" ${warnings[@]+"${warnings[@]}"}
		printf ','
		json_array "failures" ${failures[@]+"${failures[@]}"}
		printf '}\n'
		return
	fi

	echo "Agent instruction health: $status"
	for item in ${failures[@]+"${failures[@]}"}; do
		echo "FAIL: $item"
	done
	for item in ${warnings[@]+"${warnings[@]}"}; do
		echo "WARN: $item"
	done
	for item in ${passes[@]+"${passes[@]}"}; do
		echo "OK: $item"
	done
}

print_status() {
	run_checks
	if [[ "$FORMAT" == "json" ]]; then
		print_report
		return
	fi

echo "Instruction owner map"
echo "startup owner: $(canonical_path "$STARTUP_OWNER")"
echo "startup: AGENTS.md"
echo "claude: CLAUDE.md"
echo "codex: AGENTS.md -> ~/.codex/AGENTS.md"
	echo "checks: scripts/agent-instructions.sh"
	echo "skills: skills/* plus discovery projections"
	echo "repo truth: docs/agents/"
	echo "git docs: docs/git/"
	echo "vocabulary: CONTEXT.md plus scoped CONTEXT.md files"
	echo ""
	print_report
}

print_help() {
	cat <<'HELP'
Usage:
  scripts/agent-instructions.sh check [--json]
  scripts/agent-instructions.sh status [--json]

Commands:
  check   Read-only health gate for startup budgets, owner paths, leakage, appendices, and projection drift.
  status  Compact owner map plus check results.

Exit codes:
  0  success, including warnings
  1  health check failed
  2  invalid usage

This tool never generates prompt content.
HELP
}

case "$COMMAND" in
check)
	run_checks
	print_report
	if (( ${#failures[*]} > 0 )); then
		exit 1
	fi
	;;
status)
	print_status
	if (( ${#failures[*]} > 0 )); then
		exit 1
	fi
	;;
help)
	print_help
	;;
*)
	echo "Unknown command: $COMMAND" >&2
	exit 2
	;;
esac
