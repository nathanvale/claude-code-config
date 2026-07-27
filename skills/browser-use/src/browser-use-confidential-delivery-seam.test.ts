import { afterAll, describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import {
	type AgentBrowserAuthDeliveryContext,
	type AgentBrowserExecutionRuntime,
	type AgentBrowserVerifiedHandoff,
	executeAgentBrowserTask,
} from "./browser-use-agent-browser";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import { createBrowserUseAuthProvider } from "./browser-use-auth-provider";
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
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import { type RunStoreDeps, createSharedRun } from "./browser-use-runs";
import { deriveConformanceSentinel } from "./browser-use-secret-scan";
import {
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
} from "./browser-use-sensitive-run";
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

const { runScopedSentinelNonce, markGuardForDeliveryOutcome, collectRunGovernedSurfaces } =
	__confidentialDeliveryDriverForTest;

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
		environment_schema_version: "1",
		route_evidence: "verified-live",
	},
	contract_id: "browser-connect.verified-handoff",
	schema_version: "2",
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
	auth_context: "interactive-login",
	allowed_origins: ["https://oncore.test"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
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
		tokenRetrieval: fakePort,
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
		{
			stdout: adapterSuccess({
				snapshot: "@e2 textbox password @e3 textbox otp",
				refs: { e2: {}, e3: {} },
			}),
		},
	];
}

describe("confidential-delivery seam co-change (U5, R13-R16)", () => {
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
		const sensitiveGuard = markGuardForDeliveryOutcome(baseGuardResult.guard, result);
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
		});
		if (result.ok === false) {
			expect(result.message).toContain("capability-loss");
		}
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
		const sensitiveGuard = markGuardForDeliveryOutcome(baseGuardResult.guard, result);
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
});
