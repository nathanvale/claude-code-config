import {
	type CommandFacadeActionAffordance,
	type CommandFacadeResultContract,
	type CommandResultData,
	createCommandResultData,
} from "@side-quest/cli-command-facade";
import type {
	BrowserConnectEnvironmentIdentity,
	BrowserConnectEnvironmentName,
	BrowserConnectHandoffPayload,
	BrowserConnectLaunchProvenance,
	BrowserConnectRouteEvidenceStatus,
	BrowserConnectRouteId,
} from "./contract";

// The Verified Handoff Envelope payload type graph lives value-free in
// `contract.ts` (KTD6/R8) so consumers can `import type` it through the
// `./contract` subpath. Re-exported here so browser-connect internals keep
// importing from `./model` unchanged.
export type {
	BrowserConnectAuthorizedAttachment,
	BrowserConnectEnvironmentIdentity,
	BrowserConnectEnvironmentName,
	BrowserConnectHandoffPayload,
	BrowserConnectLaunchProvenance,
	BrowserConnectProofEvidence,
	BrowserConnectRouteEvidenceStatus,
	BrowserConnectRouteId,
	BrowserConnectVerifiedEndpoint,
} from "./contract";

// Compile-time parity between the value-free literal unions in `contract.ts`
// and the runtime const arrays below, enforced in BOTH directions: the
// `satisfies` clause on each array rejects a literal outside the union, and
// the `AssertTrue<IsEqual<…>>` aliases reject a union member the array lacks.
// Either drift direction is a type error, not a silent divergence.
type IsEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;

/**
 * Package-owned contract id for browser-connect verified handoff envelopes.
 *
 * One neutral shape regardless of adapter (R8): environment, endpoint, route,
 * proof, next safe action. Adapter-specific invocation detail never enters
 * this contract.
 *
 * @defaultValue "browser-connect.verified-handoff"
 */
export const BROWSER_CONNECT_CONTRACT_ID =
	"browser-connect.verified-handoff" as const;

/**
 * Machine schema version for browser-connect JSON envelopes (R16).
 *
 * Schema 2 (platform plan 2026-07-21-002 U1, KTD13): environment identity
 * carries the named logical `profile` alongside `name`. Consumers pin this
 * version locally and fail closed on an unrevised consumer; the browser-use
 * pin bumps atomically with this constant.
 *
 * @defaultValue "2"
 */
export const BROWSER_CONNECT_SCHEMA_VERSION = "2" as const;

/** Safe observed/pinned version shape for projection (R11): plain x.y.z only. */
export const BROWSER_CONNECT_SAFE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Canonical CLI name (bin entry and discovery surface).
 *
 * @defaultValue "browser-connect"
 */
export const BROWSER_CONNECT_CLI_NAME = "browser-connect" as const;

/**
 * Facade result contract shared by every browser-connect command (R8): the
 * envelope schema is identical across all adapters and commands.
 */
export const BROWSER_CONNECT_RESULT_CONTRACT = {
	id: BROWSER_CONNECT_CONTRACT_ID,
	kind: "Browser Adapter verified handoff.",
	schema_version: BROWSER_CONNECT_SCHEMA_VERSION,
} as const satisfies CommandFacadeResultContract;

/**
 * Environment names an envelope may identify (vocabulary: Human Chrome /
 * Agent Chrome). v1 has exactly one Agent Chrome instance; future
 * multi-identity means multiple Agent Chrome instances distinguished by
 * envelope environment identity, never new environment names.
 */
export const BROWSER_CONNECT_ENVIRONMENT_NAMES = [
	"agent-chrome",
] as const satisfies readonly BrowserConnectEnvironmentName[];

type _EnvironmentNameParity = AssertTrue<
	IsEqual<
		(typeof BROWSER_CONNECT_ENVIRONMENT_NAMES)[number],
		BrowserConnectEnvironmentName
	>
>;

/**
 * Three-door route model (KTD7), declared from day one so door assumptions
 * never leak into the envelope schema (R9). Slice one implements
 * `explicit-cdp` only; `ui-consent` and `extension` are model vocabulary for
 * later slices.
 */
