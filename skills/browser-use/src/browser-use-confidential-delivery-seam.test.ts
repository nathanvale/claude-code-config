import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type AgentBrowserAuthDeliveryContext,
	type AgentBrowserExecutionRuntime,
	type AgentBrowserVerifiedHandoff,
	executeAgentBrowserTask,
} from "./browser-use-agent-browser";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import { createBrowserUseAuthProvider } from "./browser-use-auth-provider";
import {
	applyAuthTransition,
	beginAuthTransaction,
} from "./browser-use-auth-transaction";
import type {
	BrowserUseDeliveryHook,
	BrowserUseTargetReproof,
	BrowserUseVerifiedTarget,
} from "./browser-use-confidential-field-delivery";
import { createBrowserUseNativeConfidentialDeliveryHook } from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import { LIVE_CLEAN_PROFILE_POSTURE_FIXTURE } from "./browser-connect-handoff-fixtures";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { BINDING_FAIL_CLOSED_EXIT_CODE } from "./browser-use-core";
import { parseBrowserUseArgv } from "./browser-use-parser";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	type RunStoreDeps,
	createSharedRun,
	loadSharedRun,
} from "./browser-use-runs";
import { deriveConformanceSentinel } from "./browser-use-secret-scan";
import {
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	type BrowserUseGovernedSurface,
	markRunSensitive,
} from "./browser-use-sensitive-run";
import { makeRuntime } from "./browser-use-test-helpers";
import { __confidentialDeliveryDriverForTest } from "./browser-use";

// =========================================================================
// Confidential-delivery seam co-change (auth plan U5, R13-R16; release
// R13-R16, AE4-AE5). Proves the agent-browser lane routes a confidential fill
// through the REAL deliverConfidentialFields choreography when the auth
// wiring supplies the delivery context and the transaction sits in its
// sensitive-interval, marks the shared run sensitive exactly once, and the
// run driver's containment gate sweeps the REAL on-disk run bytes clean.
// Without the context, the typed refusal stands unchanged.
//
// Fakes match the real envelope shapes proven in
// browser-use-agent-browser.test.ts; sentinel VALUES are minted so a delivered
// value equals a marker the sentinel owner derives (delivery-level leak
// harness posture), so a clean on-disk sweep is meaningful, not vacuous.
// =========================================================================

const {
	runScopedSentinelNonce,
	markGuardForDeliveryOutcome,
	collectRunGovernedSurfaces,
	sentinelRegistrationWithheldFailure,
	recordTaskRunOutcome,
} = __confidentialDeliveryDriverForTest;

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

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
		environment_schema_version: "2",
		route_evidence: "verified-live",
		profile_posture: LIVE_CLEAN_PROFILE_POSTURE_FIXTURE,
	},
	contract_id: "browser-connect.verified-handoff",
	schema_version: "3",
} as const satisfies BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
} satisfies AgentBrowserVerifiedHandoff;

function adapterSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

function runtimeFor(
	responses: readonly { exitCode?: number; stdout?: string; timedOut?: boolean }[],
): AgentBrowserExecutionRuntime & { calls: Array<readonly string[]> } {
	const calls: Array<readonly string[]> = [];
	let index = 0;
	return {
		calls,
		runCommand: async (input) => {
			calls.push([input.command, ...input.args]);
			const response = responses[index++] ?? {};
			return {
				exitCode: response.exitCode ?? 0,
				stdout: response.stdout ?? adapterSuccess({}),
				stderr: "",
				...(response.timedOut === undefined ? {} : { timedOut: response.timedOut }),
			};
		},
	};
}

const BINDING: BrowserUseItemBinding = {
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

function verifiedTarget(runId: string): BrowserUseVerifiedTarget {
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

const reproveOk: BrowserUseTargetReproof = async ({ target }) => ({
	proven: true,
	observed_digest: target.target_proof_digest,
});

// The delivery-helper fake: the ONLY component that observes sentinel bytes.
// It reports back only outcome + non-secret shape. The value it writes is the
// conformance sentinel for the field (value == a derived sweep marker).
function leakHelper(
	sentinelValue: Readonly<Record<BrowserUseOpCredentialField, string>>,
): { hook: BrowserUseDeliveryHook; observed: string[] } {
	const observed: string[] = [];
	const hook: BrowserUseDeliveryHook = async (input) => {
		const value = sentinelValue[input.field];
		observed.push(value);
		return { ok: true, shape: { field: input.field, byte_length: value.length } };
	};
	return { hook, observed };
}

// An opaque-handle-only TokenRetrievalPort (never bytes) — supplied to the
// provider builder so the delivery context carries a real port.
const fakePort: BrowserUseTokenRetrievalPort = {
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
	fetchCredentialField: async (input): Promise<{ ok: true; handle: BrowserUseSecretHandle }> => ({
		ok: true,
		handle: {
			handle_id: `handle-${input.field}`,
			field: input.field,
			expires_at_epoch_ms: 9_999_999,
		},
	}),
};

async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	deps: RunStoreDeps;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { env: xdg.env, deps: { fs, paths: opened.paths, clock: fixedClock().now } };
}

// Build the delivery context through the REAL provider builder (wiring_spec
// item 3): the transaction supplies the VerifiedTarget; the provider supplies
// the TokenRetrievalPort. `in_sensitive_interval` gates whether the lane routes
// a confidential fill through delivery.
function buildContext(
	deps: RunStoreDeps,
	runId: string,
	hook: BrowserUseDeliveryHook,
	inSensitiveInterval: boolean,
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
			tokenRetrieval: fakePort,
		},
		attestationByDigest: () => undefined,
	});
	return provider.buildAgentBrowserDeliveryContext({
		binding: BINDING,
		target: verifiedTarget(runId),
		deliver: hook,
		reproveTarget: reproveOk,
		field_by_ref: { "@e2": "password", "@e3": "otp-current" },
		in_sensitive_interval: inSensitiveInterval,
	});
}

