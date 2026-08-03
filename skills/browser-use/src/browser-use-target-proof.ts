import { createHash } from "node:crypto";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type {
	BrowserUseTargetReproof,
	BrowserUseVerifiedTarget,
} from "./browser-use-confidential-field-delivery";

/**
 * One read-only CDP request issued through an endpoint-bound transport.
 *
 * Session ids are transport routing metadata, never adapter tab ids.
 */
export type BrowserUseDevToolsRequest =
	| { method: "Target.getTargets" }
	| {
			method: "Target.attachToTarget";
			params: { targetId: string; flatten: true };
	  }
	| { method: "Page.getFrameTree"; sessionId: string }
	| { method: "Accessibility.getFullAXTree"; sessionId: string }
	| {
			method: "DOM.resolveNode";
			sessionId: string;
			params: { backendNodeId: number };
	  }
	| {
			method: "Target.detachFromTarget";
			params: { sessionId: string };
	  };

/**
 * Endpoint-bound DevTools request boundary.
 *
 * Production wiring owns WebSocket mechanics. This module owns the exact
 * secret-free observation sequence and can therefore use the same algorithm
 * with a hermetic fake.
 */
export type BrowserUseDevToolsTransport = {
	request(request: BrowserUseDevToolsRequest): Promise<unknown>;
};

/**
 * Semantic field identity bridged to its browser-global backend node id.
 */
export type BrowserUseVerifiedField = {
	role: string;
	accessible_name: string;
	backend_node_id: number;
};

/**
 * Verified target with the field bridge required by the delivery child.
 *
 * The existing choreography consumes the base fields. The richer producer type
 * preserves the AX-to-DOM identity without changing that stable contract.
 */
export type BrowserUseMintedVerifiedTarget = BrowserUseVerifiedTarget & {
	field: BrowserUseVerifiedField;
};

/**
 * Input for one adapter-independent target proof.
 */
export type BrowserUseTargetProofInput = {
	lane_id: string;
	run_id: string;
	expected_url: string;
	allowed_origins: readonly string[];
	binding: BrowserUseItemBinding;
	field: {
		role: string;
		accessible_name: string;
	};
};

/**
 * Typed target-proof refusal shared with confidential-delivery choreography.
 */
export type BrowserUseTargetProofRefusalCause =
	| "origin-mismatch"
	| "target-proof-invalid";

/**
 * Browser-level target identity resolved independently of an adapter's tab id.
 */
export type BrowserUseCdpTargetIdentity = {
	target_id: string;
	top_level_url: string;
	top_level_origin?: string;
};

/**
 * Resolve the CDP identity that backs one adapter-selected page.
 *
 * Adapter tab ids are deliberately absent. Resolution uses fresh browser-level
 * URL evidence and fails closed when that evidence is not unique.
 *
 * @param transport - Verified browser-level DevTools transport
 * @param input - Current page URL, allowed origins, and optional prior CDP identity
 * @returns One CDP target identity or a typed proof refusal
 * @throws Never. Transport failures become `target-proof-invalid`.
 *
 * @example
 * ```typescript
 * const resolved = await resolveBrowserUseCdpTargetIdentity(transport, {
 *   expected_url: 'https://portal.example/login',
 *   allowed_origins: ['https://portal.example'],
 * })
 * ```
 */
export async function resolveBrowserUseCdpTargetIdentity(
	transport: BrowserUseDevToolsTransport,
	input: {
		expected_url: string;
		allowed_origins: readonly string[];
		preferred_target_id?: string;
	},
): Promise<
	| { ok: true; target: BrowserUseCdpTargetIdentity }
	| { ok: false; cause: BrowserUseTargetProofRefusalCause }
