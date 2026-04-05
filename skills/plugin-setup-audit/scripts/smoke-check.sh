#!/usr/bin/env bash
set -euo pipefail

script_path="${BASH_SOURCE[0]}"
script_dir="$(cd "$(dirname "$script_path")" >/dev/null 2>&1 && /bin/pwd -P)"
skill_root="$(cd "$script_dir/.." >/dev/null 2>&1 && /bin/pwd -P)"

required_files=(
  "$skill_root/SKILL.md"
  "$skill_root/scripts/audit-plugin-setup.sh"
  "$skill_root/scripts/smoke-check.sh"
)

for file in "${required_files[@]}"; do
  [[ -f "$file" ]] || {
    echo "missing required file: $file" >&2
    exit 1
  }
done

grep -q 'name: plugin-setup-audit' "$skill_root/SKILL.md"
grep -q 'plugin setup standard' "$skill_root/SKILL.md"

json_output="$(bash "$skill_root/scripts/audit-plugin-setup.sh" --json)"

echo "$json_output" | jq -e '
  .violation_count == 0
  and ([.plugins[] | select(.plugin == "imessage")][0].classification == "tier1")
  and ([.plugins[] | select(.plugin == "contacts-hygiene")][0].classification == "tier1")
  and ([.plugins[] | select(.plugin == "go-browser-planner")][0].classification == "ignored")
' >/dev/null

echo "plugin-setup-audit smoke check passed"