export const BROWSER_CONNECT_ROUTES = [
	"explicit-cdp",
	"ui-consent",
	"extension",
] as const satisfies readonly BrowserConnectRouteId[];

type _RouteIdParity = AssertTrue<
	IsEqual<(typeof BROWSER_CONNECT_ROUTES)[number], BrowserConnectRouteId>
>;

/**
 * Evidence status a route capability carries per Adapter Definition (KTD7).
 */
export const BROWSER_CONNECT_ROUTE_EVIDENCE_STATUSES = [
	"verified-live",
	"documented",
	"candidate",
] as const satisfies readonly BrowserConnectRouteEvidenceStatus[];

type _RouteEvidenceStatusParity = AssertTrue<
	IsEqual<
		(typeof BROWSER_CONNECT_ROUTE_EVIDENCE_STATUSES)[number],
		BrowserConnectRouteEvidenceStatus
	>
>;

/**
 * Closed failure-class union covering the Branch Station Catalog's failure
 * families. Names are stable: U3 (station catalog), U4 (gateway mapping), and
 * U6/U7 (command surfaces) build on them. Kebab-case follows the plan's own
 * spelling (`wrapped-command-not-found`, `runtime-error-unexpected`).
 */
export const BROWSER_CONNECT_FAILURE_CLASSES = [
	"usage-invalid",
	"run-missing-separator",
	"environment-absent",
	"foreign-listener",
	"launch-failed",
	"adapter-unknown",
	"adapter-not-installed",
	"route-incompatible",
	"attachment-failed",
	"preexec-connect-failed",
	"wrapped-command-not-found",
	"runtime-error-unexpected",
] as const;

/**
 * Failure class union.
 */
export type BrowserConnectFailureClass =
	(typeof BROWSER_CONNECT_FAILURE_CLASSES)[number];

/**
 * Stable failure runtime-action ids — the `next_action_id` vocabulary failure
 * envelopes emit (R2). Ids follow warm-chrome's runtime-action spelling
 * (snake_case) for cross-package continuation continuity. The first eleven ids
 * are the released schema-1 vocabulary and stay stable (R16); the additive
 * repair-path ids follow them.
 */
export const BROWSER_CONNECT_FAILURE_ACTION_IDS = [
	"change_input",
	"add_run_separator",
	"launch_agent_chrome",
	"inspect_listener",
	"inspect_diagnostics",
	"list_registered_adapters",
	"install_adapter",
	"select_compatible_route",
	"inspect_attachment_probe",
	"resolve_connect_failure",
	"fix_wrapped_command",
	"use_suggested_port",
	"upgrade_adapter_to_pin",
	"adjust_adapter_pin",
	"review_adapter_definition",
] as const;

/**
 * Failure runtime-action id union.
 */
export type BrowserConnectFailureActionId =
	(typeof BROWSER_CONNECT_FAILURE_ACTION_IDS)[number];

/**
 * Compatibility-only action ids (R20/KTD21): discoverable vocabulary for
 * released schema-1 consumers, but never an outer `continuation.next_action_id`
 * selected by the recovery policy. `repair-path.ts` owns that exclusion; tests
 * enforce it across the full cause matrix.
 */
export const BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS = [
	"list_registered_adapters",
	"select_compatible_route",
	"resolve_connect_failure",
] as const satisfies readonly BrowserConnectFailureActionId[];

/**
 * Compatibility-only action id union.
 */
export type BrowserConnectCompatibilityOnlyActionId =
	(typeof BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS)[number];

/**
 * Stable success runtime-action ids.
 */
export const BROWSER_CONNECT_SUCCESS_ACTION_IDS = [
	"use_verified_handoff",
] as const;

/**
 * Success runtime-action id union.
 */
export type BrowserConnectSuccessActionId =
	(typeof BROWSER_CONNECT_SUCCESS_ACTION_IDS)[number];

/**
 * Runtime-action id union across failure and success groups.
 */
export type BrowserConnectRuntimeActionId =
	| BrowserConnectFailureActionId
	| BrowserConnectSuccessActionId;

