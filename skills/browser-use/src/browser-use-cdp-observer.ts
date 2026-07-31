/**
 * Secret-free CDP requests used by the reusable login and continuity observer.
 *
 * The transport is endpoint-bound by its caller. Target identity always travels
 * as a CDP target id, never as an adapter-owned page reference.
 */
export type BrowserUseCdpObserverRequest =
	| {
			method: "Target.attachToTarget";
			params: { targetId: string; flatten: true };
	  }
	| {
			method: "Accessibility.getFullAXTree";
			sessionId: string;
	  }
	| {
			method: "DOM.getContentQuads";
			sessionId: string;
			params: { backendNodeId: number };
	  }
	| {
			method: "Input.dispatchMouseEvent";
			sessionId: string;
			params:
				| { type: "mouseMoved"; x: number; y: number }
				| {
						type: "mousePressed" | "mouseReleased";
						x: number;
						y: number;
						button: "left";
						buttons: 0 | 1;
						clickCount: 1;
				  };
	  }
	| {
			method: "Target.detachFromTarget";
			params: { sessionId: string };
	  };

/**
 * Endpoint-bound request seam for secret-free browser observation.
 *
 * @example
 * ```typescript
 * const observer = createBrowserUseCdpObserver(transport)
 * await observer.snapshot({ target_id: 'target-7' })
 * ```
 */
export type BrowserUseCdpObserverTransport = {
	/** Issue one browser-level or flat-session CDP request. */
	request(request: BrowserUseCdpObserverRequest): Promise<unknown>;
};

/**
 * Stable, secret-free projection of one accessibility node.
 *
 * Browser-global backend node ids bridge observation to the disposable delivery
 * child without storing an adapter selector or ref.
 */
export type BrowserUseAccessibilityNode = {
	node_id: string;
	role: string;
	accessible_name: string;
	ignored: boolean;
	backend_node_id?: number;
	frame_id?: string;
	parent_id?: string;
	child_ids?: readonly string[];
	properties: Readonly<Record<string, string | number | boolean>>;
};

/**
 * Full accessibility observation for one exact CDP target.
 */
export type BrowserUseAccessibilitySnapshot = {
	target_id: string;
	nodes: readonly BrowserUseAccessibilityNode[];
};

/**
 * Typed observer refusal. Each cause is secret-free and safe for run state.
 */
export type BrowserUseCdpObserverCause =
	| "target-unavailable"
	| "snapshot-unavailable"
	| "node-unavailable"
	| "node-not-operable"
	| "activation-failed";

/**
 * Full-tree snapshot outcome.
 */
export type BrowserUseAccessibilitySnapshotResult =
	| { ok: true; snapshot: BrowserUseAccessibilitySnapshot }
	| { ok: false; cause: BrowserUseCdpObserverCause };

/**
 * Visibility and operability state used to reject stale browser nodes.
 */
export type BrowserUseNodeProbe = {
	visible: boolean;
	operable: boolean;
};

/**
 * Node probe outcome.
 */
export type BrowserUseNodeProbeResult =
	| { ok: true; probe: BrowserUseNodeProbe }
	| { ok: false; cause: BrowserUseCdpObserverCause };

/**
 * Trusted control-activation outcome.
 */
export type BrowserUseControlActivationResult =
	| { ok: true }
	| { ok: false; cause: BrowserUseCdpObserverCause };

/**
 * Reusable observer API consumed by generic login and later resume continuity.
 *
 * @example
 * ```typescript
 * const snapshot = await observer.snapshot({ target_id: 'target-7' })
 * if (snapshot.ok) {
 *   await observer.probeNode({
 *     target_id: snapshot.snapshot.target_id,
 *     backend_node_id: 41,
 *   })
 * }
 * ```
 */
export type BrowserUseCdpObserver = {
	/** Read the current full accessibility tree. */
	snapshot(input: {
		target_id: string;
	}): Promise<BrowserUseAccessibilitySnapshotResult>;
	/** Probe rendered layout and disabled state without mutating the page. */
	probeNode(input: {
		target_id: string;
		backend_node_id: number;
	}): Promise<BrowserUseNodeProbeResult>;
	/** Activate one proven control with trusted CDP mouse input. */
	activateControl(input: {
		target_id: string;
		backend_node_id: number;
	}): Promise<BrowserUseControlActivationResult>;
};

type JsonObject = Record<string, unknown>;

type SessionResult<Value> =
	| { ok: true; value: Value }
	| { ok: false; cause: BrowserUseCdpObserverCause };

const OPERABLE_CONTROL_ROLES = new Set([
	"button",
	"checkbox",
	"link",
	"menuitem",
	"radio",
	"switch",
	"tab",
]);

