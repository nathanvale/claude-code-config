import { afterAll, describe, expect, test } from "bun:test";
import {
	configureCliDiagnostics,
	type CliWriter,
	emitCliDiagnostic,
	parseCliDiagnosticArgv,
	resetCliDiagnostics,
	withCliDiagnosticContext,
} from "@side-quest/cli-command-facade";
import { commitAuthTransaction } from "./browser-use-auth";
import type { BrowserUseAuthTransactionFragment } from "./browser-use-auth-model";
import {
	applyAuthTransition,
	beginAuthTransaction,
	type BrowserUseAuthTransactionEvent,
} from "./browser-use-auth-transaction";
import { acquireLease } from "./browser-use-locks";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	type BrowserUseGovernedSurface,
	markRunSensitive,
} from "./browser-use-sensitive-run";
import {
	createRunIntegrationPort,
	createSharedRun,
	leaseKeyForRun,
	type RunStoreDeps,
} from "./browser-use-runs";
import { readDurableFile } from "./browser-use-store";

// =========================================================================
// Runtime-environment cluster acceptance (DDA-F24 here; DDA-A21/A22/G16 live
// in the setup and paths cluster tests). This file owns DDA-F24: the
// `--debug` diagnostic trail — the loudest facade verbosity the CLI can emit
// — must ALSO pass the sentinel sweep the leak harness enforces on quieter
// surfaces. F24 reruns the leak-harness containment idiom with the diagnostic
// mode forced to `debug` (parseCliDiagnosticArgv(["--debug"]).options) and
// sweeps the captured debug trail as a `diagnostic` governed surface.
//
// PROCESS-adjacent, HERMETIC: the real facade diagnostic pipeline
// (configureCliDiagnostics -> emitCliDiagnostic -> redactor -> writer) runs
// in-process against a captured writer; the representative sensitive flow
// drives the REAL auth FSM and the REAL run-store integration port into a
// REAL temp XDG root. No live browser, no network.
// =========================================================================

// The representative sentinel credential set (never real secrets), verbatim
// from the leak harness so a clean sweep is meaningful across both surfaces.
const SENTINELS = {
	username: "SENTINEL-USER-3f8a1c9d",
	password: "SENTINEL-PASS-7b2e4a6f0c",
	otp: "SENTINEL-OTP-51903827",
} as const;
const ALL_SENTINELS = [SENTINELS.username, SENTINELS.password, SENTINELS.otp];

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});


async function makeDeps(clock: () => number): Promise<RunStoreDeps> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock };
}

// A delivery-helper fake: the ONLY thing that ever touches sentinel bytes,
// exactly at the fill steps (mirrors the disposable Confidential Field
// Delivery Helper). The FSM fragment it returns is secret-free by contract.
function noopHelper(): { deliver(field: string, value: string): void; observed: string[] } {
	const observed: string[] = [];
	return { observed, deliver: (_field, value) => observed.push(value) };
}

const SUCCESS_PASSWORD_EVENTS: readonly BrowserUseAuthTransactionEvent[] = [
	{ type: "pre-auth-proved" },
	{ type: "preparation-complete" },
	{ type: "lease-granted" },
	{ type: "method-step-complete", step: "identify-auth-state" },
	{ type: "method-step-complete", step: "fill-username" },
	{ type: "method-step-complete", step: "submit-username" },
	{ type: "method-step-complete", step: "reprove-target" },
	{ type: "method-step-complete", step: "fill-password" },
	{ type: "submission-dispatched" },
	{ type: "submit-outcome-observed", outcome: "success" },
	{ type: "cleanup-complete" },
	{
		type: "postcondition-proven",
		identity_basis: "session-identity-proof",
		identity_basis_digest: "d".repeat(32),
	},
	{
		type: "attestation-issued",
		attestation_digest: "a".repeat(32),
		fresh_until_epoch_ms: 9_999_999,
	},
];

