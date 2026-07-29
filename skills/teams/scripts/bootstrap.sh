#!/usr/bin/env bash
#
# First-run dependency bootstrap for the Teams local-store reader skill.
#
# Creates skills/teams/.venv and installs the pinned requirements. Idempotent:
# if the venv already satisfies the full load-bearing import chain, this exits
# immediately without touching the network.
#
# Requires (first run only): network access, git, and a C build toolchain
# (Xcode command line tools). This is the ONLY network the skill uses, and it
# goes to GitHub/PyPI — never to Microsoft.
#
# Usage:  ./bootstrap.sh [--force]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "${SCRIPT_DIR}")"
VENV_DIR="${SKILL_DIR}/.venv"
REQUIREMENTS="${SKILL_DIR}/requirements.txt"
DEP_CHECK="${SCRIPT_DIR}/check_deps.py"

# Pinned interpreter. The dependency chain ships per-version C extension
# wheels, so this must not drift to whatever `python3` resolves to today.
PYTHON_VERSION="3.13"
PYTHON_BIN="${TEAMS_READER_PYTHON:-python${PYTHON_VERSION}}"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# Fast path: a complete venv is a no-op. Uses the SAME probe as verification,
# so a partially-installed venv falls through to a real install instead of
# being waved past.
if [[ ${FORCE} -eq 0 && -x "${VENV_DIR}/bin/python" ]]; then
  if "${VENV_DIR}/bin/python" "${DEP_CHECK}" >/dev/null 2>&1; then
    echo "teams-reader: venv already provisioned (${VENV_DIR})"
    exit 0
  fi
  echo "teams-reader: existing venv is incomplete, reprovisioning..." >&2
fi

if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  cat >&2 <<EOF
teams-reader: required interpreter '${PYTHON_BIN}' not found.

Install Python ${PYTHON_VERSION} (e.g. 'brew install python@${PYTHON_VERSION}'),
or point the bootstrap at a compatible interpreter:

    TEAMS_READER_PYTHON=/path/to/python3.13 ./bootstrap.sh
EOF
  exit 1
fi

echo "teams-reader: creating venv with ${PYTHON_BIN} ($(${PYTHON_BIN} --version))"
rm -rf "${VENV_DIR}"
"${PYTHON_BIN}" -m venv "${VENV_DIR}"

"${VENV_DIR}/bin/python" -m pip install --quiet --upgrade pip

echo "teams-reader: installing pinned requirements (clones from GitHub, builds wheels)..."
# A yanked-'zstd' warning here is expected and documented in requirements.txt.
"${VENV_DIR}/bin/python" -m pip install -r "${REQUIREMENTS}"

# Verification uses the same probe as the fast path above.
if ! "${VENV_DIR}/bin/python" "${DEP_CHECK}"; then
  echo "teams-reader: bootstrap FAILED — dependency chain incomplete." >&2
  exit 1
fi

echo "teams-reader: bootstrap complete (${VENV_DIR})"
