# Ecosystem — Skill Dependency Graph

Reference knowledge for the babysitter skill. Describes how all skills compose, what data flows between them, and where failures propagate.

## Composition Mechanisms

Skills compose in three ways:

1. **`skills:` frontmatter** — Loads another skill's knowledge into the current context (no fork). The caller gains the skill's instructions but executes them inline.
2. **`Skill()` calls** — Invokes a skill in a forked context. The caller receives structured output (### Context for Caller).
3. **`Task` sub-agents** — Spawns parallel agents for exploration/analysis. Returns summaries.

## Skill Inventory

### User-Invocable Skills (command wrappers in `~/.claude/commands/`)

| Skill | Dir | Description |
|-------|-----|-------------|
| `where-am-i` | `skills/where-am-i/` | Pipeline status + drift detection |
| `kickoff` | `skills/kickoff/` | Ticket → gathered context |
| `plan` | `skills/plan/` | Interactive planning session |
| `git` | `skills/git/` | Commit, PR create, PR review (sub-commands) |
| `review-workflow` | `skills/review-workflow/` | Orchestrated PR + Jira review |
| `review-impl` | `skills/review-impl/` | Review implementation against plan |
| `learn` | `skills/learn/` | Explore and explain codebase areas |
| `jira` | `skills/jira/` | Jira operations (view, comment, etc.) |
| `figma` | `skills/figma/` | Figma API operations |
| `figma-compare` | `skills/figma-compare/` | Compare Figma designs with app |
| `cypress` | `skills/cypress/` | Write Cypress E2E tests |
| `babysitter` | `skills/babysitter/` | Ecosystem health + self-healing (this skill) |

### Building Block Skills (not directly user-invocable)

| Skill | Dir | Description |
|-------|-----|-------------|
| `ticket-state` | `skills/ticket-state/` | Persistent per-ticket state management |
| `codebase-search` | `skills/codebase-search/` | File discovery by topic/keyword |
| `deep-dive` | `skills/deep-dive/` | Parallel file analysis |
| `api-discovery` | `skills/api-discovery/` | API endpoint status checking |
| `chrome-verify` | `skills/chrome-verify/` | Automated browser AC verification via Chrome DevTools |
| `confluence` | `skills/confluence/` | Confluence page creation |
| `pr-create` | `skills/pr-create/` | Deprecated — redirects to git |
| `pr-review` | `skills/pr-review/` | Deprecated — redirects to git |

## Dependency Graph

```
kickoff
├── skills: api-discovery, codebase-search, ticket-state
├── Skill("jira")
├── Skill("figma")
├── Skill("ticket-state")  [init, get, update, set-gathered, log]
├── Skill("api-discovery")
├── Skill("deep-dive")     [via Task sub-agent]
└── NO para-obsidian (plan skill handles Obsidian)

plan
├── skills: ticket-state
├── Skill("ticket-state")  [get, get-gathered, update, advance, decide, log]
└── para-obsidian MCP tools

where-am-i
├── Skill("ticket-state")  [get, list, advance, update]
├── Skill("jira")
└── bash: git, gh

git (COMMIT.md)
├── Skill("ticket-state")  [get, advance, log]
└── bash: git

git (PR_CREATE.md)
├── Skill("ticket-state")  [get, advance, update, log]
└── bash: git, gh

git (PR_REVIEW.md)
└── bash: gh

review-workflow
├── skills: jira, pr-review
├── Skill("jira")
├── Skill("pr-review")     → delegates to git/PR_REVIEW.md
├── Skill("ticket-state")  [get, advance]
└── bash: gh, jira CLI

qa-test
├── Skill("ticket-state")  [get, advance, get-gathered]
├── Skill("chrome-verify")  [automated AC verification]
├── Chrome DevTools MCP tools (smoke tests, fallback interactive)
└── bash: yarn start:mock, server cleanup

chrome-verify
├── Chrome DevTools MCP tools (navigate, snapshot, screenshot, evaluate_script)
├── Built-in: Read, Grep, Glob (source analysis)
├── GOTCHAS.md (append-only learning log)
└── Writes: babysitter inbox (error reporting)

codebase-search
├── Kit MCP tools (kit_semantic, kit_file_tree, etc.)
├── Git intelligence MCP tools
└── Built-in: Grep, Glob, Read

review-impl
├── skills: codebase-search, deep-dive
├── Skill("deep-dive")    [with --include-quality --include-tests]
└── para-obsidian MCP tools (read plan from vault)

learn
├── skills: codebase-search
├── Skill("deep-dive")    [via Skill tool]
└── AskUserQuestion (scope narrowing)

figma-compare
├── Skill("figma")         [frames, export, tokens]
├── Skill("jira")          [ticket context]
└── Chrome DevTools MCP tools (screenshot, snapshot)

cypress
├── Skill("jira")          [read ACs from ticket]
└── bash: yarn cypress

git (PR_MERGE.md)
├── Skill("ticket-state")  [get, advance to merged]
└── bash: gh pr merge

ticket-state
├── Skill("jira")          [on init, to fetch summary]
└── bash: git (branch detection)
```

## Data Flow

```
Jira ticket
    ↓
kickoff (reads ticket, explores code, persists gathered context)
    ↓ writes
ticket-state/<KEY>.json (stage: kickoff) + <KEY>-gathered.json
    ↓ reads
plan (interactive planning, creates plan file + Obsidian note)
    ↓ writes
ticket-state/<KEY>.json (stage: planned) + ~/.claude/plans/<KEY>-plan.md
    ↓ reads
where-am-i (shows status, detects drift)
    ↓
git/COMMIT.md (advances stage on first commit)
    ↓ writes
ticket-state/<KEY>.json (stage: implementing)
    ↓
git/PR_CREATE.md (creates PR, records PR info)
    ↓ writes
ticket-state/<KEY>.json (stage: pr_created)
    ↓
review-workflow (reviews PR, advances to in_review)
    ↓ writes
ticket-state/<KEY>.json (stage: in_review → approved → merged)
```

## State Locations

| Path | Owner | Format |
|------|-------|--------|
| `~/.claude/state/tickets/<KEY>.json` | ticket-state | JSON (schema v3) |
| `~/.claude/state/tickets/<KEY>-gathered.json` | ticket-state (via kickoff) | JSON (gathered context) |
| `~/.claude/plans/<KEY>-plan.md` | plan | Markdown (technical plan) |
| `~/.claude/state/qa-test/<KEY>/` | qa-test | Screenshots, results JSON |
| `~/.claude/skills/chrome-verify/GOTCHAS.md` | chrome-verify | Append-only learning log |
| `~/.claude/state/babysitter/issues/<id>.json` | babysitter | JSON (issue file) |
| `~/.claude/state/babysitter/inbox.ndjson` | babysitter (written by any skill) | NDJSON |

## Pipeline Stages

```
kickoff → planned → implementing → testing → pr_created → in_review → changes_requested → approved → merged
   0         1           2            3           4             5              6                7         8
```

Auto-advance triggers:
- `kickoff → planned`: plan Step 6 completes (after interactive planning)
- `planned → implementing`: first git commit detected (COMMIT.md Step 7)
- `implementing → testing`: first qa-test run (qa-test Phase 0)
- `testing → qa_verified`: all ACs pass + smoke tests pass (qa-test Phase 4)
- `qa_verified → pr_created`: PR created (PR_CREATE.md Step 6)
- `pr_created → in_review`: self-review passes (review-workflow Step 3b)
- `in_review → approved`: PR approved on GitHub (where-am-i drift detection)
- `approved → merged`: PR merged on GitHub (where-am-i drift detection or git/PR_MERGE)

## Failure Boundaries

| Skill Failure | Impact | Mitigation |
|---------------|--------|------------|
| ticket-state write fails | State stale, drift accumulates | where-am-i detects + repairs drift |
| ticket-state read fails | Skills proceed without state | Non-blocking — all callers handle gracefully |
| Jira unreachable | kickoff can't read ticket, state init lacks summary | Warn + continue with manual input |
| Figma rate limited | kickoff skips design context | Warn + continue without visual context |
| Kit MCP not loaded | codebase-search falls back to Grep/Glob | Degraded but functional |
| gh CLI fails | PR operations fail | Proxy toggle may fix (`proxy-off`) |
| chrome-verify fails | qa-test falls back to interactive per-AC loop | Degraded but functional |
| Confluence fails | kickoff can't create plan page | Plan still exists in Obsidian |

## Auto-Fix Scope

| Category | Auto-fixable? | How |
|----------|--------------|-----|
| Missing state dirs | Yes | `mkdir -p` |
| Corrupted state JSON | Yes | Backup + re-init from Jira |
| Stale pipeline state | Yes | `Skill("where-am-i", args: "--fix")` |
| MCP tool not loaded | Yes | Re-run ToolSearch |
| Missing skill files | No | Report to Nathan |
| Skill logic issues | No | Report to Nathan |
| External service outages | No | Report to Nathan |
| Deprecated skill references | Propose only | Show diff, Nathan confirms |