function runRepresentativeAuthFlow(
	helper: { deliver(field: string, value: string): void },
): BrowserUseAuthTransactionFragment {
	const begun = beginAuthTransaction({
		method: "password",
		attempt_limit: 3,
		attempts_already_consumed: 0,
		binding: {
			run_id: "run-f24-debug",
			handoff_evidence_id: "evidence-1",
			lane_id: "agent-browser",
			environment: "agent-chrome",
			profile: "default",
			service_id: "oncore",
			auth_context: "operator",
			origin: "https://oncore.test",
			target_id: "target-1",
			page_id: "page-1",
			frame_id: "frame-1",
		},
	});
	if (!begun.ok) throw new Error(`begin failed: ${begun.rejection.code}`);
	let fragment = begun.fragment;
	for (const event of SUCCESS_PASSWORD_EVENTS) {
		if (event.type === "method-step-complete") {
			if (event.step === "fill-username") helper.deliver("username", SENTINELS.username);
			if (event.step === "fill-password") helper.deliver("password", SENTINELS.password);
		}
		const result = applyAuthTransition(fragment, event);
		if (!result.ok) throw new Error(`transition ${event.type} rejected: ${result.rejection.code}`);
		fragment = result.fragment;
	}
	return fragment;
}

async function persistAndReadStoreBytes(
	deps: RunStoreDeps,
	runId: string,
	fragment: BrowserUseAuthTransactionFragment,
): Promise<string> {
	const created = await createSharedRun(deps, {
		run_id: runId,
		state: "awaiting-auth",
		task_intent: "routine-automation",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "agent-browser",
		handoff_evidence_id: "evidence-1",
		mutation_dispatched: false,
		artifacts: [],
		continuation: {
			next_action_id: "continue-auth-transaction",
			summary: "Continue the authentication transaction.",
		},
	});
	if (!created.ok) throw new Error(`create failed: ${created.code}`);
	const acquired = await acquireLease(deps, {
		key: leaseKeyForRun(created.run),
		holderId: "auth-transaction",
		ttlMs: 5_000,
	});
	if (!acquired.ok) throw new Error(`lease failed: ${acquired.code}`);
	const port = createRunIntegrationPort(
		deps,
		{ validateSecretFreeFragment: () => true, verifyAttestation: async () => true },
		{
			fencing_token: acquired.lease.fencing_token,
			activation_epoch: acquired.lease.activation_epoch,
			holderId: acquired.lease.holder_id,
		},
	);
	const committed = await commitAuthTransaction(port, {
		run_id: runId,
		expected_revision: created.run.revision,
		fragment,
	});
	if (!("ok" in committed) || !committed.ok) throw new Error("commit failed");
	const read = await readDurableFile(deps.fs, deps.paths.state.runFile(runId));
	if (read.status !== "present") throw new Error("run file absent");
	return read.raw;
}

// A CliWriter that accumulates every diagnostic line the facade writes, so the
// captured `--debug` trail can be swept exactly like the run-store bytes.
function capturingWriter(): { writer: CliWriter; lines: string[] } {
	const lines: string[] = [];
	return {
		lines,
		writer: {
			write: (chunk: string) => {
				lines.push(chunk);
				return true;
			},
		},
	};
}

// Emit the debug-level diagnostics the CLI's auth-commit path produces: the
// fragment's STRUCTURAL fields (phase/status/method-step/continuation/
// attestation identity). This is the exact shape-only data the run store also
// carries — driving it through the loudest verbosity proves `--debug` adds no
// new leak channel. Uses the REAL facade emit pipeline, not a hand-built log.
function emitDebugAuthDiagnostics(fragment: BrowserUseAuthTransactionFragment): void {
	emitCliDiagnostic("browser-use.cli", "debug", "auth-transaction-progress", {
		run_id: "run-f24-debug",
		phase: fragment.phase,
		status: fragment.status,
		method: fragment.method,
		method_step: fragment.method_step,
	});
	emitCliDiagnostic("browser-use.cli", "debug", "auth-transaction-continuation", {
		run_id: "run-f24-debug",
		continuation: fragment.continuation,
	});
	emitCliDiagnostic("browser-use.cli", "debug", "auth-transaction-attestation", {
		run_id: "run-f24-debug",
		identity_basis: fragment.identity_basis,
		attestation_digest: fragment.attestation_digest,
	});
}

