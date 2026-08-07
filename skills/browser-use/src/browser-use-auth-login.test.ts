import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { verifiedHandoffEnvelope } from "./browser-connect-handoff-fixtures";
import { parseHandoffFacts } from "./browser-use-discovery";
import type { BrowserUseEnvironmentTokenRetrievalPort } from "./browser-use-environment-op";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type { BrowserUseRunState } from "./browser-use-run-model";
import {
	type RunStoreDeps,
	createSharedRun,
	loadSharedRun,
} from "./browser-use-runs";
import { encodeDurableRecord } from "./browser-use-schemas";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

const disposables: Array<{ dispose(): void }> = [];
afterEach(() => {
	for (const disposable of disposables.splice(0)) disposable.dispose();
});

function authTransport(origin: string) {
	let screen: "login" | "authenticated" = "login";
	let closeCalls = 0;
	const targetId = "target-auth-login";
	return {
		factory: () => ({
			transport: {
				async request(message: {
					method: string;
					params?: Record<string, unknown>;
				}): Promise<unknown> {
					switch (message.method) {
						case "Target.getTargets":
							return {
								targetInfos: [
									{ targetId, type: "page", url: `${origin}/login` },
								],
							};
						case "Target.attachToTarget":
							return { sessionId: "session-auth-login" };
						case "Page.getFrameTree":
							return {
								frameTree: {
									frame: { id: "frame-auth-login", url: `${origin}/login` },
								},
							};
						case "Accessibility.getFullAXTree":
							return {
								nodes:
									screen === "login"
										? [
												{ nodeId: "form", role: { value: "form" }, name: { value: "Sign in" }, ignored: false, childIds: ["username", "password", "submit"] },
												{ nodeId: "username", parentId: "form", frameId: "frame-auth-login", role: { value: "textbox" }, name: { value: "Username" }, ignored: false, backendDOMNodeId: 11 },
												{ nodeId: "password", parentId: "form", frameId: "frame-auth-login", role: { value: "textbox" }, name: { value: "Password" }, ignored: false, backendDOMNodeId: 12 },
												{ nodeId: "submit", parentId: "form", frameId: "frame-auth-login", role: { value: "button" }, name: { value: "Sign in" }, ignored: false, backendDOMNodeId: 13 },
											]
										: [
												{ nodeId: "dashboard", frameId: "frame-auth-login", role: { value: "heading" }, name: { value: "Dashboard" }, ignored: false },
												{ nodeId: "profile", frameId: "frame-auth-login", role: { value: "button" }, name: { value: "Profile" }, ignored: false, backendDOMNodeId: 21 },
											],
							};
						case "DOM.resolveNode":
							return { object: { objectId: "field-object" } };
						case "DOM.getContentQuads":
							return { quads: [[0, 0, 20, 0, 20, 10, 0, 10]] };
						case "Input.dispatchMouseEvent":
							if (message.params?.type === "mouseReleased") {
								screen = "authenticated";
							}
					}
					return {};
				},
			},
			close() {
				closeCalls += 1;
			},
		}),
		closeCalls: () => closeCalls,
	};
}

// A freeform login now refuses before dispatch when no identity-proof owner is
// present (plan R30: identity basis is never neither). Tests that exercise the
// access, delivery, target-proof, or fragment paths must therefore inject a
// proof owner so they get past the pre-gate to the behaviour under test.
function stubAuthenticatedStateProof(origin: string) {
	return async ({ target_id }: { target_id: string }) => ({
		proven: true as const,
		proof: {
			target_id,
			page_id: "page-authenticated",
			frame_id: "frame-auth-login",
			origin,
			subject_reference: "subject-ref",
			account_reference: "account-ref",
			tenant_reference: "tenant-ref",
			identity_basis_digest: "proof-digest",
		},
	});
}