function asObject(value: unknown): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: undefined;
}

function axValue(value: unknown): string | number | boolean | undefined {
	const object = asObject(value);
	const inner = object?.value;
	return typeof inner === "string" ||
		typeof inner === "number" ||
		typeof inner === "boolean"
		? inner
		: undefined;
}

function stringAxValue(value: unknown): string {
	const parsed = axValue(value);
	return typeof parsed === "string" ? parsed : "";
}

function positiveBackendNodeId(value: unknown): number | undefined {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0
		? value
		: undefined;
}

function propertiesOf(
	value: unknown,
): Readonly<Record<string, string | number | boolean>> {
	if (!Array.isArray(value)) return {};
	const properties: Record<string, string | number | boolean> = {};
	for (const rawProperty of value) {
		const property = asObject(rawProperty);
		if (typeof property?.name !== "string") continue;
		const parsed = axValue(property.value);
		if (parsed !== undefined) properties[property.name] = parsed;
	}
	return properties;
}

function accessibilityNodeOf(value: unknown): BrowserUseAccessibilityNode | undefined {
	const node = asObject(value);
	if (typeof node?.nodeId !== "string") return undefined;
	const backendNodeId = positiveBackendNodeId(node.backendDOMNodeId);
	const childIds = Array.isArray(node.childIds)
		? node.childIds.filter((child): child is string => typeof child === "string")
		: undefined;
	return {
		node_id: node.nodeId,
		role: stringAxValue(node.role),
		accessible_name: stringAxValue(node.name),
		ignored: node.ignored === true,
		...(backendNodeId !== undefined
			? { backend_node_id: backendNodeId }
			: {}),
		...(typeof node.frameId === "string" ? { frame_id: node.frameId } : {}),
		...(typeof node.parentId === "string"
			? { parent_id: node.parentId }
			: {}),
		...(childIds !== undefined ? { child_ids: childIds } : {}),
		properties: propertiesOf(node.properties),
	};
}

async function inTargetSession<Value>(
	transport: BrowserUseCdpObserverTransport,
	targetId: string,
	run: (sessionId: string) => Promise<SessionResult<Value>>,
): Promise<SessionResult<Value>> {
	let sessionId: string | undefined;
	try {
		const attached = asObject(
			await transport.request({
				method: "Target.attachToTarget",
				params: { targetId, flatten: true },
			}),
		);
		if (typeof attached?.sessionId !== "string") {
			return { ok: false, cause: "target-unavailable" };
		}
		sessionId = attached.sessionId;
		return await run(sessionId);
	} catch {
		return { ok: false, cause: "target-unavailable" };
	} finally {
		if (sessionId !== undefined) {
			try {
				await transport.request({
					method: "Target.detachFromTarget",
					params: { sessionId },
				});
			} catch {
				// The operation result stays authoritative. A closed target can make
				// detach race with successful observation or activation.
			}
		}
	}
}

async function nodesInSession(
	transport: BrowserUseCdpObserverTransport,
	sessionId: string,
): Promise<readonly BrowserUseAccessibilityNode[] | undefined> {
	const response = asObject(
		await transport.request({
			method: "Accessibility.getFullAXTree",
			sessionId,
		}),
	);
	if (!Array.isArray(response?.nodes)) return undefined;
	return response.nodes.flatMap((node) => {
		const parsed = accessibilityNodeOf(node);
		return parsed === undefined ? [] : [parsed];
	});
}

function visibleQuadOf(value: unknown): readonly number[] | undefined {
	const response = asObject(value);
	if (!Array.isArray(response?.quads)) return undefined;
	for (const rawQuad of response.quads) {
		if (
			!Array.isArray(rawQuad) ||
			rawQuad.length !== 8 ||
			!rawQuad.every(
				(coordinate) =>
					typeof coordinate === "number" && Number.isFinite(coordinate),
			)
		) {
			continue;
		}
		const xs = [rawQuad[0], rawQuad[2], rawQuad[4], rawQuad[6]] as number[];
		const ys = [rawQuad[1], rawQuad[3], rawQuad[5], rawQuad[7]] as number[];
		if (
			Math.max(...xs) - Math.min(...xs) > 0 &&
			Math.max(...ys) - Math.min(...ys) > 0
		) {
			return rawQuad as number[];
		}
	}
	return undefined;
}

function centerOf(quad: readonly number[]): { x: number; y: number } {
	const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0, x4 = 0, y4 = 0] =
		quad;
	return {
		x: (x1 + x2 + x3 + x4) / 4,
		y: (y1 + y2 + y3 + y4) / 4,
	};
}

