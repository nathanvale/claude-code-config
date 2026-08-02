import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type {
	BrowserUseAccessibilityNode,
	BrowserUseAccessibilitySnapshot,
	BrowserUseCdpObserver,
} from "./browser-use-cdp-observer";
import type {
	BrowserUseDeliveryHook,
	BrowserUseVerifiedTarget,
} from "./browser-use-confidential-field-delivery";
import {
	classifyBrowserUseLoginStep,
	runBrowserUseLoginEngine,
	type BrowserUseAuthenticatedStateProof,
	type BrowserUseLoginTargetProof,
} from "./browser-use-login-engine";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";

const SHAPE_FIXTURES: Readonly<Record<string, string>> = {
	"label-wrapped": `<!doctype html><html><body data-shape="label-wrapped">
		<form><label>Username <input type="text"></label>
		<label>Password <input type="password"></label>
		<button>Sign in</button></form></body></html>`,
	"aria-labelledby": `<!doctype html><html><body data-shape="aria-labelledby">
		<form><span id="username">Username</span><input aria-labelledby="username">
		<span id="password">Password</span><input type="password" aria-labelledby="password">
		<button>Sign in</button></form></body></html>`,
	"placeholder-only": `<!doctype html><html><body data-shape="placeholder-only">
		<form><input placeholder="Username"><input type="password" placeholder="Password">
		<button>Sign in</button></form></body></html>`,
	iframe: `<!doctype html><html><body data-shape="iframe">
		<iframe srcdoc="<form><label>Username <input></label><label>Password <input type='password'></label><button>Sign in</button></form>"></iframe>
		</body></html>`,
	"shadow-dom": `<!doctype html><html><body data-shape="shadow-dom">
		<div id="host"></div><script>host.attachShadow({mode:"open"}).innerHTML =
		"<form><label>Username <input></label><label>Password <input type='password'></label><button>Sign in</button></form>"</script>
		</body></html>`,
	"for-id": `<!doctype html><html><body data-shape="for-id">
		<form><label for="username">Username</label><input id="username">
		<label for="password">Password</label><input id="password" type="password">
		<button>Sign in</button></form></body></html>`,
};

let server: Server | undefined;
let fixtureOrigin = "http://login-engine-fixture.invalid";

beforeAll(async () => {
	server = createServer((request, response) => {
		const shape = request.url?.split("/").at(-1) ?? "";
		const fixture = SHAPE_FIXTURES[shape];
		if (fixture === undefined) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(fixture);
	});
	try {
		await new Promise<void>((resolve, reject) => {
			server?.once("error", reject);
			server?.listen(0, "127.0.0.1", resolve);
		});
		fixtureOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	} catch {
		server = undefined;
	}
});

afterAll(async () => {
	if (server !== undefined) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
	}
});

function node(
	nodeId: string,
	role: string,
	name: string,
	backendNodeId?: number,
	parentId = "form",
): BrowserUseAccessibilityNode {
	return {
		node_id: nodeId,
		role,
		accessible_name: name,
		ignored: false,
		...(backendNodeId === undefined
			? {}
			: { backend_node_id: backendNodeId }),
		parent_id: parentId,
		properties: {},
	};
}

function screen(
	nodes: readonly BrowserUseAccessibilityNode[],
): BrowserUseAccessibilitySnapshot {
	return { target_id: "cdp-target-login", nodes };
}

function loginFormSnapshot(): BrowserUseAccessibilitySnapshot {
	return screen([
		{
			...node("form", "form", "Sign in", undefined, ""),
			child_ids: ["username", "password", "submit"],
		},
		node("username", "textbox", "Username", 41),
		node("password", "textbox", "Password", 42),
		node("submit", "button", "Sign in", 43),
	]);
}

function signedInSnapshot(): BrowserUseAccessibilitySnapshot {
	return screen([node("welcome", "heading", "Welcome, signed in", undefined, "")]);
}

function scriptedObserver(
	screens: readonly BrowserUseAccessibilitySnapshot[],
	activated: number[] = [],
): BrowserUseCdpObserver {
	return statefulObserver(screens, activated).observer;
}

