// U4 environment gateway: prove-or-launch Agent Chrome as a library call.
//
// Consumes `@side-quest/warm-chrome` IN-PROCESS (KTD2): runs its `main` with a
// captured writer, parses the JSON envelope, and maps the result into
// browser-connect's environment-proof vocabulary. No child-process shell-out.
//
// Deliberately a plain module — NO environment-interface abstraction (R9 /
// KTD2). The interface is not extracted until slice two's second environment
// implementation earns it.

import {
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_SCHEMA_VERSION,
	type WarmChromeCheckErrorCode,
	type WarmChromeRuntime,
} from "@side-quest/warm-chrome";
import type { WarmChromeMainDeps } from "@side-quest/warm-chrome/cli";

import type {
	BrowserConnectEnvironmentIdentity,
	BrowserConnectEnvironmentRepairCause,
	BrowserConnectEnvironmentRepairContext,
	BrowserConnectFailureClass,
	BrowserConnectLaunchProvenance,
	BrowserConnectProfilePostureProof,
	BrowserConnectProofEvidence,
	BrowserConnectSuggestedPortEvidence,
	BrowserConnectVerifiedEndpoint,
} from "./model.ts";

/**
 * The single environment browser-connect v1 proves (R10): Agent Chrome, the
 * warm-chrome convention profile. Never silently substituted.
 *
 * `profile` is the LOGICAL profile id (schema 2, KTD13): "default" names the
 * one warm-chrome convention profile. Physical profile directories stay owned
 * by warm-chrome; this identity never carries a filesystem path.
 */
export const AGENT_CHROME_IDENTITY: BrowserConnectEnvironmentIdentity = {
	name: "agent-chrome",
	profile: "default",
};

/**
 * Slice-one route evidence for the explicit-CDP door: verified-live (R12/KTD7).
 */
const AGENT_CHROME_ROUTE_EVIDENCE: BrowserConnectProofEvidence["route_evidence"] =
	"verified-live";

/**
 * Warm-chrome's exit-20 semantic family (KTD4): a browser-entry failure whose
 * fail-closed meaning browser-connect preserves. Anything at this exit code
 * maps to an environment failure class, never `runtime-error-unexpected`.
 */
const WARM_CHROME_BROWSER_ENTRY_EXIT_CODE = 20;

/**
 * The declared exit-20-family default catch class (R11).
 *
 * A warm-chrome exit-20 error whose `error.code` is not in
 * {@link WARM_CHROME_REASON_TO_FAILURE_CLASS} (a NEW upstream reason the type
 * system did not yet force us to map, or a non-check exit-20 code) degrades to
 * this class — the most honest existing class for "something is on the CDP port
 * that browser-connect could not verify as Agent Chrome": a foreign listener.
 * It NEVER degrades to exit-1 `runtime-error-unexpected`.
 */
export const WARM_CHROME_EXIT_20_DEFAULT_FAILURE_CLASS: BrowserConnectFailureClass =
	"foreign-listener";

/**
 * Exhaustive mapping from warm-chrome's exported check error-code union onto
 * browser-connect env-gateway failure classes (R11).
 *
 * `satisfies Record<WarmChromeCheckErrorCode, ...>` over warm-chrome's exported
 * `WARM_CHROME_CHECK_REASONS` key union makes this compile-time exhaustive:
 * a NEW upstream reason code is a TYPE ERROR here, so it can never silently
 * degrade to `runtime-error-unexpected` (exit 1). Every value stays in the
 * exit-20 environment family (`environment-absent` / `foreign-listener`).
 */
export const WARM_CHROME_REASON_TO_FAILURE_CLASS = {
	// Nothing answered the CDP endpoint — Agent Chrome is not running.
	endpoint_unreachable: "environment-absent",
	// A listener is present but proof rejects it as not Agent Chrome.
	port_occupied_foreign: "foreign-listener",
	// A non-Agent-Chrome browser answered (Chrome for Testing, Chromium, …).
	wrong_browser: "foreign-listener",
	// A listener at a non-loopback endpoint — a foreign identity.
	non_loopback: "foreign-listener",
	// Something answered but is not a valid Agent Chrome CDP endpoint.
	invalid_cdp: "foreign-listener",
	// A real Chrome on an unsafe/default profile — a foreign instance.
	unsafe_profile: "foreign-listener",
	// The profile exists but its effective credential posture is untrusted.
	profile_posture_unsafe: "foreign-listener",
	// The verified listener's identity shifted mid-proof — untrusted.
	listener_mismatch: "foreign-listener",
} as const satisfies Record<WarmChromeCheckErrorCode, BrowserConnectFailureClass>;

