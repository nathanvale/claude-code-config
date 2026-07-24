import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_LANE_AUTH_METHODS,
	BROWSER_USE_LANE_EVIDENCE_CLASSES,
	BROWSER_USE_LANE_EVIDENCE_PRODUCERS,
	BROWSER_USE_REJECTED_LANE_ALIASES,
	type BrowserUseLaneEvidenceReference,
	laneEvidenceDigestOf,
	transportAdapterIdsFromLaneTable,
} from "./browser-use-adapter-model";
import {
	createAdapterLaneRegistry,
	resolveAdapterLane,
} from "./browser-use-adapter-registry";
import {
	BROWSER_CONNECT_HANDOFF_CONTRACT_ID,
	BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
	BROWSER_USE_TRANSPORT_ADAPTERS,
} from "./command-contract";
import { BROWSER_USE_LIVE_ADAPTERS } from "./discovery-model";

// ---------------------------------------------------------------------------
// Auth plan 2026-07-21-003 U1 (R1-R6, R27; AE1): the Browser Use Adapter Lane
// Registry composes Browser Connect connection evidence, lane task evidence,
// and auth conformance evidence by immutable digest, keyed on the exact
// handoff attachment.adapter_id. Unknown ids, identity aliases, duplicate
// producers, stale/missing evidence, drift, and unknown claims all fail
// closed.
// ---------------------------------------------------------------------------

const NOW = 1_800_000_000_000;
const FRESH_MS = 24 * 60 * 60 * 1000;

const INTEGRITY = {
	executable_realpath: "/opt/side-quest/fixture/adapter-bin",
	content_digest: "sha256:fixture-content-digest",
	dependency_lock_identity: "lock:fixture-1",
	protocol_fingerprint: "protocol:fixture-1",
	platform: "darwin-arm64",
	security_policy_revision: "policy-1",
} as const;

function evidenceRef(
	overrides: Partial<BrowserUseLaneEvidenceReference> & {
		omitDigest?: boolean;
	} = {},
): BrowserUseLaneEvidenceReference {
	const { omitDigest, ...rest } = overrides;
	const base = {
		lane_id: "chrome-devtools-mcp",
		evidence_class: "task",
		producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS.task,
		claims: ["snapshot_refs"],
		integrity: INTEGRITY,
		probed_at_epoch_ms: NOW - 1000,
		stale_after_ms: FRESH_MS,
		...rest,
	} as Omit<BrowserUseLaneEvidenceReference, "evidence_digest">;
	if (omitDigest) {
		return base as BrowserUseLaneEvidenceReference;
	}
	return { ...base, evidence_digest: laneEvidenceDigestOf(base) };
}

function registryOf(evidence: readonly BrowserUseLaneEvidenceReference[]) {
	const result = createAdapterLaneRegistry({
		evidence,
		at_epoch_ms: NOW,
	});
	if (!result.ok) {
		throw new Error(`expected registry, got rejection ${result.rejection.code}`);
	}
	return result.registry;
}

function laneOf(
	registry: ReturnType<typeof registryOf>,
	laneId: string,
) {
	const resolved = resolveAdapterLane(registry, laneId);
	if (!resolved.ok) {
		throw new Error(`expected lane ${laneId}, got ${resolved.failure.code}`);
	}
	return resolved.lane;
}