> {
	try {
		const expectedUrl = normalizedUrl(input.expected_url);
		if (expectedUrl === undefined) {
			return { ok: false, cause: "target-proof-invalid" };
		}
		const targetsResponse = asObject(
			await transport.request({ method: "Target.getTargets" }),
		);
		const targetInfos = targetsResponse?.targetInfos;
		if (!Array.isArray(targetInfos)) {
			return { ok: false, cause: "target-proof-invalid" };
		}
		const pageTargets = targetInfos.flatMap((value): JsonObject[] => {
			const target = asObject(value);
			return target?.type === "page" &&
				typeof target.targetId === "string" &&
				typeof target.url === "string"
				? [target]
				: [];
		});
		const exactUrlMatches = pageTargets.filter(
			(target) =>
				typeof target.url === "string" &&
				normalizedUrl(target.url) === expectedUrl,
		);
		const expectedOrigin = originOf(expectedUrl);
		const exactOriginMatches = pageTargets.filter(
			(target) =>
				expectedOrigin !== undefined &&
				typeof target.url === "string" &&
				originOf(target.url) === expectedOrigin,
		);
		const matches =
			exactUrlMatches.length > 0
				? exactUrlMatches
				: exactOriginMatches.length > 0
					? exactOriginMatches
					: pageTargets.filter(
							(target) => target.targetId === input.preferred_target_id,
						);
		if (matches.length !== 1) {
			return { ok: false, cause: "target-proof-invalid" };
		}
		const targetId = matches[0]?.targetId;
		const topLevelUrl = matches[0]?.url;
		if (typeof targetId !== "string" || typeof topLevelUrl !== "string") {
			return { ok: false, cause: "target-proof-invalid" };
		}
		const normalizedTopLevelUrl = normalizedUrl(topLevelUrl);
		const topLevelOrigin = originOf(topLevelUrl);
		if (expectedUrl === "about:blank") {
			if (normalizedTopLevelUrl !== expectedUrl) {
				return { ok: false, cause: "target-proof-invalid" };
			}
			return {
				ok: true,
				target: { target_id: targetId, top_level_url: expectedUrl },
			};
		}
		const allowedOrigins = new Set(
			input.allowed_origins.flatMap((origin) => {
				const normalized = originOf(origin);
				return normalized === undefined ? [] : [normalized];
			}),
		);
		if (topLevelOrigin === undefined || !allowedOrigins.has(topLevelOrigin)) {
			return { ok: false, cause: "origin-mismatch" };
		}
		return {
			ok: true,
			target: {
				target_id: targetId,
				top_level_url: normalizedTopLevelUrl ?? topLevelUrl,
				top_level_origin: topLevelOrigin,
			},
		};
	} catch {
		return { ok: false, cause: "target-proof-invalid" };
	}
}

/**
 * Mint outcome with a closure that repeats the same fresh observation.
 */
export type BrowserUseTargetProofResult =
	| {
			ok: true;
			target: BrowserUseMintedVerifiedTarget;
			reproveTarget: BrowserUseTargetReproof;
	  }
	| { ok: false; cause: BrowserUseTargetProofRefusalCause };

type JsonObject = Record<string, unknown>;

type ObservedIdentity = {
	top_level_url: string;
	top_level_origin: string;
	frame_url: string;
	frame_origin: string;
	target_id: string;
	page_id: string;
	frame_id: string;
	field: BrowserUseVerifiedField;
};

type ObservedFieldNode = BrowserUseVerifiedField & {
	frame_id?: string;
};

function asObject(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function normalizedUrl(value: string): string | undefined {
	try {
		return new URL(value).href;
	} catch {
		return undefined;
	}
}

function originOf(value: string): string | undefined {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.origin
			: undefined;
	} catch {
		return undefined;
	}
}

function stringValue(value: unknown): string | undefined {
	const object = asObject(value);
	return typeof object?.value === "string" ? object.value : undefined;
}

function collectFrameUrls(
	frameTreeValue: unknown,
	frameUrls: Map<string, string>,
): void {
	const frameTree = asObject(frameTreeValue);
	const frame = asObject(frameTree?.frame);
	if (typeof frame?.id === "string" && typeof frame.url === "string") {
		frameUrls.set(frame.id, frame.url);
	}
	if (!Array.isArray(frameTree?.childFrames)) return;
	for (const child of frameTree.childFrames) {
		collectFrameUrls(child, frameUrls);
	}
}