function tokenPort(
	origin: string,
	counts: { vaults: number; items: number; fetches: number; redeems: number },
) {
	const item = {
		item_id: "item-fixture",
		vault_id: "vault-fixture",
		origins: [origin],
		login_paths: ["/login"],
		supported_methods: ["password" as const],
		state: "active" as const,
	};
	return {
		listVaults: async () => {
			counts.vaults += 1;
			return { ok: true as const, vaults: [{ vault_id: "vault-fixture" }] };
		},
		listLoginItems: async () => {
			counts.items += 1;
			return { ok: true as const, items: [item] };
		},
		getLoginItem: async () => {
			counts.items += 1;
			return { ok: true as const, item };
		},
		fetchCredentialField: async ({ field }) => {
			counts.fetches += 1;
			return {
				ok: true as const,
				handle: {
					handle_id: `opaque-${field}`,
					field,
					expires_at_epoch_ms: 60_000,
				},
			};
		},
		redeemCredentialField: async ({ handle }) => {
			counts.redeems += 1;
			return {
				ok: true as const,
				shape: { field: handle.field, byte_length: 12 },
			};
		},
	} satisfies BrowserUseEnvironmentTokenRetrievalPort;
}

function allFileText(root: string): string {
	const chunks: string[] = [];
	const visit = (path: string): void => {
		for (const entry of readdirSync(path)) {
			const candidate = join(path, entry);
			if (statSync(candidate).isDirectory()) visit(candidate);
			else chunks.push(readFileSync(candidate, "utf8"));
		}
	};
	visit(root);
	return chunks.join("\n");
}

async function openTestStore(
	env: Record<string, string | undefined>,
): Promise<RunStoreDeps> {
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock: fixedClock().now };
}

async function createTerminalRun(input: {
	deps: RunStoreDeps;
	rawHandoff: string;
	state: Extract<BrowserUseRunState, "confirmed" | "not-achieved" | "unknown">;
}): Promise<void> {
	const parsed = parseHandoffFacts(input.rawHandoff);
	if (!parsed.ok || parsed.kind !== "verified") {
		throw new Error("verified handoff fixture refused");
	}
	const created = await createSharedRun(input.deps, {
		run_id: parsed.facts.runId,
		state: input.state,
		task_intent: "routine-automation",
		environment_profile: {
			environment: parsed.facts.environmentName,
			profile: parsed.facts.environmentProfile,
		},
		adapter_id: parsed.facts.adapter,
		handoff_evidence_id: parsed.facts.handoffEvidenceId,
		mutation_dispatched: input.state === "unknown",
		artifacts: [],
	});
	expect(created.ok).toBe(true);
}

async function runStatus(
	runtime: ReturnType<typeof makeRuntime>,
	runId: string,
): Promise<Record<string, unknown>> {
	const result = await runForTest(
		["run", "status", "--run", runId, "--json"],
		runtime,
	);
	expect(result.exitCode).toBe(0);
	return (parseJson(result.stdout).data as { run: Record<string, unknown> }).run;
}