function statefulObserver(
	screens: readonly BrowserUseAccessibilitySnapshot[],
	activated: number[] = [],
): {
	observer: BrowserUseCdpObserver;
	current: () => BrowserUseAccessibilitySnapshot;
} {
	let index = 0;
	const current = (): BrowserUseAccessibilitySnapshot => {
		const snapshot = screens[Math.min(index, screens.length - 1)];
		if (snapshot === undefined) throw new Error("stateful observer needs a screen");
		return snapshot;
	};
	return {
		current,
		observer: {
			snapshot: async () => ({
				ok: true,
				snapshot: current(),
			}),
			probeNode: async () => ({
				ok: true,
				probe: { visible: true, operable: true },
			}),
			activateControl: async ({ backend_node_id }) => {
				activated.push(backend_node_id);
				index += 1;
				return { ok: true };
			},
		},
	};
}

function binding(origin: string, allowOtp = false): BrowserUseItemBinding {
	return {
		service_id: "fixture-login",
		auth_context: "interactive-login",
		allowed_origins: [origin],
		allowed_login_paths: ["/"],
		vault_id: "vault-fixture",
		item_id: "item-fixture",
		allowed_auth_methods: allowOtp ? ["password", "otp"] : ["password"],
		binding_revision: 1,
	};
}

function secretHandle(field: BrowserUseOpCredentialField): BrowserUseSecretHandle {
	return {
		handle_id: `handle-${field}`,
		field,
		expires_at_epoch_ms: 9_999_999,
	};
}

function tokenPort(
	fetched: BrowserUseOpCredentialField[] = [],
): BrowserUseTokenRetrievalPort {
	return {
		listVaults: async () => ({ ok: true, vaults: [] }),
		listLoginItems: async () => ({ ok: true, items: [] }),
		getLoginItem: async () => ({
			ok: false,
			rejection: { code: "item-missing", message: "unused" },
		}),
		fetchCredentialField: async (input) => {
			fetched.push(input.field);
			return { ok: true, handle: secretHandle(input.field) };
		},
	};
}

function targetProof(
	snapshotOf: () => BrowserUseAccessibilitySnapshot,
	proofInputs: Parameters<BrowserUseLoginTargetProof>[0][] = [],
): BrowserUseLoginTargetProof {
	return async (input) => {
		proofInputs.push(input);
		const field = snapshotOf().nodes.find(
			(candidate) =>
				candidate.role === input.field.role &&
				candidate.accessible_name === input.field.accessible_name &&
				candidate.backend_node_id !== undefined,
		);
		if (field?.backend_node_id === undefined) {
			return { ok: false, cause: "target-proof-invalid" };
		}
		const origin = new URL(input.expected_url).origin;
		const target: BrowserUseVerifiedTarget & {
			field: {
				role: string;
				accessible_name: string;
				backend_node_id: number;
			};
		} = {
			lane_id: input.lane_id,
			run_id: input.run_id,
			top_level_origin: origin,
			frame_origin: origin,
			target_id: snapshotOf().target_id,
			page_id: "page-fixture",
			frame_id: "frame-fixture",
			account_ref: "expected-principal:fixture",
			target_proof_digest: `proof-${field.backend_node_id}`,
			field: {
				role: field.role,
				accessible_name: field.accessible_name,
				backend_node_id: field.backend_node_id,
			},
		};
		return {
			ok: true,
			target,
			reproveTarget: async () => ({
				proven: true,
				observed_digest: target.target_proof_digest,
			}),
		};
	};
}

function deliveryHook(
	delivered: BrowserUseOpCredentialField[],
): BrowserUseDeliveryHook {
	return async (input) => {
		delivered.push(input.field);
		return {
			ok: true,
			shape: { field: input.field, byte_length: 12 },
		};
	};
}

function authenticatedStateProof(
	proven = true,
): BrowserUseAuthenticatedStateProof {
	return async ({ target_id }) =>
		proven
			? {
					proven: true,
					proof: {
						target_id,
						page_id: "page-authenticated",
						frame_id: "frame-authenticated",
						origin: fixtureOrigin,
						subject_reference: "subject-ref-fixture",
						account_reference: "account-ref-fixture",
						tenant_reference: "tenant-ref-fixture",
						identity_basis_digest: "identity-proof-fixture",
					},
				}
			: {
					proven: false,
					cause: "human-identity-attestation-required",
				};
}

