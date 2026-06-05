# Fallow Through the Agent Lens, 2026-06

Purpose: how Fallow plugs into agentic coding workflows — skill install, invocation, the JSON action contract, the self-review loop, and the CI gate. Companion to [2026-06-04-fallow-ai-code-quality-tool.md](2026-06-04-fallow-ai-code-quality-tool.md) (general overview).

Grounding: verified against live docs/repos, not the source video's auto-transcript. The transcript mangled several specifics (config file, skill install, dupe modes); this doc uses the authoritative strings.

Sources:
- [docs.fallow.tools/integrations/agent-skills](https://docs.fallow.tools/integrations/agent-skills)
- [github.com/fallow-rs/fallow](https://github.com/fallow-rs/fallow)
- [github.com/fallow-rs/fallow-skills](https://github.com/fallow-rs/fallow-skills)
- [GitHub Action: fallow-codebase-intelligence](https://github.com/marketplace/actions/fallow-codebase-intelligence)
- Origin video: [Web Dev Simplified, 2026-06-02](https://www.youtube.com/watch?v=t3my5ByUhFU)

## Bottom Line

- Fallow is agent-native by design: structured JSON output carries a machine-actionable `actions` array with an `auto_fixable` flag, so an agent can self-correct before opening a PR.
- Ships an official Agent Skill matched to the spec — works with Claude Code, Cursor, Windsurf, Gemini CLI, Codex, Copilot, Amp, and "any compatible agent."
- The intended loop: agent writes code -> agent runs Fallow on its own output -> agent fixes findings -> CI `audit` gates only PR-introduced regressions.
- MCP server and LSP exist alongside the CLI; CLI is the primary agent surface today.

## Why It Fits Agents

- Catches the exact failure modes of AI-generated code: duplication, dead code/unused exports, oversized + high-complexity functions, untested complexity.
- Rust-native, sub-second on most projects — cheap to run inside an agent loop, not a slow gate.
- Output contract is typed: `import type { CheckOutput } from "fallow/types"`.
- Findings are actionable, not just diagnostic: each issue lists what to do and whether Fallow can do it automatically.

## Skill Install (per agent)

Claude Code (plugin marketplace):
```
/plugin marketplace add fallow-rs/fallow-skills
/plugin install fallow-skills@fallow-rs/fallow-skills
```

Other agents:
```
# Cursor
git clone https://github.com/fallow-rs/fallow-skills.git ~/.cursor/skills/fallow-skills
# Windsurf
git clone https://github.com/fallow-rs/fallow-skills.git ~/.codeium/windsurf/skills/fallow-skills
# Gemini CLI
gemini skills install https://github.com/fallow-rs/fallow-skills.git
```

Also supported: OpenAI Codex, GitHub Copilot, Amp.

Note: the origin video showed `npx skills add ...`; the docs now use the plugin-marketplace path above. Prefer the docs form.

## Invocation

- Single skill named **`fallow`**: "Codebase intelligence for JS/TS: quality, changed-code risk, cleanup, circular deps, duplication, complexity, and (with Runtime) hot/cold-path evidence."
- Invoked by natural-language trigger phrases, not just a slash command:
  - `"check code health"`
  - `"audit this PR"` / `"Check if this PR introduces quality risk"`
  - `"find cleanup opportunities"`
  - `"what code actually runs"`
- The skill bundles the full command specs, flags, and output formats, so the agent picks the right invocation itself.

## The Agent Command Contract

Commands the skill drives (verbatim from docs):

```
fallow dead-code --format json --quiet --unused-exports   # unused exports, machine-readable
fallow dupes                                              # duplication
fallow audit                                              # changed-code gate
fallow dupes --mode semantic                              # catch renamed-variable clones
fallow dead-code --trace src/utils.ts:formatDate          # debug one export
```

JSON contract for autonomy:
- `--format json` emits structured output.
- Every issue carries an `actions` array.
- Each action has an `auto_fixable` flag — the agent reads this to decide fix-vs-flag.
- Auto-fix is dry-run-first: shows proposed changes, then applies with `--yes`.

```
fallow audit --format json     # machine-actionable with auto_fixable flags
fallow --format json           # full codebase JSON
fallow fix --dry-run           # preview cleanup before applying
```

## The Self-Review Loop (intended workflow)

1. Agent implements the feature.
2. Agent runs Fallow on what it just wrote — start full-repo, not PR-only, during initial cleanup.
3. Agent parses JSON: fixes `auto_fixable` issues via `fallow fix` (dry-run -> `--yes`), flags the rest with file paths + line numbers.
4. Once the codebase is clean, switch to `fallow audit` so only PR-introduced findings gate.

Docs' adoption guidance: fix real dead code, duplication, and complexity first (full-repo), then add the PR gate — don't lead with PR-only audits on a dirty baseline.

## CI Gate

GitHub Action `fallow-rs/fallow@v2`:

```yaml
name: Fallow
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write   # post comments / review comments
jobs:
  fallow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: fallow-rs/fallow@v2
        with:
          command: audit
          comment: true
          review-comments: true
```

- `command` accepts `audit | health | dead-code | dupes`.
- On PRs the action auto-scopes to changed files and returns a verdict: **pass | warn | fail**.
- `comment: true` posts a collapsible summary; `review-comments: true` adds inline suggestions.
- Add `security-events: write` if uploading SARIF to Code Scanning (`sarif` input).
- Other health inputs: `score`, `trend`, `hotspots`, `targets`, `coverage`, `max-comments` (default 50).

CLI equivalents for any CI:
```
fallow audit --base main          # explicit base ref
fallow audit --gate all           # fail on inherited findings too
fallow audit --format json        # verdict + structured findings
--changed-since origin/main       # scope to PR-touched files
--diff-file <path>                # filter findings to added diff hunks
--baseline <file>                 # track new vs existing
```

## Output Formats for Pipelines

`--format <type>`: `json`, `sarif` (Code Scanning), `codeclimate` (GitLab), `pr-comment-github` / `pr-comment-gitlab`, `review-github` / `review-gitlab`, `annotations`, `markdown`, `badge`.

## Suppression an Agent Can Emit

Inline (agent adds when a finding is a known false positive):
```typescript
// fallow-ignore-next-line unused-export
// fallow-ignore-next-line unused-export, complexity
// fallow-ignore-file
```
JSDoc visibility tags also suppress unused-export reports: `@public`, `@internal`, `@beta`, `@alpha`.

Config-level (`.fallowrc.json`, first-match-wins over `.fallowrc.jsonc`/`fallow.toml`/`.fallow.toml`):
```json
{
  "entry": ["src/workers/*.ts"],
  "ignorePatterns": ["**/*.generated.ts"],
  "rules": { "unused-exports": "warn", "unused-types": "off" },
  "health": { "maxCyclomatic": 20, "maxCognitive": 15, "maxCrap": 30 }
}
```

## Fit With This Repo

- Maps cleanly onto our agent-native CLI rubric: structured output, typed contract, machine-actionable next steps, scoped PR audit. Strong candidate for the `create-cli` "good agent CLI" reference set.
- Overlaps our `code-quality.md` runner table (Biome, tsc, bun) but covers a different axis — cross-file duplication, dead code, complexity/coupling — that lint + types do not.
- Two integration paths to weigh:
  - Bash-invoked `npx fallow ... --format json` behind a runner rule (matches current Biome/tsc/bun pattern; honors the "always pass JSON" convention).
  - The shipped MCP server, if we want it in the MCP-runner tier — needs verification of tool surface and JSON parity before adoption.
- Decision still open: adopt as a runner, reference-only for CLI design, or skip. This doc is grounding, not a recommendation to install.

## Open Questions

- MCP server tool surface + whether it honors `response_format: "json"` parity — not documented in sources reviewed.
- Whether the Claude Code skill's trigger phrases collide with our existing code-quality skills/rules.
- `auto_fixable` blast radius — confirm `fallow fix --yes` scope before letting an agent run it unattended.
