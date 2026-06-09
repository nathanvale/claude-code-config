#!/usr/bin/env bash
# Report active Claude/Codex LLM routing for the current Monash repo.
# Reads env resolved through direnv; never prints secret values (shape only).
set -uo pipefail

shared="$HOME/code/dotfiles/.envrc.monash-foundry"
repo_envrc="$(pwd)/.envrc"

# Resolve env as direnv would for this dir, falling back to current process env.
if command -v direnv >/dev/null 2>&1 && [ -f "$repo_envrc" ]; then
  eval "$(direnv export bash 2>/dev/null)" || true
fi

provider="personal Anthropic / Codex (no Foundry)"
if [ "${CLAUDE_CODE_USE_FOUNDRY:-}" = "1" ]; then
  provider="SMST Azure Foundry"
fi

echo "Active provider:   $provider"
echo "Foundry resource:  ${ANTHROPIC_FOUNDRY_RESOURCE:-<unset>}"
echo "Claude profile:    ${CLAUDE_CONFIG_DIR:-$HOME/.claude (personal default)}"
echo "Codex home:        ${CODEX_HOME:-$HOME/.codex (personal default)}"

# Azure key: shape only, never the value.
if [ -n "${AZURE_OPENAI_API_KEY:-}" ]; then
  echo "Azure OpenAI key:  present (len ${#AZURE_OPENAI_API_KEY})"
else
  echo "Azure OpenAI key:  <unset>"
fi

# Azure session (Foundry needs a live az login).
if command -v az >/dev/null 2>&1; then
  acct="$(az account show --query name -o tsv 2>/dev/null)"
  if [ -n "$acct" ]; then
    echo "az login:          $acct"
  else
    echo "az login:          NOT logged in (Foundry calls will fail — run: az login)"
  fi
else
  echo "az login:          az CLI not installed"
fi

# Per-repo override visibility.
if [ -f "$repo_envrc" ]; then
  if grep -qE '^[[:space:]]*unset[[:space:]]+CLAUDE_CODE_USE_FOUNDRY' "$repo_envrc"; then
    echo "Per-repo override: ACTIVE — .envrc unsets Foundry (forces personal)"
  elif grep -qE '^[[:space:]]*#.*unset[[:space:]]+CLAUDE_CODE_USE_FOUNDRY' "$repo_envrc"; then
    echo "Per-repo override: present but commented (Foundry default applies)"
  else
    echo "Per-repo override: none (shared default applies)"
  fi
  if grep -q "envrc.monash-foundry" "$repo_envrc"; then
    echo "Sources shared:    yes"
  else
    echo "Sources shared:    NO — repo does not opt into Monash routing"
  fi
else
  echo "Per-repo override: no .envrc in $(pwd)"
fi

echo
echo "Reminder: routing is resolved at launch — restart claude/codex after any change."
