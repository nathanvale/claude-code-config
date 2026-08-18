#!/usr/bin/env bash
# Read-only instruction topology health checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." >/dev/null && pwd)"
COMMAND="check"
FORMAT="plain"
STAGED=false
STAGED_DECISION="not_requested"

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
	--staged)
		STAGED=true
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

if [[ "${AGENT_INSTRUCTIONS_CHECK_STAGED:-}" == "1" && "$COMMAND" == "check" ]]; then
	STAGED=true
fi

if [[ "$STAGED" == true && "$COMMAND" == "status" ]]; then
	echo "--staged is only valid with check" >&2
	exit 2
fi

declare -a failures=()
declare -a warnings=()
declare -a passes=()
declare -a matched_paths=()
declare -a REGISTERED_OWNER_PATHS=(
	"skills/productivity-connectors/SKILL.md"
	"context/bun-runner.md"
	"skills/skill-author/SKILL.md"
	"skills/skill-author/CONTEXT.md"
	"skills/skill-author/references/skill-design-decision-runbook.md"
	"context/personal.md"
	"context/vault.md"
	"context/comms-style.md"
	"context/tracker-links.md"
	"docs/git/conventions.md"
	"docs/git/workflows.md"
	"docs/git/worktree.md"
	"docs/agents/issue-tracker.md"
	"docs/agents/triage-labels.md"
	"docs/agents/domain.md"
	"skills/context-advisor/SKILL.md"
	"skills/context-advisor/references/storage-routing.md"
	"skills/vault-git/SKILL.md"
	"skills/test-design/SKILL.md"
	"skills/test-design/evals/qualification.ts"
	"skills/test-design/evals/qualification.json"
)

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
		'nathanvale/claude-code-config'
		'Applies in `claude-code-config` repo'
		'Issues and PRDs for `'
	)

	for pattern in "${patterns[@]}"; do
		if rg -n --fixed-strings "$pattern" "$file" >/dev/null 2>&1; then
			add_fail "global leakage in ${file#$SCRIPT_DIR/}: $pattern"
		fi
	done

	# Any hardcoded home directory breaks the other machines sharing this repo.
	# Match /Users/<name>/ for any name, not just this machine's, so the check
	# catches leakage regardless of which checkout runs it. Use $HOME instead.
	if rg -n '/Users/[^/[:space:]]+/' "$file" >/dev/null 2>&1; then
		add_fail "global leakage in ${file#$SCRIPT_DIR/}: hardcoded /Users/<name>/ path (use \$HOME)"
	fi
}

check_owner_paths() {
	for path in "${REGISTERED_OWNER_PATHS[@]}"; do
		if [[ -f "$SCRIPT_DIR/$path" ]]; then
			add_pass "owner exists: $path"
		else
			add_fail "owner missing: $path"
		fi
	done
}

