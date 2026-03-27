# Thariq Shihipar's Agent Design Principles

Distilled from 7 articles by Thariq Shihipar (@trq212), engineer on the Claude Code team at Anthropic. Published 2025-09 to 2026-03.

Full source notes: `~/code/my-second-brain/docs/research/2026-03-22-thariq-*.md`

---

## File System as State

> "Your Agent should use a File System. This is a hill I will die on. Every agent can use a file system. The file system is an elegant way of representing state that your agent could read into context & allowing it to verify its work."

- The file system is both the output medium and the test fixture
- Write → read-back → assert. No separate test infrastructure needed.
- Session scratchpads (`scratch/`) survive compaction. Conversation context doesn't.
- Multi-step pipelines should write state to files so crashed sessions can resume.
- Directory structure IS progressive disclosure — Claude reads the top level, drills into what it needs.

## The Agent Loop

> "Giving Claude a computer unlocks the ability to build agents that are more effective than before."

The core cycle every agent runs:
1. **Gather context** — agentic search (bash/grep) first, semantic search only if performance demands it
2. **Take action** — tools, bash, code generation, MCP integrations
3. **Verify work** — rules-based, visual, or LLM-as-judge (see Verification)
4. **Repeat** — until the task is complete or the agent is blocked

- Start with agentic search (transparent, composable) before reaching for semantic search (faster but opaque)
- The loop is the skeleton — everything else (tools, skills, file system) hangs off it

## Progressive Disclosure

> "Think of the entire file system as a form of context engineering and progressive disclosure. Tell Claude what files are in your skill, and it will read them at appropriate times."

- CLAUDE.md → INDEX.md → specific files (not everything loaded upfront)
- Minimise injected context, maximise discoverable context
- A skill is a folder, not just a markdown file — scripts, references, examples, templates
- INDEX files should route by question ("if you need X, go to Y"), not list files

## "Found Context" vs "Given Context"

> "Claude was given this context instead of finding the context itself."

- Context Claude finds is better than context handed to it
- CLAUDE.md and MEMORY.md are "given context" — loaded whether needed or not
- QMD queries, grep, bash are "found context" — Claude retrieves what it needs
- If something in CLAUDE.md could be found via search, remove it and let Claude pull it

## Context Rot

> "It would have added context rot and interfered with Claude Code's main job."

- Context rot = information always present but rarely relevant, degrading attention
- For each piece of injected context, ask: "How often does Claude actually need this in the first 5 turns?"
- If rarely → move behind progressive disclosure

## Bash as Agent Superpower

> "My advice generally boils down to: use the bash tool more."

- Bash is the most flexible tool you can give an agent
- One-liners for: data exploration, post-action verification, temporal queries, cross-repo sweeps
- Bash generates structured input for other tools
- Bash recovers from failures (read logs, check state, resume)
- Give Claude composable scripts, not monolithic workflows

## Skills Design

> "The highest-signal content in any skill is the Gotchas section."

- Gotchas built from real failures, not hypotheticals — update the skill, not just session memory
- Description field is a trigger spec, not a summary — "Use when X" not "Does X"
- Don't state the obvious — focus on what pushes Claude out of its normal way of thinking
- Don't railroad — information + constraints, not rigid step sequences
- Config.json pattern: ask once, store, reuse forever
- Compose skills by natural language reference, not formal dependency management
- Log previous runs so the skill has history next time

## Skills as Folder Bundles

> "Think of the entire file system as a form of context engineering and progressive disclosure."

- A skill is a folder, not just a markdown file: `SKILL.md` + `scripts/` + `references/` + `assets/`
- `SKILL.md` loads into context on selection. `references/` loads via Read. `assets/` is path-referenced only.
- This is a material distinction for token management — not all skill content needs to be in context at once.
- Skills pre-approve scoped bash commands via `allowed-tools` (e.g., `Bash(git:*)`)

## PreToolUse Safety Hooks

> Skills can block dangerous commands via PreToolUse matchers.

- `PreToolUse` hooks intercept tool calls before execution — pattern match on command strings
- Use for session-scoped safety: block `rm -rf`, `DROP TABLE`, force-push, `kubectl delete`
- `/careful` and `/freeze` patterns — activate per-session guardrails via skill invocation
- Hooks also enable telemetry: log which skills fire, from what prompts, for trigger accuracy analysis

## Subagent Design

> "Subagents are useful for two main reasons. First, they enable parallelization... Second, they help manage context: subagents use their own isolated context windows, and only send relevant information back to the orchestrator."

