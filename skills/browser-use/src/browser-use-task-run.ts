// ---------------------------------------------------------------------------
// Wave-2 task run routing engine (release contract R6-R11, R23; flows F1, F7).
//
// The PURE routing core of the `browser-use task run` front door: given a Task
// Intent, the composed Adapter Lane Registry, an optional explicit lane
// override, and the adapter the Verified Handoff Envelope attached, it selects
// exactly one admissible lane or returns one typed refusal. No I/O, no clock,
// no browser call — the driver (browser-use.ts) owns store writes, handoff
// reads, and live dispatch; this module owns the routing decision so it stays
// unit-testable and the driver stays thin (agent-native seam discipline).
//
// R6: selection weighs requested outcome (the intent's preferred lane), required
// capabilities, implementation integrity, and lane evidence.
// R10: an explicit override STILL passes the same capability + evidence +
// integrity admission; an inadmissible route fails with a repair action.
// R11: no implicit adapter switch — a handoff that names a different adapter
// than the selected lane fails closed rather than substituting a lane.
// ---------------------------------------------------------------------------

import type {
	BrowserUseAdapterLaneRegistry,
	BrowserUseAdapterLaneView,
} from "./browser-use-adapter-registry";
import { resolveAdapterLane } from "./browser-use-adapter-registry";
import type { BrowserAdapterId } from "./discovery-model";
import {
	type BrowserUseTaskIntent,
	type BrowserUseTaskIntentDefinition,
	BROWSER_USE_TASK_INTENT_DEFINITIONS,
} from "./browser-use-run-model";

// --- Intent -> required capability policy (R6, R8, R9) -----------------------

/**
 * The operation-capability an intent requires of its lane (R6 "required
 * capabilities"). Drawn from the public capability vocabulary the lane table
 * exposes. The debug/performance-profile/lighthouse-audit intents now bind to
 * the chrome-devtools-mcp lane's proven read-only debugging/performance
 * capabilities, so R6 admission checks the lane actually covers them.
 */
export const BROWSER_USE_TASK_INTENT_REQUIRED_CAPABILITY: Readonly<
	Partial<Record<BrowserUseTaskIntent, string>>
> = {
	"routine-automation": "element_actions",
	"runbook-execution": "element_actions",
	scrape: "snapshot_refs",
	"frontend-test": "selector_actions",
	"locator-aria-assertion": "selector_actions",
	"trace-inspection": "network_inspection",
	"http-replay": "network_inspection",
	debug: "console_debug",
	"performance-profile": "performance_profile",
	"lighthouse-audit": "devtools_performance_insight",
};

// --- Typed refusals ----------------------------------------------------------

/** Stable routing refusal codes (release contract R6-R11). Each maps to one
 *  driver diagnostic code + continuation; the driver never invents a recovery. */
export type TaskRunRoutingRefusalCode =
	| "intent_unknown"
	| "intent_unrouted"
	| "lane_override_inadmissible"
	| "no_admissible_lane"
	| "handoff_lane_mismatch"
	| "lane_not_installed";

/** One typed routing refusal: the code, a redaction-safe reason, and the exact
 *  lane the refusal concerns (when one is resolved). */
export type TaskRunRoutingRefusal = {
	code: TaskRunRoutingRefusalCode;
	message: string;
	/** The lane the refusal is about, when a candidate was resolved. */
	lane_id?: BrowserAdapterId;
};

/**
 * A resolved, admissible route: the selected lane, whether it came from an
 * explicit override (R10) or the intent's preferred lane (R6), and the lane
 * view so the driver dispatches against proven identity without re-resolving.
 */
export type TaskRunRoute = {
	lane_id: BrowserAdapterId;
	source: "intent-preferred" | "explicit-override";
	lane: BrowserUseAdapterLaneView;
	intent: BrowserUseTaskIntent;
	required_capability?: string;
};

export type TaskRunRoutingResult =
	| { ok: true; route: TaskRunRoute }
	| { ok: false; refusal: TaskRunRoutingRefusal };

// --- Routing (R6, R10, R11) --------------------------------------------------

function definitionFor(
	intent: BrowserUseTaskIntent,
): BrowserUseTaskIntentDefinition | undefined {
	return BROWSER_USE_TASK_INTENT_DEFINITIONS.find(
		(entry) => entry.task_intent === intent,
	);
}

/**
 * Select one admissible lane for a Task Intent (release contract R6-R11).
 *
 * Decision order:
 *  1. The intent must be a code-owned Task Intent (`intent_unknown`).
 *  2. An explicit `laneOverride` resolves against the registry and STILL passes
 *     admission (R10): an unknown/aliased id or an inadmissible lane refuses
 *     with a repair action — never silently swapped for the preferred lane.
 *  3. With no override, the intent's preferred lane is used (R6); an intent with
 *     no registered preferred lane is `intent_unrouted` (honest unavailability).
 *  4. The selected lane must be able to consume the handoff's adapter (R11):
 *     a mismatch is `handoff_lane_mismatch`, never a substitution.
 *  5. A registered-but-not-installed lane (no native Implementation) surfaces as
 *     `lane_not_installed` so the driver emits the adapter-install continuation.
 *
 * @param input - intent, registry, handoff adapter, and optional lane override
 * @returns The admissible route, or one typed refusal
 */