is_staged_relevant_path() {
	local path="$1"
	case "$path" in
	AGENTS.md | CLAUDE.md | scripts/agent-instructions.sh | instruction-appendices/*)
		return 0
		;;
	esac

	local owner_path
	for owner_path in "${REGISTERED_OWNER_PATHS[@]}"; do
		if [[ "$path" == "$owner_path" ]]; then
			return 0
		fi
	done
	return 1
}

inspect_staged_relevance() {
	local staged_file
	if ! staged_file="$(mktemp "${TMPDIR:-/tmp}/agent-instructions-staged.XXXXXX")"; then
		STAGED_DECISION="inspection_failed"
		add_fail "staged Git index inspection failed"
		return 1
	fi

	if ! git -C "$SCRIPT_DIR" diff --cached --name-only -z --no-renames --diff-filter=ACDMRTUXB -- > "$staged_file"; then
		rm -f "$staged_file"
		STAGED_DECISION="inspection_failed"
		add_fail "staged Git index inspection failed"
		return 1
	fi

	local path
	while IFS= read -r -d '' path; do
		if is_staged_relevant_path "$path"; then
			matched_paths+=("$path")
		fi
	done < "$staged_file"
	rm -f "$staged_file"

	if (( ${#matched_paths[*]} > 0 )); then
		STAGED_DECISION="applicable"
	else
		STAGED_DECISION="not_applicable"
	fi
}

check_staged_worktree_alignment() {
	local index_present
	local path
	local statusGw
	for path in ${matched_paths[@]+"${matched_paths[@]}"}; do
		index_present=false
		worktree_present=false
		if git -C "$SCRIPT_DIR" ls-files --error-unmatch -- "$path" >/dev/null 2>&1; then
			index_present=true
		fi
		if [[ -e "$SCRIPT_DIR/$path" || -L "$SCRIPT_DIR/$path" ]]; then
			worktree_present=true
		fi
		if [[ "$index_present" != "$worktree_present" ]]; then
			add_fail "staged instruction input differs from working tree: $path"
			continue
		fi
		if [[ "$index_present" == false ]]; then
			continue
		fi
		if git -C "$SCRIPT_DIR" diff --quiet -- "$path"; then
			continue
		else
			status=$?
		fi
		if [[ "$status" -eq 1 ]]; then
			add_fail "staged instruction input differs from working tree: $path"
		else
			STAGED_DECISION="inspection_failed"
			add_fail "staged Git index inspection failed"
			return 1
		fi
	done
}

check_appendices() {
	local LC_ALL=C
	local dir="$SCRIPT_DIR/instruction-appendices"
	if [[ ! -d "$dir" ]]; then
		add_pass "instruction appendices absent"
		return
	fi

	local -a appendix_files=()
	local file
	while IFS= read -r -d '' file; do
		appendix_files+=("$file")
	done < <(find "$dir" -type f -name '*.md' -print0)

	local index
	local previous
	local candidate
	for (( index = 1; index < ${#appendix_files[*]}; index++ )); do
		candidate="${appendix_files[$index]}"
		previous=$((index - 1))
		while (( previous >= 0 )) && [[ "${appendix_files[$previous]}" > "$candidate" ]]; do
			appendix_files[$((previous + 1))]="${appendix_files[$previous]}"
			previous=$((previous - 1))
		done
		appendix_files[$((previous + 1))]="$candidate"
	done

	for file in ${appendix_files[@]+"${appendix_files[@]}"}; do
		local lines
		lines="$(line_count "$file")"
		if (( lines > 25 )); then
			add_fail "appendix line budget exceeded: ${file#$SCRIPT_DIR/} $lines > 25"
		else
			add_pass "appendix line budget: ${file#$SCRIPT_DIR/} $lines <= 25"
		fi
	done

	if (( ${#appendix_files[*]} == 0 )); then
		add_pass "instruction appendices empty"
	fi
}

run_checks() {
	check_line_budget "AGENTS.md" "$SCRIPT_DIR/AGENTS.md" 120
	check_line_budget "CLAUDE.md" "$SCRIPT_DIR/CLAUDE.md" 50
	check_no_leakage "$SCRIPT_DIR/AGENTS.md"
	check_owner_paths
	check_appendices
}

json_string() {
	local value="$1"
	local character
	printf '"'
	while [[ -n "$value" ]]; do
		character="${value:0:1}"
		value="${value:1}"
		case "$character" in
		'"') printf '\\"' ;;
		'\') printf '\\\\' ;;
		$'\b') printf '\\b' ;;
		$'\f') printf '\\f' ;;
		$'\n') printf '\\n' ;;
		$'\r') printf '\\r' ;;
		$'\t') printf '\\t' ;;
		*)
			local code
			LC_CTYPE=C printf -v code '%d' "'$character"
			if (( code < 32 )); then
				printf '%s%04x' '\u' "$code"
			else
				printf '%s' "$character"
			fi
			;;
		esac
	done
	printf '"'
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
		json_string "$item"
	done
	printf ']'
}

print_staged_json() {
	local applicable="null"
	case "$STAGED_DECISION" in
	applicable) applicable="true" ;;
	not_applicable) applicable="false" ;;
	esac

	printf '"staged":{"requested":%s,"applicable":%s,"decision":' "$STAGED" "$applicable"
	json_string "$STAGED_DECISION"
	printf ','
	json_array "matched_paths" ${matched_paths[@]+"${matched_paths[@]}"}
	printf '}'
}

print_staged_plain() {
	case "$STAGED_DECISION" in
	applicable) echo "Staged instruction health: applicable" ;;
	not_applicable) echo "Staged instruction health: not applicable" ;;
	inspection_failed) echo "Staged instruction health: inspection failed" ;;
	esac
	local path
	for path in ${matched_paths[@]+"${matched_paths[@]}"}; do
		printf 'MATCH: %q\n' "$path"
	done
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
		print_staged_json
		printf ','
		json_array "passes" ${passes[@]+"${passes[@]}"}
		printf ','
		json_array "warnings" ${warnings[@]+"${warnings[@]}"}
		printf ','
		json_array "failures" ${failures[@]+"${failures[@]}"}
		printf '}\n'
		return
	fi

	if [[ "$STAGED" == true ]]; then
		print_staged_plain
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
	echo "repository instructions: AGENTS.md and CLAUDE.md"
	echo "personal instruction setup: \$HOME/code/dotfiles project skill agents-md-setup"
	echo "checks: scripts/agent-instructions.sh"
	echo "skills: setup projections plus bunx skills acquisition"
	echo "repo truth: docs/agents/"
	echo "git docs: docs/git/"
	echo "vocabulary: CONTEXT.md plus scoped CONTEXT.md files"
	echo ""
	print_report
}

print_help() {
	cat <<'HELP'
Usage:
  scripts/agent-instructions.sh check [--staged] [--json]
  scripts/agent-instructions.sh status [--json]

Commands:
  check   Read-only health gate for startup budgets, owner paths, leakage, appendices, and startup delivery.
  status  Compact owner map plus check results.

Options:
  --staged  Run health only when exact staged instruction inputs are relevant. Valid with check only.
  --json    Emit the report and staged decision evidence as JSON.

Exit codes:
  0  success, including warnings
  1  health check failed
  2  invalid usage

This tool never generates prompt content.
HELP
}

case "$COMMAND" in
check)
	if [[ "$STAGED" == true ]]; then
		if inspect_staged_relevance && [[ "$STAGED_DECISION" == "applicable" ]]; then
			check_staged_worktree_alignment || true
			run_checks
		fi
	else
		run_checks
	fi
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
