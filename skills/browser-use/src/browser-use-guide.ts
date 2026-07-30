// ---------------------------------------------------------------------------
// Version-matched bundled guidance (design brief D3,
// docs/plans/2026-07-27-agent-first-front-door-brief.md).
//
// The guide ships beside the command contract it describes — the agent-browser
// `skills get core` pattern — so the external browser-use SKILL.md stays a
// thin router and this text can never drift from the shipped binary. Pure
// content module: no I/O, no state; the driver renders it verbatim.
//
// Style contract: copy-paste commands, telegraph prose, no secret values, no
// convention endpoints, no secondary-CLI commands on the everyday path.
// ---------------------------------------------------------------------------

import type { BrowserUseGuideTopic } from "./command-contract";

const CORE_GUIDE = `browser-use guide — core workflow (for AI agents)

Everyday loop (copy-paste):

  browser-use task list --json          # 1. Discover code-owned Task Intents
  browser-use task run --intent <id>    # 2. Route, attach, execute one intent
  browser-use run status --run <id>     # 3. Inspect the shared run
  browser-use run resume --run <id>     # 4. Resume after a blocked state
  browser-use artifact list --json      # 5. Read the run artifact manifest

Connection is automatic: task run proves warm Agent Chrome and attaches the
adapter internally. Pass --handoff <path> only to supply a pre-minted Verified
Handoff Envelope (advanced; see browser-use task run --help).

Runbooks (service-scoped flows):

  browser-use runbook list --json
  browser-use runbook run --service <id> --flow <id>

Every command supports --json (machine envelope) and --plain. JSON envelopes
carry error.code, continuation.next_action_id, and continuation.constraints —
follow next_action_id; obey constraints (never adapter or cold-browser
fallback when forbidden).

Completion doctrine — decide from structure, not output:
- Before a mutating page action, name one structural postcondition the failure
  path cannot also produce (URL, scoped DOM state, persisted target data).
- After mutating, re-observe fresh structure through the same continuity.
- Classify: confirmed (structure present) / not achieved (no effect proven) /
  unknown (partial evidence). On unknown: inspect, never auto-repeat; retry an
  externally-effecting mutation only when no effect is proven at the target.

Safety invariants:
- Warm Chrome only: real Google Chrome, dedicated persistent profile, loopback
  CDP. Never Chrome for Testing, throwaway profiles, or cold-browser fallback.
- Never hardcode endpoints; verified endpoints travel inside envelopes.
- Never print tokens, cookies, passwords, or auth-bearing URLs. Report secret
  checks by shape only (present/absent, length, status code).

More topics:
  browser-use guide --topic recovery    # Blocked or failed runs
  browser-use guide --topic auth        # Auth boundary and readiness
  browser-use guide --topic lanes       # Adapter lane registry
  browser-use guide --topic setup       # Required adapter binary handoff
  browser-use guide --full              # Page-action lifecycle + advanced path
`;

const CORE_GUIDE_FULL_APPENDIX = `
Page-action lifecycle (one adapter, one continuity):

  observe -> name postcondition + resolve current ref -> mutate -> verify fresh

- One semantic click through the everyday front door:
  browser-use task run --intent routine-automation --click-role <role> --click-name <accessible-name> --postcondition-id <id> --expect-visible <selector> --allowed-origin <origin>
- The same semantic contract is available to Playwright frontend-test and
  locator-aria-assertion runs; pass a numeric --tab index.
- Browser Use resolves role + name against the current task-local snapshot.
  Zero or multiple matches refuse before mutation; raw refs stay private.
- Runbook execution resolves one admissible tab when --tab is omitted.
  Pass --tab only as an exact adapter tab-id override.
- A ref is valid only inside the adapter continuity that minted it. Discard
  refs after navigation, DOM change, process/client restart, endpoint change,
  or tab change; observe again.
- Adapter return text never decides the outcome; fresh structure does.
- Take screenshots only for visual layout, media proof, or user request.

Advanced: explicit target discovery and operations (platform internals):

  browser-use targets list --mode handoff-bound --adapter <id> --json
  browser-use targets list ... --json | browser-use targets select --candidate <n>
  browser-use operate snapshot|screenshot|emulate

- Handoff-bound discovery attaches automatically and derives adapter binary +
  endpoint from the fresh envelope. --handoff remains an advanced override.
- Run correlation: pass --run-id (or BROWSER_USE_RUN_ID) plus
  BROWSER_USE_TARGET_STATE_DIR (or --state <path>) so select/status/operate
  share run-scoped target state; select fails closed without it.
- operate starts a fresh adapter process per call: never carry an operate
  snapshot ref into a separate mutation client.
`;

