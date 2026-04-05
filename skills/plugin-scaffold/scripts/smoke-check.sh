#!/usr/bin/env bash
set -euo pipefail

script_path="${BASH_SOURCE[0]}"
script_dir="$(cd "$(dirname "$script_path")" >/dev/null 2>&1 && /bin/pwd -P)"
skill_root="$(cd "$script_dir/.." >/dev/null 2>&1 && /bin/pwd -P)"

required_files=(
  "$skill_root/SKILL.md"
  "$skill_root/workflows/create-tier1.md"
  "$skill_root/workflows/create-tier2.md"
  "$skill_root/workflows/summary.md"
)

for file in "${required_files[@]}"; do
  [[ -f "$file" ]] || {
    echo "missing required file: $file" >&2
    exit 1
  }
done

grep -q 'name: plugin-scaffold' "$skill_root/SKILL.md"
grep -q 'Tier 1' "$skill_root/SKILL.md"
grep -q 'Tier 2' "$skill_root/SKILL.md"
grep -q 'ownership boundary' "$skill_root/SKILL.md"
grep -q 'check.md' "$skill_root/workflows/create-tier1.md"
grep -q 'show.md' "$skill_root/workflows/create-tier1.md"
grep -q 'configure.md' "$skill_root/workflows/create-tier2.md"
grep -q 'add-' "$skill_root/workflows/create-tier2.md"

echo "plugin-scaffold smoke check passed"
