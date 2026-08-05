import { describe, expect, test } from "bun:test";
import {
	judgeAgentBrowserRefStaleness,
	refuseAgentBrowserPreDeliveryRef,
	resumeAgentBrowserAfterDelivery,
} from "./browser-use-agent-browser";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	type BrowserUseCdpObserverRequest,
	type BrowserUseCdpObserverTransport,
	createBrowserUseCdpObserver,
} from "./browser-use-cdp-observer";
import {
	type BrowserUseDeliveryResumeDirective,
	type BrowserUseVerifiedTarget,
	deliverConfidentialFields,
} from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";

// =========================================================================
// Pause/resume continuity around confidential delivery (R18, AE10).
//
// The task lane pauses at the confidential step. The REAL choreography emits
// the resume directive; the lane must obey it: discard every adapter ref
// captured before delivery and re-observe one fresh identity basis before
// continuing. Ref staleness is judged by VISIBILITY/OPERABILITY over the U8
// main-process observer — a still-resolvable but hidden node IS stale. SPA
// logins hide rather than remove screens, so "DOM.resolveNode still succeeds"
// is a false still-valid signal and must never be consulted.
//
// Fixtures mirror the U8 login-engine multi-step convention (a mutable screen
// behind the REAL createBrowserUseCdpObserver) and the seam test's delivery
// arc (a REAL deliverConfidentialFields call mints the directive).
// =========================================================================

const TARGET_ID = "cdp-target-resume";

type FixtureNode = {
	nodeId: string;
	backendDOMNodeId?: number;
	role: string;
	name: string;
	disabled?: boolean;
	/** Rendered layout quad. A hidden node keeps AX/DOM presence but has none. */
	quad?: readonly number[];
};

// Screen 1: the login screen the lane snapshotted BEFORE delivery. The
// password field (@e2 -> backend 41) and sign-in control (@e3 -> backend 42)
// are rendered and operable.
function loginScreen(): FixtureNode[] {
	return [
		{
			nodeId: "ax-password",
			backendDOMNodeId: 41,
			role: "textbox",
			name: "Password",
			quad: [10, 20, 210, 20, 210, 60, 10, 60],
		},
		{
			nodeId: "ax-sign-in",
			backendDOMNodeId: 42,
			role: "button",
			name: "Sign in",
			quad: [10, 80, 110, 80, 110, 120, 10, 120],
		},
	];
}

// Screen 2: the SPA advanced to the OTP step by HIDING the login screen, not
// removing it. Backend nodes 41/42 remain in the tree (still resolvable) but
// have no layout box. Fresh nodes: the OTP field (52), the verify control
// (53), and a rendered-but-disabled resend control (54).
function advancedScreen(): FixtureNode[] {
	return [
		{ nodeId: "ax-password", backendDOMNodeId: 41, role: "textbox", name: "Password" },
		{ nodeId: "ax-sign-in", backendDOMNodeId: 42, role: "button", name: "Sign in" },
		{
			nodeId: "ax-otp",
			backendDOMNodeId: 52,
			role: "textbox",
			name: "One-time code",
			quad: [10, 20, 210, 20, 210, 60, 10, 60],
		},
		{
			nodeId: "ax-verify",
			backendDOMNodeId: 53,
			role: "button",
			name: "Verify",
			quad: [10, 80, 110, 80, 110, 120, 10, 120],
		},
		{
			nodeId: "ax-resend",
			backendDOMNodeId: 54,
			role: "button",
			name: "Resend code",
			disabled: true,
			quad: [10, 140, 110, 140, 110, 180, 10, 180],
		},
	];
}