/**
 * Affordance catalog (R2): every failure class resolves to exactly one next
 * safe action, expressed as an enumerated affordance id — never prose or a
 * shell string. The Record over the full failure-class union makes the
 * mapping exhaustive at compile time.
 */
export const BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS = {
	"usage-invalid": "change_input",
	"run-missing-separator": "add_run_separator",
	"environment-absent": "launch_agent_chrome",
	"foreign-listener": "inspect_listener",
	"launch-failed": "inspect_diagnostics",
	"adapter-unknown": "list_registered_adapters",
	"adapter-not-installed": "install_adapter",
	"route-incompatible": "select_compatible_route",
	"attachment-failed": "inspect_attachment_probe",
	"preexec-connect-failed": "resolve_connect_failure",
	"wrapped-command-not-found": "fix_wrapped_command",
	"runtime-error-unexpected": "inspect_diagnostics",
} as const satisfies Record<
	BrowserConnectFailureClass,
	BrowserConnectFailureActionId
>;

/**
 * Legal schema-1 `data.next_action_id` values per failure class (R16/R30).
 *
 * The class default from {@link BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS}
 * stays supported for released consumers; the additional values are the
 * policy-selected automatic mirrors plus the closed non-mutating compatibility
 * stops (`repair-path.ts` owns that selection). `inspect_diagnostics` is legal
 * everywhere as the R30 fail-safe fallback. Envelope construction rejects any
 * value outside this record.
 */
const BROWSER_CONNECT_LEGACY_NEXT_ACTIONS_BY_FAILURE_CLASS = {
	"usage-invalid": ["change_input", "inspect_diagnostics"],
	"run-missing-separator": [
		"add_run_separator",
		"change_input",
		"inspect_diagnostics",
	],
	"environment-absent": ["launch_agent_chrome", "inspect_diagnostics"],
	"foreign-listener": [
		"use_suggested_port",
		"inspect_listener",
		"inspect_diagnostics",
	],
	"launch-failed": ["inspect_diagnostics"],
	"adapter-unknown": [
		"change_input",
		"list_registered_adapters",
		"inspect_diagnostics",
	],
	"adapter-not-installed": [
		"install_adapter",
		"upgrade_adapter_to_pin",
		"list_registered_adapters",
		"inspect_diagnostics",
	],
	"route-incompatible": [
		"select_compatible_route",
		"list_registered_adapters",
		"inspect_diagnostics",
	],
	"attachment-failed": ["inspect_attachment_probe", "inspect_diagnostics"],
	"preexec-connect-failed": [
		"resolve_connect_failure",
		"launch_agent_chrome",
		"use_suggested_port",
		"inspect_listener",
		"change_input",
		"list_registered_adapters",
		"install_adapter",
		"upgrade_adapter_to_pin",
		"inspect_diagnostics",
	],
	"wrapped-command-not-found": [
		"fix_wrapped_command",
		"change_input",
		"inspect_diagnostics",
	],
	"runtime-error-unexpected": ["inspect_diagnostics"],
} as const satisfies Record<
	BrowserConnectFailureClass,
	readonly BrowserConnectFailureActionId[]
>;

/**
 * Failure runtime actions (facade rule): prose summary + structured action,
 * no command strings. Agents resolve ids against discovery, never copy shell.
 */
