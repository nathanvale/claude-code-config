# Recovery Workflow

Read after a complete bounded scan. The CLI owns exact fields, classifications,
parser behavior, reconciliation, and repair output. Inspect `--help` and runtime
results instead of copying those contracts here.

## Two Passes

1. Group sessions pursuing the same result in the same area.
   - Treat delegated, duplicate, and supporting sessions as evidence.
   - Treat harness, title, branch, and worktree as hints, not identity.
   - Cite native session IDs.
   - Show conflicts and refuse weak merges.
2. Classify every ledger row.
   - Project candidate: bounded result with a clear start, one goal, and
     observable completion.
   - Completed standalone: useful finished work that does not justify a
     project packet.
   - Supporting or duplicate: evidence assigned to one work group.
   - Test, noise, or unclear: accounted for but not promoted.

Derive the human summary from the ledger. Never maintain a second count.

## Current-State Check

- Review active useful candidates first.
- Search the configured vault for an existing canonical owner.
- Inspect live repositories, branches, plans, pull requests, and completion
  evidence before repeating historical status.
- Reuse the existing project for the same goal.
- Stop when two canonical owners remain plausible.

## Candidate Gate

Run ledger validation before grilling. Repair every missing, duplicate,
unavailable, or invalid row first.

Grill one candidate at a time. Confirm:

- overall goal;
- included and excluded sessions;
- canonical owner or exact proposed target;
- finished work and remaining work;
- observable completion evidence;
- first next action.

Use the configured vault's current proposal contract, document types, and
templates. Show the exact operation, target, source handles, evidence reason,
confidence, uncertainty, and privacy warning.

## Promotion Rules

A completed project packet needs one bounded goal, meaningful sources,
completion proof, and future retrieval value. Session count alone adds no
weight.

An inbox capture needs one distinct idea, at least one strong source handle,
plausible future use or ownership, and no canonical match. Keep vague or
duplicate thoughts in the audit only. One capture represents one idea;
supporting sessions remain evidence.

Keep approved project packets as front doors. Link repository truth, plans,
research, decisions, and completion evidence. Keep raw histories outside the
vault.

## Review Actions

- Yay: apply only the displayed proposal after rechecking the target and vault
  rules.
- Nay: close the proposal in the private audit; create no vault note.
- Defer: retain the unresolved proposal outside the vault with its source IDs
  and hashes; create no vault note.
- Details: inspect more bounded evidence; create no vault note.

After Yay, verify the scoped write and report its canonical path. A created
inbox capture moves only through a later approved and validated owner change.
