---
title: "Thariq-Inspired System Improvements"
type: plan
status: active
updated: 2026-03-26
summary: "10 improvements to the Memory OS, skills, and Claude Code setup inspired by Thariq's articles on skills, caching, agent design, file system state, and bash composability."
related:
  - ~/code/my-second-brain/docs/research/2026-03-22-thariq-applied-analysis.md
  - ~/code/my-second-brain/docs/research/2026-03-22-thariq-skills.md
  - ~/code/my-second-brain/docs/research/2026-03-22-thariq-seeing-like-an-agent.md
  - ~/code/my-second-brain/docs/research/2026-03-22-thariq-prompt-caching.md
  - ~/code/my-second-brain/docs/research/2026-03-22-thariq-playgrounds.md
  - ~/code/my-second-brain/docs/research/2026-03-22-thariq-agent-sdk.md
  - ~/code/my-second-brain/docs/research/2026-03-22-thariq-tweets-filesystem-bash-specs.md
---

# Thariq-Inspired System Improvements

Brainstormed 2026-03-26 after re-reading all 7 Thariq Shihipar articles and the applied analysis cross-referenced against Nathan's full setup.

## Context

Nathan's Claude Code setup has 22+ skills, Memory OS with QMD federation, people enrichment pipeline, productivity layer, and hooks system. The Thariq Shihipar articles surfaced concrete patterns that map directly to improvement opportunities. This doc captures the top 10 plus additional ideas for later exploration.

## Already Done (this session)

- `context/INDEX.md` created in monash-smst — progressive disclosure entry point
- `context/scripts/recon.sh` — composable bash helpers for fast memory navigation
- Date format rule added to Memory OS contract
- Key people routing table promoted to `context/context/` with CLAUDE.md pointer
- Extension roadmap created as durable context file
- Glossary people section slimmed to nickname decoder only (deduplication with `context/people/`)

---

## Top 10 Improvements

### 1. Gotchas Sections in Top Skills

**Source:** Skills article — "The highest-signal content in any skill is the Gotchas section."

**What:** Port feedback memories into the relevant skills as `## Gotchas` sections. When Claude fails at a skill, update the skill's gotchas — not just session memory.

**Start with:** `productivity-sync`, `capture`, `people-enrich`, `imessage-reader`, `slack-message`

**Effort:** Low | **Impact:** High

### 2. Skill Telemetry via PreToolUse Hook

**Source:** Skills article — "We use a PreToolUse hook that lets us log skill usage."

**What:** Add a simple PreToolUse logger that tracks which skills fire, when, and from what prompt patterns. After a week, identify under-triggering skills and improve their descriptions.

**Implementation:** Hook in `settings.json` that appends to `~/.claude/logs/skill-telemetry.jsonl`. Fields: `timestamp`, `skill_name`, `trigger_prompt_preview`, `session_id`.

**Effort:** Low | **Impact:** High

### 3. Spec → Fresh Session Discipline

**Source:** Tweet thread (14.6K bookmarks) — "Start with a minimal spec, have Claude interview you, then make a new session to execute."

**What:** Behavioral change. Plan in one session (spec to `docs/plans/`), execute in a fresh session that reads the spec. This gives clean context, better cache utilisation, and the spec serves as filesystem state.

**Already partially supported:** `ce-plan` and `ce-brainstorm` skills exist. Plans land in `docs/plans/`. Just need to enforce the session boundary.

**Effort:** None (behavioral) | **Impact:** High

### 4. Description Fields as Trigger Specs

**Source:** Skills article — "The description field is not a summary — it's a description of when to trigger this skill."

**What:** Audit all skill descriptions. Rewrite any that read as summaries ("manages tasks in TASKS.md") into trigger conditions ("Use when the user asks about tasks, wants to add/complete tasks, or needs help tracking commitments").

**Effort:** Low | **Impact:** Medium

### 5. Verification Skill (`memory-verify`)

**Source:** Agent SDK — "Three evaluation approaches: rules-based, visual, LLM-as-judge."

**What:** Build a `/memory-verify` skill that:
- Lints people note frontmatter against the contract
- Validates TASKS.md format (sections, checkbox syntax, date formats)
- Confirms QMD index freshness
- Checks memory routing (nothing stored in wrong repo)
- Optionally runs as a post-session hook