export const browserConnectFailureActions = [
	{
		id: "change_input",
		summary: "Correct CLI arguments, flags, or operands.",
		sideEffects: ["check"],
	},
	{
		id: "add_run_separator",
		summary:
			"Supply the separator boundary between run options and the wrapped command.",
		sideEffects: ["check"],
	},
	{
		id: "launch_agent_chrome",
		summary: "Launch Agent Chrome, then re-prove the environment.",
		sideEffects: ["browser", "write"],
	},
	{
		id: "inspect_listener",
		summary: "Stop and inspect the foreign listener before adapter work.",
		sideEffects: ["check"],
	},
	{
		id: "inspect_diagnostics",
		summary: "Stop and inspect diagnostics; not a connection repair.",
		sideEffects: ["check"],
	},
	{
		id: "list_registered_adapters",
		summary: "Read the adapter registry and name a registered adapter.",
		sideEffects: ["read"],
	},
	{
		id: "install_adapter",
		summary:
			"Install the registered adapter at its pinned version, then reconnect.",
		sideEffects: ["write"],
	},
	{
		id: "select_compatible_route",
		summary:
			"Pick an adapter whose declared route capability the environment shares.",
		sideEffects: ["read"],
	},
	{
		id: "inspect_attachment_probe",
		summary:
			"Inspect the adapter attachment probe evidence; the endpoint is verified.",
		sideEffects: ["check"],
	},
	{
		id: "resolve_connect_failure",
		summary:
			"Resolve the underlying connect failure with the read-only check surface, then rerun the wrapper.",
		sideEffects: ["check"],
	},
	{
		id: "fix_wrapped_command",
		summary:
			"Correct or install the wrapped command; the connection envelope was already emitted.",
		sideEffects: ["check"],
	},
	{
		id: "use_suggested_port",
		summary:
			"Start one fresh copy of the failed connect or run with the suggested explicit port at repair-chain hop one.",
		sideEffects: ["browser", "write"],
	},
	{
		id: "upgrade_adapter_to_pin",
		summary:
			"Upgrade the installed adapter to its exact pinned version through the adapter repair executor.",
		sideEffects: ["network", "write"],
	},
	{
		id: "adjust_adapter_pin",
		summary:
			"Review and change the Adapter Definition pin through normal source review.",
		sideEffects: ["write"],
	},
	{
		id: "review_adapter_definition",
		summary:
			"Review the named Adapter Definition metadata through normal source review.",
		sideEffects: ["write"],
	},
] as const satisfies readonly (CommandFacadeActionAffordance & {
	id: BrowserConnectFailureActionId;
})[];

/**
 * Success runtime actions.
 */
export const browserConnectSuccessActions = [
	{
		id: "use_verified_handoff",
		summary:
			"Attach the authorized adapter using the verified endpoint forms in this envelope.",
		sideEffects: ["browser"],
	},
] as const satisfies readonly (CommandFacadeActionAffordance & {
	id: BrowserConnectSuccessActionId;
})[];

// ---------------------------------------------------------------------------
// Typed repair context (KTD2/KTD11). Gateways classify failures into these
// records; `repair-path.ts` selects recovery from them. Policy never branches
// on prose `detail`. Run repair context is structurally incapable of carrying
// wrapped argv, arguments, environment values, or full executable paths (R26):
// separator repair carries only a non-empty-command boolean marker and
// missing-executable repair carries at most a normalized basename.
// ---------------------------------------------------------------------------

/**
 * Bounded repair-chain hop (R15/R23). Hop `0` is every ordinary invocation;
 * hop `1` marks the single fresh invocation a `use_suggested_port` recipe may
 * start. There is no hop `2`: a hop-1 failure fails closed to an operator.
 */
export const BROWSER_CONNECT_REPAIR_CHAIN_HOPS = [0, 1] as const;

/**
 * Repair-chain hop union.
 */
export type BrowserConnectRepairChainHop =
	(typeof BROWSER_CONNECT_REPAIR_CHAIN_HOPS)[number];

/**
 * Typed environment repair causes (R6/R10): absent, occupied, foreign,
 * unverified, launch-failed, and transient proof states.
 */
export const BROWSER_CONNECT_ENVIRONMENT_REPAIR_CAUSES = [
	"no_listener",
	"occupied_listener",
	"foreign_listener",
	"unverified_listener",
	"launch_failed",
	"transient_proof_failure",
] as const;

/**
 * Environment repair cause union.
 */
export type BrowserConnectEnvironmentRepairCause =
	(typeof BROWSER_CONNECT_ENVIRONMENT_REPAIR_CAUSES)[number];

/**
 * Typed adapter repair causes (R11): registry, provenance, route, and probe
 * states.
 */
