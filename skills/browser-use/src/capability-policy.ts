// ---------------------------------------------------------------------------
// Capability policy (migration U2, KTD4).
//
// Owns Browser Operation class authorization: which routed capability each
// operation class requires, and whether a binding's authorized capability set
// authorizes a class. Hoisted out of the dormant Browser Adapter Router engine
// so live code carries no import edge into the dormant router cluster; the
// dormant engine re-imports OPERATION_CLASS_CAPABILITY from here (one-way
// dormant->live).
// ---------------------------------------------------------------------------

import type { AdapterCapability } from "./discovery-model";

// Browser Operation classes authorized by route evidence (U2 R10, R11). Each
// class maps to a routed capability; an operation is authorized only when its
// capability is present in the route's authorized capability set.
export type BrowserOperationClass = "snapshot" | "screenshot" | "emulate";

// ---------------------------------------------------------------------------
// Operation capability mapping (U2 R10, R11). Each Browser Operation class
// authorizes only when its required capability is present in the route's
// authorized capability set. Runtime-owned so the public operation vocabulary
// never leaks adapter method names.
// ---------------------------------------------------------------------------

export const OPERATION_CLASS_CAPABILITY = {
	snapshot: "snapshot_refs",
	screenshot: "screenshot_media",
	emulate: "viewport_emulation",
} as const satisfies Record<BrowserOperationClass, AdapterCapability>;

export function authorizesOperationClass(
	// Structural parameter: any binding that carries an authorized capability
	// set satisfies it — the dormant Router-era RouteBinding and the
	// handoff-derived operation binding (migration U1) both do.
	binding: { authorized_capabilities: readonly AdapterCapability[] },
	operationClass: BrowserOperationClass,
): boolean {
	const required = OPERATION_CLASS_CAPABILITY[operationClass];
	return binding.authorized_capabilities.includes(required);
}
