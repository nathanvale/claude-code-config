#!/usr/bin/env bash
# Read-only instruction topology health checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." >/dev/null && pwd)"
COMMAND="${1:-check}"
FORMAT="plain"

shift || true
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

failures=()
warnings=()
passes=()

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
	[[ -f "$file" ]] || return

	if ! command -v rg >/dev/null 2>&1; then
		add_fail "rg missing; cannot scan global leakage"
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
		"context/skill-design-philosophy.md"
		"context/personal.md"
		"context/comms-style.md"
		"docs/git/conventions.md"
		"docs/git/workflows.md"
		"docs/git/worktree.md"
		"docs/agents/issue-tracker.md"
		"docs/agents/triage-labels.md"
		"docs/agents/domain.md"
		"memory/AGENTS.md"
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
	local source="$SCRIPT_DIR/AGENTS.md"
	local expected_source
	expected_source="$(canonical_path "$source")"

	if [[ -L "$codex_user" ]]; then
		local target
		target="$(resolve_link_target "$codex_user")"
		if [[ "$target" == "$expected_source" ]]; then
			add_pass "Codex user startup symlinked to AGENTS.md"
		else
			add_fail "Codex user startup symlink points elsewhere: $target"
		fi
	elif [[ -f "$codex_user" ]]; then
		if diff -q "$source" "$codex_user" >/dev/null 2>&1; then
			add_pass "Codex user startup managed copy matches AGENTS.md"
		else
			add_fail "Codex user startup drift: ~/.codex/AGENTS.md"
		fi
	else
		add_warn "Codex user startup missing"
	fi

	local claude_file="$HOME/.claude/CLAUDE.md"
	local claude_agents="$HOME/.claude/AGENTS.md"
	local expected_claude
	expected_claude="$(canonical_path "$SCRIPT_DIR/CLAUDE.md")"
	if [[ -L "$claude_file" ]]; then
		local target
		target="$(resolve_link_target "$claude_file")"
		if [[ "$target" == "$expected_claude" ]]; then
			add_pass "Claude CLAUDE.md symlinked to repo wrapper"
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
			add_pass "Claude AGENTS.md symlinked to repo startup"
		else
			add_fail "Claude AGENTS.md symlink points elsewhere: $target"
		fi
	elif [[ -e "$claude_agents" ]]; then
		add_warn "Claude AGENTS.md exists but is not symlink"
	else
		add_fail "Claude AGENTS.md missing"
	fi
}

run_checks() {
	check_line_budget "AGENTS.md" "$SCRIPT_DIR/AGENTS.md" 120
	check_line_budget "CLAUDE.md" "$SCRIPT_DIR/CLAUDE.md" 50
	check_line_budget "Codex user startup" "$HOME/.codex/AGENTS.md" 150
	check_no_leakage "$SCRIPT_DIR/AGENTS.md"
	check_no_leakage "$HOME/.codex/AGENTS.md"
	check_owner_paths
	check_appendices
	check_projection_drift
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
	if (( ${#failures[@]} > 0 )); then
		status="fail"
	elif (( ${#warnings[@]} > 0 )); then
		status="warn"
	fi

	if [[ "$FORMAT" == "json" ]]; then
		printf '{"status":"%s",' "$status"
		json_array "passes" "${passes[@]}"
		printf ','
		json_array "warnings" "${warnings[@]}"
		printf ','
		json_array "failures" "${failures[@]}"
		printf '}\n'
		return
	fi

	echo "Agent instruction health: $status"
	for item in "${failures[@]}"; do
		echo "FAIL: $item"
	done
	for item in "${warnings[@]}"; do
		echo "WARN: $item"
	done
	for item in "${passes[@]}"; do
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
echo "startup: AGENTS.md"
echo "claude: CLAUDE.md"
echo "codex: AGENTS.md -> ~/.codex/AGENTS.md"
	echo "checks: scripts/agent-instructions.sh"
	echo "skills: skills/* plus discovery projections"
	echo "repo truth: docs/agents/"
	echo "git docs: docs/git/"
	echo "vocabulary: CONTEXT.md"
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
	if (( ${#failures[@]} > 0 )); then
		exit 1
	fi
	;;
status)
	print_status
	if (( ${#failures[@]} > 0 )); then
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