export const BROWSER_CONNECT_ADAPTER_REPAIR_CAUSES = [
	"unregistered_adapter",
	"executable_absent",
	"version_mismatch",
	"route_unsupported",
	"transient_probe_failure",
	"probe_failed",
] as const;

/**
 * Adapter repair cause union.
 */
export type BrowserConnectAdapterRepairCause =
	(typeof BROWSER_CONNECT_ADAPTER_REPAIR_CAUSES)[number];

/**
 * Typed run repair causes (R12): missing-input, separator, wrapped-command,
 * and underlying pre-exec states.
 */
export const BROWSER_CONNECT_RUN_REPAIR_CAUSES = [
	"separator_missing",
	"wrapped_command_missing",
	"wrapped_executable_absent",
	"preexec_connect_failure",
] as const;

/**
 * Run repair cause union.
 */
export type BrowserConnectRunRepairCause =
	(typeof BROWSER_CONNECT_RUN_REPAIR_CAUSES)[number];

/**
 * Every typed repair cause the recovery policy selects from (R4/R18).
 */
export const BROWSER_CONNECT_REPAIR_CAUSES = [
	"usage_invalid",
	...BROWSER_CONNECT_RUN_REPAIR_CAUSES,
	...BROWSER_CONNECT_ENVIRONMENT_REPAIR_CAUSES,
	...BROWSER_CONNECT_ADAPTER_REPAIR_CAUSES,
	"unexpected_runtime_error",
] as const;

/**
 * Repair cause union across all failure domains.
 */
export type BrowserConnectRepairCause =
	(typeof BROWSER_CONNECT_REPAIR_CAUSES)[number];

/**
 * Warm-chrome suggested-port evidence (R6). `verified_free` is warm-chrome's
 * fresh proof that the suggested port was free when suggested; a stale or
 * unverified suggestion never selects `use_suggested_port`.
 */
export type BrowserConnectSuggestedPortEvidence = {
	port: number;
	verified_free: boolean;
};

/**
 * Registry-owned isolated-install safety evidence (R28/R29/KTD13). All four
 * gates must hold before policy may select automatic `install_adapter` or
 * `upgrade_adapter_to_pin`; any failed gate degrades to an operator choice.
 */
export type BrowserConnectIsolatedInstallEvidence = {
	recipe_complete: boolean;
	lock_origins_canonical: boolean;
	dependency_integrity_complete: boolean;
	lifecycle_scripts_disabled: boolean;
};

/**
 * Typed environment repair context (R6/R10). Listener causes carry at most
 * the suggested-port evidence — never a PID, ownership claim, process token,
 * or continuation receipt (R32): listener inspection is a terminal operator
 * handoff with no ownership-ingestion seam.
 */
export type BrowserConnectEnvironmentRepairContext =
	| {
			failure_class: "environment-absent";
			cause: "no_listener";
			/** Warm-chrome proof that the requested explicit port is free. */
			explicit_port_free: boolean;
	  }
	| {
			failure_class: "environment-absent";
			cause: "transient_proof_failure";
			/** True when the gateway already spent its one bounded recheck (R23). */
			recheck_attempted: boolean;
	  }
	| {
			failure_class: "foreign-listener";
			cause: "occupied_listener" | "foreign_listener" | "unverified_listener";
			suggested_explicit_port?: BrowserConnectSuggestedPortEvidence;
	  }
	| {
			failure_class: "launch-failed";
			cause: "launch_failed";
	  };

/**
 * Typed adapter repair context (R11). Adapter identity fields are trusted
 * Adapter Definition ids; policy re-validates them against the registry and
 * fails closed on unknown ids (R24).
 */
