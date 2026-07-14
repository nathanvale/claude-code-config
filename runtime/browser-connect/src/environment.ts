// U4 environment gateway: prove-or-launch Agent Chrome as a library call.
//
// Consumes `@side-quest/warm-chrome` IN-PROCESS (KTD2): runs its `main` with a
// captured writer, parses the JSON envelope, and maps the result into
// browser-connect's environment-proof vocabulary. No child-process shell-out.
//
// Deliberately a plain module — NO environment-interface abstraction (R9 /
// KTD2). The interface is not extracted until slice two's second environment
// implementation earns it.

import type {
	WarmChromeCheckErrorCode,
	WarmChromeRuntime,
} from "@side-quest/warm-chrome";
import type { WarmChromeMainDeps } from "@side-quest/warm-chrome/cli";

import type {
	BrowserConnectEnvironmentIdentity,
	BrowserConnectFailureClass,
	BrowserConnectLaunchProvenance,
	BrowserConnectProofEvidence,
	BrowserConnectVerifiedEndpoint,
} from "./model.ts";

/**
 * The single environment browser-connect v1 proves (R10): Agent Chrome, the
 * warm-chrome convention profile. Never silently substituted.
 */
const AGENT_CHROME_IDENTITY: BrowserConnectEnvironmentIdentity = {
	name: "agent-chrome",
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
	// The verified listener's identity shifted mid-proof — untrusted.
	listener_mismatch: "foreign-listener",
} as const satisfies Record<WarmChromeCheckErrorCode, BrowserConnectFailureClass>;

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
	data?: { reason?: string };
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
	const first = await runWarmChrome(deps, ["check", "--json"]);

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
		};
	}

	// Launch path (R3): drive `launch`, then re-prove via `check`.
	const launch = await runWarmChrome(deps, ["launch", "--json"]);
	if (launch.outcome === "error") {
		// A launch that itself failed never yields a handoff — provenance stays
		// false because no verified session was produced (R11).
		return {
			outcome: "failed",
			environment: AGENT_CHROME_IDENTITY,
			failure_class: "launch-failed",
			launch: { launched: false },
		};
	}

	const reProve = await runWarmChrome(deps, ["check", "--json"]);
	if (reProve.outcome === "ok") {
		return verifiedResult(reProve.envelope, { launched: true });
	}

	// Launch spawned but the re-prove never verified: no handoff (R11).
	return {
		outcome: "failed",
		environment: AGENT_CHROME_IDENTITY,
		failure_class: "launch-failed",
		launch: { launched: false },
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

function parseWarmChromeEnvelope(output: string): ParsedWarmChromeEnvelope {
	const line = output.trim().split("\n").filter(Boolean).at(-1);
	if (!line) {
		throw new Error("warm-chrome emitted no JSON envelope on the capture writer.");
	}
	const parsed = JSON.parse(line) as ParsedWarmChromeEnvelope;
	if (parsed.status !== "ok" && parsed.status !== "error") {
		throw new Error(
			`warm-chrome envelope carried an unexpected status: ${String(
				(parsed as { status?: unknown }).status,
			)}`,
		);
	}
	return parsed;
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
		},
	};
}
