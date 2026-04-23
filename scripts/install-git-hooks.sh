#!/bin/bash
# install-git-hooks.sh — install tracked git hooks from scripts/hooks/ into .git/hooks/
# Idempotent: safe to re-run. Backs up any existing hook before replacing.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SRC_DIR="${REPO_ROOT}/scripts/hooks"
DEST_DIR="${REPO_ROOT}/.git/hooks"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "No scripts/hooks/ directory found. Nothing to install."
  exit 0
fi

mkdir -p "${DEST_DIR}"

for src in "${SRC_DIR}"/*; do
  [[ -f "$src" ]] || continue
  name="$(basename "$src")"
  dest="${DEST_DIR}/${name}"

  if [[ -f "$dest" ]] && ! diff -q "$src" "$dest" > /dev/null 2>&1; then
    backup="${dest}.bak.$(date +%Y%m%d-%H%M%S)"
    echo "Backing up existing ${name} → ${backup}"
    cp "$dest" "$backup"
  fi

  cp "$src" "$dest"
  chmod +x "$dest"
  echo "Installed: ${name}"
done

echo ""
echo "Done. Hooks installed from ${SRC_DIR} → ${DEST_DIR}"
