import { afterAll, describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type AgentBrowserAuthDeliveryContext,
	type AgentBrowserExecutionRuntime,
	type AgentBrowserVerifiedHandoff,
	executeAgentBrowserTask,
} from "./browser-use-agent-browser";
import { commitAuthTransaction } from "./browser-use-auth";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import { createBrowserUseAuthProvider } from "./browser-use-auth-provider";
import { __confidentialDeliveryDriverForTest } from "./browser-use";
import type {
	BrowserUseDeliveryHook,
	BrowserUseTargetReproof,
	BrowserUseVerifiedTarget,
} from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import { deriveConformanceSentinel } from "./browser-use-secret-scan";
import {
	type BrowserUseAuthTransactionEvent,
	applyAuthTransition,
	beginAuthTransaction,
} from "./browser-use-auth-transaction";
import type { BrowserUseAuthTransactionFragment } from "./browser-use-auth-model";
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
	type RunStoreDeps,
	createRunIntegrationPort,
	createSharedRun,
	leaseKeyForRun,
} from "./browser-use-runs";
import { readDurableFile } from "./browser-use-store";
import {
	type BrowserUseGovernedSurface,
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	markRunSensitive,
} from "./browser-use-sensitive-run";

// =========================================================================
// Value-aware leak harness (auth plan U4, AE5; release contract R14-R16,
// AE5). PROCESS-BOUNDARY containment proof for the operator's OWN
// credentials: a representative sensitive flow drives real sentinel
// username/password/OTP values through the auth transaction FSM and the
// agent-browser executor fakes, persists the resulting fragment through the
// REAL run-store integration port into a REAL temp XDG root, then sweeps
// EVERY governed output surface — stdout envelopes, run-store files read back
// off disk, artifacts, diagnostics, and crash/error text — asserting ZERO
// sentinel occurrences. The crash path is included: a step that throws
// mid-delivery must still leave every surface clean.
//
// Design invariant this harness ENFORCES: sentinel bytes only ever enter the
// delivery-helper fake (the stand-in for the disposable Confidential Field
// Delivery Helper, R16). They must NEVER reach the fragment, the store, the
// envelope, or any evidence. If a future change routes a raw value onto a
// governed surface, the disk-backed sweep catches it.
// =========================================================================

// The representative sentinel credential set (never real secrets).
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

// Verbatim verified-handoff shape (agent-browser lane) reused from wave 1
// (browser-use-agent-browser.test.ts): schema 2, explicit-cdp, verified-live.
const HANDOFF = {
	outcome: "verified",
	environment: { name: "agent-chrome", profile: "default" },
	browser_entry_mode: "explicit-cdp",
	attachment: {
		adapter_id: "agent-browser",
		route: "explicit-cdp",
		probe_executable: "/opt/browser-connect/agent-browser",
	},
	endpoint: {
		http: "http://127.0.0.1:9222",
		ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
	},
	launch: { launched: false },
	proof: {
		environment_contract_id: "warm-chrome.browser-entry",
		environment_schema_version: "1",
		route_evidence: "verified-live",
	},
	contract_id: "browser-connect.verified-handoff",
	schema_version: "2",
} as const satisfies BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
};

function successEnvelope(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

async function makeDeps(clock: () => number): Promise<RunStoreDeps> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock };
}

// Advance the auth FSM through a representative password choreography (R15):
// pre-auth proof -> preparation -> lease -> identify -> username -> submit ->
// reprove -> fill-password -> dispatch -> success -> cleanup -> postcondition
// -> attestation. The delivery-helper fake is the ONLY thing that touches the
// sentinel bytes; the returned fragment is secret-free by the FSM's contract.
type DeliveryHelperFake = {
	deliver(field: "username" | "password" | "otp", value: string): void;
	observed: string[];
};