function fixtureTransport(
	state: { nodes: FixtureNode[] },
	methods: string[] = [],
): BrowserUseCdpObserverTransport {
	return {
		request: async (request: BrowserUseCdpObserverRequest): Promise<unknown> => {
			methods.push(request.method);
			switch (request.method) {
				case "Target.attachToTarget":
					return { sessionId: "session-resume" };
				case "Accessibility.getFullAXTree":
					return {
						nodes: state.nodes.map((node) => ({
							nodeId: node.nodeId,
							...(node.backendDOMNodeId === undefined
								? {}
								: { backendDOMNodeId: node.backendDOMNodeId }),
							role: { value: node.role },
							name: { value: node.name },
							...(node.disabled === undefined
								? {}
								: {
										properties: [
											{ name: "disabled", value: { value: node.disabled } },
										],
									}),
						})),
					};
				case "DOM.getContentQuads": {
					const node = state.nodes.find(
						(candidate) =>
							candidate.backendDOMNodeId === request.params.backendNodeId,
					);
					// A hidden node still resolves in the DOM but has no layout box;
					// Chrome rejects the quads request for it.
					if (node?.quad === undefined) throw new Error("node has no layout box");
					return { quads: [node.quad] };
				}
				case "Input.dispatchMouseEvent":
				case "Target.detachFromTarget":
					return {};
			}
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

const VERIFIED_TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-resume-1",
	top_level_origin: "https://oncore.test",
	frame_origin: "https://oncore.test",
	// The verified target IS the CDP target the lane resumes on; the resume
	// directive echoes this id and resumeAgentBrowserAfterDelivery refuses any
	// other target.
	target_id: TARGET_ID,
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "acct-ref-redacted",
	target_proof_digest: "d".repeat(32),
};

// Opaque-handle-only retrieval port (never bytes), mirroring the seam test.
const fakePort: BrowserUseTokenRetrievalPort = {
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

// The REAL choreography mints the resume directive — its semantics
// (discard_stale_refs, require_fresh_identity_basis) stay owned by
// browser-use-confidential-field-delivery.ts, never re-specified here.
async function deliverPassword(): Promise<BrowserUseDeliveryResumeDirective> {
	const outcome = await deliverConfidentialFields({
		binding: BINDING,
		target: VERIFIED_TARGET,
		fields: ["password"],
		tokenRetrieval: fakePort,
		deliver: async (input) => ({
			ok: true,
			shape: { field: input.field, byte_length: 12 },
		}),
		reproveTarget: async ({ target }) => ({
			proven: true,
			observed_digest: target.target_proof_digest,
		}),
	});
	if (!outcome.ok) throw new Error("delivery fixture must succeed");
	return outcome.resume;
}

describe("pause/resume continuity around confidential delivery (R18, AE10)", () => {
	test("a ref captured before delivery on an advanced screen is refused on reuse", async () => {
		const state = { nodes: loginScreen() };
		const methods: string[] = [];
		const observer = createBrowserUseCdpObserver(
			fixtureTransport(state, methods),
		);
		const captured = { ref: "@e2", backend_node_id: 41 };

		// Before delivery the captured ref's node is live: rendered and operable.
		expect(
			await judgeAgentBrowserRefStaleness(observer, {
				cdp_target_id: TARGET_ID,
				backend_node_id: captured.backend_node_id,
			}),
		).toEqual({ stale: false });

		const resume = await deliverPassword();
		expect(resume.discard_stale_refs).toBe(true);
		expect(resume.require_fresh_identity_basis).toBe(true);

		// The SPA advances by hiding the login screen: node 41 still resolves
		// but is no longer visible or operable.
		state.nodes = advancedScreen();

		const refusal = await refuseAgentBrowserPreDeliveryRef(observer, {
			cdp_target_id: TARGET_ID,
			captured,
		});
		expect(refusal).toEqual({
			reusable: false,
			code: "agent_browser_stale_ref_refused",
			message: expect.stringContaining("fresh identity basis"),
			staleness: { stale: true, cause: "ref-not-visible" },
		});
		// Staleness came from the visibility probe, never DOM.resolveNode.
		expect(methods).not.toContain("DOM.resolveNode");
	});

	test("obeying the resume directive (discard, re-observe) continues cleanly to the next step", async () => {
		const state = { nodes: loginScreen() };
		const methods: string[] = [];
		const observer = createBrowserUseCdpObserver(
			fixtureTransport(state, methods),
		);
		const capturedRefs = [
			{ ref: "@e2", backend_node_id: 41 },
			{ ref: "@e3", backend_node_id: 42 },
		];

		const resume = await deliverPassword();
		state.nodes = advancedScreen();

		const snapshotsBeforeResume = methods.filter(
			(method) => method === "Accessibility.getFullAXTree",
		).length;
		const resumed = await resumeAgentBrowserAfterDelivery(observer, {
			resume,
			cdp_target_id: TARGET_ID,
			captured_refs: capturedRefs,
		});
		expect(resumed.ok).toBe(true);
		if (!resumed.ok) return;

		// The SAME lane resumes (R5/KTD3): identity echoed from the directive.
		expect(resumed.lane_id).toBe(resume.lane_id);
		expect(resumed.run_id).toBe(resume.run_id);
		// Every pre-delivery ref is discarded (resume.discard_stale_refs).
		expect(resumed.discarded_refs).toEqual(["@e2", "@e3"]);
		// Exactly one fresh identity basis observation (no cached reuse).
		expect(
			methods.filter((method) => method === "Accessibility.getFullAXTree")
				.length,
		).toBe(snapshotsBeforeResume + 1);

		// The fresh basis names the next step's field with a fresh backend id.
		const otp = resumed.basis.nodes.find(
			(node) => node.backend_node_id === 52,
		);
		expect(otp?.role).toBe("textbox");
		expect(otp?.accessible_name).toBe("One-time code");

		// Continuing from the fresh basis proceeds cleanly: the fresh field is
		// live and the fresh control activates with trusted input.
		expect(
			await judgeAgentBrowserRefStaleness(observer, {
				cdp_target_id: TARGET_ID,
				backend_node_id: 52,
			}),
		).toEqual({ stale: false });
		expect(
			await observer.activateControl({
				target_id: TARGET_ID,
				backend_node_id: 53,
			}),
		).toEqual({ ok: true });
	});

	test("a resolvable-but-hidden node is classified stale by visibility, not DOM.resolveNode", async () => {
		const state = { nodes: advancedScreen() };
		const methods: string[] = [];
		const observer = createBrowserUseCdpObserver(
			fixtureTransport(state, methods),
		);

		// Backend node 41 is still present in the tree — DOM.resolveNode WOULD
		// succeed — but the SPA hid it, so it has no layout box.
		expect(
			await judgeAgentBrowserRefStaleness(observer, {
				cdp_target_id: TARGET_ID,
				backend_node_id: 41,
			}),
		).toEqual({ stale: true, cause: "ref-not-visible" });

		// A rendered-but-disabled node is stale by operability.
		expect(
			await judgeAgentBrowserRefStaleness(observer, {
				cdp_target_id: TARGET_ID,
				backend_node_id: 54,
			}),
		).toEqual({ stale: true, cause: "ref-not-operable" });

		// A node no longer in the tree at all is unobservable.
		expect(
			await judgeAgentBrowserRefStaleness(observer, {
				cdp_target_id: TARGET_ID,
				backend_node_id: 99,
			}),
		).toEqual({ stale: true, cause: "ref-unobservable" });

		// The judgement never consulted the false still-valid signal.
		expect(methods).not.toContain("DOM.resolveNode");
	});

	test("resume refuses a CDP target that is not the directive's target, before any observation", async () => {
		const state = { nodes: advancedScreen() };
		const methods: string[] = [];
		const observer = createBrowserUseCdpObserver(
			fixtureTransport(state, methods),
		);
		const resume = await deliverPassword();

		// The lane offers a DIFFERENT CDP target than the one the directive
		// (and the delivery's verified target) names.
		const resumed = await resumeAgentBrowserAfterDelivery(observer, {
			resume,
			cdp_target_id: "cdp-target-other",
			captured_refs: [{ ref: "@e2", backend_node_id: 41 }],
		});
		expect(resumed).toEqual({
			ok: false,
			code: "agent_browser_resume_target_mismatch",
			message: expect.stringContaining("directive's target"),
		});
		// Refused BEFORE snapshot: the mismatched target is never observed.
		expect(methods).not.toContain("Target.attachToTarget");
		expect(methods).not.toContain("Accessibility.getFullAXTree");
	});

	test("resume refuses when no fresh identity basis is observable", async () => {
		const observer = createBrowserUseCdpObserver({
			// Attachment yields no session: the target is gone, so no fresh
			// identity basis can be observed.
			request: async () => ({}),
		});
		const resume = await deliverPassword();

		const resumed = await resumeAgentBrowserAfterDelivery(observer, {
			resume,
			cdp_target_id: TARGET_ID,
			captured_refs: [{ ref: "@e2", backend_node_id: 41 }],
		});
		expect(resumed).toEqual({
			ok: false,
			code: "agent_browser_fresh_identity_basis_unavailable",
			message: expect.stringContaining("fresh identity basis"),
		});
	});
});