/**
 * Exhaustive mapping from warm-chrome's check error codes onto U1's typed
 * environment repair causes (R6/R10). Compile-time exhaustive like the class
 * record above, and consistent with it: `endpoint_unreachable` is the ONLY
 * code in the `environment-absent` class and the only `no_listener` cause;
 * every other code stays a listener cause in the `foreign-listener` class.
 */
export const WARM_CHROME_REASON_TO_ENVIRONMENT_CAUSE = {
	// No CDP listener on the requested port — the port is provably free.
	endpoint_unreachable: "no_listener",
	// Something occupies the port; identity is not Agent Chrome.
	port_occupied_foreign: "occupied_listener",
	// A browser answered but it carries a foreign identity.
	wrong_browser: "foreign_listener",
	non_loopback: "foreign_listener",
	unsafe_profile: "foreign_listener",
	profile_posture_unsafe: "foreign_listener",
	// Something answered but could not be verified as an Agent Chrome CDP end.
	invalid_cdp: "unverified_listener",
	listener_mismatch: "unverified_listener",
} as const satisfies Record<
	WarmChromeCheckErrorCode,
	BrowserConnectEnvironmentRepairCause
>;

/**
 * The exit-20-family default cause (R9): an unknown or unparseable warm-chrome
 * outcome pairs with {@link WARM_CHROME_EXIT_20_DEFAULT_FAILURE_CLASS} as an
 * unverified listener — fail closed, never a launch-earning absence.
 */
export const WARM_CHROME_EXIT_20_DEFAULT_ENVIRONMENT_CAUSE =
	"unverified_listener" satisfies BrowserConnectEnvironmentRepairCause;

/**
 * Injectable dependencies for the environment gateway. Tests replace
 * `warmChromeMain` with a scripted fake and observe `reconfigureDiagnostics`
 * without ever probing a real Chrome.
 */
export type EnvironmentGatewayDeps = {
	/**
	 * warm-chrome's `main` from its `./cli` export. Runs in-process with a
	 * captured stdout writer; the gateway parses its JSON envelope.
	 */
	warmChromeMain: (
		argv: readonly string[],
		deps?: WarmChromeMainDeps,
	) => Promise<number>;
	/**
	 * Re-apply browser-connect's own diagnostics configuration. warm-chrome's
	 * `main` mutates process-global LogTape state and `resetCliDiagnostics()`
	 * in its `finally`, tearing down the redactor. This hook restores
	 * browser-connect's R14/KTD10 redaction chokepoint; the gateway runs it
	 * after EVERY in-process `main` return.
	 */
	reconfigureDiagnostics: () => void;
	/** Run correlation id forwarded to warm-chrome (`--run-id` parity, R16). */
	runId: string;
	/**
	 * Launch Agent Chrome when the first `check` reports it absent, then
	 * re-prove via `check`. Off by default so the gateway is a pure read.
	 */
	autoLaunch?: boolean;
	/**
	 * Explicit CDP port already validated by the command contract (R15/KTD7).
	 * The gateway forwards the SAME value to warm-chrome check, launch, and
	 * recheck — never re-derived, never switched mid-invocation.
	 */
	explicitPort?: number;
	/** Optional warm-chrome runtime override forwarded to `main` (tests only). */
	warmChromeRuntime?: WarmChromeRuntime;
};

/**
 * A verified Agent Chrome environment proof (R2/R12): both endpoint forms come
 * verbatim from warm-chrome's ok envelope.
 */
export type EnvironmentGatewayVerified = {
	outcome: "verified";
	environment: BrowserConnectEnvironmentIdentity;
	endpoint: BrowserConnectVerifiedEndpoint;
	launch: BrowserConnectLaunchProvenance;
	proof: BrowserConnectProofEvidence;
};

/**
 * A failed environment proof (R11): a fail-closed failure class plus the launch
 * provenance so far. No endpoint — the environment was never verified.
 */