export function routeTaskRun(input: {
	intent: BrowserUseTaskIntent;
	registry: BrowserUseAdapterLaneRegistry;
	handoffAdapter: BrowserAdapterId;
	laneOverride?: string;
	capabilityCovers: (
		lane: BrowserUseAdapterLaneView,
		capability: string,
	) => boolean;
}): TaskRunRoutingResult {
	const { intent, registry, handoffAdapter, laneOverride } = input;
	const definition = definitionFor(intent);
	if (definition === undefined) {
		return {
			ok: false,
			refusal: {
				code: "intent_unknown",
				message: `intent ${intent} is not a code-owned Task Intent.`,
			},
		};
	}
	const requiredCapability = BROWSER_USE_TASK_INTENT_REQUIRED_CAPABILITY[intent];

	// Resolve the candidate lane: override wins but is never a free pass (R10).
	let candidate: BrowserUseAdapterLaneView;
	let source: TaskRunRoute["source"];
	if (laneOverride !== undefined) {
		const resolved = resolveAdapterLane(registry, laneOverride);
		if (!resolved.ok) {
			return {
				ok: false,
				refusal: {
					code: "lane_override_inadmissible",
					message: `lane override rejected: ${resolved.failure.message}`,
				},
			};
		}
		candidate = resolved.lane;
		source = "explicit-override";
	} else {
		const preferred = definition.preferred_adapter;
		if (preferred === undefined) {
			return {
				ok: false,
				refusal: {
					code: "intent_unrouted",
					message: `intent ${intent} has no registered lane yet; its specialist lane is not implemented.`,
				},
			};
		}
		const resolved = resolveAdapterLane(registry, preferred);
		if (!resolved.ok) {
			// A preferred lane that cannot resolve is a programming error in the
			// lane table, surfaced as unrouted rather than a crash.
			return {
				ok: false,
				refusal: {
					code: "intent_unrouted",
					message: `intent ${intent} preferred lane ${preferred} is not registered: ${resolved.failure.message}`,
				},
			};
		}
		candidate = resolved.lane;
		source = "intent-preferred";
	}

	// A registered lane with no native execution Interface is not installed on
	// this host (playwright-cdp): typed adapter-install continuation, never a
	// substitution (R10, AE3).
	if (!candidate.native_implementation.implemented) {
		return {
			ok: false,
			refusal: {
				code: "lane_not_installed",
				message: candidate.native_implementation.unavailable_reason,
				lane_id: candidate.lane_id,
			},
		};
	}

	// R6 admission: capability + evidence + integrity. Applied identically to an
	// override (R10) and the preferred lane.
	const reason = inadmissibleReasonOf(
		candidate,
		requiredCapability,
		input.capabilityCovers,
	);
	if (reason !== undefined) {
		return {
			ok: false,
			refusal: {
				code:
					source === "explicit-override"
						? "lane_override_inadmissible"
						: "no_admissible_lane",
				message: reason,
				lane_id: candidate.lane_id,
			},
		};
	}

	// R11: the selected lane must consume the verified handoff's adapter. A
	// mismatch NEVER substitutes — browser-use refuses so the caller mints a
	// matching handoff (or corrects the override).
	if (candidate.lane_id !== handoffAdapter) {
		return {
			ok: false,
			refusal: {
				code: "handoff_lane_mismatch",
				message: `the verified handoff attached adapter ${handoffAdapter} but the selected lane is ${candidate.lane_id}; browser-use never substitutes a lane.`,
				lane_id: candidate.lane_id,
			},
		};
	}

	return {
		ok: true,
		route: {
			lane_id: candidate.lane_id,
			source,
			lane: candidate,
			intent,
			...(requiredCapability !== undefined
				? { required_capability: requiredCapability }
				: {}),
		},
	};
}

/**
 * R6 admission reason for a candidate lane (implemented, consistent integrity,
 * fresh evidence, capability coverage). Split from routeTaskRun so the same
 * gate is applied to an override and the preferred lane verbatim (R10).
 *
 * @returns undefined when admissible; a typed reason otherwise
 */
function inadmissibleReasonOf(
	lane: BrowserUseAdapterLaneView,
	requiredCapability: string | undefined,
	capabilityCovers: (
		lane: BrowserUseAdapterLaneView,
		capability: string,
	) => boolean,
): string | undefined {
	if (!lane.native_implementation.implemented) {
		return lane.native_implementation.unavailable_reason;
	}
	if (lane.integrity_state === "drifted") {
		return "the lane's evidence integrity identities disagree; re-probe the pinned adapter build before routing.";
	}
	if (
		lane.evidence.connection.status === "stale" ||
		lane.evidence.task.status === "stale"
	) {
		return "the lane's connection or task evidence is stale; re-run its conformance probe before routing.";
	}
	if (
		requiredCapability !== undefined &&
		!capabilityCovers(lane, requiredCapability)
	) {
		return `the lane does not cover the required capability ${requiredCapability} for this intent.`;
	}
	return undefined;
}