describe("lane identity (R3)", () => {
	test("registry completeness: exactly one lane per live adapter id, in order", () => {
		const registry = registryOf([]);
		expect(registry.lanes.map((lane) => lane.lane_id)).toEqual([
			...BROWSER_USE_ADAPTER_LANE_IDS,
		]);
		// The live adapter vocabulary and the lane registry are the same axis —
		// one owner, no second identity table.
		expect([...BROWSER_USE_LIVE_ADAPTERS]).toEqual([
			...BROWSER_USE_ADAPTER_LANE_IDS,
		]);
	});

	test("every public lane maps to one handoff and one native Implementation slot", () => {
		const registry = registryOf([]);
		for (const lane of registry.lanes) {
			expect(lane.handoff.contract_id).toBe(BROWSER_CONNECT_HANDOFF_CONTRACT_ID);
			expect(lane.handoff.schema_version).toBe(
				BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
			);
			if (lane.native_implementation.implemented) {
				expect(lane.native_implementation.execution_interface).not.toBe("");
			} else {
				expect(lane.native_implementation.unavailable_reason).not.toBe("");
				expect(lane.native_implementation.next_repair_action).not.toBe("");
			}
		}
	});

	test("lane-specific execution Interfaces: the mcporter envelope call is registered for chrome-devtools-mcp only", () => {
		const registry = registryOf([]);
		const implemented = registry.lanes.filter(
			(lane) => lane.native_implementation.implemented,
		);
		expect(implemented.map((lane) => lane.lane_id)).toEqual([
			"chrome-devtools-mcp",
		]);
		const lane = laneOf(registry, "chrome-devtools-mcp");
		expect(
			lane.native_implementation.implemented &&
				lane.native_implementation.execution_interface,
		).toBe("mcporter-envelope-call");
	});

	test("the public transport table derives from the lane table — no second copy", () => {
		expect<readonly string[]>([...BROWSER_USE_TRANSPORT_ADAPTERS]).toEqual(
			transportAdapterIdsFromLaneTable(),
		);
	});

	test("unknown id fails closed", () => {
		const registry = registryOf([]);
		const resolved = resolveAdapterLane(registry, "made-up-adapter");
		expect(resolved.ok).toBe(false);
		if (!resolved.ok) {
			expect(resolved.failure.code).toBe("lane_unknown");
		}
	});

	test.each(Object.keys(BROWSER_USE_REJECTED_LANE_ALIASES))(
		"identity alias %s is rejected, never silently mapped",
		(alias) => {
			const registry = registryOf([]);
			const resolved = resolveAdapterLane(registry, alias);
			expect(resolved.ok).toBe(false);
			if (!resolved.ok) {
				expect(resolved.failure.code).toBe("lane_alias_rejected");
				expect(resolved.failure.message).toContain("attachment.adapter_id");
			}
		},
	);
});