**Effort:** Medium | **Impact:** High

### 6. Session Scratchpads (`scratch/`)

**Source:** File System article — "The file system is an elegant way of representing state."

**What:** Skills write intermediate reasoning and working state to a `scratch/` directory during complex workflows. This survives compaction. `productivity-sync` could write `scratch/sync-plan.md` before executing — a checkpoint Claude can re-read after compaction.

**Convention:** Add `scratch/` to `.gitignore`. Skills check for existing scratchpads on start and offer to resume.

**Effort:** Low | **Impact:** High

### 7. Append-Only Skill Logs

**Source:** Skills article — "Saving previous results in log files can help the model stay consistent and reflect on previous executions."

**What:** Top workflow skills write a one-line summary per run to an append-only log.

| Skill | Log file |
|-------|----------|
| `productivity-sync` | `logs/sync.log` |
| `people-enrich` | `logs/enrich.log` |
| `capture` | `logs/capture.log` |

Claude reads the log on next invocation: "last sync was 3 days ago, calendar had 2 new commitments, one was already in TASKS.md."

Store in `${CLAUDE_PLUGIN_DATA}` to survive plugin upgrades. Cap at last 50 entries.

**Effort:** Low | **Impact:** High

### 8. Config.json Setup Pattern

**Source:** Skills article — "Store setup information in a config.json in the skill directory."

**What:** Skills that need user context store answers in `config.json`. Agent asks once, reuses forever.

**Candidates:**
- `productivity-sync` — which calendar, which channels, triage preferences
- `slack-message` — default workspace URL, preferred channels
- `capture` — default owning repo, favourite routing heuristics

**Effort:** Medium | **Impact:** Medium

### 9. On-Demand Safety Hooks

**Source:** Skills article — `/careful` blocks destructive commands, `/freeze` blocks edits outside a directory.

**What:** Build context-specific safety skills that activate per-session:
- `/careful` — blocks `rm -rf`, `DROP TABLE`, force-push, `kubectl delete` via PreToolUse matcher
- `/freeze` — blocks Edit/Write outside a specific directory. Useful when debugging.
- `/prod-mode` — stricter guardrails on memory writes

**Effort:** Medium | **Impact:** Medium

### 10. Playgrounds for Visual Interaction

**Source:** Playgrounds article — "Think of a unique way of interacting with the model and then ask it to express that."

**What:** Interactive HTML playgrounds for problems not well-suited to text.

**High-value candidates for Nathan:**
- **Memory graph visualisation** — interactive people network, click nodes to trigger enrichment
- **Task triage board** — drag-and-drop prioritisation that outputs back to TASKS.md
- **Extension roadmap kanban** — visual board synced with the Squad 2 roadmap file
- **QMD search explorer** — try query strategies, see score distributions

Particularly valuable for ADHD — visual interaction is lower cognitive load than text.

**Install:** `/plugin install playground@claude-plugins-official`

**Effort:** Medium | **Impact:** High

### 11. Skill Composition References

**Source:** Skills article — "Reference other skills by name, and the model will invoke them if they are installed."

**What:** Declare natural composition chains in skill text so Claude chains workflows without hardcoding:
- `productivity-sync` → "invoke /productivity-tasks to update task state after syncing"
- `people-enrich` → "invoke /federated-recall for QMD queries"
- `capture` → "invoke /qmd-refresh after writing new content if the user wants immediate recall"

**Effort:** Low | **Impact:** Medium

### 12. Helper Script Libraries for Composition

**Source:** Skills article — "Give Claude scripts and libraries so it spends its turns on composition, not reconstructing boilerplate."

**What:** Build reusable script libraries:
- `lib/tasks.ts` — `parseTasks()`, `addTask()`, `moveTask()`, `overdueItems()`
- `lib/memory.ts` — `findMemory()`, `routeToRepo()`, `validateFrontmatter()`

Claude generates one-off scripts composing these — "show me overdue tasks with related people notes" becomes a composed script.

**Effort:** Medium | **Impact:** High

### 13. "Don't Railroad" Audit

**Source:** Seeing Like an Agent — "Give Claude the information it needs, but give it the flexibility to adapt."

**What:** Audit prescriptive skills for over-specificity. `productivity-sync` has a complex multi-step flow that may not always suit the situation. Consider rewriting step sequences as information + constraints, letting Claude choose the approach.