function runRepresentativeAuthFlow(
	helper: DeliveryHelperFake,
	events: readonly BrowserUseAuthTransactionEvent[],
): BrowserUseAuthTransactionFragment {
	const begun = beginAuthTransaction({
		method: "password",
		attempt_limit: 3,
		attempts_already_consumed: 0,
		binding: {
			run_id: "run-leak-harness",
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
	for (const event of events) {
		// The delivery helper (and ONLY it) sees sentinel bytes, exactly at the
		// fill steps — mirroring the disposable helper's bounded field action.
		if (event.type === "method-step-complete") {
			if (event.step === "fill-username") {
				helper.deliver("username", SENTINELS.username);
			}
			if (event.step === "fill-password") {
				helper.deliver("password", SENTINELS.password);
			}
			if (event.step === "fill-otp") helper.deliver("otp", SENTINELS.otp);
		}
		const result = applyAuthTransition(fragment, event);
		if (!result.ok) {
			throw new Error(
				`transition ${event.type} rejected: ${result.rejection.code}`,
			);
		}
		fragment = result.fragment;
	}
	return fragment;
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

// Persist the FSM fragment through the REAL integration port into the REAL
// temp XDG store, then read the on-disk run.json bytes back verbatim.
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
		{
			validateSecretFreeFragment: () => true,
			verifyAttestation: async () => true,
		},
		{
			fencing_token: acquired.lease.fencing_token,
			activation_epoch: acquired.lease.activation_epoch,
			holderId: acquired.lease.holder_id,
		},
	);
	// commitAuthTransaction is the ONLY path an auth outcome takes into the run
	// store — the same seam the CLI wires. A mid-flight (non-terminal) fragment
	// commits as awaiting-auth so the persisted fragment bytes are on disk.
	const committed = await commitAuthTransaction(port, {
		run_id: runId,
		expected_revision: created.run.revision,
		fragment,
	});
	if (!("ok" in committed) || !committed.ok) {
		throw new Error("commit failed");
	}
	const read = await readDurableFile(deps.fs, deps.paths.state.runFile(runId));
	if (read.status !== "present") throw new Error("run file absent");
	return read.raw;
}

// Drive the agent-browser executor over fakes and collect its structural
// result as a stdout envelope surface. The executor NEVER receives sentinel
// bytes — confidential delivery is refused there by design.
async function runAgentBrowserAndEnvelope(
	handoff: AgentBrowserVerifiedHandoff,
): Promise<string> {
	const responses = [
		successEnvelope({
			tabs: [
				{ tabId: "t7", active: true, type: "page", url: "https://oncore.test/app" },
			],
		}),
		successEnvelope({}),
		successEnvelope({ snapshot: "@e4 button Save", refs: { e4: {} } }),
		successEnvelope({}),
		successEnvelope({ url: "https://oncore.test/saved" }),
	];
	let index = 0;
	const runtime: AgentBrowserExecutionRuntime = {
		runCommand: async () => ({
			exitCode: 0,
			stdout: responses[index++] ?? successEnvelope({}),
			stderr: "",
		}),
	};
	const result = await executeAgentBrowserTask(runtime, {
		handoff,
		run_id: "run-leak-harness",
		target_tab_id: "t7",
		allowed_origins: ["https://oncore.test"],
		steps: [
			{ kind: "snapshot", interactive: true },
			{
				kind: "click",
				ref: "@e4",
				postcondition: { kind: "url-equals", url: "https://oncore.test/saved" },
			},
		],
	});
	return JSON.stringify(result);
}

function noopHelper(): DeliveryHelperFake {
	const observed: string[] = [];
	return {
		observed,
		deliver: (_field, value) => {
			observed.push(value);
		},
	};
}

// --- Real failed-delivery crash fixtures ------------------------------------
// The crash path is driven THROUGH the code under test: a sentinel-bearing
// field is delivered, then a later field's delivery hook returns a TYPED
// helper-crash outcome (browser-use-confidential-field-delivery.ts models a
// helper crash as `ok: false, reason: "helper-crash"`, never a JS throw). The
// executor's failure branch carries the prior delivery evidence so the run
// still turns sensitive, and the SUT emits a real blocked failure envelope.
const {
	runScopedSentinelNonce,
	markGuardForDeliveryOutcome,
	collectRunGovernedSurfaces,
} = __confidentialDeliveryDriverForTest;

const CRASH_BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	service_account_id: "service-account-1",
	auth_context: "interactive-login",
	allowed_origins: ["https://oncore.test"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	item_revision: 7,
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

function crashVerifiedTarget(runId: string): BrowserUseVerifiedTarget {
	return {
		lane_id: "agent-browser",
		run_id: runId,
		top_level_origin: "https://oncore.test",
		frame_origin: "https://oncore.test",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-1",
		account_ref: "acct-ref-redacted",
		target_proof_digest: "d".repeat(32),
	};
}

const crashReproveOk: BrowserUseTargetReproof = async ({ target }) => ({
	proven: true,
	observed_digest: target.target_proof_digest,
});

// An opaque-handle-only TokenRetrievalPort (never bytes).
const crashPort: BrowserUseTokenRetrievalPort = {
	getServiceAccountIdentity: async () => ({
		ok: true,
		identity: {
			service_account_id: "service-account-1",
			state: "ACTIVE",
			type: "SERVICE_ACCOUNT",
		},
	}),
	listVaults: async () => ({ ok: true, vaults: [] }),
	listLoginItems: async () => ({ ok: true, items: [] }),
	getLoginItem: async () => ({
		ok: false,
		rejection: { code: "item-missing", message: "n/a" },
	}),
	fetchCredentialField: async (
		input,
	): Promise<{ ok: true; handle: BrowserUseSecretHandle }> => ({
		ok: true,
		handle: {
			handle_id: `handle-${input.field}`,
			field: input.field,
			expires_at_epoch_ms: 9_999_999,
		},
	}),
};

// A delivery hook that delivers the FIRST field with its sentinel value, then
// returns a TYPED helper-crash outcome for the OTP field — the real mid-delivery
// failure the production choreography models. `observed` records the bytes the
// disposable helper touched, exactly as the real helper's process boundary would.
function crashHelper(
	sentinelValue: Readonly<Record<BrowserUseOpCredentialField, string>>,
): { hook: BrowserUseDeliveryHook; observed: string[] } {
	const observed: string[] = [];
	const hook: BrowserUseDeliveryHook = async (input) => {
		const value = sentinelValue[input.field];
		observed.push(value);
		if (input.field === "otp-current") {
			// Helper crashed mid-action AFTER touching the field: field cleared,
			// external effect possible. Typed outcome, not a JS throw.
			return { ok: false, reason: "helper-crash", field_cleared: true };
		}
		return { ok: true, shape: { field: input.field, byte_length: value.length } };
	};
	return { hook, observed };
}

function buildCrashContext(
	deps: RunStoreDeps,
	runId: string,
	hook: BrowserUseDeliveryHook,
): AgentBrowserAuthDeliveryContext {
	const provider = createBrowserUseAuthProvider({
		store: deps,
		admission: {
			kind: "environment-admitted",
			evidence: {
				lane: "environment-injected-op",
				assurance: "lower-assurance",
				native: { verdict: "native-capability-absent" },
				environment: {
					state: "ready",
					next_action: "validate-service-account",
				},
			},
			tokenRetrieval: crashPort,
		},
		attestationByDigest: () => undefined,
	});
	return provider.buildAgentBrowserDeliveryContext({
		binding: CRASH_BINDING,
		target: crashVerifiedTarget(runId),
		deliver: hook,
		reproveTarget: crashReproveOk,
		field_by_ref: { "@e2": "password", "@e3": "otp-current" },
		in_sensitive_interval: true,
	});
}

function crashAdapterSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

describe("value-aware leak harness (AE5)", () => {
	test("a full sensitive flow leaves every governed surface sentinel-free", async () => {
		const clock = fixedClock();
		const deps = await makeDeps(clock.now);
		const helper = noopHelper();

		const fragment = runRepresentativeAuthFlow(helper, SUCCESS_PASSWORD_EVENTS);
		// Sanity: the helper actually observed the sentinels (the flow is
		// representative), so a clean sweep is meaningful, not vacuous.
		expect(helper.observed).toContain(SENTINELS.username);
		expect(helper.observed).toContain(SENTINELS.password);

		const storeBytes = await persistAndReadStoreBytes(
			deps,
			"run-leak-harness",
			fragment,
		);
		const envelope = await runAgentBrowserAndEnvelope(HANDOFF);

		const guard = beginSensitiveRunGuard("run-leak-harness");
		if (!guard.ok) throw new Error("guard begin");
		const marked = markRunSensitive(guard.guard, {
			trigger: "confidential-field-delivery",
			sentinels: ALL_SENTINELS,
		});
		if (!marked.ok) throw new Error("guard mark");

		const surfaces: BrowserUseGovernedSurface[] = [
			{ kind: "stdout-envelope", label: "agent-browser-result", content: envelope },
			{ kind: "run-store-file", label: "run.json", content: storeBytes },
			{
				kind: "diagnostic",
				label: "continuation",
				content: JSON.stringify(fragment.continuation),
			},
			{
				kind: "artifact",
				label: "structural-evidence",
				content: JSON.stringify({
					attestation_digest: fragment.attestation_digest,
					identity_basis: fragment.identity_basis,
				}),
			},
			{
				kind: "log",
				label: "phase-trace",
				content: `phase=${fragment.phase} status=${fragment.status} step=${fragment.method_step}`,
			},
		];

		const gate = assertContainmentBeforeRelease(marked.guard, surfaces);
		expect(gate.release).toBe(true);
		if (!gate.release) return;
		expect(gate.verdict.swept_surfaces).toBe(5);
		// Belt-and-braces: raw disk bytes contain no sentinel.
		for (const sentinel of ALL_SENTINELS) {
			expect(storeBytes).not.toContain(sentinel);
			expect(envelope).not.toContain(sentinel);
		}
	});

	test("a REAL mid-delivery helper crash still leaves every SUT-produced surface clean (crash path)", async () => {
		// The crash is driven THROUGH the code under test, not hand-thrown. A
		// sentinel-bearing password field is delivered, then the OTP field's
		// delivery hook returns the TYPED helper-crash outcome the production
		// choreography models. deliverConfidentialFields blocks capability-loss;
		// executeAgentBrowserTask returns a REAL agent_browser_confidential_delivery_
		// blocked failure whose `delivery` slot carries the prior password shape, so
		// the run still turns sensitive. Every surface swept below is bytes the SUT
		// produced on that real failure — the returned failure envelope and the run.json
		// read back off the real temp-XDG store — never a test literal.
		const RUN = "run-leak-harness-crash";
		const clock = fixedClock();
		const deps = await makeDeps(clock.now);

		// Conformance sentinels under the DRIVER'S own run-scoped nonce, so the
		// delivered password value equals the marker the driver's sweep derives from
		// the SUT-produced delivered_shapes. A clean sweep is therefore meaningful.
		const runNonce = runScopedSentinelNonce(RUN);
		const PASS = deriveConformanceSentinel("password", runNonce);
		const OTP = deriveConformanceSentinel("otp-current", runNonce);
		expect(PASS.ok && OTP.ok).toBe(true);
		if (!(PASS.ok && OTP.ok)) return;
		const sentinelValue: Record<BrowserUseOpCredentialField, string> = {
			username: PASS.value,
			password: PASS.value,
			"otp-current": OTP.value,
		};

		const { hook, observed } = crashHelper(sentinelValue);
		// tab list, tab select, snapshot(@e2/@e3), then the password fill's
		// post-auth-proof postcondition check. The OTP fill crashes inside the
		// helper before any post-auth proof, so no further runtime call is needed.
		let index = 0;
		const responses = [
			crashAdapterSuccess({
				tabs: [
					{ tabId: "t1", active: true, type: "page", url: "https://oncore.test/login" },
				],
			}),
			crashAdapterSuccess({}),
			crashAdapterSuccess({ url: "https://oncore.test/login" }),
			crashAdapterSuccess({
				snapshot: "@e2 textbox password @e3 textbox otp",
				refs: { e2: {}, e3: {} },
			}),
			crashAdapterSuccess({ url: "https://oncore.test/login" }),
			// post-auth proof for the delivered password fill (value-equals):
			crashAdapterSuccess({ value: "•••" }),
			// fresh snapshot required before the OTP fill (refs discarded post-delivery):
			crashAdapterSuccess({
				snapshot: "@e3 textbox otp",
				refs: { e3: {} },
			}),
		];
		const runtime: AgentBrowserExecutionRuntime = {
			runCommand: async () => ({
				exitCode: 0,
				stdout: responses[index++] ?? crashAdapterSuccess({}),
				stderr: "",
			}),
		};

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: RUN,
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildCrashContext(deps, RUN, hook),
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "fill",
					ref: "@e2",
					value: "",
					sensitivity: "confidential",
					postcondition: {
						kind: "value-equals",
						selector: "input[name=password]",
						value: "•••",
					},
				},
				// A confidential delivery discards stale refs (R22), so a fresh
				// task-local snapshot is required before the OTP fill.
				{ kind: "snapshot", interactive: true },
				{
					kind: "fill",
					ref: "@e3",
					value: "",
					sensitivity: "confidential",
					postcondition: {
						kind: "value-equals",
						selector: "input[name=otp]",
						value: "•••",
					},
				},
			],
		});

		// The SUT produced a REAL failed-delivery result on the helper crash. The
		// delivery hook (the disposable-helper stand-in) is the ONLY thing that saw
		// sentinel bytes; the executor never observed a value.
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("agent_browser_confidential_delivery_blocked");
		expect(observed).toContain(sentinelValue.password);
		expect(observed).toContain(sentinelValue["otp-current"]);
		// The prior password delivery rides the failure so the run turns sensitive.
		expect(result.delivery?.delivered_shapes).toEqual([
			{ field: "password", byte_length: sentinelValue.password.length },
		]);

		// Mark the run sensitive through the DRIVER'S own seam over the SUT-produced
		// delivery evidence — the exact path a real crashed delivery follows.
		const baseGuard = beginSensitiveRunGuard(RUN);
		if (!baseGuard.ok) throw new Error("guard begin");
		const markedOutcome = markGuardForDeliveryOutcome(baseGuard.guard, result);
		expect(markedOutcome.ok).toBe(true);
		if (!markedOutcome.ok) return;
		const sensitiveGuard = markedOutcome.guard;
		expect(sensitiveGuard?.sensitive).toBe(true);
		expect(sensitiveGuard?.trigger).toBe("confidential-field-delivery");
		if (sensitiveGuard === undefined) return;

		// Persist a run through the real store so there are real on-disk bytes to
		// read back (the same real integration port the other cases exercise).
		const fragment = runRepresentativeAuthFlow(noopHelper(), [
			{ type: "pre-auth-proved" },
			{ type: "preparation-complete" },
			{ type: "lease-granted" },
			{ type: "method-step-complete", step: "identify-auth-state" },
			{ type: "method-step-complete", step: "fill-username" },
			{ type: "method-step-complete", step: "submit-username" },
			{ type: "method-step-complete", step: "reprove-target" },
			{ type: "method-step-complete", step: "fill-password" },
			{ type: "submission-dispatched" },
		]);
		await persistAndReadStoreBytes(deps, RUN, fragment);

		// Sweep bytes the SUT emitted on the real failure: the returned failure
		// envelope and the run.json read back off disk through the driver's own
		// surface collector.
		const failureEnvelope = JSON.stringify(result);
		const surfaces: BrowserUseGovernedSurface[] = [
			{
				kind: "crash-surface",
				label: "confidential-delivery-blocked-envelope",
				content: failureEnvelope,
			},
			...(await collectRunGovernedSurfaces(deps, RUN)),
		];
		expect(surfaces.some((s) => s.kind === "run-store-file")).toBe(true);

		const gate = assertContainmentBeforeRelease(sensitiveGuard, surfaces);
		expect(gate.release).toBe(true);
		// Belt-and-braces: every SUT-produced surface is sentinel-free.
		for (const surface of surfaces) {
			expect(surface.content).not.toContain(sentinelValue.password);
			expect(surface.content).not.toContain(sentinelValue["otp-current"]);
		}
	});

	test("the harness catches a REGRESSION that leaks a value onto a surface", async () => {
		// Negative fixture (plan U4 Verification): if a future change routed the
		// raw password onto the store file, the sweep MUST fail closed. Proven
		// by injecting the leak into a surface the sweep sees.
		const guard = beginSensitiveRunGuard("run-leak-regression");
		if (!guard.ok) throw new Error("guard begin");
		const marked = markRunSensitive(guard.guard, {
			trigger: "confidential-field-delivery",
			sentinels: ALL_SENTINELS,
		});
		if (!marked.ok) throw new Error("guard mark");

		const gate = assertContainmentBeforeRelease(marked.guard, [
			{
				kind: "run-store-file",
				label: "run.json",
				content: `{"leaked":"${SENTINELS.password}"}`,
			},
		]);
		expect(gate.release).toBe(false);
		if (gate.release) return;
		expect(gate.reason).toBe("containment_failed");
	});
});
