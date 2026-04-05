#!/usr/bin/env bash
set -euo pipefail

json_mode=0
repo_root="${HOME}/code/side-quest-engineering"

for arg in "$@"; do
  case "$arg" in
    --json)
      json_mode=1
      ;;
    *)
      repo_root="$arg"
      ;;
  esac
done

repo_root="${repo_root/#\~/$HOME}"
marketplace_json="$repo_root/.claude-plugin/marketplace.json"

if [[ ! -f "$marketplace_json" ]]; then
  echo "missing marketplace.json at $marketplace_json" >&2
  exit 1
fi

plugins=()
while IFS= read -r name; do
  plugins+=("$name")
done < <(jq -r '.plugins[].name' "$marketplace_json")

classify_plugin() {
  case "$1" in
    biome-runner|bun-runner|tsc-runner|unifi-admin)
      echo "exempt"
      ;;
    imessage|contacts-hygiene)
      echo "tier1"
      ;;
    go-browser-planner)
      echo "ignored"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

json_escape() {
  jq -Rn --arg s "$1" '$s'
}

records=()
violations_total=0

for plugin in "${plugins[@]}"; do
  plugin_root="$repo_root/plugins/$plugin"
  plugin_json="$plugin_root/.claude-plugin/plugin.json"
  readme="$plugin_root/README.md"
  setup_skill="$plugin_root/skills/setup/SKILL.md"
  check_workflow="$plugin_root/skills/setup/workflows/check.md"
  show_workflow="$plugin_root/skills/setup/workflows/show.md"
  configure_workflow="$plugin_root/skills/setup/workflows/configure.md"

  classification="$(classify_plugin "$plugin")"
  plugin_violations=()

  if [[ "$classification" == "unknown" ]]; then
    plugin_violations+=("plugin classification is not defined in the audit tool")
  fi

  if [[ "$classification" == "ignored" ]]; then
    :
  elif [[ "$classification" == "exempt" ]]; then
    if [[ -f "$setup_skill" ]]; then
      plugin_violations+=("exempt plugin should not need skills/setup unless explicitly reclassified")
    fi
  else
    [[ -f "$plugin_json" ]] || plugin_violations+=("missing .claude-plugin/plugin.json")
    [[ -f "$readme" ]] || plugin_violations+=("missing README.md")
    [[ -f "$setup_skill" ]] || plugin_violations+=("missing skills/setup/SKILL.md")
    [[ -f "$check_workflow" ]] || plugin_violations+=("missing skills/setup/workflows/check.md")
    [[ -f "$show_workflow" ]] || plugin_violations+=("missing skills/setup/workflows/show.md")

    if [[ -f "$setup_skill" ]] && ! rg -q 'Ownership boundary|ownership boundary' "$setup_skill"; then
      plugin_violations+=("setup skill is missing an ownership boundary section")
    fi

    if [[ -f "$plugin_json" ]] && ! jq -e '.skills == "./skills"' "$plugin_json" >/dev/null 2>&1; then
      plugin_violations+=('plugin.json is missing "skills": "./skills"')
    fi

    if [[ -f "$readme" ]] && ! rg -q ':setup' "$readme"; then
      plugin_violations+=("README does not mention the setup surface")
    fi
  fi

  if [[ "$classification" == "tier2" ]]; then
    if ! find "$plugin_root/skills/setup/workflows" -maxdepth 1 -type f -name 'add-*.md' 2>/dev/null | grep -q .; then
      plugin_violations+=("Tier 2 plugin is missing an add-* workflow")
    fi
    [[ -f "$configure_workflow" ]] || plugin_violations+=("Tier 2 plugin is missing skills/setup/workflows/configure.md")
  fi

  if (( ${#plugin_violations[@]} > 0 )); then
    violations_total=$((violations_total + ${#plugin_violations[@]}))
    compliant="false"
  else
    compliant="true"
  fi

  if (( json_mode == 1 )); then
    violations_json="[]"
    for violation in "${plugin_violations[@]}"; do
      violations_json="$(jq -cn --argjson current "$violations_json" --arg item "$violation" '$current + [$item]')"
    done
    records+=("$(jq -cn \
      --arg plugin "$plugin" \
      --arg classification "$classification" \
      --argjson compliant "$compliant" \
      --argjson violations "$violations_json" \
      '{plugin: $plugin, classification: $classification, compliant: $compliant, violations: $violations}')")
  else
    if [[ "$compliant" == "true" ]]; then
      printf 'PASS  %s (%s)\n' "$plugin" "$classification"
    else
      printf 'FAIL  %s (%s)\n' "$plugin" "$classification"
      for violation in "${plugin_violations[@]}"; do
        printf '  - %s\n' "$violation"
      done
    fi
  fi
done

if (( json_mode == 1 )); then
  records_json="[]"
  for record in "${records[@]}"; do
    records_json="$(jq -cn --argjson current "$records_json" --argjson item "$record" '$current + [$item]')"
  done
  jq -cn \
    --arg repo_root "$repo_root" \
    --arg standard "$repo_root/docs/specs/plugin-setup-standard.md" \
    --argjson violation_count "$violations_total" \
    --argjson plugins "$records_json" \
    '{
      repo_root: $repo_root,
      standard: $standard,
      violation_count: $violation_count,
      plugins: $plugins
    }'
fi

if (( violations_total > 0 )); then
  exit 1
fi
