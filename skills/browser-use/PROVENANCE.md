# Provenance: browser-use

## Source

- Source: `steipete/agent-scripts`, `skills/browser-use/`.
- URL: `https://github.com/steipete/agent-scripts`.
- License: MIT, Peter Steinberger, 2026.
- Import: sparse checkout from `main` on 2026-05-29.

## Rationale Sources

- Warm Chrome dedicated profile: `docs/adr/0006-warm-chrome-via-dedicated-debug-profile.md`.
- Browser-use binding lifecycle: `docs/adr/0008-browser-use-owns-warm-chrome-binding-lifecycle.md`.
- Fixed CDP convention and runtime proof: `docs/adr/0009-browser-use-fixed-cdp-convention-and-runtime-proof.md`.
- Evidence-first routing: `docs/adr/0012-browser-adapter-router-uses-evidence-first-routing.md`.
- Router research recovery: `docs/adr/0013-router-research-recovery-uses-diagnostic-trail.md`.
- Warm Chrome findings: `docs/research/2026-05-30-browser-use-warm-chrome-findings.md`.
- Router research stock: `docs/research/2026-06-02-browser-adapter-router-research-stock.md`.

## Local Status

- Status: adapted.
- Owner: `browser-use`.
- Current contract: Warm Chrome plus Browser Adapter Router.
- Current proven adapter: `chrome-devtools`.
- Future adapter proof targets: `agent-browser`, `playwright-cdp`.
- Deterministic replay detail: `puppeteer-core` against verified Warm Chrome.

## Local Contract

- Use real Google Chrome.
- Use a dedicated persistent profile.
- Use loopback CDP.
- Avoid Chrome for Testing.
- Avoid throwaway profiles.
- Avoid the everyday default Chrome profile.
- Keep browser entry in `browser-use`.
- Keep adapter policy in Browser Adapter Router.
- Keep adapter dependency/config repair in Browser Adapter Proof.
- Keep blocking adapter-proof repair local; do not emit `hint.docs_url` for `browser_adapter_proof` failures.
- Keep adapter-local repair commands in Browser Adapter Maps.
- Keep capability truth in Router runtime reports and manifests.
- Keep skill prose as routing, owner paths, and next safe action.

## Local Owners

- Skill driver: `skills/browser-use/SKILL.md`.
- Warm Chrome contract: `skills/browser-use/references/warm-chrome.md`.
- `chrome-devtools` Browser Adapter Map: `skills/browser-use/references/browser-adapter-chrome-devtools.md`.
- Warm Chrome CLI: `skills/browser-use/scripts/preflight-warm-chrome.sh`.
- Warm Chrome runtime: `skills/browser-use/scripts/preflight-warm-chrome.ts`.
- Browser Adapter Proof CLI: `skills/browser-use/scripts/preflight-browser-adapter.sh`.
- Browser Adapter Proof runtime: `skills/browser-use/scripts/preflight-browser-adapter.ts`.
- Browser Adapter Router CLI: `skills/browser-use/scripts/browser-adapter-router.sh`.
- Browser Adapter Router runtime: `skills/browser-use/scripts/browser-adapter-router.ts`.
- Browser Adapter Map CLI: `skills/browser-use/scripts/browser-adapter-map.sh`.
- Browser Adapter Map runtime: `skills/browser-use/scripts/browser-adapter-map.ts`.
- Router registry and capability manifests: `skills/browser-use/scripts/browser-adapter-router-manifests.ts`.
- Router model: `skills/browser-use/scripts/browser-adapter-router-model.ts`.
- Router engine: `skills/browser-use/scripts/browser-adapter-router-engine.ts`.
- Router discovery: `skills/browser-use/scripts/browser-adapter-router-discovery.ts`.
- Router validation: `skills/browser-use/scripts/browser-adapter-router-validation.ts`.
- Router recovery: `skills/browser-use/scripts/browser-adapter-router-recovery.ts`.
- CLI command contracts: `skills/browser-use/scripts/command-contract.ts`.
- Legacy helper: `skills/browser-use/scripts/launch-agent-chrome.sh`.
- Warm Chrome tests: `skills/browser-use/scripts/preflight-warm-chrome.test.ts`.
- Browser Adapter Proof tests: `skills/browser-use/scripts/preflight-browser-adapter.test.ts`.
- Browser Adapter Router tests: `skills/browser-use/scripts/browser-adapter-router.test.ts`.
- Browser Adapter Map tests: `skills/browser-use/scripts/browser-adapter-map.test.ts`.
- Live/smoke matrix: `skills/browser-use/TEST_MATRIX.md`.

## Current Driver Shape

- Run Warm Chrome Preflight for browser-entry proof.
- Ask Router `report` for current capability evidence.
- Build a route evidence envelope from user request, preconditions, proof, and reports.
- Run Router `route`.
- Follow Router continuation.
- Run Browser Adapter Proof when Router emits `prove_adapter_attachment`.
- Add attachment proof to the envelope.
- Reroute.
- Act only after Router emits `use_selected_browser_adapter`.

## Adaptation History

- 2026-05-29: Imported upstream skill substrate.
- 2026-05-29: Proved live Oncore portal path with real Chrome, Chrome DevTools MCP, and `one-password`.
- 2026-06-01: Added Warm Chrome Preflight facade and live endpoint checks.
- 2026-06-01: Hardened read-only check, safe repair, launch reuse, diagnostics, and redaction.
- 2026-06-02: Added Browser Adapter Proof facade.
- 2026-06-02: Proved `chrome-devtools` attachment through verified Warm Chrome and `mcporter`.
- 2026-06-02: Added Browser Adapter Router facade.
- 2026-06-03: Added Router recovery metadata, route-validity constraints, smoke artifacts, and capability report routing.
- 2026-06-03: Rewrote `SKILL.md` around Router-first adapter selection.
- 2026-06-03: Proved live Router-first Chrome path: missing attachment proof, `prove_adapter_attachment`, `chrome-devtools` proof, reroute success.

## Validated Paths

- Warm Chrome Preflight validates current endpoint authority.
- Warm Chrome `check` is read-only.
- Warm Chrome `repair` owns safe profile proof repair.
- Warm Chrome `launch` starts real Google Chrome only when needed.
- Browser Adapter Proof runs Warm Chrome Preflight internally.
- `chrome-devtools` proof accepts `mcporter` bound to verified Warm Chrome.
- Missing `mcporter`, configured runner, or Chrome DevTools MCP reports adapter dependency recovery.
- Stale `mcporter` config reports adapter config recovery.
- Router `report` discovers validated capability reports from self-report input or runtime manifests.
- Router `route` consumes supplied evidence; it does not probe adapters.
- Missing attachment proof emits `prove_adapter_attachment`.
- Route success emits `use_selected_browser_adapter`.
- Route success emits route-validity constraints.
- Router registry includes `chrome-devtools`, `agent-browser`, and `playwright-cdp`.
- Live Router-first Chrome path selects `chrome-devtools` with route confidence `90` after attachment proof.

## Open Work

- Prove `agent-browser` against Warm Chrome before documenting it as routable.
- Prove `playwright-cdp` against Warm Chrome before documenting it as routable.
- Keep browser-domain-memory consuming this contract instead of duplicating it.
- Refresh capability manifests only from verified evidence.
