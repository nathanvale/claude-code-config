// ---------------------------------------------------------------------------
// Shared mcporter transport (plan U4) + the envelope-derived adapter call (U3).
//
// Lane boundary (auth plan U1, R5/KTD2): this module implements the
// "mcporter-envelope-call" execution Interface the Adapter Lane Registry
// registers for the chrome-devtools-mcp lane ONLY. Other lanes register their
// own execution Interfaces in the lane table; this transport never becomes a
// universal adapter or auth abstraction, and no auth or secret value may pass
// through it.
//
// Browser Operation execution runs mcporter subcommands through the same
// transport Browser Adapter Proof used. This wrapper resolves and prefixes the
// command vector via the shared core, then maps the neutral failure reasons
// onto the Browser Operation diagnostic taxonomy:
//   - invalid override   -> browser_operation_command_override_invalid (input)
//   - missing binary     -> browser_operation_dependency_missing (dependency
//                            recovery; never Warm Chrome repair or adapter
//                            fallback)
// AE10: identical command-vector semantics across both surfaces. The argv vector
// is passed positionally to runtime.runCommand and never shell-evaluated.
//
// The envelope-derived call (R1/R2): every live adapter invocation is built
// from Verified Handoff Envelope facts — pinned binary via `--stdio`, verified
// endpoint verbatim via `--stdio-arg --browser-url` — never from a configured
// mcporter server name. The exact argv and env guard were pinned empirically
// against real mcporter 0.12.2 in mcporter-adapter-process-boundary.test.ts
// (ENVELOPE_ADAPTER_ARGV_CONTRACT / ENVELOPE_ADAPTER_ENV_GUARD).
// ---------------------------------------------------------------------------

import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	type McporterCommandResult,
	isMissingCommandResult,
	mcporterDependencyHintText,
	mcporterOverrideInvalidHintText,
	runMcporter,
} from "./mcporter-transport";

const OPERATION_TRANSPORT_TIMEOUT_MS = 8000;

export type BrowserOperationTransportFailure =
	| {
			kind: "command_override_invalid";
			code: "browser_operation_command_override_invalid";
			message: string;
			hintSummary: string;
	  }
	| {
			kind: "dependency_missing";
			code: "browser_operation_dependency_missing";
			message: string;
			hintSummary: string;
	  }
	| {
			kind: "transport_timeout";
			code: "browser_operation_transport_timeout";
			message: string;
			hintSummary: string;
	  }
	| {
			kind: "execution_failed";
			code: "browser_operation_transport_failed";
			message: string;
			hintSummary: string;
	  };

export type BrowserOperationTransportResult =
	| { ok: true; result: McporterCommandResult }
	| { ok: false; failure: BrowserOperationTransportFailure };

// --- Envelope-derived adapter call (U3, R1/R2) -------------------------------

// The envelope-derived slots. Everything else in the argv is literal.
export type EnvelopeAdapterCall = {
	// attachment.probe_executable, verbatim (KTD3 guarantees it is absolute).
	probeExecutable: string;
	// endpoint.http, verbatim (R2: endpoint authority holds to the spawn).
	endpointHttp: string;
	tool: string;
	argsJson: string;
};

// Mandatory env guard on every envelope-derived spawn. mcporter classifies any
// stdio command containing the fragment `chrome-devtools-mcp` as keep-alive
// and daemon-routes it: with a daemon running, the configured chrome-devtools
// server silently answers the call — wrong binary, wrong endpoint, exit 0
// (observed live in the U1 proof). `*` disables keep-alive routing for every
// name; `=1` matches nothing.
export const ENVELOPE_ADAPTER_CALL_ENV = {
	MCPORTER_NO_KEEPALIVE: "*",
} as const;