// The executor call sequence for: tab list, tab select, snapshot (@e2/@e3),
// then the confidential fill's post-auth-proof postcondition check. The
// confidential fill itself never calls the runtime — the delivery helper owns
// the bounded write inside the disposable helper.
function attachAndSnapshot(): { exitCode?: number; stdout?: string }[] {
	return [
		{
			stdout: adapterSuccess({
				tabs: [{ tabId: "t1", active: true, type: "page", url: "https://oncore.test/login" }],
			}),
		},
		{ stdout: adapterSuccess({}) },
		{ stdout: adapterSuccess({ url: "https://oncore.test/login" }) },
		{
			stdout: adapterSuccess({
				snapshot: "@e2 textbox password @e3 textbox otp",
				refs: {
					e2: { role: "textbox", name: "Password" },
					e3: { role: "textbox", name: "One-time code" },
				},
			}),
		},
		{ stdout: adapterSuccess({ url: "https://oncore.test/login" }) },
	];
}

describe("confidential-delivery seam co-change (U5, R13-R16)", () => {
	test("opaque capability crosses only the native delivery port and an unknown write keeps capture quarantined after cleanup", async () => {
		const events: string[] = [];
		const nativeInputs: unknown[] = [];
		const sentinel = "U7_RAW_CREDENTIAL_MUST_NOT_REACH_TYPESCRIPT";
		const hook = createBrowserUseNativeConfidentialDeliveryHook({
			quarantine: {
				pause: async () => {
					events.push("pause");
					return { ok: true };
				},
				cleanup: async () => {
					events.push("cleanup");
					return { ok: true };
				},
				resume: async () => {
					events.push("resume");
					return { ok: true };
				},
			},
			consumePrivatePipeAndDeliver: async (input) => {
				events.push("native");
				nativeInputs.push(input);
				return {
					schema_version: 1,
					ok: false,
					write_state: "write-outcome-unknown",
					rejection: {
						code: "write-outcome-unknown",
						message:
							"confidential field delivery blocked; inspect the typed code.",
					},
					protocol_trace: [
						"Target.getTargetInfo",
						"Page.getFrameTree",
						"Accessibility.getFullAXTree",
						"DOM.describeNode",
						"DOM.resolveNode",
						"Runtime.callFunctionOn",
					],
				};
			},
		});

		const result = await hook({
			handle: {
				handle_id: "environment-capability-1",
				field: "password",
				expires_at_epoch_ms: 9_999_999,
			},
			field: "password",
			target: verifiedTarget("run-u7-private-pipe"),
			semantic_locator: {
				role: "textbox",
				accessible_name: "Password",
				input_kind: "password",
			},
		});

		expect(result).toEqual({
			ok: false,
			reason: "field-write-failed",
			field_cleared: false,
			write_state: "write-outcome-unknown",
		});
		expect(events).toEqual(["pause", "native", "cleanup"]);
		expect(JSON.stringify(nativeInputs)).not.toContain(sentinel);
		expect(nativeInputs).toEqual([
			{
				schema_version: 1,
				capability: {
					handle_id: "environment-capability-1",
					field: "password",
					expires_at_epoch_ms: 9_999_999,
				},
				target: {
					lane_id: "agent-browser",
					run_id: "run-u7-private-pipe",
					target_id: "target-1",
					page_id: "page-1",
					frame_id: "frame-1",
					top_level_origin: "https://oncore.test",
					frame_origin: "https://oncore.test",
					target_proof_digest: "d".repeat(32),
				},
				locator: {
					role: "textbox",
					accessible_name: "Password",
					input_kind: "password",
				},
			},
		]);
	});

	test("agent-browser invalidates its snapshot ref and sends one semantic locator through the native-only hook", async () => {
		const store = await makeStore();
		const journal: string[] = [];
		const nativeInputs: unknown[] = [];
		const hook = createBrowserUseNativeConfidentialDeliveryHook({
			quarantine: {
				pause: async () => {
					journal.push("pause");
					return { ok: true };
				},
				cleanup: async () => {
					journal.push("cleanup");
					return { ok: true };
				},
				resume: async () => {
					journal.push("resume");
					return { ok: true };
				},
			},
			consumePrivatePipeAndDeliver: async (input) => {
				journal.push("native");
				nativeInputs.push(input);
				return {
					schema_version: 1,
					ok: true,
					write_state: "delivered",
					shape: { field: "password", byte_length: 17 },
					protocol_trace: [
						"Target.getTargetInfo",
						"Page.getFrameTree",
						"Accessibility.getFullAXTree",
						"DOM.describeNode",
						"DOM.resolveNode",
						"Runtime.callFunctionOn",
					],
				};
			},
		});
		const runtime = runtimeFor([
			...attachAndSnapshot(),
			{ stdout: adapterSuccess({ value: "•••" }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-u7-semantic-native",
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildContext(
				store.deps,
				"run-u7-semantic-native",
				hook,
				true,
			),
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
			],
		});

		expect(result.ok).toBe(true);
		expect(journal).toEqual(["pause", "native", "cleanup", "resume"]);
		expect(nativeInputs).toMatchObject([
			{
				locator: {
					role: "textbox",
					accessible_name: "Password",
					input_kind: "password",
				},
			},
		]);
		expect(runtime.calls.some((call) => call.includes("fill"))).toBe(false);
	});

	test("a possibly-written confidential delivery blocks the auth transaction without any automatic retry path", () => {
		const started = beginAuthTransaction({
			binding: {
				run_id: "run-u7-possibly-written",
				handoff_evidence_id: "handoff-1",
				lane_id: "agent-browser",
				environment: "agent-chrome",
				profile: "default",
				service_id: "oncore",
				auth_context: "interactive-login",
				origin: "https://oncore.test",
				target_id: "target-1",
				page_id: "page-1",
				frame_id: "frame-1",
			},
			method: "password",
			attempt_limit: 3,
			attempts_already_consumed: 0,
		});
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		let fragment = started.fragment;
		for (const event of [
			{ type: "pre-auth-proved" as const },
			{ type: "preparation-complete" as const },
			{ type: "lease-granted" as const },
		]) {
			const next = applyAuthTransition(fragment, event);
			expect(next.ok).toBe(true);
			if (!next.ok) return;
			fragment = next.fragment;
		}

		const blocked = applyAuthTransition(fragment, {
			type: "confidential-delivery-outcome-observed",
			outcome: "possibly-written",
		});
		expect(blocked).toMatchObject({
			ok: true,
			fragment: {
				status: "blocked",
				blocked_cause: "capability-loss",
				external_effect: "possible",
				submission_started: false,
			},
		});
		if (!blocked.ok) return;
		expect(
			applyAuthTransition(blocked.fragment, {
				type: "blocked-cause-resolved",
			}),
		).toMatchObject({
			ok: false,
			rejection: { code: "auth_cause_not_resolvable" },
		});
		expect(
			applyAuthTransition(blocked.fragment, {
				type: "human-retry-approved",
			}),
		).toMatchObject({
			ok: false,
			rejection: { code: "auth_retry_requires_human" },
		});
	});

	test("delivery context inside the sensitive interval routes a confidential fill through the choreography and marks the run sensitive over clean on-disk bytes", async () => {
		const NONCE_RUN = "run-cfd-seam-ok";
		const store = await makeStore();

		// Conformance sentinels under the driver's run-scoped nonce so the delivered
		// values equal the markers the driver's own sweep derives.
		const runNonce = runScopedSentinelNonce(NONCE_RUN);
		const PASS = deriveConformanceSentinel("password", runNonce);
		const OTP = deriveConformanceSentinel("otp-current", runNonce);
		expect(PASS.ok && OTP.ok).toBe(true);
		if (!(PASS.ok && OTP.ok)) return;
		const sentinelValue: Record<BrowserUseOpCredentialField, string> = {
			username: PASS.value,
			password: PASS.value,
			"otp-current": OTP.value,
		};

		const { hook, observed } = leakHelper(sentinelValue);
		const runtime = runtimeFor([
			...attachAndSnapshot(),
			// post-auth proof for the confidential password fill (value-equals):
			{ stdout: adapterSuccess({ value: "•••" }) },
		]);

		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: NONCE_RUN,
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildContext(store.deps, NONCE_RUN, hook, true),
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
			],
		});

		// The choreography delivered the password field (the helper saw the bytes),
		// the executor never ran its own `fill`, and the result carries delivery
		// evidence with the FSM method-step-complete event.
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(observed).toContain(sentinelValue.password);
		expect(result.delivery?.method_step_events).toEqual(["fill-password"]);
		expect(result.delivery?.delivered_shapes).toEqual([
			{ field: "password", byte_length: sentinelValue.password.length },
		]);
		expect(result.delivery?.resume.discard_stale_refs).toBe(true);
		expect(result.delivery?.resume.require_fresh_identity_basis).toBe(true);
		// No adapter argv ever carried a raw value.
		expect(JSON.stringify(runtime.calls)).not.toContain(sentinelValue.password);
		// The executor never issued a `fill` command for the confidential step.
		expect(
			runtime.calls.some((call) => call.includes("fill")),
		).toBe(false);

		// Driver seam: the delivery outcome marks the shared run sensitive exactly
		// once under the run-scoped nonce.
		const created = await createSharedRun(store.deps, {
			run_id: NONCE_RUN,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed",
			mutation_dispatched: false,
			artifacts: [],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const baseGuardResult = await import("./browser-use-sensitive-run").then((m) =>
			m.beginSensitiveRunGuard(NONCE_RUN),
		);
		expect(baseGuardResult.ok).toBe(true);
		if (!baseGuardResult.ok) return;
		const markedOutcome = markGuardForDeliveryOutcome(baseGuardResult.guard, result);
		expect(markedOutcome.ok).toBe(true);
		if (!markedOutcome.ok) return;
		const sensitiveGuard = markedOutcome.guard;
		expect(sensitiveGuard?.sensitive).toBe(true);
		expect(sensitiveGuard?.trigger).toBe("confidential-field-delivery");
		if (sensitiveGuard === undefined) return;

		// Containment gate over the REAL on-disk run bytes: the run.json written to
		// the temp XDG store carries no delivered value, so the sweep releases.
		const surfaces = await collectRunGovernedSurfaces(store.deps, NONCE_RUN);
		expect(surfaces.length).toBeGreaterThan(0);
		expect(surfaces.some((s) => s.kind === "run-store-file")).toBe(true);
		const gate = assertContainmentBeforeRelease(sensitiveGuard, surfaces);
		expect(gate.release).toBe(true);
		for (const surface of surfaces) {
			expect(surface.content).not.toContain(sentinelValue.password);
			expect(surface.content).not.toContain(sentinelValue["otp-current"]);
		}
	});

	test("without the auth-delivery context, a confidential fill is refused unchanged (default not weakened)", async () => {
		const runtime = runtimeFor(attachAndSnapshot());
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-cfd-seam-refusal",
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			// no auth_delivery
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "fill",
					ref: "@e2",
					value: "sentinel-secret",
					sensitivity: "confidential",
					postcondition: {
						kind: "value-equals",
						selector: "input[name=password]",
						value: "sentinel-secret",
					},
				},
			],
		});
		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_confidential_input_requires_auth_transaction",
			outcome: "not-achieved",
		});
	});

	test("delivery context present but OUTSIDE the sensitive interval still refuses (native-capability / phase gate)", async () => {
		const store = await makeStore();
		const { hook } = leakHelper({
			username: "u",
			password: "p",
			"otp-current": "o",
		});
		const runtime = runtimeFor(attachAndSnapshot());
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-cfd-seam-outside",
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildContext(store.deps, "run-cfd-seam-outside", hook, false),
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
			],
		});
		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_confidential_input_requires_auth_transaction",
		});
	});

	test("a blocked delivery is a typed not-achieved refusal carrying the auth blocked cause", async () => {
		const store = await makeStore();
		const runtime = runtimeFor(attachAndSnapshot());
		// A delivery hook that fails the write: the choreography blocks capability-loss.
		const failingHook: BrowserUseDeliveryHook = async () => ({
			ok: false,
			reason: "field-write-failed",
			field_cleared: true,
		});
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-cfd-seam-blocked",
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildContext(store.deps, "run-cfd-seam-blocked", failingHook, true),
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
			],
		});
		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_confidential_delivery_blocked",
			outcome: "not-achieved",
			mutation_dispatched: true,
		});
		if (result.ok === false) {
			expect(result.message).toContain("capability-loss");
		}
	});

	test("a delivery helper that never starts preserves no-mutation truth", async () => {
		const store = await makeStore();
		const runtime = runtimeFor(attachAndSnapshot());
		const unavailableHook: BrowserUseDeliveryHook = async () => ({
			ok: false,
			reason: "helper-unavailable",
			field_cleared: false,
		});
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: "run-cfd-seam-helper-unavailable",
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildContext(
				store.deps,
				"run-cfd-seam-helper-unavailable",
				unavailableHook,
				true,
			),
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
			],
		});

		expect(result).toMatchObject({
			ok: false,
			code: "agent_browser_confidential_delivery_blocked",
			outcome: "not-achieved",
			mutation_dispatched: false,
		});
	});

	test("the driver's on-disk sweep catches a REGRESSION that leaks a delivered value into the run bytes", async () => {
		const RUN = "run-cfd-seam-regression";
		const store = await makeStore();
		const runNonce = runScopedSentinelNonce(RUN);
		const PASS = deriveConformanceSentinel("password", runNonce);
		expect(PASS.ok).toBe(true);
		if (!PASS.ok) return;

		const { hook } = leakHelper({
			username: PASS.value,
			password: PASS.value,
			"otp-current": PASS.value,
		});
		const runtime = runtimeFor([
			...attachAndSnapshot(),
			{ stdout: adapterSuccess({ value: "•••" }) },
		]);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: RUN,
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildContext(store.deps, RUN, hook, true),
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
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const baseGuardResult = beginSensitiveRunGuard(RUN);
		if (!baseGuardResult.ok) return;
		const markedOutcome = markGuardForDeliveryOutcome(baseGuardResult.guard, result);
		expect(markedOutcome.ok).toBe(true);
		if (!markedOutcome.ok) return;
		const sensitiveGuard = markedOutcome.guard;
		if (sensitiveGuard === undefined) return;

		// Negative fixture: a surface that DID leak the delivered value must fail
		// the containment gate closed (the driver never releases such a run).
		const gate = assertContainmentBeforeRelease(sensitiveGuard, [
			{
				kind: "run-store-file",
				label: `run:${RUN}`,
				content: `{"leaked":"${PASS.value}"}`,
			},
		]);
		expect(gate.release).toBe(false);
		if (gate.release) return;
		expect(gate.reason).toBe("containment_failed");
	});

	test("a delivery followed by a LATER failure still carries delivery evidence and turns the run sensitive", async () => {
		const RUN = "run-cfd-seam-late-failure";
		const store = await makeStore();
		const runNonce = runScopedSentinelNonce(RUN);
		const PASS = deriveConformanceSentinel("password", runNonce);
		expect(PASS.ok).toBe(true);
		if (!PASS.ok) return;
		const { hook, observed } = leakHelper({
			username: PASS.value,
			password: PASS.value,
			"otp-current": PASS.value,
		});
		// The post-auth structural proof FAILS (fresh structure shows the wrong
		// value), so the task terminates not-achieved AFTER the secret already
		// reached the page.
		const runtime = runtimeFor([
			...attachAndSnapshot(),
			{ stdout: adapterSuccess({ value: "wrong-value" }) },
		]);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: RUN,
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: buildContext(store.deps, RUN, hook, true),
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
			],
		});
		// The task failed, but the delivery already happened: the FAILURE result
		// carries the same delivery evidence the success branch would.
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("agent_browser_postcondition_not_achieved");
		expect(observed).toContain(PASS.value);
		expect(result.delivery?.delivered_shapes).toEqual([
			{ field: "password", byte_length: PASS.value.length },
		]);
		expect(result.delivery?.method_step_events).toEqual(["fill-password"]);

		// The guard seam marks the run sensitive from the FAILED result, so
		// recordTaskRunOutcome's containment gate engages instead of being skipped.
		const baseGuardResult = beginSensitiveRunGuard(RUN);
		expect(baseGuardResult.ok).toBe(true);
		if (!baseGuardResult.ok) return;
		const markedOutcome = markGuardForDeliveryOutcome(
			baseGuardResult.guard,
			result,
		);
		expect(markedOutcome.ok).toBe(true);
		if (!markedOutcome.ok) return;
		expect(markedOutcome.guard?.sensitive).toBe(true);
		expect(markedOutcome.guard?.trigger).toBe("confidential-field-delivery");
	});

	test("sentinel derivation failure after a delivery WITHHOLDS release (fail closed), never an unguarded release", () => {
		const RUN = "run-cfd-seam-derivation-fail";
		const baseGuardResult = beginSensitiveRunGuard(RUN);
		expect(baseGuardResult.ok).toBe(true);
		if (!baseGuardResult.ok) return;
		// Delivery engaged, but the evidence yields NO derivable sentinels (empty
		// delivered shapes): the sentinel owner refuses, so the guard seam must
		// answer ok:false rather than silently dropping the guard.
		const marked = markGuardForDeliveryOutcome(baseGuardResult.guard, {
			ok: false,
			code: "agent_browser_postcondition_not_achieved",
			outcome: "not-achieved",
			message:
				"Fresh structure did not satisfy the confidential fill postcondition.",
			executed_steps: 1,
			mutation_dispatched: true,
			delivery: {
				delivered_shapes: [],
				method_step_events: [],
				resume: {
					lane_id: "agent-browser",
					run_id: RUN,
					target_id: "target-1",
					discard_stale_refs: true,
					require_fresh_identity_basis: true,
					delivered_shapes: [],
				},
			},
		});
		expect(marked).toEqual({ ok: false, reason: "sentinel_derivation_failed" });
		if (marked.ok) return;
		// The call sites translate ok:false into the withheld typed failure: fail
		// closed with a repair path, never a normal release.
		const withheld = sentinelRegistrationWithheldFailure(marked.reason);
		expect(withheld.code).toBe("task_run_lane_refused");
		expect(withheld.exitCode).toBe(BINDING_FAIL_CLOSED_EXIT_CODE);
		expect(withheld.recoverability).toBe("repair_state");
		expect(withheld.message).toContain("withheld");
		expect(withheld.message).toContain("sentinel_derivation_failed");
	});

	test("the release gate sweeps the PENDING envelope: a sentinel present only in envelope text withholds emission", async () => {
		const RUN = "run-cfd-seam-envelope-sweep";
		const store = await makeStore();
		const created = await createSharedRun(store.deps, {
			run_id: RUN,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed",
			mutation_dispatched: false,
			artifacts: [],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const SENTINEL = "sentinel-envelope-leak-000111";
		const baseGuardResult = beginSensitiveRunGuard(RUN);
		expect(baseGuardResult.ok).toBe(true);
		if (!baseGuardResult.ok) return;
		const marked = markRunSensitive(baseGuardResult.guard, {
			trigger: "confidential-field-delivery",
			sentinels: [SENTINEL],
		});
		expect(marked.ok).toBe(true);
		if (!marked.ok) return;

		const parsed = parseBrowserUseArgv([
			"task",
			"run",
			"--handoff",
			"handoff.json",
			"--intent",
			"scrape",
			"--json",
		]);
		expect(parsed.kind).toBe("command");
		if (parsed.kind !== "command") return;
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		const input = {
			parsed,
			runtime: makeRuntime(),
			stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
			stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
			runId: "cli-run-envelope-sweep",
			caller: { label: null },
			durationMs: () => 1,
		};
		// The pending failure envelope carries adapter-derived text that leaked
		// the sentinel; the on-disk run bytes stay clean, so ONLY the pending
		// envelope sweep can catch it.
		const exitCode = await recordTaskRunOutcome(
			input,
			store.deps,
			created.run,
			{ lane_id: "agent-browser", source: "intent-preferred", intent: "scrape" },
			{
				kind: "terminal",
				state: "not-achieved",
				failure: {
					code: "task_run_not_achieved",
					message: `adapter text leaked ${SENTINEL} into the envelope`,
					actionId: "inspect_task_run_result",
					exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
					recoverability: "none",
				},
			},
			{ guard: marked.guard },
		);
		expect(exitCode).toBe(BINDING_FAIL_CLOSED_EXIT_CODE);
		const emitted = stdoutChunks.join("") + stderrChunks.join("");
		// The leaking envelope was withheld: the sentinel never reached the real
		// streams; what WAS emitted is the containment refusal.
		expect(emitted).not.toContain(SENTINEL);
		expect(emitted).toContain("containment failed");
	});

	test("a clean pending envelope releases normally through the sensitive gate", async () => {
		const RUN = "run-cfd-seam-envelope-clean";
		const store = await makeStore();
		const created = await createSharedRun(store.deps, {
			run_id: RUN,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed",
			mutation_dispatched: false,
			artifacts: [],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const SENTINEL = "sentinel-envelope-clean-000222";
		const baseGuardResult = beginSensitiveRunGuard(RUN);
		expect(baseGuardResult.ok).toBe(true);
		if (!baseGuardResult.ok) return;
		const marked = markRunSensitive(baseGuardResult.guard, {
			trigger: "confidential-field-delivery",
			sentinels: [SENTINEL],
		});
		expect(marked.ok).toBe(true);
		if (!marked.ok) return;

		const parsed = parseBrowserUseArgv([
			"task",
			"run",
			"--handoff",
			"handoff.json",
			"--intent",
			"scrape",
			"--json",
		]);
		expect(parsed.kind).toBe("command");
		if (parsed.kind !== "command") return;
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		const input = {
			parsed,
			runtime: makeRuntime(),
			stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
			stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
			runId: "cli-run-envelope-clean",
			caller: { label: null },
			durationMs: () => 1,
		};
		const exitCode = await recordTaskRunOutcome(
			input,
			store.deps,
			created.run,
			{ lane_id: "agent-browser", source: "intent-preferred", intent: "scrape" },
			{ kind: "confirmed", executedSteps: 1 },
			{ guard: marked.guard },
		);
		expect(exitCode).toBe(0);
		const emitted = stdoutChunks.join("");
		// The swept-clean envelope is released byte-for-byte onto the real stream.
		expect(emitted).toContain(RUN);
		expect(emitted).not.toContain(SENTINEL);
		expect(emitted).toContain("confirmed");
	});

	test("the fenced outcome commit persists admitted read results and makes capture refusal terminal", async () => {
		const store = await makeStore();
		const privateRunbookState = {
			runbook_target_binding: {
				schema_version: "1",
				mode: "automatic",
				binding_id: "candidate-structured-result",
			},
			runbook_progress: {
				schema_version: "1",
				service_id: "oncore",
				flow_id: "diagnose",
				runbook_version: "2",
				next_step: 0,
				total_steps: 1,
			},
		} as const;
		const parsed = parseBrowserUseArgv([
			"task",
			"run",
			"--handoff",
			"handoff.json",
			"--intent",
			"scrape",
			"--json",
		]);
		expect(parsed.kind).toBe("command");
		if (parsed.kind !== "command") return;

		const admitted = await createSharedRun(store.deps, {
			run_id: "run-structured-result-admitted",
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed",
			...privateRunbookState,
			mutation_dispatched: false,
			artifacts: [],
		});
		expect(admitted.ok).toBe(true);
		if (!admitted.ok) return;
		const admittedStdout: string[] = [];
		const admittedExit = await recordTaskRunOutcome(
			{
				parsed,
				runtime: makeRuntime(),
				stdout: { write: (chunk: string) => admittedStdout.push(chunk) },
				stderr: { write: () => undefined },
				runId: "cli-structured-result-admitted",
				caller: { label: null },
				durationMs: () => 1,
			},
			store.deps,
			admitted.run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			{ kind: "confirmed", executedSteps: 1 },
			{
				runbookNextStep: 1,
				structuredResults: [
					{
						ok: true,
						action_id: "diagnose-grid",
						item_key: "monday",
						outcome: {
							schema_id: "a".repeat(64),
							sensitivity: "low",
							summary: '{"rows":7}',
							result_digest: "b".repeat(64),
							inline: true,
						},
					},
				],
			},
		);
		expect(admittedExit).toBe(0);
		const admittedLoaded = await loadSharedRun(
			store.deps,
			"run-structured-result-admitted",
		);
		expect(admittedLoaded.ok).toBe(true);
		if (admittedLoaded.ok) {
			expect(admittedLoaded.run.structured_results).toHaveLength(1);
			expect(admittedLoaded.run.state).toBe("confirmed");
			expect(admittedLoaded.run.runbook_progress?.next_step).toBe(1);
		}
		const admittedEnvelope = JSON.parse(admittedStdout.join(""));
		expect(admittedEnvelope.data).toMatchObject({
			contract: "browser-use.shared-run",
			schema_version: "2",
			run: { structured_results: [{ ok: true, item_key: "monday" }] },
		});

		const refused = await createSharedRun(store.deps, {
			run_id: "run-structured-result-refused",
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed",
			...privateRunbookState,
			mutation_dispatched: false,
			artifacts: [],
		});
		expect(refused.ok).toBe(true);
		if (!refused.ok) return;
		const refusedStdout: string[] = [];
		const refusedExit = await recordTaskRunOutcome(
			{
				parsed,
				runtime: makeRuntime(),
				stdout: { write: (chunk: string) => refusedStdout.push(chunk) },
				stderr: { write: () => undefined },
				runId: "cli-structured-result-refused",
				caller: { label: null },
				durationMs: () => 1,
			},
			store.deps,
			refused.run,
			{
				lane_id: "agent-browser",
				source: "intent-preferred",
				intent: "runbook-execution",
			},
			{ kind: "confirmed", executedSteps: 1 },
			{
				runbookNextStep: 1,
				structuredResults: [
					{
						ok: false,
						action_id: "diagnose-grid",
						refusal: {
							code: "structured_result_schema_mismatch",
							message:
								"the captured read result does not satisfy its schema.",
						},
					},
				],
			},
		);
		expect(refusedExit).toBe(BINDING_FAIL_CLOSED_EXIT_CODE);
		const refusedLoaded = await loadSharedRun(
			store.deps,
			"run-structured-result-refused",
		);
		expect(refusedLoaded.ok).toBe(true);
		if (refusedLoaded.ok) {
			expect(refusedLoaded.run.state).toBe("not-achieved");
			expect(refusedLoaded.run.structured_results?.[0]?.ok).toBe(false);
			expect(refusedLoaded.run.runbook_progress?.next_step).toBe(0);
		}
		expect(JSON.parse(refusedStdout.join("")).error).toMatchObject({
			code: "runbook_structured_result_refused",
		});
	});

	test("dispatch truth and terminal truth produce the conservative effect table", async () => {
		const cases = [
			{ state: "confirmed", mutationDispatched: false, effect: "none" },
			{ state: "confirmed", mutationDispatched: true, effect: "none" },
			{ state: "not-achieved", mutationDispatched: false, effect: "none" },
			{ state: "not-achieved", mutationDispatched: true, effect: "unknown" },
			{ state: "unknown", mutationDispatched: true, effect: "unknown" },
			{ state: "needs-human", mutationDispatched: true, effect: "unknown" },
		] as const;

		for (const [index, scenario] of cases.entries()) {
			const store = await makeStore();
			const runId = `run-effect-table-${index}`;
			const created = await createSharedRun(store.deps, {
				run_id: runId,
				state: "running",
				task_intent: "scrape",
				environment_profile: {
					environment: "agent-chrome",
					profile: "default",
				},
				adapter_id: "agent-browser",
				handoff_evidence_id: "seed",
				mutation_dispatched: false,
				artifacts: [],
			});
			expect(created.ok).toBe(true);
			if (!created.ok) continue;
			const parsed = parseBrowserUseArgv([
				"task",
				"run",
				"--handoff",
				"handoff.json",
				"--intent",
				"scrape",
				"--json",
			]);
			expect(parsed.kind).toBe("command");
			if (parsed.kind !== "command") continue;
			const stdoutChunks: string[] = [];
			const failure = {
				code: "task_run_not_achieved",
				message: "effect-table fixture",
				actionId: "inspect_task_run_result" as const,
				exitCode: BINDING_FAIL_CLOSED_EXIT_CODE,
				recoverability: "none" as const,
			};
			const mapping =
				scenario.state === "confirmed"
					? {
							kind: "confirmed" as const,
							executedSteps: 1,
							mutationDispatched: scenario.mutationDispatched,
						}
					: scenario.state === "needs-human"
						? {
								kind: "blocked" as const,
								state: scenario.state,
								continuation: {
									next_action_id: "inspect_task_run_result",
									summary: "inspect",
								},
								failure,
								mutationDispatched: scenario.mutationDispatched,
							}
						: {
								kind: "terminal" as const,
								state: scenario.state,
								failure,
								mutationDispatched: scenario.mutationDispatched,
							};

			await recordTaskRunOutcome(
				{
					parsed,
					runtime: makeRuntime(),
					stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
					stderr: { write: () => undefined },
					runId: `cli-${runId}`,
					caller: { label: null },
					durationMs: () => 1,
				},
				store.deps,
				created.run,
				{
					lane_id: "agent-browser",
					source: "intent-preferred",
					intent: "scrape",
				},
				mapping,
			);

			const envelope = JSON.parse(stdoutChunks.join("")) as {
				data: { external_effect: string };
			};
			expect(envelope.data.external_effect).toBe(scenario.effect);
		}
	});
});

// =========================================================================
// (H) Hermetic real-process runbook-run confidential delivery (U13 tier-H).
//
// A REAL child process drives the wired runbook engine end-to-end over a REAL
// temp XDG store, with hermetic op-execute + delivery-hook fakes at the injected
// port boundaries only (see fixtures/confidential-runbook-delivery-fixture.ts).
// The fixture emits an ordered journal proving the phase order (quarantine
// raised BEFORE secret acquisition, sensitive-interval lease acquired, exactly
// one bounded write, cleanup + assertContainmentBeforeRelease released over the
// real on-disk run bytes). This parent then sweeps EVERY governed surface the
// process actually produced — run-store bytes, stdout, stderr, and artifacts —
// for the derived sentinel and asserts ZERO occurrences, with a NEGATIVE control
// proving the same sweep fails closed when a sentinel IS planted.
//
// The sentinel is a conformance marker (BU-CFD-SENTINEL-...), obviously fake and
// never a real-looking credential.
// =========================================================================

const RUNBOOK_FIXTURE = join(
	import.meta.dir,
	"fixtures",
	"confidential-runbook-delivery-fixture.ts",
);
const RUNBOOK_NONCE = "hruncfd01";

async function waitForRunbookJournal(path: string, event: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			const parsed = JSON.parse(await readFile(path, "utf8")) as string[];
			if (parsed.includes(event)) return;
		} catch {
			// journal not written yet
		}
		await Bun.sleep(25);
	}
	throw new Error(`fixture journal never reached event: ${event}`);
}