describe("generic browser-use login engine", () => {
	test("fills six served structural shapes by role and accessible name", async () => {
		for (const [shape, fixture] of Object.entries(SHAPE_FIXTURES)) {
			const url = `${fixtureOrigin}/shape/${shape}`;
			const served = server ? await (await fetch(url)).text() : fixture;
			expect(served).toContain(`data-shape="${shape}"`);

			const form = loginFormSnapshot();
			const activated: number[] = [];
			const observer = scriptedObserver(
				[form, signedInSnapshot()],
				activated,
			);
			const proofInputs: Parameters<BrowserUseLoginTargetProof>[0][] = [];
			const delivered: BrowserUseOpCredentialField[] = [];
			const fetched: BrowserUseOpCredentialField[] = [];

			const result = await runBrowserUseLoginEngine(
				{
					observer,
					proveTarget: targetProof(() => form, proofInputs),
					tokenRetrieval: tokenPort(fetched),
					deliver: deliveryHook(delivered),
					proveAuthenticatedState: authenticatedStateProof(),
				},
				{
					lane_id: "agent-browser",
					run_id: `run-${shape}`,
					target_id: form.target_id,
					expected_url: url,
					allowed_origins: [fixtureOrigin],
					binding: binding(fixtureOrigin),
				},
			);

			expect(result.ok).toBe(true);
			expect(delivered).toEqual(["username", "password"]);
			expect(fetched).toEqual(["username", "password"]);
			expect(activated).toEqual([43]);
			expect(
				proofInputs.map((input) => ({
					role: input.field.role,
					accessible_name: input.field.accessible_name,
					allowed_origins: input.allowed_origins,
				})),
			).toEqual([
				{
					role: "textbox",
					accessible_name: "Username",
					allowed_origins: [fixtureOrigin],
				},
				{
					role: "textbox",
					accessible_name: "Password",
					allowed_origins: [fixtureOrigin],
				},
			]);
			expect(classifyBrowserUseLoginStep(form).step).toBe("username");
		}
	});

	test("handles unlabelled username and password steps followed by OTP", async () => {
		const username = screen([
			node("username-heading", "heading", "Sign in", undefined, "form"),
			node("username", "textbox", "", 51),
			node("username-next", "button", "Next", 52),
		]);
		const password = screen([
			node("password-heading", "heading", "Enter password", undefined, "form"),
			node("password", "textbox", "", 61),
			node("password-next", "button", "Continue", 62),
		]);
		const otp = screen([
			node("otp-heading", "heading", "Two-factor authentication", undefined),
			node("otp", "textbox", "One-time code", 71),
			node("otp-next", "button", "Verify", 72),
		]);
		const activated: number[] = [];
		const state = statefulObserver(
			[username, password, otp, signedInSnapshot()],
			activated,
		);
		const delivered: BrowserUseOpCredentialField[] = [];
		const proofInputs: Parameters<BrowserUseLoginTargetProof>[0][] = [];
		const url = `${fixtureOrigin}/shape/label-wrapped`;

		const result = await runBrowserUseLoginEngine(
			{
				observer: state.observer,
				proveTarget: targetProof(state.current, proofInputs),
				tokenRetrieval: tokenPort(),
				deliver: deliveryHook(delivered),
				proveAuthenticatedState: authenticatedStateProof(),
			},
			{
				lane_id: "agent-browser",
				run_id: "run-multi-step",
				target_id: username.target_id,
				expected_url: url,
				allowed_origins: [fixtureOrigin],
				binding: binding(fixtureOrigin, true),
			},
		);

		expect(result.ok).toBe(true);
		expect(delivered).toEqual(["username", "password", "otp-current"]);
		expect(activated).toEqual([52, 62, 72]);
		expect(
			proofInputs.map((input) => input.field.accessible_name),
		).toEqual(["", "", "One-time code"]);
		if (result.ok) {
			expect(result.trace.map((entry) => entry.step)).toEqual([
				"username",
				"submit",
				"password",
				"submit",
				"otp",
				"submit",
			]);
		}
	});

	test("refuses origin drift before retrieving or delivering a secret", async () => {
		const form = loginFormSnapshot();
		const fetched: BrowserUseOpCredentialField[] = [];
		const delivered: BrowserUseOpCredentialField[] = [];
		const minted = targetProof(() => form);
		const result = await runBrowserUseLoginEngine(
			{
				observer: scriptedObserver([form]),
				proveTarget: async (input) => {
					const proof = await minted(input);
					return proof.ok
						? {
								...proof,
								reproveTarget: async () => ({
									proven: false,
									cause: "origin-mismatch",
								}),
							}
						: proof;
				},
				tokenRetrieval: tokenPort(fetched),
				deliver: deliveryHook(delivered),
			},
			{
				lane_id: "agent-browser",
				run_id: "run-origin-drift",
				target_id: form.target_id,
				expected_url: `${fixtureOrigin}/shape/label-wrapped`,
				allowed_origins: [fixtureOrigin],
				binding: binding(fixtureOrigin),
			},
		);

		expect(result).toMatchObject({
			ok: false,
			reason: "blocked",
			blocked: { blocked_cause: "origin-mismatch" },
		});
		expect(fetched).toEqual([]);
		expect(delivered).toEqual([]);
	});

	test("generic signed-in words never authorize without fresh authenticated-state proof", async () => {
		const welcome = signedInSnapshot();
		const result = await runBrowserUseLoginEngine(
			{
				observer: scriptedObserver([welcome]),
				proveTarget: async () => {
					throw new Error("a signed-in screen has no credential target");
				},
				tokenRetrieval: tokenPort(),
				deliver: deliveryHook([]),
				proveAuthenticatedState: authenticatedStateProof(false),
			},
			{
				lane_id: "agent-browser",
				run_id: "run-welcome-near-miss",
				target_id: welcome.target_id,
				expected_url: `${fixtureOrigin}/shape/label-wrapped`,
				allowed_origins: [fixtureOrigin],
				binding: binding(fixtureOrigin),
			},
		);

		expect(result).toMatchObject({
			ok: false,
			blocked: {
				blocked_cause: "human-identity-attestation-required",
			},
		});
	});

	test("routes a human challenge to a resumable continuation without delivery", async () => {
		const challenge = screen([
			node("captcha", "heading", "Complete CAPTCHA verification", undefined),
			node("captcha-button", "button", "Continue", 91),
		]);
		let proofCalls = 0;
		const fetched: BrowserUseOpCredentialField[] = [];
		const delivered: BrowserUseOpCredentialField[] = [];
		const result = await runBrowserUseLoginEngine(
			{
				observer: scriptedObserver([challenge]),
				proveTarget: async () => {
					proofCalls += 1;
					return { ok: false, cause: "target-proof-invalid" };
				},
				tokenRetrieval: tokenPort(fetched),
				deliver: deliveryHook(delivered),
			},
			{
				lane_id: "agent-browser",
				run_id: "run-human-challenge",
				target_id: challenge.target_id,
				expected_url: `${fixtureOrigin}/shape/label-wrapped`,
				allowed_origins: [fixtureOrigin],
				binding: binding(fixtureOrigin),
			},
		);

		expect(result).toMatchObject({
			ok: false,
			reason: "human-challenge",
			blocked: {
				blocked_cause: "user-presence-required",
				continuation: { next_action_id: "complete-user-presence" },
			},
		});
		expect(proofCalls).toBe(0);
		expect(fetched).toEqual([]);
		expect(delivered).toEqual([]);
	});

	test("fails ambiguous unlabelled fields closed before delivery", async () => {
		const ambiguous = screen([
			node("field-a", "textbox", "", 101),
			node("field-b", "textbox", "", 102),
			node("next", "button", "Next", 103),
		]);
		const delivered: BrowserUseOpCredentialField[] = [];
		const result = await runBrowserUseLoginEngine(
			{
				observer: scriptedObserver([ambiguous]),
				proveTarget: async () => {
					throw new Error("ambiguous fields must not be proven");
				},
				tokenRetrieval: tokenPort(),
				deliver: deliveryHook(delivered),
			},
			{
				lane_id: "agent-browser",
				run_id: "run-ambiguous",
				target_id: ambiguous.target_id,
				expected_url: `${fixtureOrigin}/shape/label-wrapped`,
				allowed_origins: [fixtureOrigin],
				binding: binding(fixtureOrigin),
			},
		);

		expect(result).toMatchObject({
			ok: false,
			reason: "human-challenge",
			blocked: {
				blocked_cause: "human-identity-attestation-required",
				external_effect_possible: false,
			},
		});
		expect(delivered).toEqual([]);
	});
});