function proofDigest(
	input: BrowserUseTargetProofInput,
	accountRef: string,
	identity: ObservedIdentity,
): string {
	const canonical = JSON.stringify([
		["lane_id", input.lane_id],
		["run_id", input.run_id],
		["top_level_url", identity.top_level_url],
		["top_level_origin", identity.top_level_origin],
		["frame_url", identity.frame_url],
		["frame_origin", identity.frame_origin],
		["target_id", identity.target_id],
		["page_id", identity.page_id],
		["frame_id", identity.frame_id],
		["account_ref", accountRef],
		["field_role", identity.field.role],
		["field_accessible_name", identity.field.accessible_name],
		["field_backend_node_id", identity.field.backend_node_id],
	]);
	return createHash("sha256").update(canonical).digest("hex");
}

function expectedPrincipalRef(binding: BrowserUseItemBinding): string {
	const canonical = JSON.stringify([
		binding.service_id,
		binding.auth_context,
		binding.vault_id,
		binding.item_id,
		binding.binding_revision,
	]);
	const digest = createHash("sha256").update(canonical).digest("hex");
	return `expected-principal:sha256:${digest}`;
}

async function observe(
	transport: BrowserUseDevToolsTransport,
	input: BrowserUseTargetProofInput,
	preferredTargetId?: string,
): Promise<
	| { ok: true; identity: ObservedIdentity }
	| { ok: false; cause: BrowserUseTargetProofRefusalCause }
> {
	try {
		const resolution = await resolveBrowserUseCdpTargetIdentity(transport, {
			expected_url: input.expected_url,
			allowed_origins: input.allowed_origins,
			...(preferredTargetId === undefined
				? {}
				: { preferred_target_id: preferredTargetId }),
		});
		if (!resolution.ok) return resolution;
		const targetId = resolution.target.target_id;
		const topLevelUrl = resolution.target.top_level_url;
		const topLevelOrigin = resolution.target.top_level_origin;
		const allowedOrigins = new Set(
			input.allowed_origins.flatMap((origin) => {
				const normalized = originOf(origin);
				return normalized === undefined ? [] : [normalized];
			}),
		);
		if (topLevelOrigin === undefined || !allowedOrigins.has(topLevelOrigin)) {
			return { ok: false, cause: "origin-mismatch" };
		}

		const attached = asObject(
			await transport.request({
				method: "Target.attachToTarget",
				params: { targetId, flatten: true },
			}),
		);
		const sessionId = attached?.sessionId;
		if (typeof sessionId !== "string") {
			return { ok: false, cause: "target-proof-invalid" };
		}
		try {
			const frameResponse = asObject(
				await transport.request({ method: "Page.getFrameTree", sessionId }),
			);
			const frameTree = asObject(frameResponse?.frameTree);
			const frame = asObject(frameTree?.frame);
			const pageId = frame?.id;
			if (typeof pageId !== "string") {
				return { ok: false, cause: "target-proof-invalid" };
			}
			const frameUrls = new Map<string, string>();
			collectFrameUrls(frameTree, frameUrls);
			const axResponse = asObject(
				await transport.request({
					method: "Accessibility.getFullAXTree",
					sessionId,
				}),
			);
			if (!Array.isArray(axResponse?.nodes)) {
				return { ok: false, cause: "target-proof-invalid" };
			}
			const roleMatches = axResponse.nodes.flatMap(
				(value): ObservedFieldNode[] => {
					const node = asObject(value);
					return stringValue(node?.role) === input.field.role &&
						typeof node?.backendDOMNodeId === "number" &&
						Number.isSafeInteger(node.backendDOMNodeId) &&
						node.backendDOMNodeId > 0 &&
						(typeof node.frameId === "string" || node.frameId === undefined)
						? [
								{
									role: input.field.role,
									accessible_name: stringValue(node.name) ?? "",
									backend_node_id: node.backendDOMNodeId,
									...(typeof node.frameId === "string"
										? { frame_id: node.frameId }
										: {}),
								},
							]
						: [];
				},
			);
			const exactNameMatches = roleMatches.filter(
				(field) =>
					field.accessible_name === input.field.accessible_name,
			);
			const fieldMatches =
				exactNameMatches.length > 0
					? exactNameMatches
					: roleMatches.filter((field) => field.accessible_name === "");
			if (fieldMatches.length !== 1) {
				return { ok: false, cause: "target-proof-invalid" };
			}
			const fieldNode = fieldMatches[0] as ObservedFieldNode;
			const frameId = fieldNode.frame_id ?? pageId;
			const frameUrl = frameUrls.get(frameId);
			if (frameUrl === undefined) {
				return { ok: false, cause: "target-proof-invalid" };
			}
			const resolved = asObject(
				await transport.request({
					method: "DOM.resolveNode",
					sessionId,
					params: { backendNodeId: fieldNode.backend_node_id },
				}),
			);
			const remoteObject = asObject(resolved?.object);
			if (typeof remoteObject?.objectId !== "string") {
				return { ok: false, cause: "target-proof-invalid" };
			}
			const frameOrigin = originOf(frameUrl);
			if (frameOrigin === undefined || !allowedOrigins.has(frameOrigin)) {
				return { ok: false, cause: "origin-mismatch" };
			}
			return {
				ok: true,
				identity: {
					top_level_url: normalizedUrl(topLevelUrl) ?? topLevelUrl,
					top_level_origin: topLevelOrigin,
					frame_url: normalizedUrl(frameUrl) ?? frameUrl,
					frame_origin: frameOrigin,
					target_id: targetId,
					page_id: pageId,
					frame_id: frameId,
					field: {
						role: fieldNode.role,
						accessible_name: fieldNode.accessible_name,
						backend_node_id: fieldNode.backend_node_id,
					},
				},
			};
		} finally {
			try {
				await transport.request({
					method: "Target.detachFromTarget",
					params: { sessionId },
				});
			} catch {
				// The observation result stays authoritative. A closed target can
				// make detach race with a completed proof.
			}
		}
	} catch {
		return { ok: false, cause: "target-proof-invalid" };
	}
}

