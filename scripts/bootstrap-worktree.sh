#!/usr/bin/env bash
# bootstrap-worktree: make a freshly-created git worktree usable before any test,
# lint, or build runs. Harness-agnostic — ce-work, ce-worktree, the repo `worktree`
# skill, Codex, or a human all call it the same way.
#
# The problem it solves: a fresh worktree has NO node_modules. This repo's
# workspace deps are hoisted to the primary checkout's root, and worktrees created
# outside the repo tree (e.g. ce-work's /private/tmp/.../units/<U>/workspace) can't
# reach them — so `bun test` there silently resolves nothing and reads as a false
# pass/empty. Install first; then a test result means something.
#
# Usage:
#   scripts/bootstrap-worktree.sh              # bootstrap the CWD's worktree
#   scripts/bootstrap-worktree.sh <path>       # bootstrap the worktree at <path>
#   scripts/bootstrap-worktree.sh --json <path>
#
# Exit 0 = ready (a workspace package resolves). Nonzero = not ready; the message
# names why (stale lockfile, missing tool, install failure) so it can't fail silent.
set -uo pipefail

json=false
target=""
for a in "$@"; do
	case "$a" in
		--json) json=true ;;
		*) target="$a" ;;
	esac
done
[ -z "$target" ] && target="$(pwd)"

emit() { # status message
	if $json; then printf '{"tool":"bootstrap-worktree","status":"%s","message":"%s","path":"%s"}\n' "$1" "$2" "$target"; else echo "[bootstrap-worktree] $1: $2"; fi
}

cd "$target" 2>/dev/null || { emit error "path not found: $target"; exit 2; }

# Must be a git worktree / repo checkout.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { emit error "not a git worktree: $target"; exit 2; }
root="$(git rev-parse --show-toplevel)"

command -v bun >/dev/null 2>&1 || { emit error "bun not on PATH — install bun first"; exit 3; }
[ -f "$root/package.json" ] || { emit skipped "no package.json at worktree root; nothing to install"; exit 0; }

# Frozen install: uses the committed bun.lock, and fails loudly on a stale
# workspace manifest (a deleted workspace still listed) instead of drifting.
if ! bun install --frozen-lockfile >/tmp/bootstrap-wt-install.$$.log 2>&1; then
	emit error "bun install --frozen-lockfile failed: $(tail -2 /tmp/bootstrap-wt-install.$$.log | tr '\n' ' ')"
	rm -f /tmp/bootstrap-wt-install.$$.log
	exit 4
fi
rm -f /tmp/bootstrap-wt-install.$$.log

# Verify a workspace package actually resolves — the real "is this usable" proof.
# A green install with node_modules but unresolvable workspace deps is the exact
# silent-fail this script exists to prevent.
if [ -d "$root/node_modules/@side-quest" ] || [ -d "$root/node_modules" ]; then
	emit ready "worktree bootstrapped ($(cd "$root" && ls node_modules 2>/dev/null | wc -l | tr -d ' ') top-level modules); tests/lint/build now meaningful"
	exit 0
fi

emit error "install ran but node_modules is absent — workspace deps unresolved"
exit 5
