# PROTOTYPE — build-scratch handoff + capture (throwaway, delete me)

**Question being answered:** Does the choreography "browser-use hands off a
redacted summary → `build-scratch` CLI constructs redacted Recorder-shaped JSON
on disk" hold up as a data shape, and do the **two redaction gates** behave?

This is a state / business-logic / data-shape prototype (per `/prototype`
LOGIC branch). It is NOT production code. No tests, no error handling beyond
runnable, no persistence (writes go to a temp dir).

## Run

```
bun prototypes/build-scratch-handoff/tui.ts
```

Drive it by hand. Press keys to load different fake handoffs and watch:
- the redacted handoff payload that crossed the skill boundary (Gate 1 output)
- the Recorder-shaped JSON `build-scratch` would emit
- Gate 2 fail-closing the whole batch when a typed secret slips through, naming
  the offending entry

## The two gates

- **Gate 1** lives in `browser-use` (`skills/browser-use/SKILL.md:113`, "return
  shape only"). It runs *before* the boundary — a raw typed secret (`hunter2`)
  must never reach this prototype. Modelled here by `handoff.ts` fixtures: the
  "good" handoffs already carry `redacted:password-field`, never `hunter2`.
- **Gate 2** lives in `build-scratch` (`redaction.ts`). Fail-closed: a single
  deny-list hit (field-name OR value-shape) refuses the **whole batch** and
  names the offending entry. This is the second net for anything Gate 1 missed.

## What's portable vs throwaway

- Portable (lift into real code later): `redaction.ts`, `build-scratch.ts`,
  `handoff.ts` types. Pure, no I/O, no terminal codes.
- Throwaway: `tui.ts` (terminal shell), `cli.ts` (CLI surface sketch).

## Open question this punts on

Memory-root location (repo-local vs `~/.config/context/`) is a brainstorm/plan
decision. The prototype writes to a temp dir and prints the path.

## Verdict

The choreography holds. Four things the running shape taught us, to carry into
the re-brainstorm:

1. **Handoff payload shape works as observations-only.** `RedactedHandoff`
   (`handoff.ts`) — domain, flowSlug, ordered `fields[]` of `{name, observed}`,
   `forks[]`, an `AuthPointer` *reference* (never the credential), and a
   redacted `stuckPoint` — carries everything build-scratch needs with zero
   typed values. Field *order* is preserved by the array. The auth pointer as a
   reference string (`1password:Molty/Acme Login`) resolved cleanly.

2. **Recorder-shaped JSON is a thin, honest mapping.** Each observed field →
   one `change` step whose `value` is the shape (a `redacted:*` placeholder for
   sensitive fields, a free-text shape note otherwise). Forks/auth/stuck-point
   live in a `_scratch` sidecar. This is Recorder-*ish*, not byte-identical —
   good enough to prove the shape; the real selector strategy is a plan detail.

3. **The two gates compose correctly, fail-closed.** Gate 2 (`redaction.ts`)
   runs BEFORE any build. The leaky fixture (raw `hunter2`, a deny-listed
   `api_token`, a 6-digit OTP under a clean name) is refused with exit 2,
   naming the offending field. **First-hit-wins is the right semantics:** one
   hit refuses the whole batch, so enumerating the rest is wasted — but note
   the consequence below.

4. **CLI surface is viable** (`cli.ts`): `build-scratch <handoff>
   [--memory-root] [--timestamp] [--dry-run] [-h]`, exit 0/1/2.

### Surfaced for the re-brainstorm / plan (genuine findings, not polish)

- **Over-redaction bug found and fixed mid-prototype.** The first cut
  placeholdered *every* field via a `placeholderFor` fallback, blanking
  `username` to `redacted:sensitive-field`. Wrong — Gate 2 already passed the
  batch, so non-sensitive free-text should survive verbatim. Fix: value =
  `field.observed` as-is. **Plan implication:** the builder must NOT redact;
  redaction is purely Gate 1 + Gate 2's *refuse* decision. The builder only
  *copies through* already-safe shapes. `placeholderFor` stays in `redaction.ts`
  but is currently unused by the builder — decide in planning whether it has a
  home at all.
- **Gate 2 caught the raw `hunter2` by its field NAME (`password`), not its
  value-shape.** That's fine for refusal, but it means the value-shape detectors
  (bearer/hex/base64/OTP) are only exercised when a secret lands under a
  *clean-named* field. The OTP-under-`verification` leak in the fixture proves
  that path exists — but because field-name fires first and stops, the unit
  tests in the real plan must cover value-shape hits **in isolation** (clean
  field name + secret-shaped value), or that detector could rot undetected.
- **memory-root still unpinned** — prototype writes to a temp dir
  (`mkdtempSync`). Repo-local vs `~/.config/context/` per the Memory OS contract
  is a real brainstorm/plan decision, unchanged by this prototype.
- **Whole-batch-refuse names only the FIRST offender.** If browser-use leaks
  several secrets, the operator fixes one, re-runs, hits the next. Acceptable
  for fail-closed safety, but the plan should decide whether the error should
  list *all* hits (better DX) vs first-only (current, simplest).
