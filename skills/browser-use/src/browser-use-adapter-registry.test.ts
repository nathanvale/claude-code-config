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
	adapterLaneViewDigestOf,
	BROWSER_USE_LANE_EVIDENCE_MAX_STALE_AFTER_MS,
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

	test("lane-specific execution Interfaces: chrome-devtools-mcp and agent-browser each register their own native call", () => {
		const registry = registryOf([]);
		const implemented = registry.lanes.filter(
			(lane) => lane.native_implementation.implemented,
		);
		expect(implemented.map((lane) => lane.lane_id)).toEqual([
			"chrome-devtools-mcp",
			"agent-browser",
		]);
		const chrome = laneOf(registry, "chrome-devtools-mcp");
		expect(
			chrome.native_implementation.implemented &&
				chrome.native_implementation.execution_interface,
		).toBe("mcporter-envelope-call");
		const agentBrowser = laneOf(registry, "agent-browser");
		expect(
			agentBrowser.native_implementation.implemented &&
				agentBrowser.native_implementation.execution_interface,
		).toBe("agent-browser-native-call");
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

	test.each(["toString", "constructor", "__proto__", "hasOwnProperty"])(
		"prototype-chain id %s resolves as unknown, not an inherited alias",
		(id) => {
			const registry = registryOf([]);
			const resolved = resolveAdapterLane(registry, id);
			expect(resolved.ok).toBe(false);
			if (!resolved.ok) {
				expect(resolved.failure.code).toBe("lane_unknown");
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

	test("digests bind the composed view: identical evidence fresh vs stale differs", () => {
		const reference = evidenceRef();
		const fresh = createAdapterLaneRegistry({
			evidence: [reference],
			at_epoch_ms: NOW,
		});
		const stale = createAdapterLaneRegistry({
			evidence: [reference],
			at_epoch_ms: NOW + FRESH_MS + 1,
		});
		if (!fresh.ok || !stale.ok) throw new Error("expected registries");
		expect(fresh.registry.composed_digest).not.toBe(
			stale.registry.composed_digest,
		);
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
		["executable_realpath", "/opt/side-quest/other-bin"],
		["dependency_lock_identity", "lock:changed"],
		["protocol_fingerprint", "protocol:changed"],
		["platform", "linux-x64"],
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

	test("a producer cannot smuggle fields through the nested integrity object", () => {
		const base = evidenceRef();
		const smuggled = {
			...base,
			integrity: { ...base.integrity, smuggled_field: "outside-the-digest" },
		};
		const result = createAdapterLaneRegistry({
			evidence: [smuggled as unknown as BrowserUseLaneEvidenceReference],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_schema_extended");
		}
	});

	test.each([
		["future-dated probe", { probed_at_epoch_ms: NOW + 1 }],
		["NaN probe time", { probed_at_epoch_ms: Number.NaN }],
		["Infinity staleness window", { stale_after_ms: Number.POSITIVE_INFINITY }],
		["NaN staleness window", { stale_after_ms: Number.NaN }],
		["zero staleness window", { stale_after_ms: 0 }],
		["negative staleness window", { stale_after_ms: -1 }],
	] as const)("%s is rejected at admission, never pinned proven", (_label, overrides) => {
		const base = evidenceRef();
		const pathological = {
			...base,
			...overrides,
		} as BrowserUseLaneEvidenceReference;
		const result = createAdapterLaneRegistry({
			evidence: [
				{
					...pathological,
					evidence_digest: laneEvidenceDigestOf(pathological),
				},
			],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_freshness_invalid");
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

describe("exact-shape admission (R3/R4, finding #2)", () => {
	function rejectionCodeOf(
		evidence: readonly BrowserUseLaneEvidenceReference[],
		atEpochMs = NOW,
	): string {
		const result = createAdapterLaneRegistry({
			evidence,
			at_epoch_ms: atEpochMs,
		});
		if (result.ok) throw new Error("expected a rejection, got a registry");
		return result.rejection.code;
	}

	test.each(
		["lane_id", "evidence_class", "producer", "claims", "integrity", "probed_at_epoch_ms", "stale_after_ms", "evidence_digest"] as const,
	)("a reference missing %s is rejected as incomplete, never admitted", (key) => {
		const { [key]: _omitted, ...partial } = evidenceRef();
		expect(
			rejectionCodeOf([partial as BrowserUseLaneEvidenceReference]),
		).toBe("lane_evidence_schema_incomplete");
	});

	test("reviewer reproduction: a missing integrity key never hashes as null and passes", () => {
		// The digest is recomputed over the SAME malformed shape, so the digest
		// check alone cannot catch this — exact-shape admission must.
		const { content_digest: _omitted, ...partialIntegrity } = INTEGRITY;
		const malformed = {
			...evidenceRef({ omitDigest: true }),
			integrity: partialIntegrity,
		};
		const reference = {
			...malformed,
			evidence_digest: laneEvidenceDigestOf(
				malformed as unknown as BrowserUseLaneEvidenceReference,
			),
		};
		expect(
			rejectionCodeOf([reference as unknown as BrowserUseLaneEvidenceReference]),
		).toBe("lane_evidence_schema_incomplete");
	});

	test.each([
		["null", null],
		["array", []],
		["string", "not-an-object"],
	] as const)("integrity as %s is rejected as incomplete", (_label, integrity) => {
		const reference = { ...evidenceRef(), integrity };
		expect(
			rejectionCodeOf([reference as unknown as BrowserUseLaneEvidenceReference]),
		).toBe("lane_evidence_schema_incomplete");
	});

	test.each([
		["empty string", ""],
		["non-string", 42],
	] as const)(
		"an integrity identity fact as %s is rejected as incomplete",
		(_label, value) => {
			const reference = {
				...evidenceRef(),
				integrity: { ...INTEGRITY, content_digest: value },
			};
			expect(
				rejectionCodeOf([
					reference as unknown as BrowserUseLaneEvidenceReference,
				]),
			).toBe("lane_evidence_schema_incomplete");
		},
	);

	test.each([
		["null", null],
		["array", []],
		["string", "not-an-object"],
		["number", 7],
	] as const)(
		"a %s evidence reference is a typed rejection, never an uncaught crash",
		(_label, reference) => {
			expect(
				rejectionCodeOf([
					reference as unknown as BrowserUseLaneEvidenceReference,
				]),
			).toBe("lane_evidence_schema_incomplete");
		},
	);

	test.each([
		["lane_id", 7],
		["evidence_class", 42],
		["producer", 1],
		["evidence_digest", 9],
	] as const)(
		"a non-string %s rejects as incomplete instead of crashing the rejection path",
		(key, value) => {
			const reference = { ...evidenceRef(), [key]: value };
			expect(
				rejectionCodeOf([
					reference as unknown as BrowserUseLaneEvidenceReference,
				]),
			).toBe("lane_evidence_schema_incomplete");
		},
	);

	test.each([
		["null claims", null],
		["string claims", "snapshot_refs"],
		["non-string claim entry", [42]],
		["empty-string claim entry", [""]],
		["duplicate claim entries", ["snapshot_refs", "snapshot_refs"]],
	] as const)("%s reject as incomplete, never crash or admit", (_label, claims) => {
		const reference = { ...evidenceRef(), claims };
		expect(
			rejectionCodeOf([
				reference as unknown as BrowserUseLaneEvidenceReference,
			]),
		).toBe("lane_evidence_schema_incomplete");
	});

	test("an unknown evidence class fails as unknown before producer lookup", () => {
		// Pre-fix, an unknown class rode an undefined-vs-undefined producer
		// comparison straight past admission.
		const reference = evidenceRef({
			evidence_class:
				"made-up-class" as BrowserUseLaneEvidenceReference["evidence_class"],
			producer: "made-up-producer",
		});
		expect(rejectionCodeOf([reference])).toBe("lane_evidence_class_unknown");
	});
});

describe("clock and TTL validation (R4, finding #3)", () => {
	test.each([
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
		["negative", -1],
		["non-integer", NOW + 0.5],
	] as const)(
		"an invalid %s evaluation clock composes nothing, even for expired evidence",
		(_label, clock) => {
			// Reviewer reproduction: expired evidence + NaN clock read as proven
			// pre-fix. An invalid clock is now a typed rejection.
			const result = createAdapterLaneRegistry({
				evidence: [
					evidenceRef({
						probed_at_epoch_ms: NOW - FRESH_MS - 1,
						stale_after_ms: FRESH_MS,
					}),
				],
				at_epoch_ms: clock,
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.rejection.code).toBe("lane_registry_clock_invalid");
			}
		},
	);

	test("a staleness window above the code-owned TTL ceiling is rejected", () => {
		const result = createAdapterLaneRegistry({
			evidence: [
				evidenceRef({
					stale_after_ms: BROWSER_USE_LANE_EVIDENCE_MAX_STALE_AFTER_MS + 1,
				}),
			],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_freshness_invalid");
		}
	});

	test("a staleness window at the TTL ceiling still admits", () => {
		const result = createAdapterLaneRegistry({
			evidence: [
				evidenceRef({
					stale_after_ms: BROWSER_USE_LANE_EVIDENCE_MAX_STALE_AFTER_MS,
				}),
			],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(true);
	});

	test("an expiry overflowing the safe-integer range is rejected", () => {
		const result = createAdapterLaneRegistry({
			evidence: [
				evidenceRef({
					probed_at_epoch_ms: Number.MAX_SAFE_INTEGER - 1000,
					stale_after_ms: FRESH_MS,
				}),
			],
			at_epoch_ms: Number.MAX_SAFE_INTEGER,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_freshness_invalid");
		}
	});

	test.each([
		["negative probe time", { probed_at_epoch_ms: -1 }],
		["non-integer probe time", { probed_at_epoch_ms: NOW - 1000.5 }],
		["non-integer staleness window", { stale_after_ms: 1000.5 }],
	] as const)("%s is rejected at admission", (_label, overrides) => {
		const base = { ...evidenceRef({ omitDigest: true }), ...overrides };
		const result = createAdapterLaneRegistry({
			evidence: [
				{
					...base,
					evidence_digest: laneEvidenceDigestOf(base),
				} as BrowserUseLaneEvidenceReference,
			],
			at_epoch_ms: NOW,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("lane_evidence_freshness_invalid");
		}
	});
});

describe("rejection repair actions (R27, finding #5)", () => {
	const scenarios: ReadonlyArray<{
		code: string;
		compose: () => ReturnType<typeof createAdapterLaneRegistry>;
	}> = [
		{
			code: "lane_evidence_schema_extended",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [
						{
							...evidenceRef(),
							smuggled: "field",
						} as unknown as BrowserUseLaneEvidenceReference,
					],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_evidence_schema_incomplete",
			compose: () => {
				const { producer: _omitted, ...partial } = evidenceRef();
				return createAdapterLaneRegistry({
					evidence: [partial as BrowserUseLaneEvidenceReference],
					at_epoch_ms: NOW,
				});
			},
		},
		{
			code: "lane_evidence_lane_unknown",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [
						evidenceRef({
							lane_id:
								"made-up-adapter" as BrowserUseLaneEvidenceReference["lane_id"],
						}),
					],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_evidence_class_unknown",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [
						evidenceRef({
							evidence_class:
								"made-up-class" as BrowserUseLaneEvidenceReference["evidence_class"],
						}),
					],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_evidence_producer_mismatch",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [
						evidenceRef({
							producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS.connection,
						}),
					],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_evidence_claim_unknown",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [evidenceRef({ claims: ["invent-a-capability"] })],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_evidence_freshness_invalid",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [evidenceRef({ probed_at_epoch_ms: NOW + 1 })],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_evidence_digest_invalid",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [
						{
							...evidenceRef(),
							claims: ["screenshot_media"],
						} as BrowserUseLaneEvidenceReference,
					],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_evidence_duplicate_producer",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [evidenceRef(), evidenceRef()],
					at_epoch_ms: NOW,
				}),
		},
		{
			code: "lane_registry_clock_invalid",
			compose: () =>
				createAdapterLaneRegistry({
					evidence: [],
					at_epoch_ms: Number.NaN,
				}),
		},
	];

	test.each(scenarios.map((scenario) => [scenario.code, scenario] as const))(
		"%s carries exactly one deterministic machine-readable repair action",
		(_code, scenario) => {
			const first = scenario.compose();
			const second = scenario.compose();
			expect(first.ok).toBe(false);
			expect(second.ok).toBe(false);
			if (!first.ok && !second.ok) {
				expect(first.rejection.code).toBe(
					scenario.code as typeof first.rejection.code,
				);
				expect(typeof first.rejection.next_repair_action).toBe("string");
				expect(first.rejection.next_repair_action.length).toBeGreaterThan(0);
				// Deterministic: the same rejection always names the same repair.
				expect(first.rejection.next_repair_action).toBe(
					second.rejection.next_repair_action,
				);
			}
		},
	);
});

describe("auth methods gate on a usable lane (R5, finding #1)", () => {
	test("proven conformance on an unimplemented lane advertises nothing", () => {
		const registry = registryOf([
			evidenceRef({
				lane_id: "playwright-cdp",
				evidence_class: "auth-conformance",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
				claims: ["password", "otp"],
			}),
		]);
		const lane = laneOf(registry, "playwright-cdp");
		// Evidence stays honest proven; the ADVERTISED capability is what gates.
		expect(lane.evidence["auth-conformance"].status).toBe("proven");
		expect(lane.native_implementation.implemented).toBe(false);
		expect(lane.advertised_auth_methods).toEqual([]);
	});

	test("the same proven conformance on an implemented lane advertises its methods", () => {
		const registry = registryOf([
			evidenceRef({
				lane_id: "chrome-devtools-mcp",
				evidence_class: "auth-conformance",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
				claims: ["password", "otp"],
			}),
		]);
		expect(
			laneOf(registry, "chrome-devtools-mcp").advertised_auth_methods,
		).toEqual(["password", "otp"]);
	});
});

describe("material lane view digest (finding #4)", () => {
	function materialViewOf(laneId: string) {
		const { lane_evidence_digest: _digest, ...view } = laneOf(
			registryOf([]),
			laneId,
		);
		return view;
	}

	test("the published lane digest is the digest of the complete material view", () => {
		const registry = registryOf([evidenceRef()]);
		for (const lane of registry.lanes) {
			const { lane_evidence_digest, ...view } = lane;
			expect(adapterLaneViewDigestOf(view)).toBe(lane_evidence_digest);
		}
	});

	test("a handoff pin change changes the digest", () => {
		const view = materialViewOf("chrome-devtools-mcp");
		const repinned = {
			...view,
			handoff: { ...view.handoff, schema_version: "3" },
		};
		expect(adapterLaneViewDigestOf(repinned)).not.toBe(
			adapterLaneViewDigestOf(view),
		);
	});

	test("a native Implementation change changes the digest", () => {
		const view = materialViewOf("chrome-devtools-mcp");
		const unimplemented = {
			...view,
			native_implementation: {
				implemented: false as const,
				unavailable_reason: "revoked",
				next_repair_action: "re-register the lane Implementation",
			},
		};
		expect(adapterLaneViewDigestOf(unimplemented)).not.toBe(
			adapterLaneViewDigestOf(view),
		);
	});

	test("derived claims and repair state change the digest", () => {
		const view = materialViewOf("chrome-devtools-mcp");
		expect(
			adapterLaneViewDigestOf({
				...view,
				advertised_auth_methods: ["session-reuse"],
			}),
		).not.toBe(adapterLaneViewDigestOf(view));
		expect(
			adapterLaneViewDigestOf({
				...view,
				next_repair_action: "re-probe the lane",
			}),
		).not.toBe(adapterLaneViewDigestOf(view));
	});
});