- Two purposes: **parallelization** (multiple tasks at once) and **context isolation** (don't pollute the parent)
- Subagents return excerpts, not full context — the orchestrator stays lean
- Prefer subagent dispatch over model switching mid-session (switching breaks cache)
- Use for: lightweight recall queries, format conversions, triage decisions, parallel research

## Code as Agent Output

> "Code is precise, composable, and infinitely reusable, making it an ideal output for agents."

- Agents shouldn't just *run* code — they should *generate* code as their primary output
- Generated code handles complex formatting (Excel, PowerPoint, Word) better than tool-by-tool approaches
- Bash + code generation = download, convert, search, transform in a single composed pipeline
- Code on disk is verifiable state — read it back, lint it, run it

## Tool Design

> "Even the best designed tool doesn't work if Claude doesn't understand how to call it."

**Mindset shift:** Tools are contracts with non-deterministic agents, not APIs for developers. Agents may hallucinate, ask clarifying questions, or misuse tools entirely — design for that.

- Design tools Claude *wants* to use — watch for tool avoidance
- Sweet spot between too rigid and too freeform
- As models improve, revisit whether old tools are now constraining
- Use tools to model state transitions (like plan mode) rather than changing the tool set

### Fewer Tools, Better Tools

> "More tools don't always lead to better outcomes. Too many tools or overlapping tools can distract agents from pursuing efficient strategies."

- Don't wrap every API endpoint as a tool — consolidate into high-impact actions
- Search-first over list-all: `search_logs` returning relevant lines beats `read_logs` dumping everything
- Consolidation examples: replace `list_users` + `list_events` + `create_event` with a single `schedule_event`
- Namespace tools to prevent confusion: `asana_projects_search`, `jira_search` (prefix by service or resource)

### Meaningful Context in Responses

> "Resolving arbitrary alphanumeric UUIDs to more semantically meaningful language significantly improves Claude's precision in retrieval tasks by reducing hallucinations."

- Return human-readable fields (`name`, `file_type`) over raw identifiers (`uuid`, `mime_type`)
- Include only fields the agent needs for its next action — not every field the API returns
- Add a `response_format` enum parameter so agents can control verbosity (detailed for chained calls, concise for display)

### Token-Efficient Tool Responses

- Implement pagination, range selection, filtering, truncation with sensible defaults
- Include steering messages in truncated responses: "Consider making multiple targeted searches rather than one broad search"
- Error responses must be actionable: show expected parameter format, not stack traces
- Claude Code caps tool responses at 25K tokens by default — design under that constraint

### Tool Descriptions as Prompt Engineering

> "Small refinements to tool descriptions can yield dramatic improvements."

- Think of describing a tool to a new team member — make implicit context explicit
- Parameter naming matters: `user_id` not `user`, `start_date` not `date`
- Avoid ambiguity through strict data models and clear enums
- Prototype → eval → analyze transcripts → optimize descriptions with Claude → repeat

### Eval-Driven Tool Iteration

> "What agents omit in their feedback and responses can often be more important than what they include."

- Write realistic eval tasks, not toy examples ("schedule a meeting with Jane and attach last week's notes" not "schedule meeting with jane@acme.corp")
- Collect: accuracy, runtime, token consumption, tool error rates, call frequency patterns
- Review agent reasoning transcripts — look for what the agent *didn't* do
- Hold out test sets to prevent overfitting to training evals
- Concatenate eval transcripts → paste into Claude for automatic analysis and optimization

## Prompt Caching

> "Cache Rules Everything Around Me."

- Static content first, dynamic content last
- Never add/remove tools or change models mid-session
- Use messages for updates, not system prompt changes
- Fork operations (compaction, subagents) must share the parent's prefix
- Monitor cache hit rate like uptime

## Verification

> "Three evaluation approaches: rules-based feedback through code linting, visual feedback for UI-related tasks, LLM-as-judge for subjective quality assessment."

- Rules-based: frontmatter linting, format validation, schema checks — deterministic, scriptable
- Visual: playgrounds, screenshots — particularly valuable for ADHD
- LLM-as-judge: subagent critiques output before writing

## Spec → Fresh Session

> "Start with a minimal spec or prompt and ask Claude to interview you using the AskUserQuestionTool. Then make a new session to execute the spec." (14.6K bookmarks)

- Plan in one session, execute in a fresh one
- Clean context, better cache utilisation
- The spec on disk IS the state — survives session boundaries

## Diagnostic Framework

When an agent fails, ask four questions:
1. Missing information → add to skill or progressive disclosure
2. Repeated error → add to gotchas section
3. Wrong tool → redesign tool or add a new one
4. Performance drift → build an eval