describe("evidence composition (R3/R4)", () => {
	test("missing evidence is honest unproven, never a claim", () => {
		const registry = registryOf([]);
		for (const lane of registry.lanes) {
			for (const evidenceClass of BROWSER_USE_LANE_EVIDENCE_CLASSES) {
				expect(lane.evidence[evidenceClass].status).toBe("unproven");
			}
			expect(lane.proven_task_claims).toEqual([]);
			expect(lane.advertised_auth_methods).toEqual([]);
		}
	});

	test("fresh valid task evidence proves exactly its claims", () => {
		const registry = registryOf([evidenceRef()]);
		const lane = laneOf(registry, "chrome-devtools-mcp");
		expect(lane.evidence.task.status).toBe("proven");
		expect(lane.proven_task_claims).toEqual(["snapshot_refs"]);
		// Other lanes stay untouched — no cross-lane substitution.
		expect(laneOf(registry, "agent-browser").proven_task_claims).toEqual([]);
	});

	test("composition is deterministic: same evidence, same digests", () => {
		const a = registryOf([evidenceRef()]);
		const b = registryOf([evidenceRef()]);
		expect(a.composed_digest).toBe(b.composed_digest);
		expect(laneOf(a, "chrome-devtools-mcp").lane_evidence_digest).toBe(
			laneOf(b, "chrome-devtools-mcp").lane_evidence_digest,
		);
		// Evidence changes the composition.
		const c = registryOf([
			evidenceRef({ integrity: { ...INTEGRITY, content_digest: "sha256:other" } }),
		]);
		expect(c.composed_digest).not.toBe(a.composed_digest);
	});

	test("stale evidence fails closed (R4)", () => {
		const registry = registryOf([
			evidenceRef({
				probed_at_epoch_ms: NOW - FRESH_MS - 1,
				stale_after_ms: FRESH_MS,
			}),
		]);
		const lane = laneOf(registry, "chrome-devtools-mcp");
		expect(lane.evidence.task.status).toBe("stale");
		expect(lane.proven_task_claims).toEqual([]);
		expect(lane.next_repair_action).toBeDefined();
	});

	test("duplicate producer for one claim class is rejected (one producer per claim)", () => {
		const result = createAdapterLaneRegistry({
			evidence: [evidenceRef(), evidenceRef({ claims: ["screenshot_media"] })],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_duplicate_producer");
		}
	});

	test("a producer cannot publish another producer's evidence class", () => {
		const result = createAdapterLaneRegistry({
			evidence: [
				evidenceRef({ producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS.connection }),
			],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_producer_mismatch");
		}
	});

	test("an unknown claim fails closed (R4)", () => {
		const result = createAdapterLaneRegistry({
			evidence: [evidenceRef({ claims: ["invent-a-capability"] })],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_claim_unknown");
		}
	});

	test("auth conformance claims validate against the auth method vocabulary", () => {
		const ok = createAdapterLaneRegistry({
			evidence: [
				evidenceRef({
					evidence_class: "auth-conformance",
					producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
					claims: [BROWSER_USE_LANE_AUTH_METHODS[0]],
				}),
			],
			at_epoch_ms: NOW,
		});
		expect(ok.ok).toBe(true);
		const bad = createAdapterLaneRegistry({
			evidence: [
				evidenceRef({
					evidence_class: "auth-conformance",
					producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
					claims: ["snapshot_refs"],
				}),
			],
			at_epoch_ms: NOW,
		});
		expect(bad.ok).toBe(false);
	});

	test("auth methods are advertised only from proven auth conformance evidence", () => {
		const registry = registryOf([
			evidenceRef({
				evidence_class: "auth-conformance",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
				claims: ["session-reuse"],
			}),
		]);
		expect(
			laneOf(registry, "chrome-devtools-mcp").advertised_auth_methods,
		).toEqual(["session-reuse"]);
		// Stale conformance advertises nothing.
		const stale = registryOf([
			evidenceRef({
				evidence_class: "auth-conformance",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
				claims: ["session-reuse"],
				probed_at_epoch_ms: NOW - FRESH_MS - 1,
			}),
		]);
		expect(
			laneOf(stale, "chrome-devtools-mcp").advertised_auth_methods,
		).toEqual([]);
	});
});

describe("integrity binding (R4)", () => {
	test("same-version replacement: integrity disagreement across a lane's evidence drifts the lane and fails claims closed", () => {
		const registry = registryOf([
			evidenceRef(),
			evidenceRef({
				evidence_class: "connection",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS.connection,
				claims: [],
				integrity: { ...INTEGRITY, content_digest: "sha256:replaced-binary" },
			}),
		]);
		const lane = laneOf(registry, "chrome-devtools-mcp");
		expect(lane.integrity_state).toBe("drifted");
		expect(lane.proven_task_claims).toEqual([]);
		expect(lane.next_repair_action).toBeDefined();
	});

	test.each([
		["dependency_lock_identity", "lock:changed"],
		["protocol_fingerprint", "protocol:changed"],
		["security_policy_revision", "policy-changed"],
	] as const)("%s drift also drifts the lane", (field, value) => {
		const registry = registryOf([
			evidenceRef(),
			evidenceRef({
				evidence_class: "connection",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS.connection,
				claims: [],
				integrity: { ...INTEGRITY, [field]: value },
			}),
		]);
		expect(laneOf(registry, "chrome-devtools-mcp").integrity_state).toBe(
			"drifted",
		);
	});

	test("an edited evidence reference is rejected: the digest is recomputed, not trusted", () => {
		const tampered = {
			...evidenceRef(),
			claims: ["screenshot_media"],
		};
		const result = createAdapterLaneRegistry({
			evidence: [tampered as BrowserUseLaneEvidenceReference],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_digest_invalid");
		}
	});

	test("a producer cannot extend the registry schema", () => {
		const extended = {
			...evidenceRef(),
			extra_registry_field: "smuggled",
		};
		const result = createAdapterLaneRegistry({
			evidence: [extended as unknown as BrowserUseLaneEvidenceReference],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_schema_extended");
		}
	});

	test("evidence for an unknown lane id is rejected", () => {
		const result = createAdapterLaneRegistry({
			evidence: [
				evidenceRef({
					lane_id: "made-up-adapter" as BrowserUseLaneEvidenceReference["lane_id"],
				}),
			],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_lane_unknown");
		}
	});
});
