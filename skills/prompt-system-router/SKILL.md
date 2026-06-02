---
name: prompt-system-router
description: "Classify startup-instruction changes. Routes hot rules, runtime mechanics, owner docs, and deterministic checks."
disable-model-invocation: true
---

# Prompt System Router

## Purpose

Answer where instruction changes belong without recreating a routing table.

## Authority

- Decision: `docs/adr/0011-lean-startup-instructions.md`
- Vocabulary: `CONTEXT.md`
- Health contract: `scripts/agent-instructions.sh`

## Classification

- Startup hot rule: edit `AGENTS.md`.
- Claude runtime mechanic: keep `CLAUDE.md` tiny, only when runtime proof requires it.
- Codex runtime mechanic: prefer config/rules/docs; keep startup note tiny only when needed.
- Tool workflow: edit owning `skills/*/SKILL.md`.
- Deep reference: edit `context/`, `docs/`, or skill `references/`.
- Deterministic contract: move to code, CLI help, generated docs, or runtime checks.
- Repo-specific fact: keep in repo-local `docs/agents/`, not global startup.
- Personal lookup fact: `context/personal.md` or memory docs.

## Misroutes

- Generated prompt artifact edited as source.
- Workflow mechanics copied into `AGENTS.md`.
- Repo path, issue tracker, or triage facts added to global startup.
- Deterministic tables repeated in prose.
- Runtime appendix used as second handbook.

## Output

- Surface
- Owner
- Verification
- Risk
