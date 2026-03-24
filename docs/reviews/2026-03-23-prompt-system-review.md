---
title: "Prompt System Review"
type: review
status: complete
updated: 2026-03-23
summary: "Review of the prompt-fragment system, focusing on cross-harness leakage, stale runtime abstractions, and prompt-boundary hygiene. Verdict: mixed."
related:
  - docs/specs/prompt-system.md
  - docs/research/2026-03-23-agent-prompt-best-practices.md
  - docs/decisions/2026-03-22-non-inferable-filter-for-sizing.md
review_target: prompt-fragments/, scripts/render-user-prompts.sh, generated startup prompts
review_scope: system
verdict: mixed
---

# Prompt System Review

## Context

This review evaluates the shared, Claude-only, and Codex-only prompt surfaces in this repo.

The goal was not to question the fragment-render architecture itself. The review focused on whether the system was using that architecture well:

- are shared prompts truly cross-harness
- are runtime-specific mechanics kept in harness-specific layers
- do rendered prompts stay lean and non-inferable
- do Claude and Codex receive comparable governance where intended

The render pipeline itself was healthy at review time:

```bash
./scripts/render-user-prompts.sh --check
```

## Review Target

The review covered:

- `prompt-fragments/shared/`
- `prompt-fragments/claude/`
- `prompt-fragments/codex/`
- `scripts/render-user-prompts.sh`
- the rendered outputs consumed by Claude and Codex

## Criteria

The system was reviewed against this bar:

1. shared prompts should express behavior and policy, not harness-specific invocation syntax
2. harness-specific files should own runtime mechanics
3. prompts should follow the non-inferable filter
4. shared governance should be mirrored across harnesses when the behavior is genuinely shared
5. the shell-based fragment workflow should stay simple and maintainable

## Findings

### 1. The fragment-render architecture is strong

The underlying architecture was already a good fit for community best practices:

- modular rather than monolithic
- small shell-based composition
- clear shared vs harness-specific separation
- drift checks and rendered output verification

The review did not find evidence that the fragment system or shell renderer should be replaced.

### 2. Shared prompts were carrying Claude-specific mechanics

Before cleanup, shared prompt content included Claude-branded syntax and paths. That meant Codex inherited instructions that were not native to Codex.

This was the clearest prompt-boundary problem:

- the shared layer was answering both "what should happen" and "how Claude does it"
- Codex then received parts of Claude's interface model

### 3. Some shared rules used stale or brittle runtime abstractions

The previous shared wording used exact runtime nouns like `ultrathink/think` and `AskQuestion`, and the Codex guidance included stale abstractions such as `shell_command`.

That increased drift risk because the prompt was teaching the runtime interface instead of the behavior.

### 4. Shared governance was uneven across harnesses

Claude had stronger governance through rules, especially around Memory OS routing, while Codex mostly got location hints.

That asymmetry was small but meaningful because governance is one of the few things that really belongs in shared startup context.

### 5. The non-inferable filter was only partly enforced

The repo had a strong ADR for prompt sizing and non-inferable content, but some shared fragments still included concrete syntax and tool-specific detail that should have lived elsewhere.

The issue was not architecture drift. It was content discipline drift.

## Open Questions

- Should review notes become a standard output for other audit-like workflows in this repo?
- Should the prompt system eventually add a dedicated smoke test for stale runtime nouns in harness-specific fragments too, not just shared fragments?

## Verdict

Mixed.

The prompt system architecture was already good and worth keeping. The main issues were prompt hygiene and boundary discipline inside the shared layer, not the render model itself.

## Follow-ups

- Keep shared prompts checklist-oriented and interface-neutral
- Keep harness-specific invocation syntax out of `shared/`
- Maintain prompt hygiene checks in the render workflow
- Use this note as the first canonical `type: review` example in the Memory OS system