const RECOVERY_GUIDE = `browser-use guide — recovery

Every failure envelope names its own next step. Read in this order:

1. error.code               Typed diagnostic; each code names a recovery.
2. continuation.next_action_id   The one next safe action; dispatch verbatim.
3. continuation.constraints      Hard limits; never work around them.

Common states:

- Exit 20 (failed closed): the envelope carries exactly one Repair Path —
  follow it. Never fall back to a cold or headless browser; never retry a
  convention port.
- Blocked run: browser-use run status --run <id> --json shows the blocked
  cause; its continuation is an auth or repair command — run it as printed.
- Platform repair: browser-use repair status --json to project repair state;
  browser-use repair apply for bounded, registered repair execution.
- Stale or mismatched handoff evidence: rerun the task (connection re-proves
  automatically); with a caller-managed envelope, re-mint it first.

A login or MFA wall reached after a healthy attach is an app step in the warm
profile, not a connection failure — keep driving the page.
`;

const AUTH_GUIDE = `browser-use guide — auth boundary

- Inspect local auth custody without reading its value:
  browser-use auth status --json
- Install or atomically replace only through a human-controlled channel:
  browser-use auth install-token             # hidden terminal entry
  browser-use auth install-token --stdin     # explicit inherited stdin
- Remove local custody, then follow the remote-revocation continuation:
  browser-use auth remove-token --json
- A noninteractive install without --stdin returns human-action-required. It
  never waits for a terminal and never accepts a value in argv, flags, or env.
- Auth readiness remains a check, not a login script:
  browser-use auth repair-vault-grant --json
- Blocked-cause continuations are commands: a blocked run's envelope names the
  exact auth subcommand to dispatch verbatim.
- Inspect and resume the same run from a fresh process:
  browser-use run status --run <id> --json
  browser-use run resume --run <id> --json
- Resolve login secrets through the domain's Auth Pointer at runtime; never
  inline secret values in commands, files, or output.
- Report secret checks by shape only: present/absent, length, status code,
  account or org name. Never print token, cookie, or password values.
- Treat auth/session state as an operation precondition when the task needs
  it; the warm profile carries session state between runs.
`;

const LANES_GUIDE = `browser-use guide — adapter lanes

- Lanes are registered adapter implementations with evidence status:
  browser-use lanes list --json
  browser-use lanes show --adapter <id> --json
- task run routes each intent to an admissible lane automatically; pass
  --lane <id> only to override, and expect admission checks to reject a lane
  whose capability or evidence does not satisfy the intent.
- Adapter ids come from the registered enum (lanes list); never abbreviate.
- A domain file's engine field selects the lane for that domain's work.
`;

const SETUP_GUIDE = `browser-use guide — adapter binary setup

Use this only when a run reports adapter_not_installed or an acceptance proof
needs an adapter that is not yet ready.

1. Discover the registered adapter ids:

  browser-use lanes list --json

2. For each adapter required by the intended run, read the trusted preview:

  browser-connect repair-adapter <adapter-id> --check --json

Read these fields; inferring a package or substituting "latest" breaks
exact-pin provenance and leaves the adapter unavailable:

- data.install_state: installed_at_pin means ready.
- data.required_binary: executable, package_name, pinned_version,
  install_scope, lifecycle_scripts_required, package_owner, and docs_url.
- data.posture: none, automatic, or operator.
- data.eligible_action_id / data.operator_choice_ids: the allowed next step.

When posture is operator, tell the human:

- Install data.required_binary.package_name at exactly
  data.required_binary.pinned_version.
- Use the user-owned package-manager scope named by install_scope.
- Allow lifecycle scripts only when lifecycle_scripts_required is true.
- Use the package owner and docs URL from the same preview.
- Do not change the registered pin, use privilege escalation, or install a
  substitute adapter.

Never run \`agent-browser install\`: it downloads Chrome for Testing. Browser
Use attaches adapters only to Warm Chrome.

After the human installs the package, rerun the same read-only preview:

  browser-connect repair-adapter <adapter-id> --check --json

Continue only when install_state is installed_at_pin and posture is none, then
rerun the original browser-use command.
`;

/**
 * Render one guide topic. `full` appends the page-action lifecycle and
 * advanced platform path to the core topic (ignored for other topics).
 */
export function renderGuide(topic: BrowserUseGuideTopic, full: boolean): string {
	switch (topic) {
		case "core":
			return full ? `${CORE_GUIDE}${CORE_GUIDE_FULL_APPENDIX}` : CORE_GUIDE;
		case "recovery":
			return RECOVERY_GUIDE;
		case "auth":
			return AUTH_GUIDE;
		case "lanes":
			return LANES_GUIDE;
		case "setup":
			return SETUP_GUIDE;
	}
}
