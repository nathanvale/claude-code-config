# Residual review findings — feat/browser-connect (slice one)

Accepted, not-applied findings from the ce-code-review pass on 2026-07-14.
All are P3 advisory or deliberate design choices. Recorded here so they are
not lost; none blocks slice one.

## Deliberate design choices (not defects)

- **P3 — `check` emits sentinel `attachment: { adapter_id: "none", probe_executable: "none" }`** (`src/cli.ts`, `src/model.ts`). `check` produces no adapter attachment but shares the neutral `BrowserConnectHandoffPayload` shape (the plan's one-envelope-shape KTD). A consumer must not read `adapter_id: "none"` as a real adapter. **Slice-two action:** review whether `BrowserConnectHandoffPayload.attachment` should be optional, or a `check`-specific verified-environment payload variant should exist.

- **P3 — over-exported symbols** (`BROWSER_CONNECT_ADAPTER_IDS` in `registry.ts`, `WARM_CHROME_EXIT_20_DEFAULT_FAILURE_CLASS` in `environment.ts`). Used only in-file today; kept exported as intended public API for slice-two consumers and the future adapter-fallback feature. **Action if unused by slice two:** add `@since`/`@internal` intent JSDoc or narrow the export.

## Defense-in-depth (unreachable on current target)

- **P3 — `redactBrowserConnectText` misses bare JWT/opaque tokens with no key prefix or scheme** (`src/model.ts`). No code path routes a bare user token into a `detail` field (wrapped-command args never reach `detail`; adapter/env details carry only executable names + versions). macOS target only. Add a JWT/high-entropy pattern as defense-in-depth if a `detail`-bound token path is ever introduced.

- **P3 — Windows-style backslash paths escape the POSIX path-redaction rule** (`src/model.ts`). Not reachable on the macOS target (spawn detail paths are POSIX). Add a backslash-path branch only if a Windows runtime enters scope.

## Recorded open question (already in the plan)

- **KTD8 mcporter transport drift** — `src/adapters/registry.ts` reimplements the no-shell argv transport package-locally (browser-use exports no module surface). No compile-time drift tripwire against `skills/browser-use/src/mcporter-transport.ts`. Already tracked as the plan's Outstanding Question KTD8 (consolidate into a shared workspace module or delete the browser-use copy when browser-use migrates).

## Testing gaps left open (covered elsewhere or low-value)

- The 12 verified-Agent-Chrome stations are skipped at the process boundary (need real Chrome) — covered in-process by U4/U6/U7 injected-dep tests + the Verification Contract live smoke. Honest skip.
- No negative test proving the cli-command-facade parser does not emit an unredacted diagnostic during the pre-configure parse window on the run-missing-separator path (depends on facade-internal behavior; browser-connect never emits the tail there).

Source review run artifacts: `/tmp/compound-engineering/ce-code-review/20260714-164146-dd7dca81/`.
