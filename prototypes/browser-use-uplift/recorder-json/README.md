# PROTOTYPE — real Chrome Recorder JSON output (throwaway)

**Question:** Can `browser-use` compose a captured flow into a VALID, replayable
Chrome DevTools Recorder JSON — using the REAL durable selectors we proved we can
capture (`#MainContent_LoginControl_UserName` etc.), not placeholders — and is
that the right thing to hand `browser-domain-memory`?

This supersedes `../build-scratch-handoff/` (which used placeholder selectors
because real selector capture wasn't proven yet). Now it IS proven, so this
prototype emits the real thing and **validates it against `@puppeteer/replay`'s
own `parse()`** — the canonical Recorder schema validator (Chrome DevTools team).

## Run

```
bun prototypes/browser-use-uplift/recorder-json/build-recorder.ts
```

Emits a Recorder UserFlow JSON from a captured-flow fixture (the shape
browser-use produces: ordered actions + real selectors + shape-only values),
then validates it with `@puppeteer/replay parse()` and (optionally) `stringify()`
to runnable Puppeteer code to prove it's genuinely replayable.

## What it proves / answers

1. The output is **valid Recorder JSON** (passes `parse()`), not Recorder-ish.
2. Real selectors slot into the `selectors: Selector[]` fallback-chain shape.
3. Secret values stay shape-only (`redacted:password-field`) — Gate 1 holds even
   in a "replayable" artifact (so it is intentionally NOT auth-replayable).
4. Surfaces the real question for the memory skill: is full Recorder JSON the
   right durable artifact, or overkill vs a lean handoff? (verdict below)

## Throwaway

Delete or fold the validated shape into the `browser-domain-memory` capture
contract once decided.

## Verdict

**Yes — browser-use can emit VALID, replayable Chrome Recorder JSON with real
selectors.** Proven: `@puppeteer/replay parse()` passes ("VALID, 5 steps"), and
`stringify()` produces real Puppeteer code (`page.goto`, `.fill`, `.click`). It's
Recorder-*compatible*, not just Recorder-ish.

Key findings for the `browser-domain-memory` capture contract:

1. **Validate against the real schema — it catches things.** `click` steps
   REQUIRE `offsetX`/`offsetY` (not optional). A hand-rolled "Recorder-ish"
   format would have shipped invalid JSON silently. browser-use captures the
   offset from `get box @ref` (element center). Lesson: emit + validate with
   `parse()`, don't approximate the shape.

2. **Gate 1 survives the "replayable" artifact, elegantly.** Values are
   shape-only (`redacted:password-field`), so the JSON reproduces the
   PATH/structure but is intentionally NOT auth-replayable. A replayable
   evidence artifact that can't actually log in — exactly the safety posture we
   want for Scratch Evidence.

3. **Selectors: one real `#id` per step, as a single-element `Selector[]`
   chain.** Honest gap vs a human Recorder export, which carries a multi-selector
   fallback chain (css + aria + text) for robustness. Our capture
   (`get attr @ref id`) gives one strong selector. Plan decision: is one real
   selector enough, or should browser-use also resolve aria/text fallbacks via
   `get attr`/`eval` to match Recorder's robustness?

4. **The format question is ANSWERED: Recorder JSON is viable as the durable
   artifact.** It's a real standard (Chrome DevTools team), validatable,
   replayable, and tools already understand it. The remaining call is whether
   the memory skill stores the full Recorder JSON as Scratch Evidence (rich,
   replayable-structure) vs distilling to leaner prose — but the JSON itself is
   no longer hypothetical.

Supersedes `../build-scratch-handoff/` (placeholder selectors). This proves the
real thing.

## Replay proof (`replay.ts`)

**The full loop closes: capture → store → REPLAY, against the real page.**
`replay.ts` connects `puppeteer-core` to the warm Chrome (`browserURL`), parses
the Recorder JSON, and runs it via `@puppeteer/replay`'s `createRunner` +
`PuppeteerRunnerExtension`. Proven live on oncore:

```
▶ setViewport / navigate / change #...UserName / change #...Password
✓ #MainContent_LoginControl_UserName resolved, value="redacted:username-field"
✓ #MainContent_LoginControl_Password resolved, value="redacted:password-field"
✓ replay executed. Stopped before submit (no login attempted).
```

Findings:
- **`@puppeteer/replay` drives our captured JSON against the real warm Chrome.**
  The captured selectors resolve to the real fields and the flow executes. No
  new browser stack — replays into the same CDP Chrome we capture from.
- **Gate 1 is demonstrably safe on replay, not just in theory.** Shape-only
  values mean replay types `redacted:*` into the real fields and we deliberately
  omit the submit click → genuine structural replay that CANNOT log in.
- **Run prereq:** warm Chrome up on `$PORT` (default 9444) via
  `warm-connect-WORKING.sh`. `bun replay.ts`.

End-to-end pipeline now fully proven: agent-browser capture (real selectors) →
valid Recorder JSON → puppeteer-replay playback on the real browser.