// Build the pinned ad-hoc argv. Token notes (all observed, U1):
//   - `--stdio-arg` space form only: the `=` form is parsed as a TOOL argument.
//   - `--experimentalPageIdRouting` makes take_snapshot/take_screenshot/emulate
//     accept a pageId directly, replacing the select_page two-call sequence
//     (selection state is process-local and meaningless on a fresh spawn).
//   - `--name` pins a fresh server name so no configured server is consulted.
export function envelopeAdapterCallArgs(call: EnvelopeAdapterCall): string[] {
	return [
		"call",
		"--stdio",
		call.probeExecutable,
		"--stdio-arg",
		"--browser-url",
		"--stdio-arg",
		call.endpointHttp,
		"--stdio-arg",
		"--experimentalPageIdRouting",
		"--name",
		"browser-use-envelope-adapter",
		"--tool",
		call.tool,
		"--args",
		call.argsJson,
		"--output",
		"json",
	];
}

// Run one envelope-derived adapter tool call: pinned argv + env guard through
// the shared transport, so the override channel and failure taxonomy apply
// unchanged (R9).
export async function runEnvelopeAdapterCall(
	runtime: BrowserUseRuntime,
	call: EnvelopeAdapterCall,
): Promise<BrowserOperationTransportResult> {
	return runBrowserUseMcporter(
		runtime,
		envelopeAdapterCallArgs(call),
		ENVELOPE_ADAPTER_CALL_ENV,
	);
}

// Run an mcporter subcommand for a Browser Operation. Returns a structured
// result U7's operation path maps onto its operation envelope. Failure routing
// mirrors Browser Adapter Proof so the two surfaces stay aligned (AE10): a
// missing binary or missing-command result routes to dependency recovery, a
// timed-out call routes to a distinct transport-timeout failure, and an invalid
// override routes to override-invalid. None fall back to an adapter or cold
// browser. Optional `env` overlays the inherited environment on the spawn.
export async function runBrowserUseMcporter(
	runtime: BrowserUseRuntime,
	args: readonly string[],
	env?: Record<string, string>,
): Promise<BrowserOperationTransportResult> {
	const outcome = await runMcporter(
		runtime,
		args,
		OPERATION_TRANSPORT_TIMEOUT_MS,
		env,
	);
	if (!outcome.ok) {
		if (outcome.reason === "invalid_override") {
			return {
				ok: false,
				failure: {
					kind: "command_override_invalid",
					code: "browser_operation_command_override_invalid",
					message: "mcporter command override is invalid.",
					hintSummary: mcporterOverrideInvalidHintText(outcome.message),
				},
			};
		}
		if (outcome.reason === "execution_failed") {
			// The command runner threw for a reason other than a spawn/start
			// failure. Report a distinct transport failure rather than telling the
			// operator mcporter is missing.
			return {
				ok: false,
				failure: {
					kind: "execution_failed",
					code: "browser_operation_transport_failed",
					message: "mcporter command execution failed unexpectedly.",
					hintSummary:
						"The mcporter transport failed without starting cleanly. Inspect the command runner before retrying the operation.",
				},
			};
		}
		return {
			ok: false,
			failure: dependencyMissingFailure(
				`${outcome.command} could not be started from the selected mcporter command vector.`,
			),
		};
	}
	// Guard the timeout before the missing-command check, matching Adapter Proof's
	// leaf ordering. A timed-out result carries exitCode 1 and empty output, so
	// without this branch it would be misreported as a clean success.
	if (outcome.result.timedOut) {
		return {
			ok: false,
			failure: {
				kind: "transport_timeout",
				code: "browser_operation_transport_timeout",
				message: "mcporter call timed out before the Browser Operation completed.",
				hintSummary:
					"The mcporter transport timed out. Retry, or repair Warm Chrome and the Browser Adapter before reattempting the operation.",
			},
		};
	}
	if (isMissingCommandResult(outcome.result)) {
		return {
			ok: false,
			failure: dependencyMissingFailure(
				"mcporter or the configured runner is missing.",
			),
		};
	}
	return { ok: true, result: outcome.result };
}

function dependencyMissingFailure(
	problem: string,
): Extract<BrowserOperationTransportFailure, { kind: "dependency_missing" }> {
	return {
		kind: "dependency_missing",
		code: "browser_operation_dependency_missing",
		message: "mcporter could not be started.",
		hintSummary: mcporterDependencyHintText(problem),
	};
}
