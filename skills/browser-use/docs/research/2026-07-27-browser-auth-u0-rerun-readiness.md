---
date: 2026-07-27
topic: browser-auth-u0
kind: research-evidence
status: upstream-change-required
classification: upstream-change-required
---

# Browser Authentication U0 Rerun Readiness

## Result

`upstream-change-required`

Do not create `runtime/browser-use-security/` or rerun the legacy ad-hoc
fixture on this machine.

## Gate Evidence

| Gate | Observed | Result |
|---|---|---|
| Full Xcode | Command Line Tools active; `Xcode.app` absent | blocked |
| Stable signing identity | zero valid code-signing identities | blocked |
| Provisioning profile | no product profile supplied or admitted | blocked |
| Notarization pipeline | unavailable without full Xcode and an admitted credential profile | blocked |

The paid Apple Developer Program prerequisite remains an operator action.
Developer ID Application identity plus a stable restricted-entitlement profile
are its mechanical downstream evidence.

## Design Review

- Keep U3b whole under `runtime/browser-use-security/`.
- Start no native scaffold before ADR 0028's entry gate passes.
- Keep Approval Broker, Token Retrieval Launcher, and Confidential Field
  Delivery XPC as separately signed targets in one product.
- Require an app-like Token Retrieval Launcher with an embedded provisioning
  profile and private `keychain-access-groups` entitlement.
- Keep raw-secret custody split: launcher has no browser channel; delivery has
  no OP token or network entitlement.
- Treat `authTokenRetrieval` production wiring and field-level
  `supported_methods` projection as U3b integration obligations.

The existing
`skills/browser-use/src/fixtures/browser-auth-u0/run-fixture.ts` cannot produce
the target receipt. It ad-hoc-signs its temporary bundles, permits an
inherited-descriptor fallback, and correctly reports `sandbox_enforced=false`.
Re-running it would repeat the 2026-07-23 evidence rather than admit U3b.

## Prepared Rerun Gate

Use `browser-auth-u0-rerun.sh` only after the operator prerequisites exist:

```bash
skills/browser-use/docs/research/browser-auth-u0-rerun.sh \
  --provisioning-profile /absolute/path/to/profile.provisionprofile \
  --notary-keychain-profile browser-use-security-notary \
  -- /absolute/path/to/product-owned-u0-probe
```

The script:

- emits redacted JSONL gate evidence;
- requires active full Xcode and `notarytool`;
- requires a Developer ID Application identity;
- decodes the explicit profile and requires Team-bound keychain groups plus
  more than 30 days remaining validity;
- proves notarization service access through an explicit Keychain profile;
- dispatches the exact product-owned probe argv only after every gate passes;
- never builds, signs, or invokes an unsigned or ad-hoc substitute.

The product-owned probe remains intentionally unspecified until U3b owns its
native admission manifest and executable contract. Do not make the research
script a second native-product Interface.

## Next Safe Action

Enroll in the paid Apple Developer Program. Install full Xcode. Acquire the
stable Developer ID identity, restricted-entitlement provisioning profile, and
notarization Keychain profile. Then rerun this gate before creating the U3b
product scaffold.