describe("auth login CLI", () => {
	test("freeform login uses one bounded user-present authority and opaque delivery", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const origin = "https://github.example";
		const runId = "freeform-auth-success";
		const handoffPath = join(xdg.base, "handoff.json");
		writeFileSync(
			handoffPath,
			verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "playwright-cdp";
				envelope.data.attachment.route = "explicit-cdp";
				envelope.data.attachment.probe_executable = "/opt/browser-connect/playwright-cdp";
			}),
			{ mode: 0o600 },
		);
		const counts = { vaults: 0, items: 0, fetches: 0, redeems: 0 };
		const port = tokenPort(origin, counts);
		const transport = authTransport(origin);
		let releaseCalls = 0;
		const ambientSentinel = "AMBIENT_OP_SENTINEL_MUST_STAY_INERT";
		const argv = [
			"auth", "login", "--handoff", handoffPath,
			"--service", "github", "--allowed-origin", origin, "--json",
		];
		const result = await runForTest(
			argv,
			makeRuntime({
				env: {
					...xdg.env,
					OP_SERVICE_ACCOUNT_TOKEN: ambientSentinel,
					OP_CONNECT_TOKEN: ambientSentinel,
				},
				platformFs: createDefaultPlatformFs(),
				readTextFile: async (path) => readFileSync(path, "utf8"),
				authUserPresentAccess: async () => ({
					ok: true,
					lease: {
						access_path: "user-present-desktop",
						required_vault_scope: "exactly-one-vault",
						expires_at_epoch_ms: 31_000,
						token_retrieval: port,
						release: async () => {
							releaseCalls += 1;
						},
					},
				}),
				authApprovedBindingResolver: async () => ({
					service_id: "github",
					auth_context: "interactive-login",
					allowed_origins: [origin],
					allowed_login_paths: ["/login"],
					vault_id: "vault-fixture",
					item_id: "item-fixture",
					allowed_auth_methods: ["password"],
					binding_revision: 1,
				}),
				authenticatedStateProof: async ({ target_id }) => ({
					proven: true,
					proof: {
						target_id,
						page_id: "page-authenticated",
						frame_id: "frame-auth-login",
						origin,
						subject_reference: "subject-ref",
						account_reference: "account-ref",
						tenant_reference: "tenant-ref",
						identity_basis_digest: "proof-digest",
					},
				}),
				authTransport: transport.factory,
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseJson(result.stdout) as {
			data: {
				entry_mode: string;
				auth_access_path: string;
				selected_lane: string;
				run: { state: string };
			};
		};
		expect(envelope.data).toMatchObject({
			entry_mode: "freeform",
			auth_access_path: "user-present-desktop",
			selected_lane: "playwright-cdp",
			run: { state: "ready" },
		});
		expect(counts.vaults).toBeGreaterThan(0);
		expect(counts.redeems).toBe(2);
		expect(releaseCalls).toBe(1);
		expect(transport.closeCalls()).toBe(1);
		expect(argv.join(" ")).not.toContain(ambientSentinel);
		expect(`${result.stdout}\n${result.stderr}`).not.toContain(ambientSentinel);
		expect(allFileText(xdg.base)).not.toContain(ambientSentinel);
	});

	test.each(["confirmed", "not-achieved", "unknown"] as const)(
		"a terminal run (%s) refuses auth re-entry before access acquisition",
		async (state) => {
			const xdg = makeTempXdgEnv();
			disposables.push(xdg);
			const runId = `freeform-auth-terminal-${state}`;
			const handoffPath = join(xdg.base, `${runId}-handoff.json`);
			const rawHandoff = verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "playwright-cdp";
				envelope.data.attachment.route = "explicit-cdp";
				envelope.data.attachment.probe_executable =
					"/opt/browser-connect/playwright-cdp";
			});
			writeFileSync(handoffPath, rawHandoff, { mode: 0o600 });
			await createTerminalRun({
				deps: await openTestStore(xdg.env),
				rawHandoff,
				state,
			});
			let accessCalls = 0;
			const result = await runForTest(
				[
					"auth", "login", "--run", runId, "--handoff", handoffPath,
					"--service", "github", "--allowed-origin", "https://github.example",
					"--json",
				],
				makeRuntime({
					env: xdg.env,
					platformFs: createDefaultPlatformFs(),
					readTextFile: async (path) => readFileSync(path, "utf8"),
					authManagedAccess: async () => {
						accessCalls += 1;
						return { ok: false, cause: "authority-unavailable" };
					},
				}),
			);
			expect(result.exitCode).toBe(20);
			const envelope = parseJson(result.stdout);
			expect(envelope.error).toMatchObject({
				code: "run_terminal_truth",
				retryable: false,
			});
			expect(envelope.continuation).toMatchObject({
				next_action_id: "inspect_shared_run",
			});
			expect(accessCalls).toBe(0);
		},
	);

	test("target resolution refusal persists the auth-owned recovery before returning", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const origin = "https://github.example";
		const runId = "freeform-auth-target-refused";
		const handoffPath = join(xdg.base, "handoff.json");
		writeFileSync(
			handoffPath,
			verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "playwright-cdp";
				envelope.data.attachment.route = "explicit-cdp";
				envelope.data.attachment.probe_executable =
					"/opt/browser-connect/playwright-cdp";
			}),
			{ mode: 0o600 },
		);
		const counts = { vaults: 0, items: 0, fetches: 0, redeems: 0 };
		const transport = authTransport("https://wrong-origin.example");
		let releaseCalls = 0;
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: createDefaultPlatformFs(),
			readTextFile: async (path) => readFileSync(path, "utf8"),
			authUserPresentAccess: async () => ({
				ok: true,
				lease: {
					access_path: "user-present-desktop",
					required_vault_scope: "exactly-one-vault",
					expires_at_epoch_ms: 31_000,
					token_retrieval: tokenPort(origin, counts),
					release: async () => {
						releaseCalls += 1;
					},
				},
			}),
			authenticatedStateProof: stubAuthenticatedStateProof(origin),
			authTransport: transport.factory,
		});
		const result = await runForTest(
			[
				"auth", "login", "--handoff", handoffPath,
				"--service", "github", "--allowed-origin", origin, "--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "target-proof-invalid",
		});
		expect(await runStatus(runtime, runId)).toMatchObject({
			state: "awaiting-auth",
			continuation: { next_action_id: "reprove-target-and-restart" },
		});
		expect(counts).toEqual({ vaults: 0, items: 0, fetches: 0, redeems: 0 });
		expect(releaseCalls).toBe(1);
		expect(transport.closeCalls()).toBe(1);
	});

	test("missing confidential delivery persists capability-loss recovery", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const origin = "https://github.example";
		const runId = "freeform-auth-delivery-missing";
		const handoffPath = join(xdg.base, "handoff.json");
		writeFileSync(
			handoffPath,
			verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "playwright-cdp";
				envelope.data.attachment.route = "explicit-cdp";
				envelope.data.attachment.probe_executable =
					"/opt/browser-connect/playwright-cdp";
			}),
			{ mode: 0o600 },
		);
		const counts = { vaults: 0, items: 0, fetches: 0, redeems: 0 };
		const completePort = tokenPort(origin, counts);
		const tokenRetrieval = {
			listVaults: completePort.listVaults,
			listLoginItems: completePort.listLoginItems,
			getLoginItem: completePort.getLoginItem,
			fetchCredentialField: completePort.fetchCredentialField,
		};
		const transport = authTransport(origin);
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: createDefaultPlatformFs(),
			readTextFile: async (path) => readFileSync(path, "utf8"),
			authUserPresentAccess: async () => ({
				ok: true,
				lease: {
					access_path: "user-present-desktop",
					required_vault_scope: "exactly-one-vault",
					expires_at_epoch_ms: 31_000,
					token_retrieval: tokenRetrieval,
					release: async () => {},
				},
			}),
			authenticatedStateProof: stubAuthenticatedStateProof(origin),
			authTransport: transport.factory,
		});
		const result = await runForTest(
			[
				"auth", "login", "--handoff", handoffPath,
				"--service", "github", "--allowed-origin", origin, "--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "auth_delivery_unavailable",
		});
		expect(await runStatus(runtime, runId)).toMatchObject({
			state: "needs-human",
			continuation: { next_action_id: "inspect-capability-loss" },
		});
		expect(counts).toEqual({ vaults: 0, items: 0, fetches: 0, redeems: 0 });
	});

	test("a malformed persisted auth fragment refuses before credential access", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const origin = "https://github.example";
		const runId = "freeform-auth-transaction-failed";
		const handoffPath = join(xdg.base, "handoff.json");
		const rawHandoff = verifiedHandoffEnvelope((envelope) => {
			envelope.run_id = runId;
			envelope.data.attachment.adapter_id = "playwright-cdp";
			envelope.data.attachment.route = "explicit-cdp";
			envelope.data.attachment.probe_executable =
				"/opt/browser-connect/playwright-cdp";
		});
		writeFileSync(handoffPath, rawHandoff, { mode: 0o600 });
		const parsed = parseHandoffFacts(rawHandoff);
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("verified handoff fixture refused");
		}
		const deps = await openTestStore(xdg.env);
		const created = await createSharedRun(deps, {
			run_id: runId,
			state: "running",
			task_intent: "routine-automation",
			environment_profile: {
				environment: parsed.facts.environmentName,
				profile: parsed.facts.environmentProfile,
			},
			adapter_id: parsed.facts.adapter,
			handoff_evidence_id: parsed.facts.handoffEvidenceId,
			mutation_dispatched: false,
			artifacts: [],
		});
		expect(created.ok).toBe(true);
		const loaded = await loadSharedRun(deps, runId);
		if (!loaded.ok) throw new Error("created run could not be loaded");
		await deps.fs.writeFileDurable(
			deps.paths.state.runFile(runId),
			encodeDurableRecord("shared-run", {
				...loaded.payload,
				auth_fragment: {
					schema_version: "1",
					fragment: { malformed: true },
				},
			}),
			0o600,
		);
		const counts = { vaults: 0, items: 0, fetches: 0, redeems: 0 };
		const transport = authTransport(origin);
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: createDefaultPlatformFs(),
			readTextFile: async (path) => readFileSync(path, "utf8"),
			authUserPresentAccess: async () => ({
				ok: true,
				lease: {
					access_path: "user-present-desktop",
					required_vault_scope: "exactly-one-vault",
					expires_at_epoch_ms: 31_000,
					token_retrieval: tokenPort(origin, counts),
					release: async () => {},
				},
			}),
			authenticatedStateProof: stubAuthenticatedStateProof(origin),
			authTransport: transport.factory,
		});
		const result = await runForTest(
			[
				"auth", "login", "--run", runId, "--handoff", handoffPath,
				"--service", "github", "--allowed-origin", origin, "--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "auth_fragment_invalid",
		});
		expect(await runStatus(runtime, runId)).toMatchObject({
			state: "needs-human",
			continuation: { next_action_id: "inspect-capability-loss" },
		});
		expect(counts).toEqual({ vaults: 0, items: 0, fetches: 0, redeems: 0 });
	});

	test("access cleanup refusal preserves the result and releases dispatch authority", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const origin = "https://github.example";
		const runId = "freeform-auth-cleanup-refused";
		const handoffPath = join(xdg.base, "handoff.json");
		writeFileSync(
			handoffPath,
			verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "playwright-cdp";
				envelope.data.attachment.route = "explicit-cdp";
				envelope.data.attachment.probe_executable =
					"/opt/browser-connect/playwright-cdp";
			}),
			{ mode: 0o600 },
		);
		const counts = { vaults: 0, items: 0, fetches: 0, redeems: 0 };
		let releaseCalls = 0;
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: createDefaultPlatformFs(),
			readTextFile: async (path) => readFileSync(path, "utf8"),
			authUserPresentAccess: async () => ({
				ok: true,
				lease: {
					access_path: "user-present-desktop",
					required_vault_scope: "exactly-one-vault",
					expires_at_epoch_ms: 31_000,
					token_retrieval: tokenPort(origin, counts),
					release: async () => {
						releaseCalls += 1;
						throw new Error("fixture cleanup refusal");
					},
				},
			}),
			authApprovedBindingResolver: async () => ({
				service_id: "github",
				auth_context: "interactive-login",
				allowed_origins: [origin],
				allowed_login_paths: ["/login"],
				vault_id: "vault-fixture",
				item_id: "item-fixture",
				allowed_auth_methods: ["password"],
				binding_revision: 1,
			}),
			authenticatedStateProof: async ({ target_id }) => ({
				proven: true,
				proof: {
					target_id,
					page_id: "page-authenticated",
					frame_id: "frame-auth-login",
					origin,
					subject_reference: "subject-ref",
					account_reference: "account-ref",
					tenant_reference: "tenant-ref",
					identity_basis_digest: "proof-digest",
				},
			}),
			authTransport: authTransport(origin).factory,
		});
		const baseArgv = [
			"auth", "login", "--handoff", handoffPath,
			"--service", "github", "--allowed-origin", origin, "--json",
		];
		const argv = ["auth", "login", "--run", runId, ...baseArgv.slice(2)];
		const first = await runForTest(baseArgv, runtime);
		expect(first.exitCode).toBe(0);
		const second = await runForTest(argv, runtime);
		expect(second.exitCode).toBe(0);
		expect(releaseCalls).toBe(2);
	});

	test("refused user-present authority returns enrollment recovery without credential access", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const origin = "https://github.example";
		const runId = "freeform-auth-user-presence-refused";
		const handoffPath = join(xdg.base, "handoff.json");
		writeFileSync(
			handoffPath,
			verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "playwright-cdp";
				envelope.data.attachment.route = "explicit-cdp";
				envelope.data.attachment.probe_executable =
					"/opt/browser-connect/playwright-cdp";
			}),
			{ mode: 0o600 },
		);
		const sentinel = "REFUSED_USER_PRESENCE_SECRET_MUST_STAY_INERT";
		const counts = { vaults: 0, items: 0, fetches: 0, redeems: 0 };
		let managedCalls = 0;
		let userPresentCalls = 0;
		let transportCalls = 0;
		const result = await runForTest(
			[
				"auth", "login", "--handoff", handoffPath,
				"--service", "github", "--allowed-origin", origin, "--json",
			],
			makeRuntime({
				env: { ...xdg.env, OP_SERVICE_ACCOUNT_TOKEN: sentinel },
				platformFs: createDefaultPlatformFs(),
				readTextFile: async (path) => readFileSync(path, "utf8"),
				authTokenRetrieval: tokenPort(origin, counts),
				authManagedAccess: async () => {
					managedCalls += 1;
					return { ok: false, cause: "authority-unavailable" };
				},
				authUserPresentAccess: async () => {
					userPresentCalls += 1;
					return { ok: false, cause: "user-presence-refused" };
				},
				authenticatedStateProof: stubAuthenticatedStateProof(origin),
				authTransport: () => {
					transportCalls += 1;
					return authTransport(origin).factory();
				},
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseJson(result.stdout) as {
			data: {
				run: { state: string; continuation: { next_action_id: string } };
			};
		};
		expect(envelope.data.run).toMatchObject({
			state: "awaiting-auth",
			continuation: { next_action_id: "enroll-browser-automation-token" },
		});
		expect(managedCalls).toBe(1);
		expect(userPresentCalls).toBe(1);
		expect(transportCalls).toBe(0);
		expect(counts).toEqual({ vaults: 0, items: 0, fetches: 0, redeems: 0 });
		expect(`${result.stdout}\n${result.stderr}`).not.toContain(sentinel);
		expect(allFileText(xdg.base)).not.toContain(sentinel);
	});

	test("ambient OP authority cannot substitute for either bounded access path", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runId = "freeform-auth-no-authority";
		const handoffPath = join(xdg.base, "handoff.json");
		mkdirSync(xdg.base, { recursive: true });
		writeFileSync(
			handoffPath,
			verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "agent-browser";
			}),
			{ mode: 0o600 },
		);
		const sentinel = "AMBIENT_AUTHORITY_MUST_NOT_ROUTE";
		const result = await runForTest(
			[
				"auth", "login", "--handoff", handoffPath,
				"--service", "github", "--allowed-origin", "https://github.example",
				"--json",
			],
			makeRuntime({
				env: {
					...xdg.env,
					OP_SERVICE_ACCOUNT_TOKEN: sentinel,
					OP_CONNECT_TOKEN: sentinel,
				},
				platformFs: createDefaultPlatformFs(),
				readTextFile: async (path) => readFileSync(path, "utf8"),
				authenticatedStateProof: stubAuthenticatedStateProof(
					"https://github.example",
				),
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseJson(result.stdout) as {
			data: {
				auth_access_path: string;
				run: { state: string; continuation: { next_action_id: string } };
			};
		};
		expect(envelope.data).toMatchObject({
			auth_access_path: "unavailable",
			run: {
				state: "awaiting-auth",
				continuation: {
					next_action_id: "enroll-browser-automation-token",
				},
			},
		});
		expect(`${result.stdout}\n${result.stderr}`).not.toContain(sentinel);
		expect(allFileText(xdg.base)).not.toContain(sentinel);
	});

	test("freeform login without an identity-proof owner refuses before dispatch", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const origin = "https://github.example";
		const runId = "freeform-auth-no-proof-owner";
		const handoffPath = join(xdg.base, "handoff.json");
		writeFileSync(
			handoffPath,
			verifiedHandoffEnvelope((envelope) => {
				envelope.run_id = runId;
				envelope.data.attachment.adapter_id = "playwright-cdp";
				envelope.data.attachment.route = "explicit-cdp";
				envelope.data.attachment.probe_executable =
					"/opt/browser-connect/playwright-cdp";
			}),
			{ mode: 0o600 },
		);
		const counts = { vaults: 0, items: 0, fetches: 0, redeems: 0 };
		let transportCalls = 0;
		// Access authority IS present; only the identity-proof owner is absent.
		// The pre-gate must still refuse before opening any transport, proving it
		// gates on proof — not merely on absent access.
		const runtime = makeRuntime({
			env: xdg.env,
			platformFs: createDefaultPlatformFs(),
			readTextFile: async (path) => readFileSync(path, "utf8"),
			authUserPresentAccess: async () => ({
				ok: true,
				lease: {
					access_path: "user-present-desktop",
					required_vault_scope: "exactly-one-vault",
					expires_at_epoch_ms: 31_000,
					token_retrieval: tokenPort(origin, counts),
					release: async () => {},
				},
			}),
			authTransport: () => {
				transportCalls += 1;
				return authTransport(origin).factory();
			},
		});
		const result = await runForTest(
			[
				"auth", "login", "--handoff", handoffPath,
				"--service", "github", "--allowed-origin", origin, "--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(await runStatus(runtime, runId)).toMatchObject({
			state: "needs-human",
			continuation: { next_action_id: "use-reviewed-runbook-for-auth" },
		});
		expect(transportCalls).toBe(0);
		expect(counts).toEqual({ vaults: 0, items: 0, fetches: 0, redeems: 0 });
	});
});
