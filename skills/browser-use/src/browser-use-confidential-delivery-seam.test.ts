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
import {
	createBrowserUseAuthProvider,
	sensitiveIntervalLeaseKeyForRun,
} from "./browser-use-auth-provider";
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
import { BINDING_FAIL_CLOSED_EXIT_CODE } from "./browser-use-core";
import { parseBrowserUseArgv } from "./browser-use-parser";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	type RunStoreDeps,
	createSharedRun,
	leaseKeyForRun,
	loadSharedRun,
} from "./browser-use-runs";
import { deriveConformanceSentinel } from "./browser-use-secret-scan";
import {
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	type BrowserUseGovernedSurface,
	markRunSensitive,
} from "./browser-use-sensitive-run";
import type {
	BrowserUseDevToolsRequest,
	BrowserUseDevToolsTransport,
} from "./browser-use-target-proof";
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
	emitSubmitApprovalGate,
	buildRunbookAuthDelivery,
	environmentDeliveryHook,
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

const resolveApprovedBinding = async (): Promise<BrowserUseItemBinding> =>
	BINDING;

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

function stableProofTransport(): BrowserUseDevToolsTransport {
	return {
		request: async (request: BrowserUseDevToolsRequest): Promise<unknown> => {
			switch (request.method) {
				case "Target.getTargets":
					return {
						targetInfos: [
							{
								targetId: "cdp-target-7",
								type: "page",
								url: "https://oncore.test/login",
							},
						],
					};
				case "Target.attachToTarget":
					return { sessionId: "session-1" };
				case "Page.getFrameTree":
					return {
						frameTree: {
							frame: {
								id: "top-frame",
								url: "https://oncore.test/login",
							},
						},
					};
				case "Accessibility.getFullAXTree":
					return {
						nodes: [
							{
								backendDOMNodeId: 41,
								frameId: "top-frame",
								role: { value: "textbox" },
								name: { value: "Password" },
							},
						],
					};
				case "DOM.resolveNode":
					return { object: { objectId: "object-41" } };
				case "Target.detachFromTarget":
					return {};
			}
		},
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

function liveSeamInput(runId: string) {
	return {
		pendingItemBindings: ["oncore_password"],
		serviceId: "oncore",
		allowedOrigins: ["https://oncore.test"],
		expectedTargetUrl: "https://oncore.test/login",
		confidentialFields: [
			{
				bindingSlug: "oncore_password",
				credentialField: "password" as const,
				target: { role: "textbox", name: "Password" },
			},
		],
		handoff: HANDOFF,
		runId,
		targetTabId: "t1",
	};
}

function activeVaultPort(
	overrides: Partial<BrowserUseTokenRetrievalPort> = {},
): BrowserUseTokenRetrievalPort {
	return {
		listVaults: async () => ({
			ok: true,
			vaults: [{ vault_id: "vault-1", name: "Browser Automation" }],
		}),
		listLoginItems: async () => ({
			ok: true,
			items: [
				{
					item_id: "item-1",
					vault_id: "vault-1",
					origins: ["https://oncore.test"],
					login_paths: ["/login"],
					supported_methods: ["password"] as const,
					state: "active",
				},
			],
		}),
		getLoginItem: async () => ({
			ok: true,
			item: {
				item_id: "item-1",
				vault_id: "vault-1",
				origins: ["https://oncore.test"],
				login_paths: ["/login"],
				supported_methods: ["password", "otp"],
				state: "active",
			},
		}),
		fetchCredentialField: fakePort.fetchCredentialField,
		...overrides,
	};
}

type ApprovedBindingResolver = NonNullable<
	Parameters<
		typeof buildRunbookAuthDelivery
	>[1]["resolveApprovedBinding"]
>;

function buildApprovedAuthDelivery(
	store: RunStoreDeps,
	port: BrowserUseTokenRetrievalPort,
	deps: Omit<
		Parameters<typeof buildRunbookAuthDelivery>[1],
		"tokenRetrieval" | "resolveApprovedBinding"
	>,
	resolver: ApprovedBindingResolver = resolveApprovedBinding,
) {
	const provider = createBrowserUseAuthProvider({
		store,
		tokenRetrieval: port,
		attestationByDigest: () => undefined,
	});
	return buildRunbookAuthDelivery(provider, {
		...deps,
		tokenRetrieval: port,
		resolveApprovedBinding: resolver,
	});
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
		field_by_binding_slug: {
			oncore_password: "password",
			oncore_otp_current: "otp-current",
		},
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
				refs: { e2: {}, e3: {} },
			}),
		},
		{ stdout: adapterSuccess({ url: "https://oncore.test/login" }) },
	];
}

