#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required for claude-code-config setup." >&2
  exit 1
fi

echo "Installing dependencies..."
bun install --frozen-lockfile

if [[ -d "scripts/hooks" ]]; then
  hooks_dir="$(git rev-parse --git-path hooks)"
  mkdir -p "${hooks_dir}"

  for hook in scripts/hooks/*; do
    [[ -f "${hook}" ]] || continue
    hook_name="$(basename "${hook}")"
    cp "${hook}" "${hooks_dir}/${hook_name}"
    chmod +x "${hooks_dir}/${hook_name}"
    echo "Installed git hook: ${hook_name}"
  done
fi

echo "Setup complete."