export type EnvironmentGatewayFailed = {
	outcome: "failed";
	environment: BrowserConnectEnvironmentIdentity;
	failure_class: BrowserConnectFailureClass;
	launch: BrowserConnectLaunchProvenance;
	/**
	 * Typed repair context (R6/R10): preserves the warm-chrome reason as a
	 * typed cause and any `suggested_explicit_port` as typed evidence. The
	 * suggestion is NEVER consumed in this invocation (no_internal_port_switch);
	 * repair-path policy decides what it earns.
	 */
	repair_context: BrowserConnectEnvironmentRepairContext;
	/** Free text; callers redact before serialization (R14). */
	detail?: string;
};

/**
 * Environment gateway result union.
 */
export type EnvironmentGatewayResult =
	| EnvironmentGatewayVerified
	| EnvironmentGatewayFailed;

type WarmChromeOkEnvelope = {
	status: "ok";
	data: {
		endpoint: string;
		web_socket_debugger_url: string;
		contract_id: string;
		schema_version: string;
		port: string;
		browser_pid: number;
		credential_posture: BrowserConnectProfilePostureProof;
	};
};

type WarmChromeErrorEnvelope = {
	status: "error";
	process_exit_code?: number;
	error: {
		code: string;
		exit_code: number;
		message?: string;
	};
	data?: { reason?: string; suggested_explicit_port?: number };
};

type ParsedWarmChromeEnvelope = WarmChromeOkEnvelope | WarmChromeErrorEnvelope;

/**
 * Prove — or, when `autoLaunch` is set, launch-then-prove — Agent Chrome.
 *
 * Runs warm-chrome's `main` in-process (KTD2). On a verified check the ok
 * envelope's http + ws endpoint forms are mapped into browser-connect's
 * verified-endpoint vocabulary (R12). On an exit-20 failure the error code is
 * mapped onto a fail-closed failure class (R11). Auto-launch drives `launch`
 * then re-proves via `check`, capturing launch provenance (R3).
 *
 * @param deps - Injectable warm-chrome `main`, diagnostics re-config hook, run
 *   id, and launch policy
 * @returns A verified proof or a typed failure — never throws for a warm-chrome
 *   exit-20 outcome
 */
export async function proveAgentChromeEnvironment(
	deps: EnvironmentGatewayDeps,
): Promise<EnvironmentGatewayResult> {
	try {
		return await proveAgentChromeEnvironmentInner(deps);
	} catch (error) {
		// P3: keep the exit-20 invariant (R11/KTD4) robust to upstream warm-chrome
		// drift. `parseWarmChromeEnvelope` throws on an empty/non-JSON/unexpected
		// capture; that throw would otherwise escape this try/finally, reach main's
		// catch, and degrade to exit-1 `runtime-error-unexpected` — breaking the
		// invariant that any warm-chrome browser-entry outcome stays exit-20-family.
		// NOT currently reachable (browser-connect always calls warm-chrome with
		// fixed `--json` argv, which always emits an envelope), but mapping it here
		// makes the guarantee robust regardless of what warm-chrome emits. A
		// non-parse error (a genuine browser-connect bug) is rethrown unchanged.
		if (!(error instanceof WarmChromeEnvelopeParseError)) throw error;
		return {
			outcome: "failed",
			environment: AGENT_CHROME_IDENTITY,
			failure_class: WARM_CHROME_EXIT_20_DEFAULT_FAILURE_CLASS,
			launch: { launched: false },
			// R9: an unverifiable capture fails closed with the default typed
			// cause — never a launch-earning absence.
			repair_context: {
				failure_class: "foreign-listener",
				cause: WARM_CHROME_EXIT_20_DEFAULT_ENVIRONMENT_CAUSE,
			},
			detail: error.message,
		};
	}
}