describe("DDA-F24 --debug diagnostics pass the secret scan", () => {
	test("the leak-harness sweep is clean over the captured --debug diagnostic trail", async () => {
		const clock = fixedClock();
		const deps = await makeDeps(clock.now);
		const helper = noopHelper();

		const fragment = runRepresentativeAuthFlow(helper);
		// Sanity: the delivery helper actually saw the sentinels, so a clean
		// sweep is meaningful, not vacuous.
		expect(helper.observed).toContain(SENTINELS.username);
		expect(helper.observed).toContain(SENTINELS.password);

		const storeBytes = await persistAndReadStoreBytes(deps, "run-f24-debug", fragment);

		// F24 oracle: rerun with `--debug`. Force the diagnostic mode the CLI
		// selects for `--debug` through the REAL facade parser, configure the
		// facade to write to the capturing writer, then emit the auth-path
		// diagnostics inside a diagnostic context (the CLI's own bracket).
		const parsed = parseCliDiagnosticArgv(["--debug"]);
		expect(parsed.options.mode).toBe("debug");
		expect(parsed.options.debug).toBe(true);
		const capture = capturingWriter();
		configureCliDiagnostics({
			categoryRoot: "browser-use.cli",
			options: parsed.options,
			diagnosticWriter: capture.writer,
		});
		try {
			withCliDiagnosticContext(
				{ run_id: parsed.options.runId, started_at_ms: parsed.options.startedAtMs },
				() => emitDebugAuthDiagnostics(fragment),
			);
		} finally {
			resetCliDiagnostics();
		}
		const debugTrail = capture.lines.join("");
		// The debug trail is non-empty (the flow really emitted diagnostics), so
		// sweeping it is a real assertion.
		expect(debugTrail.length).toBeGreaterThan(0);
		expect(debugTrail).toContain("auth-transaction-progress");

		const guard = beginSensitiveRunGuard("run-f24-debug");
		if (!guard.ok) throw new Error("guard begin");
		const marked = markRunSensitive(guard.guard, {
			trigger: "confidential-field-delivery",
			sentinels: ALL_SENTINELS,
		});
		if (!marked.ok) throw new Error("guard mark");

		const surfaces: BrowserUseGovernedSurface[] = [
			{ kind: "run-store-file", label: "run.json", content: storeBytes },
			{ kind: "diagnostic", label: "debug-trail", content: debugTrail },
		];
		const gate = assertContainmentBeforeRelease(marked.guard, surfaces);
		expect(gate.release).toBe(true);
		if (!gate.release) return;
		expect(gate.verdict.swept_surfaces).toBe(2);
		expect(gate.verdict.swept_kinds).toContain("diagnostic");
		// Belt-and-braces: no sentinel byte in either surface.
		for (const sentinel of ALL_SENTINELS) {
			expect(debugTrail).not.toContain(sentinel);
			expect(storeBytes).not.toContain(sentinel);
		}
	});

	test("the sweep catches a REGRESSION that leaks a sentinel into the --debug trail", async () => {
		// Negative fixture: if a future change logged a raw field value at debug
		// level, the redactor + shape-only invariant would be bypassed and the
		// sweep MUST fail closed. Prove it by emitting a diagnostic whose value
		// carries a sentinel, capturing it through the real facade, and sweeping.
		const parsed = parseCliDiagnosticArgv(["--debug"]);
		const capture = capturingWriter();
		configureCliDiagnostics({
			categoryRoot: "browser-use.cli",
			options: parsed.options,
			diagnosticWriter: capture.writer,
		});
		try {
			withCliDiagnosticContext(
				{ run_id: parsed.options.runId, started_at_ms: parsed.options.startedAtMs },
				() =>
					emitCliDiagnostic("browser-use.cli", "debug", "leaky-diagnostic", {
						run_id: "run-f24-regression",
						// A non-secret-keyed field carrying a raw value — the redactor's
						// key/prefix heuristics do NOT catch it, so only the sentinel
						// sweep stands between this and a leak.
						observed_marker: SENTINELS.password,
					}),
			);
		} finally {
			resetCliDiagnostics();
		}
		const debugTrail = capture.lines.join("");
		expect(debugTrail).toContain(SENTINELS.password);

		const guard = beginSensitiveRunGuard("run-f24-regression");
		if (!guard.ok) throw new Error("guard begin");
		const marked = markRunSensitive(guard.guard, {
			trigger: "confidential-field-delivery",
			sentinels: ALL_SENTINELS,
		});
		if (!marked.ok) throw new Error("guard mark");

		const gate = assertContainmentBeforeRelease(marked.guard, [
			{ kind: "diagnostic", label: "debug-trail", content: debugTrail },
		]);
		expect(gate.release).toBe(false);
		if (gate.release) return;
		expect(gate.reason).toBe("containment_failed");
	});
});