describe("confidential-delivery seam co-change (U5, R13-R16)", () => {
	test("live seam delivers to the observed target URL after a same-origin redirect", async () => {
		const store = await makeStore();
		let deliveryCalls = 0;
		const port = {
			...activeVaultPort(),
			fetchCredentialField: async (
				request: Parameters<
					BrowserUseTokenRetrievalPort["fetchCredentialField"]
				>[0],
			): Promise<{ ok: true; handle: BrowserUseSecretHandle }> => {
				const targetBound = request as typeof request & {
					target_digest?: string;
					observed_origin?: string;
				};
				expect(targetBound.target_digest).toMatch(/^[a-f0-9]{64}$/);
				expect(targetBound.observed_origin).toBe("https://oncore.test");
				return {
					ok: true,
					handle: {
						handle_id: "live-handle-password",
						field: "password",
						expires_at_epoch_ms: 9_999_999,
					},
				};
			},
			redeemCredentialField: async (request: {
				handle: BrowserUseSecretHandle;
				target_digest: string;
				ws_url: string;
				target_url: string;
				target_origin: string;
				field: { role: string; accessible_name: string };
			}) => {
				deliveryCalls += 1;
				expect(request.handle.handle_id).toBe("live-handle-password");
				expect(request.target_digest).toMatch(/^[a-f0-9]{64}$/);
				expect(request.ws_url).toBe(HANDOFF.endpoint.ws);
				expect(request.target_url).toBe("https://oncore.test/login");
				expect(request.target_origin).toBe("https://oncore.test");
				expect(request.field).toEqual({
					role: "textbox",
					accessible_name: "Password",
				});
				return {
					ok: true as const,
					shape: { field: "password" as const, byte_length: 12 },
				};
			},
		};
		let transportClosed = 0;
		const seam = buildApprovedAuthDelivery(store.deps, port, {
			createTargetTransport: () => ({
				transport: stableProofTransport(),
				close: () => {
					transportClosed += 1;
				},
			}),
			createDeliveryHook: environmentDeliveryHook,
		});
		const outcome = await seam({
			...liveSeamInput("run-live-seam"),
			expectedTargetUrl: "https://oncore.test/candidate",
		});
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.context.in_sensitive_interval).toBe(true);
		expect(outcome.context.binding.item_id).toBe("item-1");
		expect(outcome.context.target.target_id).toBe("cdp-target-7");
		expect(outcome.context.field_by_binding_slug).toEqual({
			oncore_password: "password",
		});
		const executed = await executeAgentBrowserTask(
			runtimeFor([
				...attachAndSnapshot(),
				{ stdout: adapterSuccess({ value: "•••" }) },
			]),
			{
				handoff: HANDOFF,
				run_id: "run-live-seam",
				target_tab_id: "t1",
				allowed_origins: ["https://oncore.test"],
				auth_delivery: outcome.context,
				steps: [
					{ kind: "snapshot", interactive: true },
					{
						kind: "fill",
						ref: "@e2",
						item_binding: "oncore_password",
						value: "",
						sensitivity: "confidential",
						postcondition: {
							kind: "value-equals",
							selector: "input[name=password]",
							value: "•••",
						},
					},
				],
			},
		);
		expect(executed.ok).toBe(true);
		expect(deliveryCalls).toBe(1);
		await outcome.release?.();
		expect(transportClosed).toBe(1);
	});

	test("U7/R2/R12: the LIVE composition delivers a conformance sentinel with clean lane argv, no fill dispatch, and clean on-disk run bytes through the containment gate", async () => {
		const RUN = "run-live-seam-sentinel";
		const store = await makeStore();

		// Sentinel minted under the driver's OWN run-scoped nonce so the marker
		// markGuardForDeliveryOutcome registers EQUALS the delivered value — the
		// argv/on-disk sweeps below hunt for the exact bytes the helper typed.
		const nonce = runScopedSentinelNonce(RUN);
		const PASS = deriveConformanceSentinel("password", nonce);
		expect(PASS.ok).toBe(true);
		if (!PASS.ok) return;

		const helperObserved: string[] = [];
		const port = {
			...activeVaultPort(),
			redeemCredentialField: async (request: {
				handle: BrowserUseSecretHandle;
				target_digest: string;
				ws_url: string;
				target_url: string;
				target_origin: string;
				field: { role: string; accessible_name: string };
			}) => {
				// The disposable helper stand-in "types" the sentinel bytes; only the
				// non-secret shape leaves this boundary (byte_length == value length).
				helperObserved.push(PASS.value);
				expect(request.handle.handle_id.length).toBeGreaterThan(0);
				return {
					ok: true as const,
					shape: {
						field: "password" as const,
						byte_length: PASS.shape.byte_length,
					},
				};
			},
		};
		const seam = buildApprovedAuthDelivery(store.deps, port, {
			createTargetTransport: () => ({
				transport: stableProofTransport(),
				close: () => {},
			}),
			createDeliveryHook: environmentDeliveryHook,
		});
		const built = await seam(liveSeamInput(RUN));
		expect(built.ok).toBe(true);
		if (!built.ok) return;

		const runtime = runtimeFor([
			...attachAndSnapshot(),
			{ stdout: adapterSuccess({ value: "•••" }) },
		]);
		const result = await executeAgentBrowserTask(runtime, {
			handoff: HANDOFF,
			run_id: RUN,
			target_tab_id: "t1",
			allowed_origins: ["https://oncore.test"],
			auth_delivery: built.context,
			steps: [
				{ kind: "snapshot", interactive: true },
				{
					kind: "fill",
					ref: "@e2",
					item_binding: "oncore_password",
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
		// The delivery genuinely completed (the helper saw the sentinel bytes), so
		// a clean lane sweep below is meaningful, not vacuous.
		expect(helperObserved).toContain(PASS.value);
		expect(result.delivery?.delivered_shapes).toEqual([
			{ field: "password", byte_length: PASS.value.length },
		]);

		// The existing argv-leak assertion holds against the LIVE composition: no
		// adapter argv carried the delivered value, and the executor dispatched no
		// native fill for the confidential step.
		expect(JSON.stringify(runtime.calls)).not.toContain(PASS.value);
		expect(runtime.calls.some((call) => call.includes("fill"))).toBe(false);

		// Driver guard seam over REAL on-disk run bytes: mark from the live result,
		// prove the registered sentinel IS the delivered value, then release clean.
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
		const baseGuardResult = beginSensitiveRunGuard(RUN);
		expect(baseGuardResult.ok).toBe(true);
		if (!baseGuardResult.ok) return;
		const marked = markGuardForDeliveryOutcome(baseGuardResult.guard, result);
		expect(marked.ok).toBe(true);
		if (!marked.ok) return;
		const guard = marked.guard;
		expect(guard?.sensitive).toBe(true);
		if (guard === undefined) return;
		// Loop closed by construction: what was delivered is exactly what is hunted.
		expect(guard.sentinels).toContain(PASS.value);

		const surfaces = await collectRunGovernedSurfaces(store.deps, RUN);
		expect(surfaces.some((s) => s.kind === "run-store-file")).toBe(true);
		for (const surface of surfaces) {
			expect(surface.content).not.toContain(PASS.value);
		}
		const gate = assertContainmentBeforeRelease(guard, surfaces);
		expect(gate.release).toBe(true);

		// Non-vacuous flip: the SAME guard withholds when a run surface carries the
		// delivered value, proving the clean release above is a real verdict.
		const planted = assertContainmentBeforeRelease(guard, [
			...surfaces,
			{
				kind: "run-store-file",
				label: "planted-live-leak",
				content: `{"leaked":"${PASS.value}"}`,
			},
		]);
		expect(planted.release).toBe(false);
		if (planted.release) return;
		expect(planted.reason).toBe("containment_failed");
		await built.release?.();
	});

	test("token absence refuses before target proof and names the install-token continuation chain", async () => {
		const store = await makeStore();
		const port = activeVaultPort({
			listVaults: async () => ({
				ok: false,
				rejection: {
					code: "token-invalid",
					message: "token unavailable",
				},
			}),
		});
		const provider = createBrowserUseAuthProvider({
			store: store.deps,
			tokenRetrieval: port,
			attestationByDigest: () => undefined,
		});
		let transportCalls = 0;
		const seam = buildRunbookAuthDelivery(provider, {
			tokenRetrieval: port,
			createTargetTransport: () => {
				transportCalls += 1;
				return { transport: stableProofTransport(), close: () => {} };
			},
			createDeliveryHook: () => undefined,
		});
		const outcome = await seam(liveSeamInput("run-token-absent"));
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.message).toContain("missing-token");
		expect(outcome.message).toContain("auth install-token");
		expect(transportCalls).toBe(0);
	});

	test("zero, one, and many vault matches block typed before target proof or handle mint", async () => {
		const store = await makeStore();
		for (const scenario of ["zero", "single", "ambiguous"] as const) {
			let handleMints = 0;
			let transportCalls = 0;
			const matchingItems = [
				{
					item_id: "item-a",
					vault_id: "vault-1",
					origins: ["https://oncore.test"],
					login_paths: ["/login"],
					supported_methods: ["password"] as const,
					state: "active" as const,
				},
				{
					item_id: "item-b",
					vault_id: "vault-1",
					origins: ["https://oncore.test"],
					login_paths: ["/login"],
					supported_methods: ["password"] as const,
					state: "active" as const,
				},
			];
			const port = activeVaultPort({
				listLoginItems: async () => ({
					ok: true,
					items:
						scenario === "zero"
							? []
							: matchingItems.slice(0, scenario === "single" ? 1 : 2),
				}),
				fetchCredentialField: async (request) => {
					handleMints += 1;
					return await fakePort.fetchCredentialField(request);
				},
			});
			const provider = createBrowserUseAuthProvider({
				store: store.deps,
				tokenRetrieval: port,
				attestationByDigest: () => undefined,
			});
			const seam = buildRunbookAuthDelivery(provider, {
				tokenRetrieval: port,
				createTargetTransport: () => {
					transportCalls += 1;
					return { transport: stableProofTransport(), close: () => {} };
				},
				createDeliveryHook: () => undefined,
			});
			const outcome = await seam(liveSeamInput(`run-match-${scenario}`));
			expect(outcome.ok).toBe(false);
			if (outcome.ok) continue;
			expect(outcome.message).toContain(
				scenario === "zero"
					? "revoked-binding"
					: "binding-approval-required",
			);
			if (scenario !== "zero") {
				expect(outcome.message).toContain("rank 1 item item-a");
			}
			expect(handleMints).toBe(0);
			expect(transportCalls).toBe(0);
		}
	});

	test("two slugs of one Item Binding proceed; two distinct Item Bindings refuse single-binding-v1 (R10)", async () => {
		const store = await makeStore();
		const twoSlugInput = (runId: string) => ({
			...liveSeamInput(runId),
			pendingItemBindings: ["oncore_password", "oncore_username"],
			confidentialFields: [
				{
					bindingSlug: "oncore_password",
					credentialField: "password" as const,
					target: { role: "textbox", name: "Password" },
				},
				{
					bindingSlug: "oncore_username",
					credentialField: "username" as const,
					target: { role: "textbox", name: "Username" },
				},
			],
		});

		// Positive: both slugs resolve to the SAME item — one distinct Item
		// Binding — so the real seam builds the context with both mappings, and
		// the REAL environmentDeliveryHook redeems EACH field with ITS OWN node
		// descriptor — the username redemption must never carry the password
		// field's descriptor (a constant descriptor would write the password
		// into the username node).
		{
			const redeemedDescriptors: {
				field: BrowserUseOpCredentialField;
				descriptor: { role: string; accessible_name: string };
			}[] = [];
			const port = {
				...activeVaultPort(),
				redeemCredentialField: async (request: {
					handle: BrowserUseSecretHandle;
					target_digest: string;
					ws_url: string;
					target_url: string;
					target_origin: string;
					field: { role: string; accessible_name: string };
				}) => {
					redeemedDescriptors.push({
						field: request.handle.field,
						descriptor: request.field,
					});
					return {
						ok: true as const,
						shape: { field: request.handle.field, byte_length: 1 },
					};
				},
			};
			const seam = buildApprovedAuthDelivery(store.deps, port, {
				createTargetTransport: () => ({
					transport: stableProofTransport(),
					close: () => {},
				}),
				createDeliveryHook: environmentDeliveryHook,
			});
			const built = await seam(twoSlugInput("run-r10-one-item"));
			expect(built.ok).toBe(true);
			if (built.ok) {
				expect(built.context.field_by_binding_slug).toEqual({
					oncore_password: "password",
					oncore_username: "username",
				});
				// Redeem BOTH fields through the REAL hook the seam built.
				for (const field of ["password", "username"] as const) {
					const delivered = await built.context.deliver({
						handle: {
							handle_id: `handle-${field}`,
							field,
							expires_at_epoch_ms: 9_999_999,
						},
						field,
						target: built.context.target,
					});
					expect(delivered.ok).toBe(true);
				}
				expect(redeemedDescriptors).toEqual([
					{
						field: "password",
						descriptor: { role: "textbox", accessible_name: "Password" },
					},
					{
						field: "username",
						descriptor: { role: "textbox", accessible_name: "Username" },
					},
				]);
				// The username redemption must NOT receive the password descriptor.
				expect(redeemedDescriptors[1]?.descriptor.accessible_name).not.toBe(
					"Password",
				);
				await built.release?.();
			}
		}

		// Negative: the slugs resolve to TWO distinct items — the real seam
		// refuses single-binding-v1 before any target proof or handle mint.
		{
			let handleMints = 0;
			let transportCalls = 0;
			const itemFor = (itemId: string) => ({
				item_id: itemId,
				vault_id: "vault-1",
				origins: ["https://oncore.test"],
				login_paths: ["/login"],
				supported_methods: ["password" as const],
				state: "active" as const,
			});
			const port = activeVaultPort({
				getLoginItem: async ({ item_id }) => ({
					ok: true,
					item: itemFor(item_id),
				}),
				fetchCredentialField: async (request) => {
					handleMints += 1;
					return await fakePort.fetchCredentialField(request);
				},
			});
			const seam = buildApprovedAuthDelivery(
				store.deps,
				port,
				{
					createTargetTransport: () => {
						transportCalls += 1;
						return { transport: stableProofTransport(), close: () => {} };
					},
					createDeliveryHook: () => undefined,
				},
				async ({ binding_ref }) => ({
					...BINDING,
					item_id:
						binding_ref === "oncore_password" ? "item-a" : "item-b",
				}),
			);
			const outcome = await seam(twoSlugInput("run-r10-two-items"));
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.message).toContain("single-binding-v1");
			}
			expect(handleMints).toBe(0);
			expect(transportCalls).toBe(0);
		}
	});

	test("target digest drift blocks before handle mint or bounded delivery", async () => {
		const store = await makeStore();
		let handleMints = 0;
		let deliveryCalls = 0;
		let observation = 0;
		const stable = stableProofTransport();
		const driftingTransport: BrowserUseDevToolsTransport = {
			request: async (request) => {
				if (request.method === "Target.getTargets") observation += 1;
				if (request.method === "Target.getTargets" && observation > 1) {
					return {
						targetInfos: [
							{
								targetId: "cdp-target-7",
								type: "page",
								url: "https://oncore.test/login?changed=1",
							},
						],
					};
				}
				if (request.method === "Page.getFrameTree" && observation > 1) {
					return {
						frameTree: {
							frame: {
								id: "top-frame",
								url: "https://oncore.test/login?changed=1",
							},
						},
					};
				}
				return await stable.request(request);
			},
		};
		const port = activeVaultPort({
			fetchCredentialField: async (request) => {
				handleMints += 1;
				return await fakePort.fetchCredentialField(request);
			},
		});
		const seam = buildApprovedAuthDelivery(store.deps, port, {
			createTargetTransport: () => ({
				transport: driftingTransport,
				close: () => {},
			}),
			createDeliveryHook: () => async ({ field }) => {
				deliveryCalls += 1;
				return { ok: true, shape: { field, byte_length: 12 } };
			},
		});
		const built = await seam(liveSeamInput("run-target-drift"));
		expect(built.ok).toBe(true);
		if (!built.ok) return;
		const result = await executeAgentBrowserTask(
			runtimeFor([
				...attachAndSnapshot(),
				{ stdout: adapterSuccess({ value: "•••" }) },
			]),
			{
				handoff: HANDOFF,
				run_id: "run-target-drift",
				target_tab_id: "t1",
				allowed_origins: ["https://oncore.test"],
				auth_delivery: built.context,
				steps: [
					{ kind: "snapshot", interactive: true },
					{
						kind: "fill",
						ref: "@e2",
						item_binding: "oncore_password",
						value: "",
						sensitivity: "confidential",
						postcondition: {
							kind: "value-equals",
							selector: "input[name=password]",
							value: "•••",
						},
					},
				],
			},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("agent_browser_confidential_delivery_blocked");
		}
		expect(handleMints).toBe(0);
		expect(deliveryCalls).toBe(0);
		await built.release?.();
	});

	test("sensitive lease contention blocks the second run and its key cannot collide with dispatch", async () => {
		const store = await makeStore();
		const port = activeVaultPort();
		const seam = buildApprovedAuthDelivery(store.deps, port, {
			createTargetTransport: () => ({
				transport: stableProofTransport(),
				close: () => {},
			}),
			createDeliveryHook: () => async ({ field }) => ({
				ok: true,
				shape: { field, byte_length: 12 },
			}),
		});
		const first = await seam(liveSeamInput("run-lease-first"));
		expect(first.ok).toBe(true);
		const second = await seam(liveSeamInput("run-lease-second"));
		expect(second.ok).toBe(false);
		if (!second.ok) expect(second.message).toContain("lease-unavailable");
		const runIdentity = {
			environment_profile: {
				environment: HANDOFF.environment.name,
				profile: HANDOFF.environment.profile,
			},
		};
		expect(sensitiveIntervalLeaseKeyForRun(runIdentity)).not.toBe(
			leaseKeyForRun(runIdentity),
		);
		if (first.ok) await first.release?.();
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
					item_binding: "oncore_password",
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
					item_binding: "oncore_password",
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
					item_binding: "oncore_password",
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
					item_binding: "oncore_password",
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
					item_binding: "oncore_password",
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
					item_binding: "oncore_password",
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
					item_binding: "oncore_password",
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

	test("the submit approval gate withholds its envelope when persisted run containment fails", async () => {
		const RUN = "run-cfd-seam-approval-gate";
		const SENTINEL = "sentinel-approval-gate-000333";
		const store = await makeStore();
		const created = await createSharedRun(store.deps, {
			run_id: RUN,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: SENTINEL,
			mutation_dispatched: true,
			artifacts: [],
		});
		expect(created.ok).toBe(true);
		if (!created.ok) return;

		const baseGuard = beginSensitiveRunGuard(RUN);
		expect(baseGuard.ok).toBe(true);
		if (!baseGuard.ok) return;
		const marked = markRunSensitive(baseGuard.guard, {
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
		const command = {
			parsed,
			runtime: makeRuntime(),
			stdout: { write: (chunk: string) => stdoutChunks.push(chunk) },
			stderr: { write: (chunk: string) => stderrChunks.push(chunk) },
			runId: "cli-run-approval-gate",
			caller: { label: null },
			durationMs: () => 1,
		};

		const exitCode = await emitSubmitApprovalGate({
			command,
			deps: store.deps,
			run: created.run,
			continuationId: "complete-submit-approval",
			artifactId: "submit-approval-2.png",
			guard: marked.guard,
		});
		expect(exitCode).toBe(BINDING_FAIL_CLOSED_EXIT_CODE);
		const emitted = stdoutChunks.join("") + stderrChunks.join("");
		expect(emitted).not.toContain(SENTINEL);
		expect(emitted).not.toContain("approval_review");
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
			// executor was asked for a secret, then lease, one bounded write per
			// field, re-keyed containment, release.
			const journal = JSON.parse(
				await readFile(journalPath, "utf8"),
			) as string[];
			expect(journal[0]).toBe("quarantine:raised");
			expect(journal).toContain("lease:acquired:oncore_password");
			expect(journal).toContain("op-execute:secret-acquired");
			expect(journal).toContain("delivery:bounded-write:password");
			expect(journal).toContain("containment:sentinels-rekeyed");
			expect(journal[journal.length - 1]).toBe("cleanup:released");
			// Strict phase order: quarantine < lease < secret acquisition < the
			// bounded write < re-keyed containment < release.
			const order = [
				"quarantine:raised",
				"lease:acquired:oncore_password",
				"op-execute:secret-acquired",
				"delivery:bounded-write:password",
				"containment:sentinels-rekeyed",
				"cleanup:released",
			].map((event) => journal.indexOf(event));
			for (let i = 1; i < order.length; i += 1) {
				expect(order[i - 1]).toBeLessThan(order[i] ?? -1);
			}
			// Exactly one bounded write occurred, and it was PER FIELD: one write
			// for the single delivered field, none for any other field.
			expect(
				journal.filter((e) => e.startsWith("delivery:bounded-write:")),
			).toEqual(["delivery:bounded-write:password"]);

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