/**
 * Mint one verified target and a closure that freshly re-observes it.
 *
 * @param transport - Secret-free DevTools transport already bound to the handoff endpoint
 * @param input - Expected URL, origin policy, binding, and semantic field identity
 * @returns A verified target plus reproof closure, or a typed refusal
 * @throws Never. Transport and observation failures become `target-proof-invalid`.
 *
 * @example
 * ```typescript
 * const proof = await mintBrowserUseVerifiedTarget(transport, input)
 * if (proof.ok) await proof.reproveTarget({ target: proof.target })
 * ```
 */
export async function mintBrowserUseVerifiedTarget(
	transport: BrowserUseDevToolsTransport,
	input: BrowserUseTargetProofInput,
): Promise<BrowserUseTargetProofResult> {
	const observed = await observe(transport, input);
	if (!observed.ok) return observed;
	const accountRef = expectedPrincipalRef(input.binding);
	const digest = proofDigest(input, accountRef, observed.identity);
	const target: BrowserUseMintedVerifiedTarget = {
		lane_id: input.lane_id,
		run_id: input.run_id,
		top_level_origin: observed.identity.top_level_origin,
		frame_origin: observed.identity.frame_origin,
		target_id: observed.identity.target_id,
		page_id: observed.identity.page_id,
		frame_id: observed.identity.frame_id,
		account_ref: accountRef,
		target_proof_digest: digest,
		field: observed.identity.field,
	};
	const reproveTarget: BrowserUseTargetReproof = async ({ target: candidate }) => {
		if (
			candidate.lane_id !== target.lane_id ||
			candidate.run_id !== target.run_id ||
			candidate.target_id !== target.target_id ||
			candidate.account_ref !== target.account_ref
		) {
			return { proven: false, cause: "target-proof-invalid" };
		}
		const fresh = await observe(transport, input, target.target_id);
		return fresh.ok
			? {
					proven: true,
					observed_digest: proofDigest(input, accountRef, fresh.identity),
				}
			: { proven: false, cause: fresh.cause };
	};
	return { ok: true, target, reproveTarget };
}
