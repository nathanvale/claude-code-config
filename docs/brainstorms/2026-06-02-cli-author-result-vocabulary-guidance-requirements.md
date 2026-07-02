---
date: 2026-06-02
topic: cli-author-result-vocabulary-guidance
title: "cli-author guidance for package-owned result vocabulary"
type: brainstorm
issue: 155
---

# cli-author guidance for package-owned result vocabulary

## Summary

Update cli-author docs so agents catch package-owned result vocabulary while respecting facade
ownership. Keep guidance tiny: teach ownership boundaries, update PR #76 stale wording, and cite
Browser Adapter Proof as a pattern without copying its values.

## Problem Frame

PR #76 moved several facade candidates into runtime-backed enforcement. Existing cli-author guidance
still frames baseline exits, diagnostic capability, diagnostic trail pointer, and write preview as
mostly declarative or candidate-level.

Browser Adapter Proof showed a second gap: agents can push package-owned result vocabulary into
generic docs or contracts instead of keeping stable values beside the package result contract.

Need docs that help an agent ask: "who owns this literal?" before emitting guidance, schemas, tests,
or adapters.

## Key Decisions

- **Choose tiny Approach B.** Add guidance plus a small Browser Adapter Proof pattern citation.
  Stronger than abstract policy alone; lighter than schema work.
- **No facade schema extension.** Do not add global result vocabulary registry or `resultVocabulary`
  field until at least two packages need pre-run vocabulary discovery.
- **One owner per contract.** Facade owns shallow metadata and runtime-backed affordances. Package
  owns result vocabulary, result member meaning, recovery semantics, and diagnostic event names.
- **Docs compose.** `skills/cli-author/SKILL.md` routes. Existing refs teach. No new parallel
  reference unless current refs become noisy.

## Requirements

**Runtime sync**

- R1. Update cli-author wording for PR #76 runtime-backed affordances: baseline exits, diagnostic
  capability, diagnostic trail pointer, and write preview capability.
- R2. Keep "declare, don't enforce" wording only where still true, such as output modes,
  interactivity, and environment variables.
- R3. Baseline `exitCodes` guidance must require `"0"`, `"1"`, and `"2"` as facade-owned keys;
  extra numeric codes stay package-owned.

**Package-owned result vocabulary**

- R4. `agent-native-cli-design.md` must distinguish facade-owned contract shape, package-owned
  result vocabulary, and private implementation detail.
- R5. `cli-command-facade.md` must add a compact package-owned result vocabulary note near
  `resultContract`.
- R6. Guidance must tell agents to export stable package-owned result literals, constants, or types
  beside the package's `CommandFacadeContract` implementation when those literals appear in `data.*`,
  adapter outputs, diagnostics, tests, or docs.
- R7. Guidance must avoid listing package-specific literal values in cli-author prose.

**Diagnostic and mutation boundaries**

- R8. Diagnostic trail guidance must describe same-run `diagnostic_trail` pointer to a diagnostic
  capability, without inventing raw logs, trace URLs, retention, access, or platform policy.
- R9. Write preview guidance must reflect runtime enforcement for honest `write` and `destructive`
  side effects: check, dry-run, or justified safe-text preview exemption.
- R10. Guidance must preserve the side-effect declaration boundary: facade enforcement depends on
  honest command metadata, not route-name inference or generic mutation vocabulary.

**No parallel policy**

- R11. `skills/cli-author/SKILL.md` may route to references, but must not duplicate the facade
  reference body.
- R12. Examples must teach judgment, not full schemas, allowed-value lists, or runtime envelopes.

## Scope Boundaries

- In scope: update `skills/cli-author/references/agent-native-cli-design.md`.
- In scope: update `skills/cli-author/references/cli-command-facade.md`.
- In scope: update `CONTEXT.md` only if "package-owned result vocabulary" becomes durable glossary
  language.
- In scope: cite Browser Adapter Proof as pattern, not as copied values.
- Out of scope: facade API/schema changes.
- Out of scope: generic facade enum registry or global result vocabulary field.
- Out of scope: full JSON schema generation or contract-to-spec round trip.
- Out of scope: Browser Adapter Proof refactor.
- Out of scope: listing Browser Adapter Proof statuses, source labels, diagnostic codes, or result
  members in cli-author prose.
- Out of scope: new reference file unless existing refs become materially noisy.

## Acceptance Examples

- AE1. **Covers R1-R3.** Given cli-author docs mention baseline exits, when an agent reads them after
  PR #76, then `"0"`, `"1"`, and `"2"` are described as runtime-backed facade requirements, and
  extra numeric exits are package-owned.
- AE2. **Covers R4-R7.** Given a package has stable `data.*` status strings, source labels, or
  diagnostic labels, when cli-author guidance covers result contracts, then it directs the agent to
  package-owned constants/types beside the contract implementation, not to generic facade prose.
- AE3. **Covers R8-R10.** Given a mutating command has diagnostics, when docs describe the facade
  boundary, then write preview and diagnostic trail are runtime-backed affordances, while trail
  storage, access, and diagnostic event vocabulary stay package-owned.
- AE4. **Covers R11-R12.** Given a reviewer checks the docs, then no new hand-maintained list
  restates facade field shapes, validator categories, result envelope members, or package-specific
  result values.

## Success Criteria

- `rg "does NOT judge sensible exit codes|contract candidate" skills/cli-author/references CONTEXT.md`
  has no stale hits for runtime-backed PR #76 affordances.
- Docs contain a clear "package-owned result vocabulary" phrase or equivalent canonical term.
- Browser Adapter Proof appears only as a pattern citation.
- No doc uses absolute paths.
- Issue #155 can move from brainstorm to plan without inventing scope or ownership rules.

## Sources / Research

- GitHub issue: https://github.com/nathanvale/claude-code-config/issues/155
- Merged upstream context: https://github.com/nathanvale/side-quest-engineering/pull/76
- `skills/cli-author/references/agent-native-cli-design.md`
- `skills/cli-author/references/cli-command-facade.md`
- `CONTEXT.md`
- `docs/adr/0009-cli-author-uses-bounded-local-extension.md`
- `docs/adr/0010-skill-examples-teach-judgment-not-contracts.md`