async function probeInSession(
	transport: BrowserUseCdpObserverTransport,
	sessionId: string,
	backendNodeId: number,
): Promise<
	| {
			ok: true;
			probe: BrowserUseNodeProbe;
			center?: { x: number; y: number };
			node: BrowserUseAccessibilityNode;
	  }
	| { ok: false; cause: BrowserUseCdpObserverCause }
> {
	try {
		const nodes = await nodesInSession(transport, sessionId);
		if (nodes === undefined) {
			return { ok: false, cause: "snapshot-unavailable" };
		}
		const node = nodes.find(
			(candidate) => candidate.backend_node_id === backendNodeId,
		);
		if (node === undefined) return { ok: false, cause: "node-unavailable" };
		let quad: readonly number[] | undefined;
		try {
			quad = visibleQuadOf(
				await transport.request({
					method: "DOM.getContentQuads",
					sessionId,
					params: { backendNodeId },
				}),
			);
		} catch {
			// Chrome rejects getContentQuads when a still-resolvable node has no
			// layout box. That is the hidden/stale result U11 needs, not an
			// observer outage and never evidence that the node remains operable.
			quad = undefined;
		}
		const visible = !node.ignored && quad !== undefined;
		const operable = visible && node.properties.disabled !== true;
		return {
			ok: true,
			probe: { visible, operable },
			...(quad !== undefined ? { center: centerOf(quad) } : {}),
			node,
		};
	} catch {
		return { ok: false, cause: "snapshot-unavailable" };
	}
}

/**
 * Create a secret-free observer over an already verified CDP transport.
 *
 * Every operation attaches by exact CDP target id and detaches afterward. Mouse
 * activation uses `Input.dispatchMouseEvent`; no DOM click script exists.
 *
 * @param transport - Endpoint-bound browser-level CDP request seam
 * @returns Observer for snapshots, probes, and trusted control activation
 *
 * @example
 * ```typescript
 * const observer = createBrowserUseCdpObserver(transport)
 * const result = await observer.snapshot({ target_id: 'target-7' })
 * ```
 */
export function createBrowserUseCdpObserver(
	transport: BrowserUseCdpObserverTransport,
): BrowserUseCdpObserver {
	return {
		snapshot: async ({ target_id }) =>
			await inTargetSession(transport, target_id, async (sessionId) => {
				try {
					const nodes = await nodesInSession(transport, sessionId);
					return nodes === undefined
						? { ok: false, cause: "snapshot-unavailable" }
						: {
								ok: true,
								value: { target_id, nodes },
							};
				} catch {
					return { ok: false, cause: "snapshot-unavailable" };
				}
			}).then((result): BrowserUseAccessibilitySnapshotResult =>
				result.ok
					? { ok: true, snapshot: result.value }
					: { ok: false, cause: result.cause },
			),
		probeNode: async ({ target_id, backend_node_id }) =>
			await inTargetSession(transport, target_id, async (sessionId) => {
				const result = await probeInSession(
					transport,
					sessionId,
					backend_node_id,
				);
				return result.ok
					? { ok: true, value: result.probe }
					: { ok: false, cause: result.cause };
			}).then((result): BrowserUseNodeProbeResult =>
				result.ok
					? { ok: true, probe: result.value }
					: { ok: false, cause: result.cause },
			),
		activateControl: async ({ target_id, backend_node_id }) =>
			await inTargetSession(transport, target_id, async (sessionId) => {
				const probed = await probeInSession(
					transport,
					sessionId,
					backend_node_id,
				);
				if (!probed.ok) return probed;
				if (
					!probed.probe.operable ||
					probed.center === undefined ||
					!OPERABLE_CONTROL_ROLES.has(probed.node.role.toLowerCase())
				) {
					return { ok: false, cause: "node-not-operable" };
				}
				const { x, y } = probed.center;
				try {
					await transport.request({
						method: "Input.dispatchMouseEvent",
						sessionId,
						params: { type: "mouseMoved", x, y },
					});
					await transport.request({
						method: "Input.dispatchMouseEvent",
						sessionId,
						params: {
							type: "mousePressed",
							x,
							y,
							button: "left",
							buttons: 1,
							clickCount: 1,
						},
					});
					await transport.request({
						method: "Input.dispatchMouseEvent",
						sessionId,
						params: {
							type: "mouseReleased",
							x,
							y,
							button: "left",
							buttons: 0,
							clickCount: 1,
						},
					});
					return { ok: true, value: undefined };
				} catch {
					return { ok: false, cause: "activation-failed" };
				}
			}).then((result): BrowserUseControlActivationResult =>
				result.ok ? { ok: true } : { ok: false, cause: result.cause },
			),
	};
}
