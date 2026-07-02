---
title: "claude-code-config → harness-agnostic Agent Skills repo (no plugins)"
type: brainstorm
status: seed
updated: 2026-05-30
summary: "Pivot claude-code-config from a Claude-Code-specific repo into a harness-agnostic Agent Skills repo (Claude Code + Codex + Cursor), distributed steipete-style via git-clone + symlink, deliberately WITHOUT the plugin concept. Plugins = vendor lock-in Nathan doesn't want. Captures fact-checked 2026 research + the every-marketplace/compound-engineering teardown that proves a plugin is just a ~20-line manifest, not a container."
related:
  - AGENTS.md
  - CLAUDE.md
  - install.sh
  - skills/browser-use/PROVENANCE.md
  - prompt-fragments/
---

# Agent Skills repo, no plugins (seed)

This is a SEED, not a plan. It locks the research + the one strong opinion ("no plugins, no vendor
lock-in") and leaves structural decisions open for a real `/ce-brainstorm` or `/ce-plan` pass.

## The thesis

Stop treating this as a *Claude Code* repo. Make it a **vendor-neutral Agent Skills repo** that
Claude Code, Codex, and Cursor all consume from one source. Distribute the steipete way: public git
repo, MIT, consumers `git clone` + symlink (or sparse-checkout one skill). **No plugins. No
`marketplace.json`. No vendor manifests.**

Nathan's hard preference: *simplicity + no vendor lock-in.* "Plugin" is a vendor primitive; he does
not want the concept at all.

## Why this is viable now (fact-checked 2026 research)

- **Agent Skills (`SKILL.md`) is an open standard** — released by Anthropic Dec 2025, adopted by
  Codex, Cursor, VS Code, Gemini CLI, JetBrains Junie, AWS Kiro, Goose. The *base* `SKILL.md` is
  portable across all of them.
- **Caveat (verified against Claude Code docs):** Claude Code *extends* the standard with
  invocation control, subagent execution, and dynamic context injection. Base SKILL.md is portable;
  **the extensions are not.** A skill leaning on Claude-only frontmatter degrades on Codex.
- **AGENTS.md is Linux-Foundation-governed** (Agentic AI Foundation), 60,000+ repos, read natively
  by Codex / Cursor / Gemini / Copilot / Devin / Windsurf / Aider. **Claude Code does NOT yet read
  AGENTS.md natively** (open issue anthropics/claude-code#31005) — which is exactly *why* this repo
  already renders `AGENTS.md → CLAUDE.md` from `prompt-fragments/`. We've been working around this
  gap from the start.
- **Codex skill paths:** repo-level primary convention is `.agents/skills/`; user-global is
  `~/.codex/skills`. Claude Code user-global is `~/.claude/skills`.

## Winning community pattern (highest engagement)

@cathrynlavery (464 likes — the most-engaged post in the research):

> "Don't put skills inside each agent folder. Keep them in a `~/.agents` GitHub repo — skills,
> hooks, prompts all live there. Every agent symlinks in specific skills. One skill updated = every
> agent and machine updated instantly."

That is the steipete `agent-scripts` model, which Nathan already consumes from. Reinforced by:

- @grok: `ln -s ~/.claude/skills ~/.codex/skills` — "quickest path."
- hamy.xyz Core/Shell: `AGENTS.md` = source of truth; `CLAUDE.md` imports `@AGENTS.md`;
  `.claude/skills/` symlinks to `agents/skills/`. **(This repo already does the CLAUDE.md imports
  @AGENTS.md half.)**
- agensi.io: copy / symlink / shared-repo-clone+symlink — three methods, symlink is the lean one.

## The plugin teardown (why "no plugins" is the leaner choice, not the lossy one)

Inspected `every-marketplace/compound-engineering@3.9.3` on disk. It supports Codex — here's how:

```
compound-engineering/3.9.3/
  skills/            ← vendor-neutral SKILL.md (the value)
  agents/            ← sub-agent defs (Claude-native; Codex needs a converter)
  .claude-plugin/plugin.json   ← ~20 lines of JSON
  .codex-plugin/plugin.json    ← ~20 lines of JSON
  .cursor-plugin/plugin.json   ← ~20 lines of JSON
```

Findings:

- A "plugin" is **not a lock-in container.** It's a ~20-line JSON manifest pointing at
  `skills: ./skills/`. compound-engineering ships ONE `skills/` + `agents/` with THREE thin
  per-vendor manifests. Same content, three pointers.
- For the non-portable part (sub-agents), the Codex manifest says: *"run the companion Bun converter
  after install"* — they translate Claude sub-agents into Codex format at install time. **Honest
  about the boundary** rather than pretending sub-agents are portable.

Conclusion: the steipete symlink model ships **identical `skills/` content with ZERO vendor
manifests.** It loses only marketplace discoverability — which Nathan explicitly doesn't want. So
for "simplicity + no lock-in," dropping plugins is *strictly leaner*, not a sacrifice.

## The REAL fault line (not plugin-vs-no-plugin)

The boundary that actually matters: **does a skill spawn sub-agents or call `mcp__` tools?**

**Portable tier** — base `SKILL.md`, works Codex + Claude Code + Cursor:
browser-use, one-password, cli-author, draft-message, context7-mcp, confluence-pages, capture,
work-style-convert, and most domain/utility skills.

**Claude-dependent tier** — sub-agents or `mcp__`, degrades on Codex without a converter:
harden-implementation (spawns reviewers), newsroom-investigate (beat-reporters), issue-to-pr,
runbook-orchestrator, productivity-sync.

This is the line to design around — *not* "should I use plugins."

## Second research pass — community practice + sub-agent escape hatches (2026-05-30)

Deeper newsroom pass. Centered the anti-plugin / pure-symlink angle and the sub-agent portability gap.

### Community converged on exactly this plan

The "central repo → symlink → every harness" pattern is the **dominant** community approach, not a
fringe one. Independently repeated by ~a dozen practitioners (@ianzepp, @syssignals, @artpi,
@deriegle, @kaushikgopal, @tonkapark — the last links steipete `agent-scripts`). They reject plugins
for the same three reasons stated above: lock-in, security (a symlinked third-party npm package =
live write channel on every push — @aabyzov, mitigate via pinned SKILL.md hash + install-time diff),
and simplicity (markdown in git needs no runtime/registry).

### `.agents/skills/` is the symlink target to adopt (verified)

`agentskills.io` documents `.agents/skills/` as a "widely-adopted convention for cross-client skill
sharing" — skills there are auto-visible to any compliant client (Claude Code, Codex, Cursor,
Gemini, Windsurf). Both project-level `.agents/skills/` and user-level `~/.agents/skills/`.
Qualification: convention, **not** a mandated standard. Implication: `install.sh` should target
`.agents/skills/` first; per-vendor symlinks become fallback, not primary.

### Fact-check corrections to the first pass

- ❌ **"Codex 8 KB skill cap" is FALSE.** Real Codex limit = **1024-char `description` field**. (Our
  AGENTS.md already caps descriptions at 320ch — comfortably under.) Note: wshobson docs *claim* an
  8KB cap; treat as their own enforcement choice, not a Codex rule.
- ⚠️ **Codex sub-agents:** real, but GA **May 2026** (not March); primitives are
  `spawn_agent`/`wait_agent`/`send_input`/`resume_agent`/`close_agent` (not `send_message`). Protocol
  **differs** from Claude → `agents/*.md` don't port directly. No standard converter exists.

### The two sub-agent escape hatches (for the Claude-dependent tier)

**Hatch A — dispatcher (`shinpr/sub-agents-skills`):** one neutral `.agents/*.md` with `run-agent:`
frontmatter; SKILL.md tells the AI to call `run_subagent.py`, which shells out to the named CLI
(codex/claude/cursor/gemini). Plugin-free, symlink-friendly. Costs: **adds Python** (we prefer
bun/TS), sub-agents run **isolated, no shared state** (so multi-step orchestrations like
harden's iterating reviewers or newsroom's parallel beat-reporters→synthesizer don't translate as
true workflows, only as single spawns).

**Hatch B — generator (`wshobson/agents`):** one markdown source, `make generate-all` emits native
per-harness artifacts. Powerful, idiomatic everywhere — but it's a **build system that GENERATES
plugins** (the thing we're escaping) and still ships `marketplace.json`. Opposite of the lean ethos.

**Hatch C — don't port (community lean wing, e.g. @amadad/@ianzepp):** keep portable tier on
symlinks; let orchestration stay **Claude-native by choice**. Zero deps, zero machinery. Most
aligned with "ask before adding deps" + simplicity. Cost: those skills simply don't run on Codex.

Decision: **DEFERRED.** Recorded for the real plan. Leaning signal (not locked): Hatch C is the
leanest and most ethos-aligned; Hatch B is ruled out for this repo.

## Decisions already locked

- Distribution: **git clone + symlink (steipete). No plugins. No marketplace.json.** MIT.
- PROVENANCE on export — mirror of how imported skills (browser-use etc.) already carry
  `PROVENANCE.md` + `LICENSE.upstream`. When a skill leaves to another repo, it gets the same note.
- Frame: vendor-neutral by choice. The plugin concept is out.

## Open questions (do NOT decide here — for the real brainstorm/plan)

1. **Multi-harness install:** `install.sh` should symlink into **`.agents/skills/`** as the primary
   cross-tool target (auto-visible to compliant clients), with `~/.claude/skills` / `~/.codex/skills`
   as fallback. Confirmed direction; mechanics TBD.
2. **AGENTS.md as source of truth:** keep the rendered `AGENTS.md → CLAUDE.md` prompt-system, or
   lean harder on AGENTS.md as canonical now that Codex reads it natively? Tension with the existing
   `prompt-fragments/` render pipeline.
3. **Rename** `claude-code-config` → `agent-skills` (or similar)? Defer — cosmetic, do last.
4. **Sub-agent tier (DEFERRED):** Hatch A (shinpr dispatcher, adds Python) / Hatch B (wshobson
   generator, ruled out — generates plugins) / Hatch C (don't port, Claude-native by choice — leanest).
   See "Second research pass" above. Lean: C.
5. **`validate-skills` linter:** steipete has one; this repo doesn't (dir-convention discovery only).
   Add one that YAML-parses every `SKILL.md` and flags Claude-only frontmatter on skills tagged
   portable — enforces the portable/Claude-dependent split mechanically.

## Sources (engagement-ranked, fact-checked this session)

- @cathrynlavery (464 likes) — `~/.agents` repo + symlink pattern
- @grok — `ln -s ~/.claude/skills ~/.codex/skills`
- agents.md / Linux Foundation press — AGENTS.md governance + 60k repos (verified)
- anthropics/claude-code#31005 — Claude Code AGENTS.md support pending (verified)
- developers.openai.com/codex/skills — Codex Agent Skills + `.agents/skills/` path (verified)
- hamy.xyz, agensi.io, morphllm.com — cross-harness sharing methods
- on-disk teardown: `every-marketplace/compound-engineering@3.9.3` `.claude/.codex/.cursor-plugin/`
