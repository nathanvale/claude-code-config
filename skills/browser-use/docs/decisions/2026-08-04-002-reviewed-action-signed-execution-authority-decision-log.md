---
title: Signed execution authority for Reviewed Actions
slug: reviewed-action-signed-execution-authority
type: decision-log
status: accepted
date: "2026-08-04"
timezone: Australia/Melbourne
owner: browser-use
---

# Signed execution authority for Reviewed Actions

Browser Use will treat ApprovalBroker-signed promotion as the sole execution
authority for a Reviewed Action. Unsigned historical approval claims remain
Legacy Promotion Evidence: readable and migratable, but never executable.

## Decision

- Refuse execution when only Legacy Promotion Evidence exists.
- Return `action_promotion_authority_missing` before loading action bytes or
  constructing a browser step.
- Require fresh per-action ApprovalBroker promotion before execution.
- Never automatically sign, wrap, or convert Legacy Promotion Evidence.
- Preserve legacy evidence for inspection and migration.
- Keep the public operator promotion front door outside PR #303.

## Considered alternatives

- Temporary unsigned execution was rejected because it preserves two authority
  paths and requires a security-sensitive cutoff mechanism.
- Permanent legacy execution was rejected because an unverifiable claim cannot
  prove current approval authority.
- Automatic receipt wrapping was rejected because it would convert evidence
  into authority without fresh human approval.
- Adding a privileged promotion CLI to PR #303 was rejected to keep this fix
  limited to closing the runtime bypass.

## Consequences

- Retained legacy catalogs remain inspectable and available for migration.
- Legacy actions fail closed until separately re-promoted.
- The current operator promotion transaction remains internal until a separate
  front-door decision ships it.