**Effort:** Low | **Impact:** Medium

### 14. Subagent Handoffs Over Model Switches

**Source:** Prompt Caching — "If you're 100k tokens in with Opus, switching to Haiku is more expensive because you rebuild the cache."

**What:** Use subagent dispatches for lightweight tasks instead of `/fast` toggle. The Explore agents already do this. Extend to: quick recall queries, format conversions, triage decisions, simple lookups.

**Effort:** Low | **Impact:** Medium

### 15. Quarterly Tool Capability Audit

**Source:** Seeing Like an Agent — "As model capabilities increase, the tools your models once needed might now be constraining them."

**What:** Schedule a quarterly review:
- Does the ADHD coach hook need recalibration? Are some reminders now noise?
- Can Claude manage task state more implicitly?
- Are there skills that were workarounds for model limitations that no longer exist?

**Effort:** None (behavioral) | **Impact:** Medium

### 16. Diagnostic Skill (`/diagnose`)

**Source:** Agent SDK — "Does the agent misunderstand tasks due to missing information?"

**What:** Build a `/diagnose` skill that walks through four questions after a failure:
1. Missing information → add to skill or progressive disclosure
2. Repeated error → add to gotchas section
3. Wrong tool → redesign tool or add a new one
4. Performance drift → build an eval

Closes the improvement loop and compounds quality over time.

**Effort:** Medium | **Impact:** High

### 17. File-Based State Machines for Pipelines

**Source:** File System article — "The file system is an elegant way of representing state."

**What:** Multi-step pipelines write state to JSON files. If session crashes or compacts, Claude reads the state file and resumes mid-pipeline.

```json
// scratch/people-enrichment/nathan.state.json
{ "stage": "qmd-queries", "dimensions_completed": 18, "dimensions_total": 30 }
```

**Applies to:** `people-enrich`, `productivity-sync`, NotebookLM pack creation.

**Effort:** Medium | **Impact:** High

### 18. Session Summary on Exit

**Source:** Agent SDK — "Organizing previous conversations in dedicated folders enables agents to search relevant history."

**What:** Hook on Stop event writes a brief summary to `sessions/YYYY-MM-DD-HH.md`. Next session, Claude can `grep sessions/` for relevant prior work. Different from memory (durable facts) — this is episodic recall: "what did we talk about last Tuesday?"

**Effort:** Medium | **Impact:** High

### 19. "Given Context" vs "Found Context" Audit

**Source:** Seeing Like an Agent — "Claude was given this context instead of finding it itself."

**What:** Audit CLAUDE.md and MEMORY.md. Is anything there that Claude could find on its own via QMD, file reads, or bash? If so, remove it and let Claude pull it when relevant. Minimise injected context → maximise discovered context. Reduces context rot.

**Effort:** Low | **Impact:** High

### 20. Cross-Repo Bash Recipes

**Source:** Tweet threads — "Every agent can use a file system."

**What:** Create a `cross-repo-recipes.sh` reference file with one-liners that span the multi-repo setup:

```bash
# All open tasks across every repo
grep -r "- \[ \]" ~/code/*/TASKS.md

# Which repos have heaviest CLAUDE.md
wc -l ~/code/*/CLAUDE.md | sort -n

# What changed this week across all repos
for repo in ~/code/monash-smst ~/code/experience-sdk ~/code/my-second-brain; do
  echo "=== $(basename $repo) ===" && git -C "$repo" log --oneline --since="7 days ago" | head -5
done

# Find a person across all memory surfaces
grep -rli "ashwini" ~/code/*/context/people/
```

These sweeps are impossible with file tools (scoped to working directory) but trivial with bash.

**Effort:** Low | **Impact:** High

---

## Next Steps

Pick 2-3 items to implement in the next session. Recommended starting batch:

1. **#1 Gotchas** — immediate value, low effort, compounds forever
2. **#7 Append-only logs** — makes `productivity-sync` self-aware across sessions
3. **#4 Description audit** — quick pass, improves triggering accuracy

Then schedule #5 (`memory-verify`) and #10 (Playgrounds) as dedicated sessions.

For the full 40-callout deep analysis, see: `~/code/my-second-brain/docs/research/2026-03-22-thariq-applied-analysis.md`
