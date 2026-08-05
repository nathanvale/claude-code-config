# Reviewed Action authoring contract findings

Lane: `prototype` logic. No browser (existing FastTrack actions own execution
evidence; post-build will require Agent Chrome acceptance). No tests. Full state
printed after every action.

Reuses the SHIPPED action mechanics from `browser-use-runbook-actions.ts`
(`actionAssetDigest` sha256 content-addressing, `actionDigestIsValid`,
`auditActionEffectClass` mechanical effect audit, `ONCORE_DRAFT_VERIFICATION_ACTION_BYTES`
as a proven observational example) rather than reinventing them.

## Question

Can an agent discover, author, validate, and apply custom business JavaScript
while an external human promotion remains the sole authority that makes the exact
digest referenceable by a Runbook (ADR 0033)?

## Exact call sequence

```text
cd skills/browser-use
bun run prototype:reviewed-action-authoring
```

One command drives: `action schema --json`, validate (valid + credential-bearing),
apply (unpromoted candidate), self-promotion refusal, pre-promotion reference
refusal, human promotion, valid reference, byte-change invalidation, and the full
set of reference refusals.

## Results (verdict: PASS — 12/12)

| Scenario | Outcome |
| --- | --- |
| `action schema --json` | Exposes wrapper shape, origin, effect class (audited), input/result schema, postcondition, minimal example |
| validate valid observational action | ok; effect class `read` (real audit) |
| validate action carrying credentials | Refused with precise repair; credentials forbidden |
| apply | Writes an UNPROMOTED candidate with a sha256 content digest; zero promotions |
| agent/self promotion | Refused; external human is sole authority |
| runbook reference before promotion | Refused `action-unpromoted` |
| external human promotion | Binds exact digest, origin, effect, postcondition, approval reference |
| runbook reference by id + exact promoted digest | Resolves |
| re-apply changed bytes | Prior promotion invalidated; new candidate unpromoted |
| reference OLD digest after byte change | Refused `action-unpromoted` |
| reference absent action | Refused `action-absent` |
| reference wrong origin | Refused `wrong-origin` |
| reference auth/credential-capable action | Refused `auth-capable-action-refused` |

## What this proves

- The authoring front door layers cleanly on shipped content-addressing + effect
  audit; no parallel digest or effect logic is needed.
- Authoring and validation are agent-capable; promotion is not. Self-promotion is
  refused; only an external human approval binds a digest.
- Promotion binds the EXACT bytes. Any byte change (even an appended comment)
  invalidates the prior promotion — and here the real `auditActionEffectClass`
  correctly flipped the edited bytes from `read` to `mutation`, because the
  appended comment no longer matches the bounded observational proof. The audit is
  mechanical, not a stub.
- A Runbook may reference only a promoted id + exact digest, and only for a
  non-credential action at the matching origin. Absent, unpromoted, stale,
  wrong-origin, and auth-capable references all refuse.
- No inline JavaScript enters the Runbook Draft; credential/login content is
  refused at validation.

## Limits

- In-memory front door; no real private-source filesystem, Git, or promotion
  registry persistence.
- Reference resolution here is the authoring/promotion gate, not action execution.
  The FastTrack actions and `browser-use-runbook-actions.test.ts` own execution
  evidence; post-build acceptance against Agent Chrome remains required.
- `auth_capable` is a prototype flag standing in for the real credential/login
  detection at the execution boundary.

## Plan effect

- Confirmed: Reviewed Action authoring (dependency-order item 3) is a coherent
  prerequisite for Private Runbook authoring. Acceptance criteria: schema exposes
  wrapper/origin/effect/schemas/postcondition/example; agent authors + validates;
  apply writes an unpromoted digest; self-promotion refuses; human promotion binds
  exact bytes + approval; byte change invalidates; runbook reference passes only on
  promoted id + exact digest + matching origin + non-credential; absent /
  unpromoted / stale / wrong-origin / auth-capable refuse.
- Confirmed: reuse the shipped `actionAssetDigest` and `auditActionEffectClass` —
  do not build a second digest or effect model.
- Open (named): real private-source persistence + promotion registry, and
  post-build Agent Chrome execution acceptance for a newly authored action.
