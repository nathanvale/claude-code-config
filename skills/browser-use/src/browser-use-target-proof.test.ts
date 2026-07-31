import { describe, expect, test } from "bun:test";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import { deliverConfidentialFields } from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import {
	type BrowserUseDevToolsRequest,
	type BrowserUseDevToolsTransport,
	mintBrowserUseVerifiedTarget,
} from "./browser-use-target-proof";

const BINDING: BrowserUseItemBinding = {
	service_id: "fasttrack",
	auth_context: "interactive-login",
	allowed_origins: ["https://portal.example.test"],
	allowed_login_paths: ["/login"],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

function handle(field: BrowserUseOpCredentialField): BrowserUseSecretHandle {
	return { handle_id: `handle-${field}`, field, expires_at_epoch_ms: 9_999_999 };
}

function tokenPort(
	onFetch: () => void = () => {},
): BrowserUseTokenRetrievalPort {
	return {
		listVaults: async () => ({ ok: true, vaults: [] }),
		listLoginItems: async () => ({ ok: true, items: [] }),
		getLoginItem: async () => ({
			ok: false,
			rejection: { code: "item-missing", message: "unused" },
		}),
		fetchCredentialField: async (input) => {
			onFetch();
			return { ok: true, handle: handle(input.field) };
		},
	};
}

function stableTransport(): BrowserUseDevToolsTransport {
	return {
		request: async (request: BrowserUseDevToolsRequest): Promise<unknown> => {
			switch (request.method) {
				case "Target.getTargets":
					return {
						targetInfos: [
							{
								targetId: "cdp-target-7",
								type: "page",
								url: "https://portal.example.test/login",
								title: "FastTrack",
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
								url: "https://portal.example.test/login",
							},
						},
					};
				case "Accessibility.getFullAXTree":
					return {
						nodes: [
							{
								nodeId: "ax-username",
								backendDOMNodeId: 41,
								frameId: "top-frame",
								role: { type: "role", value: "textbox" },
								name: { type: "computedString", value: "Username" },
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

function transportWithTargets(
	targetInfos: readonly Record<string, unknown>[],
	attachedTargetIds: string[] = [],
): BrowserUseDevToolsTransport {
	const stable = stableTransport();
	return {
		request: async (request) => {
			if (request.method === "Target.getTargets") return { targetInfos };
			if (request.method === "Target.attachToTarget") {
				attachedTargetIds.push(request.params.targetId);
			}
			return stable.request(request);
		},
	};
}

describe("verified target proof", () => {
	test("a stable page reproduces its digest on fresh reproof", async () => {
		const minted = await mintBrowserUseVerifiedTarget(stableTransport(), {
			lane_id: "agent-browser",
			run_id: "run-1",
			expected_url: "https://portal.example.test/login",
			allowed_origins: BINDING.allowed_origins,
			binding: BINDING,
			field: { role: "textbox", accessible_name: "Username" },
		});

		expect(minted.ok).toBe(true);
		if (!minted.ok) return;
		const reproof = await minted.reproveTarget({ target: minted.target });
		expect(reproof).toEqual({
			proven: true,
			observed_digest: minted.target.target_proof_digest,
		});
		expect(minted.target).toMatchObject({
			top_level_origin: "https://portal.example.test",
			frame_origin: "https://portal.example.test",
			target_id: "cdp-target-7",
			page_id: "top-frame",
			frame_id: "top-frame",
			field: {
				role: "textbox",
				accessible_name: "Username",
				backend_node_id: 41,
			},
		});
		expect(minted.target.account_ref).toMatch(
			/^expected-principal:sha256:[a-f0-9]{64}$/,
		);
		expect(minted.target.account_ref).not.toContain(BINDING.item_id);
		expect(minted.target.account_ref).not.toContain(BINDING.vault_id);
	});

	test("a detach rejection after successful observation still yields the proof", async () => {
		// A closed or racing target can make Target.detachFromTarget reject
		// AFTER the identity was fully observed; the observation result stays
		// authoritative and must not become target-proof-invalid.
		const stable = stableTransport();
		const detachRejecting: BrowserUseDevToolsTransport = {
			request: async (request) => {
				if (request.method === "Target.detachFromTarget") {
					throw new Error("No session with given id");
				}
				return stable.request(request);
			},
		};

		const minted = await mintBrowserUseVerifiedTarget(detachRejecting, {
			lane_id: "agent-browser",
			run_id: "run-1",
			expected_url: "https://portal.example.test/login",
			allowed_origins: BINDING.allowed_origins,
			binding: BINDING,
			field: { role: "textbox", accessible_name: "Username" },
		});

		expect(minted.ok).toBe(true);
		if (!minted.ok) return;
		expect(minted.target.target_id).toBe("cdp-target-7");

		// Reproof re-observes through the same transport; its detach also
		// rejects, and the successful reproof still stands.
		const reproof = await minted.reproveTarget({ target: minted.target });
		expect(reproof).toEqual({
			proven: true,
			observed_digest: minted.target.target_proof_digest,
		});
	});

	test("resolves one CDP target by exact URL then exact origin, never adapter tab id", async () => {
		const exactAttachments: string[] = [];
		const exact = await mintBrowserUseVerifiedTarget(
			transportWithTargets(
				[
					{
						targetId: "t1",
						type: "page",
						url: "https://other.example.test/login",
					},
					{
						targetId: "cdp-target-exact",
						type: "page",
						url: "https://portal.example.test/login",
					},
				],
				exactAttachments,
			),
			{
				lane_id: "agent-browser",
				run_id: "run-exact",
				expected_url: "https://portal.example.test/login",
				allowed_origins: BINDING.allowed_origins,
				binding: BINDING,
				field: { role: "textbox", accessible_name: "Username" },
			},
		);
		expect(exact.ok).toBe(true);
		expect(exactAttachments).toEqual(["cdp-target-exact"]);

		const originAttachments: string[] = [];
		const origin = await mintBrowserUseVerifiedTarget(
			transportWithTargets(
				[
					{
						targetId: "t1",
						type: "page",
						url: "https://other.example.test/login",
					},
					{
						targetId: "cdp-target-origin",
						type: "page",
						url: "https://portal.example.test/login?fresh=1",
					},
				],
				originAttachments,
			),
			{
				lane_id: "agent-browser",
				run_id: "run-origin",
				expected_url: "https://portal.example.test/adapter-observed",
				allowed_origins: BINDING.allowed_origins,
				binding: BINDING,
				field: { role: "textbox", accessible_name: "Username" },
			},
		);
		expect(origin.ok).toBe(true);
		expect(originAttachments).toEqual(["cdp-target-origin"]);
	});

	test("returns typed refusals for an out-of-policy origin and a closed tab", async () => {
		const outside = await mintBrowserUseVerifiedTarget(
			transportWithTargets([
				{
					targetId: "cdp-phish",
					type: "page",
					url: "https://phish.example.test/login",
				},
			]),
			{
				lane_id: "agent-browser",
				run_id: "run-phish",
				expected_url: "https://phish.example.test/login",
				allowed_origins: BINDING.allowed_origins,
				binding: BINDING,
				field: { role: "textbox", accessible_name: "Username" },
			},
		);
		expect(outside).toEqual({ ok: false, cause: "origin-mismatch" });

		const gone = await mintBrowserUseVerifiedTarget(
			transportWithTargets([]),
			{
				lane_id: "agent-browser",
				run_id: "run-gone",
				expected_url: "https://portal.example.test/login",
				allowed_origins: BINDING.allowed_origins,
				binding: BINDING,
				field: { role: "textbox", accessible_name: "Username" },
			},
		);
		expect(gone).toEqual({ ok: false, cause: "target-proof-invalid" });

		let targetReads = 0;
		const stable = stableTransport();
		const closesAfterMint: BrowserUseDevToolsTransport = {
			request: async (request) => {
				if (request.method === "Target.getTargets") {
					targetReads += 1;
					return targetReads === 1
						? stable.request(request)
						: { targetInfos: [] };
				}
				return stable.request(request);
			},
		};
		const beforeClose = await mintBrowserUseVerifiedTarget(closesAfterMint, {
			lane_id: "agent-browser",
			run_id: "run-closes",
			expected_url: "https://portal.example.test/login",
			allowed_origins: BINDING.allowed_origins,
			binding: BINDING,
			field: { role: "textbox", accessible_name: "Username" },
		});
		expect(beforeClose.ok).toBe(true);
		if (!beforeClose.ok) return;
		expect(
			await beforeClose.reproveTarget({ target: beforeClose.target }),
		).toEqual({ proven: false, cause: "target-proof-invalid" });
	});

	test("bridges labelled, aria-labelledby, placeholder, iframe, shadow, and unlabelled fields to the same DOM node", async () => {
		const shapes = [
			{
				shape: "labelled",
				name: "Username",
				requestedName: "Username",
				frameId: "top-frame",
			},
			{
				shape: "aria-labelledby",
				name: "Username",
				requestedName: "Username",
				frameId: "top-frame",
			},
			{
				shape: "placeholder",
				name: "Username",
				requestedName: "Username",
				frameId: "top-frame",
			},
			{
				shape: "iframe",
				name: "Username",
				requestedName: "Username",
				frameId: "login-frame",
			},
			{
				shape: "shadow-DOM",
				name: "Username",
				requestedName: "Username",
				frameId: "top-frame",
			},
			{
				shape: "unlabelled",
				name: "",
				requestedName: "Username",
				frameId: "top-frame",
			},
		] as const;

		for (const [index, shape] of shapes.entries()) {
			const backendNodeId = 100 + index;
			const resolvedNodeIds: number[] = [];
			const stable = stableTransport();
			const transport: BrowserUseDevToolsTransport = {
				request: async (request) => {
					if (request.method === "Page.getFrameTree") {
						const embeddedUrl =
							shape.shape === "iframe"
								? "https://auth.example.test/embedded-login"
								: "https://portal.example.test/embedded-login";
						return {
							frameTree: {
								frame: {
									id: "top-frame",
									url: "https://portal.example.test/login",
								},
								childFrames: [
									{
										frame: {
											id: "login-frame",
											url: embeddedUrl,
										},
									},
								],
							},
						};
					}
					if (request.method === "Accessibility.getFullAXTree") {
						return {
							nodes: [
								{
									nodeId: `ax-${shape.shape}`,
									backendDOMNodeId: backendNodeId,
									frameId: shape.frameId,
									role: { type: "role", value: "textbox" },
									name: { type: "computedString", value: shape.name },
									source_shape: shape.shape,
								},
							],
						};
					}
					if (request.method === "DOM.resolveNode") {
						resolvedNodeIds.push(request.params.backendNodeId);
						return { object: { objectId: `object-${backendNodeId}` } };
					}
					return stable.request(request);
				},
			};
			const minted = await mintBrowserUseVerifiedTarget(transport, {
				lane_id: "agent-browser",
				run_id: `run-${shape.shape}`,
				expected_url: "https://portal.example.test/login",
				allowed_origins: [
					...BINDING.allowed_origins,
					"https://auth.example.test",
				],
				binding: BINDING,
				field: { role: "textbox", accessible_name: shape.requestedName },
			});

			expect(minted.ok).toBe(true);
			if (!minted.ok) continue;
			expect(minted.target.field.accessible_name).toBe(shape.name);
			expect(minted.target.field.backend_node_id).toBe(backendNodeId);
			expect(minted.target.frame_id).toBe(shape.frameId);
			expect(minted.target.frame_origin).toBe(
				shape.shape === "iframe"
					? "https://auth.example.test"
					: "https://portal.example.test",
			);
			expect(resolvedNodeIds).toEqual([backendNodeId]);
		}
	});

	test("refuses ambiguous URL matches and ambiguous unlabelled fallback fields", async () => {
		const ambiguousTarget = await mintBrowserUseVerifiedTarget(
			transportWithTargets([
				{
					targetId: "cdp-target-a",
					type: "page",
					url: "https://portal.example.test/login",
				},
				{
					targetId: "cdp-target-b",
					type: "page",
					url: "https://portal.example.test/login",
				},
			]),
			{
				lane_id: "agent-browser",
				run_id: "run-ambiguous-target",
				expected_url: "https://portal.example.test/login",
				allowed_origins: BINDING.allowed_origins,
				binding: BINDING,
				field: { role: "textbox", accessible_name: "Username" },
			},
		);
		expect(ambiguousTarget).toEqual({
			ok: false,
			cause: "target-proof-invalid",
		});

		const stable = stableTransport();
		const ambiguousFields: BrowserUseDevToolsTransport = {
			request: async (request) =>
				request.method === "Accessibility.getFullAXTree"
					? {
							nodes: [51, 52].map((backendDOMNodeId) => ({
								backendDOMNodeId,
								frameId: "top-frame",
								role: { type: "role", value: "textbox" },
								name: { type: "computedString", value: "" },
							})),
						}
					: stable.request(request),
		};
		const ambiguousFallback = await mintBrowserUseVerifiedTarget(
			ambiguousFields,
			{
				lane_id: "agent-browser",
				run_id: "run-ambiguous-field",
				expected_url: "https://portal.example.test/login",
				allowed_origins: BINDING.allowed_origins,
				binding: BINDING,
				field: { role: "textbox", accessible_name: "Username" },
			},
		);
		expect(ambiguousFallback).toEqual({
			ok: false,
			cause: "target-proof-invalid",
		});
	});

	test("an allowed URL and origin change yields a different digest that choreography refuses before minting a handle", async () => {
		const stable = stableTransport();
		let observation = 0;
		const urls = [
			"https://portal.example.test/login",
			"https://sso.example.test/challenge",
		] as const;
		const transport: BrowserUseDevToolsTransport = {
			request: async (request) => {
				if (request.method === "Target.getTargets") {
					const url = urls[Math.min(observation, urls.length - 1)] as string;
					observation += 1;
					return {
						targetInfos: [
							{ targetId: "cdp-target-7", type: "page", url },
						],
					};
				}
				if (request.method === "Page.getFrameTree") {
					const url = urls[Math.min(observation - 1, urls.length - 1)] as string;
					return {
						frameTree: { frame: { id: "top-frame", url } },
					};
				}
				return stable.request(request);
			},
		};
		const binding: BrowserUseItemBinding = {
			...BINDING,
			allowed_origins: [
				"https://portal.example.test",
				"https://sso.example.test",
			],
		};
		const minted = await mintBrowserUseVerifiedTarget(transport, {
			lane_id: "agent-browser",
			run_id: "run-drift",
			expected_url: "https://portal.example.test/login",
			allowed_origins: binding.allowed_origins,
			binding,
			field: { role: "textbox", accessible_name: "Username" },
		});
		expect(minted.ok).toBe(true);
		if (!minted.ok) return;

		const reproof = await minted.reproveTarget({ target: minted.target });
		expect(reproof.proven).toBe(true);
		if (!reproof.proven) return;
		expect(reproof.observed_digest).not.toBe(
			minted.target.target_proof_digest,
		);

		let fetched = false;
		const delivered = await deliverConfidentialFields({
			binding,
			target: minted.target,
			fields: ["password"],
			tokenRetrieval: tokenPort(() => {
				fetched = true;
			}),
			deliver: async () => ({
				ok: true,
				shape: { field: "password", byte_length: 1 },
			}),
			reproveTarget: minted.reproveTarget,
		});
		expect(delivered.ok).toBe(false);
		if (delivered.ok) return;
		expect(delivered.blocked.blocked_cause).toBe("target-proof-invalid");
		expect(fetched).toBe(false);
	});

	test("canonical digest ignores response key order and volatile title or timing fields", async () => {
		function canonicalTransport(reversed: boolean): BrowserUseDevToolsTransport {
			const stable = stableTransport();
			return {
				request: async (request) => {
					if (request.method === "Target.getTargets") {
						return reversed
							? {
									targetInfos: [
										{
											timing: 9001,
											url: "https://portal.example.test/login",
											type: "page",
											targetId: "cdp-target-7",
											title: "Changed title",
										},
									],
								}
							: {
									targetInfos: [
										{
											targetId: "cdp-target-7",
											type: "page",
											url: "https://portal.example.test/login",
											title: "Original title",
											timing: 1,
										},
									],
								};
					}
					if (request.method === "Page.getFrameTree") {
						return reversed
							? {
									timing: 2,
									frameTree: {
										frame: {
											url: "https://portal.example.test/login",
											id: "top-frame",
										},
									},
								}
							: {
									frameTree: {
										frame: {
											id: "top-frame",
											url: "https://portal.example.test/login",
										},
									},
									timing: 1,
								};
					}
					return stable.request(request);
				},
			};
		}
		const input = {
			lane_id: "agent-browser",
			run_id: "run-canonical",
			expected_url: "https://portal.example.test/login",
			allowed_origins: BINDING.allowed_origins,
			binding: BINDING,
			field: { role: "textbox", accessible_name: "Username" },
		} as const;
		const first = await mintBrowserUseVerifiedTarget(
			canonicalTransport(false),
			input,
		);
		const second = await mintBrowserUseVerifiedTarget(
			canonicalTransport(true),
			input,
		);
		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		if (!first.ok || !second.ok) return;
		expect(first.target.target_proof_digest).toBe(
			second.target.target_proof_digest,
		);
	});
});