export type BrowserConnectAdapterRepairContext =
	| {
			failure_class: "adapter-unknown";
			cause: "unregistered_adapter";
			/** Trusted registered candidates for an operator handoff choice. */
			candidate_adapter_ids: readonly string[];
			/** Present only when exactly one registered correction is deterministic. */
			deterministic_replacement_adapter_id?: string;
	  }
	| {
			failure_class: "adapter-not-installed";
			cause: "executable_absent";
			adapter_id: string;
			/** Trusted manual-install inputs (identity, pin, install location, owner, docs) are complete. */
			manual_install_inputs_complete: boolean;
			automatic_install?: BrowserConnectIsolatedInstallEvidence;
	  }
	| {
			failure_class: "adapter-not-installed";
			cause: "version_mismatch";
			adapter_id: string;
			observed_version: string;
			pinned_version: string;
			/** The registry explicitly allowlists this exact observed-to-pin transition (R21/R22). */
			transition_allowlisted: boolean;
			automatic_install?: BrowserConnectIsolatedInstallEvidence;
	  }
	| {
			failure_class: "route-incompatible";
			cause: "route_unsupported";
			/** Trusted registered candidates with an implemented compatible route. */
			candidate_adapter_ids: readonly string[];
	  }
	| {
			failure_class: "attachment-failed";
			cause: "transient_probe_failure";
			/** True when the gateway already spent its one bounded re-probe (R23). */
			re_probe_attempted: boolean;
	  }
	| {
			failure_class: "attachment-failed";
			cause: "probe_failed";
	  };

/**
 * Typed run repair context (R12/R26). No wrapped argv, arguments, environment
 * values, or full executable paths — the separator variant carries only the
 * non-empty-command boolean marker, and the missing-executable variant carries
 * at most a normalized basename that policy re-validates before use.
 */
export type BrowserConnectRunRepairContext =
	| {
			failure_class: "run-missing-separator";
			cause: "separator_missing";
			/** Parser-memory marker: a non-empty wrapped command exists (never echoed). */
			wrapped_command_present: boolean;
	  }
	| {
			failure_class: "run-missing-separator";
			cause: "wrapped_command_missing";
	  }
	| {
			failure_class: "wrapped-command-not-found";
			cause: "wrapped_executable_absent";
			deterministic_correction: boolean;
			/** Normalized basename only; policy fails closed on unsafe values (R26). */
			executable_basename?: string;
	  }
	| {
			failure_class: "preexec-connect-failed";
			cause: "preexec_connect_failure";
			/** The underlying typed failure; policy inherits its exact posture. */
			underlying:
				| BrowserConnectEnvironmentRepairContext
				| BrowserConnectAdapterRepairContext;
	  };

/**
 * Full typed repair context union (R4): one variant family per failure class,
 * exhaustive over all 12 classes. `repair-path.ts` switches over
 * `failure_class` with never-exhaustiveness, so an unhandled class is a type
 * error, and unknown runtime values fail closed to an operator stage (R9).
 */
export type BrowserConnectRepairContext =
	| {
			failure_class: "usage-invalid";
			cause: "usage_invalid";
			/** A single accepted-usage correction is known deterministically. */
			deterministic_correction: boolean;
	  }
	| BrowserConnectRunRepairContext
	| BrowserConnectEnvironmentRepairContext
	| BrowserConnectAdapterRepairContext
	| {
			failure_class: "runtime-error-unexpected";
			cause: "unexpected_runtime_error";
	  };

/**
 * Failure payload (R2): failure class plus exactly one next safe action.
 * `detail` is optional free text and always passes the redaction chokepoint
 * before serialization (R14).
 *
 * `suggested_explicit_port` is additive schema-1 evidence (R6): the typed
 * warm-chrome suggestion, projected only when a hop-0 driver could use it to
 * build the one `use_suggested_port` rerun — a headless driver must never
 * have to scrape the port from a stderr diagnostic. Numbers and a boolean
 * only, so text safety is unaffected.
 */
export type BrowserConnectFailurePayload = {
	outcome: "failed";
	failure_class: BrowserConnectFailureClass;
	next_action_id: BrowserConnectFailureActionId;
	environment: BrowserConnectEnvironmentIdentity;
	launch: BrowserConnectLaunchProvenance;
	suggested_explicit_port?: BrowserConnectSuggestedPortEvidence;
	detail?: string;
};

/**
 * Envelope payload union before facade metadata is attached.
 */
export type BrowserConnectEnvelopePayload =
	| BrowserConnectHandoffPayload
	| BrowserConnectFailurePayload;