async function filesUnder(root: string): Promise<string[]> {
	if ((await stat(root).catch(() => null)) === null) return [];
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));
}

describe("(H) hermetic real-process runbook confidential delivery (U13)", () => {
	test("a real runbook run delivers a confidential field with no sentinel on any governed surface, and the sweep fails closed when a sentinel is planted", async () => {
		// realpath the temp base: macOS tmpdirs sit behind /var -> /private/var and
		// the XDG root guard refuses a symlinked ancestor.
		const root = realpathSync(
			mkdtempSync(join(tmpdir(), "browser-use-runbook-cfd-")),
		);
		const dataRoot = join(root, "data");
		const stateRoot = join(root, "state");
		const journalPath = join(root, "journal.json");

		// The sentinel the fixture delivers (== the derived conformance marker).
		const sentinel = deriveConformanceSentinel("password", RUNBOOK_NONCE);
		expect(sentinel.ok).toBe(true);
		if (!sentinel.ok) return;

		try {
			const child = Bun.spawn(
				[
					process.execPath,
					RUNBOOK_FIXTURE,
					dataRoot,
					stateRoot,
					journalPath,
					RUNBOOK_NONCE,
				],
				{ cwd: root, stdout: "pipe", stderr: "pipe" },
			);
			await waitForRunbookJournal(journalPath, "cleanup:released");
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);

			// The real run confirmed and released.
			expect(exitCode).toBe(0);
			expect(stdout).toContain("runbook-delivery-complete");

			// The journal proves the phase ORDER: quarantine raised BEFORE the op
			// executor was asked for a secret, then lease, one bounded write, release.
			const journal = JSON.parse(
				await readFile(journalPath, "utf8"),
			) as string[];
			expect(journal[0]).toBe("quarantine:raised");
			expect(journal).toContain("lease:acquired:oncore_password");
			expect(journal).toContain("op-execute:secret-acquired");
			expect(journal).toContain("delivery:bounded-write");
			expect(journal[journal.length - 1]).toBe("cleanup:released");
			// Quarantine strictly precedes secret acquisition.
			expect(journal.indexOf("quarantine:raised")).toBeLessThan(
				journal.indexOf("op-execute:secret-acquired"),
			);
			// Exactly one bounded write occurred.
			expect(
				journal.filter((e) => e === "delivery:bounded-write"),
			).toHaveLength(1);

			// Zero-sentinel sweep over EVERY real governed surface: run-store bytes
			// (and every state file), stdout, stderr, and any artifacts.
			const stateFiles = await filesUnder(stateRoot);
			const runFiles = stateFiles.filter((f) => f.endsWith("run.json"));
			expect(runFiles.length).toBeGreaterThan(0);
			const surfaces: BrowserUseGovernedSurface[] = [
				{ kind: "stdout-envelope", label: "child-stdout", content: stdout },
				{ kind: "log", label: "child-stderr", content: stderr },
			];
			for (const file of stateFiles) {
				surfaces.push({
					kind: file.includes("/artifacts/") ? "artifact" : "run-store-file",
					label: file,
					content: await readFile(file, "utf8"),
				});
			}
			// Direct byte assertion: the sentinel is nowhere.
			for (const surface of surfaces) {
				expect(surface.content).not.toContain(sentinel.value);
			}

			// Mechanical containment gate over the real surfaces: it releases clean.
			const cleanGuard = beginSensitiveRunGuard("run-h-runbook-cfd");
			expect(cleanGuard.ok).toBe(true);
			if (!cleanGuard.ok) return;
			const cleanMarked = markRunSensitive(cleanGuard.guard, {
				trigger: "confidential-field-delivery",
				sentinels: [sentinel.value],
			});
			expect(cleanMarked.ok).toBe(true);
			if (!cleanMarked.ok) return;
			const cleanGate = assertContainmentBeforeRelease(
				cleanMarked.guard,
				surfaces,
			);
			expect(cleanGate.release).toBe(true);

			// NEGATIVE control: plant the sentinel on one surface — the SAME sweep
			// must now withhold release (fail closed), proving the clean pass above
			// was not vacuous.
			const plantGuard = beginSensitiveRunGuard("run-h-runbook-plant");
			expect(plantGuard.ok).toBe(true);
			if (!plantGuard.ok) return;
			const plantMarked = markRunSensitive(plantGuard.guard, {
				trigger: "confidential-field-delivery",
				sentinels: [sentinel.value],
			});
			expect(plantMarked.ok).toBe(true);
			if (!plantMarked.ok) return;
			const plantedGate = assertContainmentBeforeRelease(plantMarked.guard, [
				...surfaces,
				{
					kind: "run-store-file",
					label: "planted-leak",
					content: `{"leaked":"${sentinel.value}"}`,
				},
			]);
			expect(plantedGate.release).toBe(false);
			if (plantedGate.release) return;
			expect(plantedGate.reason).toBe("containment_failed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 30_000);
});
