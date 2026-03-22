#!/bin/bash
# render-user-prompts.sh - Render canonical user-scope prompt files from fragments
#
# Usage:
#   ./scripts/render-user-prompts.sh --write   Render and write output files
#   ./scripts/render-user-prompts.sh --check   Check if outputs match rendered fragments (exit 1 if drift)
#   ./scripts/render-user-prompts.sh --diff    Show diff between current and rendered

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRAGMENTS="${SCRIPT_DIR}/prompt-fragments"

# Fragment ordering for AGENTS.md (shared core)
SHARED_FRAGMENTS=(
  "shared/intro.md"
  "shared/critical-rules.md"
  "shared/tool-routing.md"
  "shared/communication-style.md"
  "shared/key-people.md"
  "shared/memory-os.md"
)

# Claude-only fragments appended to CLAUDE.md
CLAUDE_FRAGMENTS=(
  "claude/claude-runtime-notes.md"
)

# Codex-only fragments appended after shared
CODEX_FRAGMENTS=(
  "codex/codex-runtime-notes.md"
  "codex/tool-map.md"
)

# --- Render functions ---

render_agents() {
  for frag in "${SHARED_FRAGMENTS[@]}"; do
    cat "${FRAGMENTS}/${frag}"
    echo ""
  done
}

render_claude() {
  cat <<'HEADER'
<!-- GENERATED — do not edit directly. Edit prompt-fragments/ and run: scripts/render-user-prompts.sh --write -->
@AGENTS.md

HEADER
  for frag in "${CLAUDE_FRAGMENTS[@]}"; do
    cat "${FRAGMENTS}/${frag}"
    echo ""
  done
}

render_codex() {
  for frag in "${SHARED_FRAGMENTS[@]}"; do
    cat "${FRAGMENTS}/${frag}"
    echo ""
  done
  for frag in "${CODEX_FRAGMENTS[@]}"; do
    cat "${FRAGMENTS}/${frag}"
    echo ""
  done
}

# --- Actions ---

write_outputs() {
  echo "Rendering AGENTS.md..."
  render_agents > "${SCRIPT_DIR}/AGENTS.md"

  echo "Rendering CLAUDE.md..."
  render_claude > "${SCRIPT_DIR}/CLAUDE.md"

  echo "Rendering generated/codex-user-agents.md..."
  render_codex > "${SCRIPT_DIR}/generated/codex-user-agents.md"

  # Copy rendered Codex output to ~/.codex/AGENTS.md
  local codex_home="${HOME}/.codex"
  if [[ -d "$codex_home" ]]; then
    echo "Syncing to ~/.codex/AGENTS.md..."
    cp "${SCRIPT_DIR}/generated/codex-user-agents.md" "${codex_home}/AGENTS.md"
  else
    echo "SKIP: ~/.codex/ does not exist"
  fi

  echo "Done. Rendered files:"
  wc -l "${SCRIPT_DIR}/AGENTS.md" "${SCRIPT_DIR}/CLAUDE.md" "${SCRIPT_DIR}/generated/codex-user-agents.md"
}

