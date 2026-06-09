---
name: monash-llm-routing
description: "Switch a Monash repo's Claude/Codex routing between SMST Azure Foundry and the personal Anthropic/Codex account. Use when Nathan says 'turn on Foundry', 'turn off Foundry', 'use my personal Claude/Anthropic account here', 'switch to personal Codex', 'which account am I on', or 'why is this repo using Foundry'."
role: tool-workflow
---

# Monash LLM Routing

Switch which provider serves `claude` / `codex` in a Monash repo: SMST Azure **Foundry** (Entra ID, shared SMST resource) vs the **personal** Anthropic / Codex account.

Local-development skill: works on Nathan's machine because the dotfiles owners below exist. Does not travel to another machine without them.

**No-touch skill**: this skill reads state and hands Nathan the exact edit to make. It never edits `.envrc`, never runs `direnv allow`, never runs `az login`. Those are Nathan's actions (trust grant + auth). The agent's job ends at "here's the one line to change and the command to run."

## Owner

- Routing logic (canonical, all Monash repos): `~/code/dotfiles/.envrc.monash-foundry` — exports `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_FOUNDRY_RESOURCE`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `AZURE_OPENAI_API_KEY`, default model ids.
- Per-repo override: the repo's `.envrc` (2-line stub that sources the shared file, plus optional `unset` lines).
- Codex Azure key: `~/code/dotfiles/.env.1password`.

A repo opts into Foundry by sourcing the shared file. It opts **back to personal** by uncommenting the `unset` lines in its own `.envrc`.

## Key facts

- Routing is resolved **at process launch**, not mid-session. Changing env never switches a running `claude`/`codex` — always restart it.
- Foundry profile dirs isolate auth/history: `~/.claude-monash`, `~/.codex-monash`. Personal uses `~/.claude`, `~/.codex`.
- Foundry needs a live `az login` (Entra ID). No valid Azure session = Foundry calls fail.
- The shared file's header cites a decoder doc that no longer exists at the cited path; treat the shared file itself as the owner, don't chase the dead link.

## Workflow

The agent does step 1 and reads out steps 2-4 as instructions. The agent does **not** perform steps 2-4.

1. Read current state — run `bash scripts/llm-routing-status.sh`. Reports active provider, profile dir, az login, per-repo override.
2. Hand Nathan the target edit to the **repo's own `.envrc`** (never the shared file — it owns every Monash repo):
   - **Turn ON Foundry**: keep the `source_env ".../.envrc.monash-foundry"` line; remove/comment the two `unset` lines. If status showed no Azure session, he also runs `! az login`.
   - **Turn ON personal**: add (or uncomment) these two lines after the source line:
     ```bash
     unset CLAUDE_CODE_USE_FOUNDRY
     unset ANTHROPIC_FOUNDRY_RESOURCE
     ```
3. Tell Nathan to reload + re-check: `! direnv allow . && bash scripts/llm-routing-status.sh`.
4. Tell Nathan to restart the agent — Foundry/personal only takes effect in a **new** `claude`/`codex` launched from this directory. Most-missed step; always state it.

## Safety

- No-touch: the agent never writes `.envrc`, never runs `direnv allow`, never runs `az login`. It only reads state and instructs. Hand Nathan the exact line + command; he applies it.
- The repo-local `.envrc` is the only correct edit target. `~/code/dotfiles/.envrc.monash-foundry` routes **all** Monash repos — flag it, don't touch it.
- Never print or echo `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_API_KEY_MONASH` values. The status script checks presence/shape only.

## Verification

- `bash scripts/llm-routing-status.sh` — proves the resulting active provider after any edit + `direnv allow`.