async function proveAgentChromeEnvironmentInner(
	deps: EnvironmentGatewayDeps,
): Promise<EnvironmentGatewayResult> {
	// R15/KTD7: ONE validated explicit port for the whole invocation — the same
	// argument pair reaches check, launch, and recheck, or none of them.
	const portArgs =
		deps.explicitPort === undefined
			? []
			: ["--port", String(deps.explicitPort)];

	const first = await runWarmChrome(deps, ["check", "--json", ...portArgs]);

	if (first.outcome === "ok") {
		return verifiedResult(first.envelope, { launched: false });
	}

	const firstClass = classifyExit20(first);

	// Fail closed unless auto-launch is requested and the environment is absent.
	if (!deps.autoLaunch || firstClass !== "environment-absent") {
		return {
			outcome: "failed",
			environment: AGENT_CHROME_IDENTITY,
			failure_class: firstClass,
			launch: { launched: false },
			repair_context: environmentRepairContextFor(first, firstClass),
		};
	}

	// Launch path (R3): drive `launch`, then re-prove via `check`.
	const launch = await runWarmChrome(deps, ["launch", "--json", ...portArgs]);
	if (launch.outcome === "error") {
		// A launch that itself failed never yields a handoff — provenance stays
		// false because no verified session was produced (R11).
		return {
			outcome: "failed",
			environment: AGENT_CHROME_IDENTITY,
			failure_class: "launch-failed",
			launch: { launched: false },
			repair_context: { failure_class: "launch-failed", cause: "launch_failed" },
		};
	}

	const reProve = await runWarmChrome(deps, ["check", "--json", ...portArgs]);
	if (reProve.outcome === "ok") {
		return verifiedResult(reProve.envelope, { launched: true });
	}

	// Decision (P2/AE7): KEEP the re-prove, fix provenance attribution.
	//
	// warm-chrome's `launch` already re-proves internally via its bounded
	// readiness poll (runtime/warm-chrome src/launch.ts), so its ok envelope is
	// authoritative and dropping this second `check` would be sound. We do NOT
	// drop it here only because that would change the check-count contract the
	// out-of-scope connect-command tests assert (`check → launch → check`); the
	// attribution fix below is sufficient and blast-radius-free.
	//
	// We reach this branch ONLY because `launch.outcome !== "error"` — i.e.
	// warm-chrome's launch invocation returned a verified/ok outcome, which means
	// a Chrome WAS spawned. The re-prove then failed (the spawned Chrome died, or
	// a race). Cleanup responsibility is always attributable (AE7): because the
	// launch invocation itself succeeded, we OWN whatever it started regardless of
	// what the re-prove says, so provenance is launched:true. A launch that itself
	// failed keeps launched:false in the branch above.
	//
	// R23/KTD12: the re-prove above is the invocation's ONE bounded recheck.
	// Ending here — with no further warm-chrome call and no fresh-invocation
	// continuation — keeps the retry budget in-invocation.
	return {
		outcome: "failed",
		environment: AGENT_CHROME_IDENTITY,
		failure_class: "launch-failed",
		launch: { launched: true },
		repair_context: { failure_class: "launch-failed", cause: "launch_failed" },
	};
}

type WarmChromeRun =
	| { outcome: "ok"; exitCode: number; envelope: WarmChromeOkEnvelope }
	| {
			outcome: "error";
			exitCode: number;
			envelope: WarmChromeErrorEnvelope;
	  };

/**
 * Run warm-chrome's `main` in-process with a captured writer, restore
 * browser-connect diagnostics after it returns, and parse the JSON envelope.
 *
 * The diagnostics re-config MUST run after every `main` return (its `finally`
 * calls `resetCliDiagnostics()`), so the KTD10/R14 chokepoint is never left
 * disabled post-gateway.
 */
async function runWarmChrome(
	deps: EnvironmentGatewayDeps,
	command: readonly string[],
): Promise<WarmChromeRun> {
	let output = "";
	const stdout = {
		write: (chunk: string) => {
			output += chunk;
			return true as const;
		},
	};

	const argv = ["--run-id", deps.runId, ...command];
	let exitCode: number;
	try {
		exitCode = await deps.warmChromeMain(argv, {
			stdout,
			...(deps.warmChromeRuntime ? { runtime: deps.warmChromeRuntime } : {}),
		});
	} finally {
		// R14/KTD10: warm-chrome's main tore down LogTape in its finally; restore
		// browser-connect's redactor immediately, on success AND on throw.
		deps.reconfigureDiagnostics();
	}

	const envelope = parseWarmChromeEnvelope(output);
	if (envelope.status === "ok") {
		return { outcome: "ok", exitCode, envelope };
	}
	return { outcome: "error", exitCode, envelope };
}

/**
 * A warm-chrome capture that could not be parsed into a `{ status }` envelope
 * (empty, non-JSON, or an unexpected status). Distinct type so
 * {@link proveAgentChromeEnvironment} can catch ONLY parse failures and map them
 * into the exit-20 family (P3/R11), while a genuine browser-connect bug still
 * propagates.
 */
class WarmChromeEnvelopeParseError extends Error {}