check_outputs() {
  local exit_code=0
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap "rm -rf '$tmpdir'" EXIT

  # Render to temp files for exact comparison
  render_agents > "${tmpdir}/AGENTS.md"
  render_claude > "${tmpdir}/CLAUDE.md"
  render_codex > "${tmpdir}/codex-user-agents.md"

  # Check AGENTS.md
  if ! diff -q "${tmpdir}/AGENTS.md" "${SCRIPT_DIR}/AGENTS.md" > /dev/null 2>&1; then
    echo "DRIFT: AGENTS.md does not match rendered fragments"
    exit_code=1
  else
    echo "OK: AGENTS.md"
  fi

  # Check CLAUDE.md
  if ! diff -q "${tmpdir}/CLAUDE.md" "${SCRIPT_DIR}/CLAUDE.md" > /dev/null 2>&1; then
    echo "DRIFT: CLAUDE.md does not match rendered fragments"
    exit_code=1
  else
    echo "OK: CLAUDE.md"
  fi

  # Check generated/codex-user-agents.md
  if ! diff -q "${tmpdir}/codex-user-agents.md" "${SCRIPT_DIR}/generated/codex-user-agents.md" > /dev/null 2>&1; then
    echo "DRIFT: generated/codex-user-agents.md does not match rendered fragments"
    exit_code=1
  else
    echo "OK: generated/codex-user-agents.md"
  fi

  # Check @AGENTS.md shim resolution
  # CLAUDE.md uses @AGENTS.md import — verify the target exists where Claude will look for it
  local claude_home="${HOME}/.claude"
  if [[ -f "${claude_home}/CLAUDE.md" ]]; then
    # Extract @-imports from CLAUDE.md and verify each target exists
    local imports
    imports=$(grep -oE '^@[^ ]+' "${claude_home}/CLAUDE.md" 2>/dev/null || true)
    for import in $imports; do
      local target="${import#@}"
      local resolved="${claude_home}/${target}"
      if [[ ! -f "$resolved" ]]; then
        echo "BROKEN: @${target} import in ~/.claude/CLAUDE.md — file not found at ${resolved}"
        exit_code=1
      else
        echo "OK: @${target} import resolves"
      fi
    done
  fi

  # Check ~/.codex/AGENTS.md parity
  local codex_home="${HOME}/.codex"
  if [[ -f "${codex_home}/AGENTS.md" ]]; then
    if ! diff -q "${SCRIPT_DIR}/generated/codex-user-agents.md" "${codex_home}/AGENTS.md" > /dev/null 2>&1; then
      echo "DRIFT: ~/.codex/AGENTS.md does not match generated/codex-user-agents.md"
      exit_code=1
    else
      echo "OK: ~/.codex/AGENTS.md (in sync)"
    fi
  fi

  # Check context files referenced in memory-os fragment actually exist
  local context_frag="${FRAGMENTS}/shared/memory-os.md"
  if [[ -f "$context_frag" ]]; then
    local context_paths
    context_paths=$(grep -oE '~/.claude/context/[^ ]+\.md' "$context_frag" 2>/dev/null || true)
    local context_ok=true
    for ctx in $context_paths; do
      local expanded="${ctx/#\~/$HOME}"
      if [[ ! -f "$expanded" ]]; then
        echo "BROKEN: ${ctx} referenced in memory-os fragment but file not found"
        exit_code=1
        context_ok=false
      fi
    done
    if $context_ok; then
      echo "OK: all context file references resolve"
    fi
  fi

  # Check for orphan fragments (files in prompt-fragments/ not referenced in any render array)
  local orphan_found=false
  while IFS= read -r frag_file; do
    local rel="${frag_file#${FRAGMENTS}/}"
    local found=false
    for f in "${SHARED_FRAGMENTS[@]}" "${CLAUDE_FRAGMENTS[@]}" "${CODEX_FRAGMENTS[@]}"; do
      if [[ "$f" == "$rel" ]]; then
        found=true
        break
      fi
    done
    if ! $found; then
      echo "ORPHAN: ${rel} exists in prompt-fragments/ but is not referenced in any render array"
      exit_code=1
      orphan_found=true
    fi
  done < <(find "${FRAGMENTS}" -name "*.md" -type f 2>/dev/null | sort)
  if ! $orphan_found; then
    echo "OK: no orphan fragments"
  fi

  if [[ $exit_code -eq 0 ]]; then
    echo ""
    echo "All checks passed."
  else
    echo ""
    echo "Issues detected. Run: ./scripts/render-user-prompts.sh --write"
  fi

  return $exit_code
}

diff_outputs() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap "rm -rf '$tmpdir'" EXIT

  render_agents > "${tmpdir}/AGENTS.md"
  render_claude > "${tmpdir}/CLAUDE.md"
  render_codex > "${tmpdir}/codex-user-agents.md"

  echo "=== AGENTS.md ==="
  diff "${tmpdir}/AGENTS.md" "${SCRIPT_DIR}/AGENTS.md" || true
  echo ""
  echo "=== CLAUDE.md ==="
  diff "${tmpdir}/CLAUDE.md" "${SCRIPT_DIR}/CLAUDE.md" || true
  echo ""
  echo "=== generated/codex-user-agents.md ==="
  diff "${tmpdir}/codex-user-agents.md" "${SCRIPT_DIR}/generated/codex-user-agents.md" || true
}

# --- Main ---

case "${1:-}" in
  --write)
    write_outputs
    ;;
  --check)
    check_outputs
    ;;
  --diff)
    diff_outputs
    ;;
  *)
    echo "Usage: $0 {--write|--check|--diff}"
    exit 1
    ;;
esac
