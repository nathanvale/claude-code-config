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
import type { BrowserUseEnvironmentTokenRetrievalPort } from "./browser-use-environment-op";
import { createDefaultPlatformFs } from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
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

function tokenPort(origin: string, counts: { vaults: number; redeems: number }) {
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
		listLoginItems: async () => ({ ok: true as const, items: [item] }),
		getLoginItem: async () => ({ ok: true as const, item }),
		fetchCredentialField: async ({ field }) => ({
			ok: true as const,
			handle: {
				handle_id: `opaque-${field}`,
				field,
				expires_at_epoch_ms: 60_000,
			},
		}),
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
		const counts = { vaults: 0, redeems: 0 };
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
});