function parseWarmChromeEnvelope(output: string): ParsedWarmChromeEnvelope {
	// warm-chrome writes exactly one envelope to the capture writer via the
	// facade's `writeJson`, which pretty-prints (`JSON.stringify(value, null, 2)`)
	// across multiple lines. Parse the whole trimmed capture as one JSON
	// document — reading only the last line would parse a bare `}` and throw.
	const document = output.trim();
	if (!document) {
		throw new WarmChromeEnvelopeParseError(
			"warm-chrome emitted no JSON envelope on the capture writer.",
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(document);
	} catch (error) {
		throw new WarmChromeEnvelopeParseError(
			`warm-chrome capture was not valid JSON: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	if (!isRecord(parsed) || (parsed.status !== "ok" && parsed.status !== "error")) {
		throw new WarmChromeEnvelopeParseError(
			`warm-chrome envelope carried an unexpected status: ${String(
				isRecord(parsed) ? parsed.status : undefined,
			)}`,
		);
	}
	if (parsed.status === "ok") {
		const data = isRecord(parsed.data) ? parsed.data : undefined;
		if (
			data?.contract_id !== WARM_CHROME_CONTRACT_ID ||
			data.schema_version !== WARM_CHROME_SCHEMA_VERSION
		) {
			throw new WarmChromeEnvelopeParseError(
				"warm-chrome ok envelope carried unrecognized contract provenance.",
			);
		}
		const endpointPort = readBoundEndpointPort(
			data?.endpoint,
			data?.web_socket_debugger_url,
		);
		const profilePosture = parseLiveCleanProfilePosture(
			data?.credential_posture,
			{
				port:
					endpointPort !== null && data?.port === endpointPort
						? endpointPort
						: null,
				browserPid: data?.browser_pid,
			},
		);
		if (profilePosture === null) {
			throw new WarmChromeEnvelopeParseError(
				"warm-chrome ok envelope lacked exact live-clean profile posture.",
			);
		}
		return {
			...(parsed as WarmChromeOkEnvelope),
			data: {
				...((parsed as WarmChromeOkEnvelope).data),
				credential_posture: profilePosture,
			},
		};
	}
	return parsed as WarmChromeErrorEnvelope;
}

function readBoundEndpointPort(httpValue: unknown, wsValue: unknown): string | null {
	if (typeof httpValue !== "string" || typeof wsValue !== "string") return null;
	try {
		const http = new URL(httpValue);
		const ws = new URL(wsValue);
		if (
			http.protocol !== "http:" ||
			ws.protocol !== "ws:" ||
			http.hostname !== "127.0.0.1" ||
			ws.hostname !== "127.0.0.1" ||
			!isNumericPort(http.port) ||
			http.port !== ws.port ||
			!ws.pathname.startsWith("/devtools/browser/")
		) {
			return null;
		}
		return http.port;
	} catch {
		return null;
	}
}

function parseLiveCleanProfilePosture(
	value: unknown,
	binding: {
		port: unknown;
		browserPid: unknown;
	},
): BrowserConnectProfilePostureProof | null {
	if (
		!hasExactKeys(value, ["state", "disk", "process", "effective"]) ||
		value.state !== "live-clean" ||
		!hasExactKeys(value.disk, [
			"save_setting",
			"auto_signin_setting",
			"sync_setting",
			"stored_login",
		]) ||
		value.disk.save_setting !== "disabled" ||
		value.disk.auto_signin_setting !== "disabled" ||
		value.disk.sync_setting !== "disabled" ||
		value.disk.stored_login !== "live-observed-absent" ||
		!hasExactKeys(value.process, [
			"disable_sync_switch",
			"disable_extensions_switch",
		]) ||
		value.process.disable_sync_switch !== "present" ||
		value.process.disable_extensions_switch !== "present" ||
		!hasExactKeys(value.effective, [
			"observation",
			"save_capability",
			"fill_exposure",
			"sync_state",
			"save_prompt",
			"observer",
		]) ||
		value.effective.observation !== "running-chrome" ||
		value.effective.save_capability !== "disabled" ||
		value.effective.fill_exposure !== "no-source" ||
		value.effective.sync_state !== "disabled" ||
		value.effective.save_prompt !== "suppressed" ||
		!hasExactKeys(value.effective.observer, [
			"source",
			"browser_pid",
			"port",
			"profile_match",
			"observed_at_ms",
		]) ||
		value.effective.observer.source !== "chrome-webui" ||
		value.effective.observer.profile_match !== "exact" ||
		!isPositiveInteger(binding.browserPid) ||
		value.effective.observer.browser_pid !== binding.browserPid ||
		!isNumericPort(binding.port) ||
		value.effective.observer.port !== binding.port ||
		!isNonNegativeFiniteNumber(value.effective.observer.observed_at_ms)
	) {
		return null;
	}
	return value as BrowserConnectProfilePostureProof;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNumericPort(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{1,5}$/.test(value)) return false;
	const port = Number(value);
	return port >= 1 && port <= 65_535;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<K extends string>(
	value: unknown,
	keys: readonly K[],
): value is Record<K, unknown> {
	if (!isRecord(value)) return false;
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

/**
 * Map an errored warm-chrome run onto a fail-closed failure class (R11).
 *
 * A known check error code resolves through the exhaustive record; a truly
 * unknown code at the exit-20 family degrades to the declared default catch —
 * never to `runtime-error-unexpected`.
 */
function classifyExit20(
	run: Extract<WarmChromeRun, { outcome: "error" }>,
): BrowserConnectFailureClass {
	const code = run.envelope.error.code;
	if (isKnownCheckErrorCode(code)) {
		return WARM_CHROME_REASON_TO_FAILURE_CLASS[code];
	}
	// Unknown code: honor the exit-20 semantic family (KTD4). Even an off-family
	// exit code from warm-chrome is a browser-entry failure to browser-connect,
	// so it stays in the exit-20 default rather than degrading to exit 1.
	void WARM_CHROME_BROWSER_ENTRY_EXIT_CODE;
	return WARM_CHROME_EXIT_20_DEFAULT_FAILURE_CLASS;
}

function isKnownCheckErrorCode(code: string): code is WarmChromeCheckErrorCode {
	return Object.hasOwn(WARM_CHROME_REASON_TO_FAILURE_CLASS, code);
}

/**
 * Build the typed environment repair context for an errored first check
 * (R6/R10): the warm-chrome reason is preserved as a typed cause and a
 * `suggested_explicit_port` becomes typed evidence — captured, never consumed.
 */
function environmentRepairContextFor(
	run: Extract<WarmChromeRun, { outcome: "error" }>,
	failureClass: BrowserConnectFailureClass,
): BrowserConnectEnvironmentRepairContext {
	if (failureClass === "environment-absent") {
		// endpoint_unreachable: nothing answered on the requested port, so the
		// explicit port is provably free for a launch (R7).
		return {
			failure_class: "environment-absent",
			cause: "no_listener",
			explicit_port_free: true,
		};
	}
	const code = run.envelope.error.code;
	const cause = isKnownCheckErrorCode(code)
		? WARM_CHROME_REASON_TO_ENVIRONMENT_CAUSE[code]
		: WARM_CHROME_EXIT_20_DEFAULT_ENVIRONMENT_CAUSE;
	const suggestion = suggestedPortEvidence(
		run.envelope.data?.suggested_explicit_port,
	);
	return {
		failure_class: "foreign-listener",
		// Defensive only: the class and cause records pair `no_listener` with
		// `environment-absent` exclusively (tested exhaustively), so a listener
		// class can never see `no_listener`; fail closed to unverified if it did.
		cause:
			cause === "no_listener"
				? WARM_CHROME_EXIT_20_DEFAULT_ENVIRONMENT_CAUSE
				: cause,
		...(suggestion === undefined
			? {}
			: { suggested_explicit_port: suggestion }),
	};
}

/**
 * Map warm-chrome's `data.suggested_explicit_port` onto typed evidence (R6).
 * warm-chrome only emits a suggestion it proved free during the occupied-port
 * probe, so a well-formed value carries `verified_free: true`; anything
 * malformed is dropped rather than trusted.
 */
function suggestedPortEvidence(
	value: unknown,
): BrowserConnectSuggestedPortEvidence | undefined {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > 65535
	) {
		return undefined;
	}
	return { port: value, verified_free: true };
}

function verifiedResult(
	envelope: WarmChromeOkEnvelope,
	launch: BrowserConnectLaunchProvenance,
): EnvironmentGatewayVerified {
	const endpoint: BrowserConnectVerifiedEndpoint = {
		http: envelope.data.endpoint,
		ws: envelope.data.web_socket_debugger_url,
	};
	return {
		outcome: "verified",
		environment: AGENT_CHROME_IDENTITY,
		endpoint,
		launch,
		proof: {
			environment_contract_id: envelope.data.contract_id,
			environment_schema_version: envelope.data.schema_version,
			route_evidence: AGENT_CHROME_ROUTE_EVIDENCE,
			profile_posture: envelope.data.credential_posture,
		},
	};
}