/**
 * Envelope data after facade metadata (`contract_id`, `schema_version`) is
 * attached by the facade result-data helper.
 */
export type BrowserConnectEnvelopeData = CommandResultData<
	BrowserConnectEnvelopePayload,
	typeof BROWSER_CONNECT_RESULT_CONTRACT
>;

/**
 * Build envelope data through the facade result-data helper.
 *
 * Enforces the affordance catalog (a failure envelope may only carry the one
 * next action its failure class authorizes), redacts free-text detail through
 * the chokepoint (R14), and rejects reserved metadata keys via the facade
 * helper.
 *
 * @param payload - Handoff or failure payload without facade metadata keys
 * @returns Payload with `contract_id` and `schema_version` attached
 * @throws When the next action is unauthorized or reserved keys are present
 */
export function createBrowserConnectEnvelopeData(
	payload: BrowserConnectEnvelopePayload,
): BrowserConnectEnvelopeData {
	const safePayload = payload.outcome === "failed" ? redactFailure(payload) : payload;
	return createCommandResultData(
		{ resultContract: BROWSER_CONNECT_RESULT_CONTRACT },
		safePayload,
	) as BrowserConnectEnvelopeData;
}

function redactFailure(
	payload: BrowserConnectFailurePayload,
): BrowserConnectFailurePayload {
	const authorized: readonly BrowserConnectFailureActionId[] =
		BROWSER_CONNECT_LEGACY_NEXT_ACTIONS_BY_FAILURE_CLASS[payload.failure_class];
	if (!authorized.includes(payload.next_action_id)) {
		throw new Error(
			`next_action_id ${payload.next_action_id} is not an authorized affordance for ${payload.failure_class}; expected one of ${authorized.join(", ")}.`,
		);
	}
	if (payload.detail === undefined) return payload;
	return { ...payload, detail: redactBrowserConnectText(payload.detail) };
}

/**
 * Redaction chokepoint for envelope and diagnostic free text (R14/KTD10),
 * mirroring warm-chrome's `redactUnsafeText` stance. Scrubs 1Password secret
 * references, bearer tokens, websocket debugger URLs, sensitive option
 * values, sensitive key=value pairs, and local paths. Structured verified
 * endpoint fields never pass through here — they stay verbatim by contract.
 */
export function redactBrowserConnectText(value: string): string {
	return value
		.replace(/\bop:\/\/\S+/gi, "[redacted]")
		.replace(/\bwss?:\/\/\S+/gi, "[redacted]")
		.replace(/\bBearer\s+\S+/gi, "[redacted]")
		.replace(/--[A-Za-z0-9][\w-]*(?:=\S*)?/g, (match) =>
			hasSensitiveName(match) ? "[redacted]" : match,
		)
		.replace(/\b[\w-]*(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)[\w-]*=\S+/gi, "[redacted]")
		.replace(/(^|[\s:(=])(?:~\/|\/)\S+/g, "$1[redacted]");
}

/**
 * Usage-message chokepoint (R14), mirroring warm-chrome's
 * `sanitizeUsageMessage`: echoed argument values that look like paths,
 * secret references, or sensitive option names are redacted wholesale.
 */
export function sanitizeBrowserConnectUsageMessage(message: string): string {
	if (message.startsWith("unexpected argument: ")) {
		return `unexpected argument: ${sanitizeUsageValue(
			message.slice("unexpected argument: ".length),
		)}`;
	}
	if (message.startsWith("unknown option: ")) {
		return `unknown option: ${sanitizeUsageValue(
			message.slice("unknown option: ".length),
		)}`;
	}
	return redactBrowserConnectText(message);
}

function sanitizeUsageValue(value: string): string {
	if (isUnsafeUsageValue(value)) return "[redacted]";
	return redactBrowserConnectText(value);
}

function isUnsafeUsageValue(value: string): boolean {
	return (
		value.startsWith("/") ||
		value.startsWith("~/") ||
		value.startsWith("op://") ||
		hasSensitiveName(value)
	);
}

function hasSensitiveName(value: string): boolean {
	return /(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)/i.test(
		value,
	);
}
