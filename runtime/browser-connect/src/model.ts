import {
	type CommandFacadeActionAffordance,
	type CommandFacadeResultContract,
	type CommandResultData,
	createCommandResultData,
} from "@side-quest/cli-command-facade";

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
 * Machine schema version for v1 browser-connect JSON envelopes (R16).
 *
 * @defaultValue "1"
 */
export const BROWSER_CONNECT_SCHEMA_VERSION = "1" as const;

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
export const BROWSER_CONNECT_ENVIRONMENT_NAMES = ["agent-chrome"] as const;

/**
 * Environment name union.
 */
export type BrowserConnectEnvironmentName =
	(typeof BROWSER_CONNECT_ENVIRONMENT_NAMES)[number];

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
] as const;

/**
 * Route id union — also the browser-entry mode vocabulary the envelope names
 * (R16): the door through which the browser session is entered.
 */
export type BrowserConnectRouteId = (typeof BROWSER_CONNECT_ROUTES)[number];

/**
 * Evidence status a route capability carries per Adapter Definition (KTD7).
 */
export const BROWSER_CONNECT_ROUTE_EVIDENCE_STATUSES = [
	"verified-live",
	"documented",
	"candidate",
] as const;

/**
 * Route evidence status union.
 */
export type BrowserConnectRouteEvidenceStatus =
	(typeof BROWSER_CONNECT_ROUTE_EVIDENCE_STATUSES)[number];

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
 * (snake_case) for cross-package continuation continuity.
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
] as const;

/**
 * Failure runtime-action id union.
 */
export type BrowserConnectFailureActionId =
	(typeof BROWSER_CONNECT_FAILURE_ACTION_IDS)[number];

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

/**
 * Environment identity (R2): whose browser this is. v1 names exactly one
 * Agent Chrome; future multi-identity distinguishes instances here.
 */
export type BrowserConnectEnvironmentIdentity = {
	name: BrowserConnectEnvironmentName;
};

/**
 * Verified endpoint forms (R2). Both forms come verbatim from the environment
 * proof (structured ok-envelope exemption — the JSON envelope is the one
 * surface that carries the verified websocket URL intact); neither is ever
 * derived from the port convention.
 */
export type BrowserConnectVerifiedEndpoint = {
	http: string;
	ws: string;
};

/**
 * The specific adapter attachment the envelope authorizes (R16). The
 * `probe_executable` names which executable performed the attachment probe
 * (R4: proof names a handshake the adapter itself performed).
 */
export type BrowserConnectAuthorizedAttachment = {
	adapter_id: string;
	route: BrowserConnectRouteId;
	probe_executable: string;
};

/**
 * Launch provenance (R3): mandatory structured field on every envelope.
 * `launched` is true only when browser-connect launched Agent Chrome during
 * this run.
 */
export type BrowserConnectLaunchProvenance = {
	launched: boolean;
};

/**
 * Proof evidence summary (R2): names the environment proof contract that
 * vouched for the endpoint and the declared evidence status of the authorized
 * route.
 */
export type BrowserConnectProofEvidence = {
	environment_contract_id: string;
	environment_schema_version: string;
	route_evidence: BrowserConnectRouteEvidenceStatus;
};

/**
 * Verified handoff payload (R2/R16): decision-complete in one read — names
 * the browser-entry mode and the specific adapter attachment it authorizes.
 * Run-id correlation stays facade-owned on the outer runtime envelope
 * (`run_id`, caller-suppliable, warm-chrome `--run-id` parity).
 */
export type BrowserConnectHandoffPayload = {
	outcome: "verified";
	environment: BrowserConnectEnvironmentIdentity;
	browser_entry_mode: BrowserConnectRouteId;
	attachment: BrowserConnectAuthorizedAttachment;
	endpoint: BrowserConnectVerifiedEndpoint;
	launch: BrowserConnectLaunchProvenance;
	proof: BrowserConnectProofEvidence;
};

/**
 * Failure payload (R2): failure class plus exactly one next safe action.
 * `detail` is optional free text and always passes the redaction chokepoint
 * before serialization (R14).
 */
export type BrowserConnectFailurePayload = {
	outcome: "failed";
	failure_class: BrowserConnectFailureClass;
	next_action_id: BrowserConnectFailureActionId;
	environment: BrowserConnectEnvironmentIdentity;
	launch: BrowserConnectLaunchProvenance;
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
	const authorized =
		BROWSER_CONNECT_NEXT_ACTION_BY_FAILURE_CLASS[payload.failure_class];
	if (payload.next_action_id !== authorized) {
		throw new Error(
			`next_action_id ${payload.next_action_id} is not the authorized affordance for ${payload.failure_class}; expected ${authorized}.`,
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
