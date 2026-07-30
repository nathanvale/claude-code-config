import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_LANE_EVIDENCE_CLASSES,
	BROWSER_USE_LANE_EVIDENCE_PRODUCERS,
	BROWSER_USE_REJECTED_LANE_ALIASES,
	type BrowserUseLaneEvidenceReference,
	laneEvidenceDigestOf,
} from "./browser-use-adapter-model";
import {
	type BrowserUseAdapterLaneView,
	createAdapterLaneRegistry,
} from "./browser-use-adapter-registry";
import {
	REAL_VERIFIED_HANDOFF_ENVELOPE,
} from "./browser-connect-handoff-fixtures";
import {
	BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
	BROWSER_USE_ADAPTER_LANES_CONTRACT_ID,
} from "./command-contract";
import { adapterLaneRow, renderAdapterLaneLine, runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// Normalize one plain lane line back into the JSON row shape (finding #7):
// parity is proven by exact deep equality against `adapterLaneRow`, never by
// subset substring checks. Free-text values are JSON-quoted in the line.
function normalizedLaneFromPlainLine(line: string): Record<string, unknown> {
	const laneId = line.slice(0, line.indexOf(" "));
	const fields = new Map<string, string>();
	for (const match of line.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
		const [, key, raw] = match;
		if (key === undefined || raw === undefined) continue;
		fields.set(key, raw.startsWith('"') ? (JSON.parse(raw) as string) : raw);
	}
	const required = (key: string): string => {
		const value = fields.get(key);
		if (value === undefined) throw new Error(`plain line omits ${key}`);
		return value;
	};
	const slotOf = (key: string): Record<string, unknown> => {
		const value = required(key);
		const [status, digest, probed] = value.split("@");
		return digest !== undefined
			? {
					status,
					evidence_digest: digest,
					probed_at_epoch_ms: Number(probed),
				}
			: { status };
	};
	const listOf = (key: string): string[] => {
		const value = required(key);
		return value === "none" ? [] : value.split(",");
	};
	const handoff = required("handoff");
	const separator = handoff.lastIndexOf("@");
	const implementation = required("implementation");
	const repair = fields.get("repair");
	return {
		lane_id: laneId,
		handoff: {
			contract_id: handoff.slice(0, separator),
			schema_version: handoff.slice(separator + 1),
		},
		native_implementation:
			implementation === "unavailable"
				? {
						implemented: false,
						unavailable_reason: required("unavailable_reason"),
						next_repair_action: required("implementation_repair"),
					}
				: { implemented: true, execution_interface: implementation },
		integrity_state: required("integrity"),
		evidence: {
			connection: slotOf("connection"),
			task: slotOf("task"),
			"auth-conformance": slotOf("auth"),
		},
		proven_task_claims: listOf("task_claims"),
		advertised_auth_methods: listOf("auth_methods"),
		lane_evidence_digest: required("digest"),
		...(repair === undefined ? {} : { next_repair_action: repair }),
	};
}

function expectFullPlainParity(lane: BrowserUseAdapterLaneView): void {
	expect(
		normalizedLaneFromPlainLine(renderAdapterLaneLine(lane).trim()),
	).toEqual(adapterLaneRow(lane) as Record<string, unknown>);
}

// =========================================================================
// `lanes list` / `lanes show` (auth plan 2026-07-21-003 U1, R3/R27; AE1).
//
// Live projections of the Adapter Lane Registry composition: exact handoff
// ids, one native Implementation slot per lane, honest unproven evidence, and
// fail-closed unknown/alias resolution through the public surface.
// =========================================================================

describe("lanes list — Adapter Lane Registry projection", () => {
	test("lanes list --json projects every lane with contract identity and honest unproven evidence", async () => {
		const result = await runForTest(["lanes", "list", "--json"], makeRuntime());
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.status).toBe("ok");
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe(BROWSER_USE_ADAPTER_LANES_CONTRACT_ID);
		expect(data.schema_version).toBe("1");
		expect(data.lane_count).toBe(BROWSER_USE_ADAPTER_LANE_IDS.length);
		expect(typeof data.composed_digest).toBe("string");
		const lanes = data.lanes as Array<Record<string, unknown>>;
		expect(lanes.map((lane) => lane.lane_id)).toEqual([
			...BROWSER_USE_ADAPTER_LANE_IDS,
		]);
		for (const lane of lanes) {
			// Every public lane maps to one handoff pin and one native
			// Implementation slot (U1 verification).
			expect(lane.handoff).toMatchObject({
				contract_id: "browser-connect.verified-handoff",
				schema_version: BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
			});
			const implementation = lane.native_implementation as Record<
				string,
				unknown
			>;
			if (implementation.implemented === true) {
				const expectedInterface = {
					"chrome-devtools-mcp": "mcporter-envelope-call",
					"agent-browser": "agent-browser-native-call",
					"playwright-cdp": "playwright-cli-native-call",
				} as const;
				expect(implementation.execution_interface).toBe(
					expectedInterface[
						lane.lane_id as keyof typeof expectedInterface
					],
				);
			} else {
				expect(implementation.unavailable_reason).toBeDefined();
				expect(implementation.next_repair_action).toBeDefined();
			}
			// No CLI evidence producer exists yet: everything is honest unproven,
			// and no auth method is advertised (unsupported stays visible).
			const evidence = lane.evidence as Record<
				string,
				Record<string, unknown>
			>;
			for (const evidenceClass of BROWSER_USE_LANE_EVIDENCE_CLASSES) {
				expect(evidence[evidenceClass]?.status).toBe("unproven");
			}
			expect(lane.proven_task_claims).toEqual([]);
			expect(lane.advertised_auth_methods).toEqual([]);
		}
		const implemented = lanes.filter(
			(lane) =>
				(lane.native_implementation as Record<string, unknown>).implemented ===
				true,
		);
		expect(implemented.map((lane) => lane.lane_id)).toEqual([
			"chrome-devtools-mcp",
			"agent-browser",
			"playwright-cdp",
		]);
	});

	test("lanes list --plain projects the full lane state JSON projects (normalized parity)", async () => {
		const plain = await runForTest(["lanes", "list", "--plain"], makeRuntime());
		expect(plain.exitCode).toBe(0);
		const lines = plain.stdout.trim().split("\n");
		expect(lines).toHaveLength(BROWSER_USE_ADAPTER_LANE_IDS.length + 1);
		expect(lines[0]).toBe(
			`contract=${BROWSER_USE_ADAPTER_LANES_CONTRACT_ID} schema=1 caller=none`,
		);
		const json = parseJson(
			(await runForTest(["lanes", "list", "--json"], makeRuntime())).stdout,
		);
		const rows = (json.data as Record<string, unknown>).lanes as Array<
			Record<string, unknown>
		>;
		for (const [index, laneId] of BROWSER_USE_ADAPTER_LANE_IDS.entries()) {
			const line = lines[index + 1] ?? "";
			expect(line.startsWith(`${laneId} `)).toBe(true);
			// Exact normalized parity (finding #7): the parsed plain line equals
			// the complete JSON row — no subset assertions.
			expect(normalizedLaneFromPlainLine(line)).toEqual(rows[index] ?? {});
		}
	});
});

describe("plain projection covers every composed lane state (finding #7)", () => {
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
		overrides: Partial<BrowserUseLaneEvidenceReference> = {},
	): BrowserUseLaneEvidenceReference {
		const base = {
			lane_id: "chrome-devtools-mcp",
			evidence_class: "task",
			producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS.task,
			claims: ["snapshot_refs"],
			integrity: INTEGRITY,
			probed_at_epoch_ms: NOW - 1000,
			stale_after_ms: FRESH_MS,
			...overrides,
		} as Omit<BrowserUseLaneEvidenceReference, "evidence_digest">;
		return { ...base, evidence_digest: laneEvidenceDigestOf(base) };
	}

	function lanesOf(
		evidence: readonly BrowserUseLaneEvidenceReference[],
		atEpochMs = NOW,
	): readonly BrowserUseAdapterLaneView[] {
		const result = createAdapterLaneRegistry({
			evidence,
			at_epoch_ms: atEpochMs,
		});
		if (!result.ok) throw new Error(`rejection ${result.rejection.code}`);
		return result.registry.lanes;
	}

	test("proven evidence: digest, probe time, and claims all round-trip", () => {
		for (const lane of lanesOf([
			evidenceRef(),
			evidenceRef({
				evidence_class: "auth-conformance",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS["auth-conformance"],
				claims: ["session-reuse", "password"],
			}),
		])) {
			expectFullPlainParity(lane);
		}
	});

	test("stale evidence: status and the lane repair action round-trip", () => {
		for (const lane of lanesOf(
			[evidenceRef()],
			NOW + FRESH_MS + 1,
		)) {
			expectFullPlainParity(lane);
		}
	});

	test("drifted integrity: state and repair action round-trip", () => {
		const lanes = lanesOf([
			evidenceRef(),
			evidenceRef({
				evidence_class: "connection",
				producer: BROWSER_USE_LANE_EVIDENCE_PRODUCERS.connection,
				claims: [],
				integrity: { ...INTEGRITY, content_digest: "sha256:replaced-binary" },
			}),
		]);
		const drifted = lanes.find((lane) => lane.integrity_state === "drifted");
		expect(drifted).toBeDefined();
		for (const lane of lanes) {
			expectFullPlainParity(lane);
		}
	});

	test("unavailable Implementations: reason and repair round-trip quoted", () => {
		for (const lane of lanesOf([])) {
			expectFullPlainParity(lane);
		}
	});
});

describe("lanes show — fail-closed lane resolution (AE1)", () => {
	test("lanes show resolves one lane by its exact handoff adapter id", async () => {
		const result = await runForTest(
			["lanes", "show", "--adapter", "chrome-devtools-mcp", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe(BROWSER_USE_ADAPTER_LANES_CONTRACT_ID);
		expect(data.schema_version).toBe("1");
		const lane = data.lane as Record<string, unknown>;
		expect(lane.lane_id).toBe("chrome-devtools-mcp");
		expect(lane.handoff).toMatchObject({
			contract_id: "browser-connect.verified-handoff",
			schema_version: BROWSER_CONNECT_HANDOFF_SCHEMA_VERSION,
		});
		expect(lane.native_implementation).toMatchObject({
			implemented: true,
			execution_interface: "mcporter-envelope-call",
		});
		expect(lane.proven_task_claims).toEqual([]);
		expect(lane.advertised_auth_methods).toEqual([]);
	});

	test("lanes show --plain projects the resolved lane line", async () => {
		const result = await runForTest(
			["lanes", "show", "--adapter", "chrome-devtools-mcp", "--plain"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		const lines = result.stdout.trim().split("\n");
		expect(lines[0]).toBe(
			`contract=${BROWSER_USE_ADAPTER_LANES_CONTRACT_ID} schema=1 caller=none`,
		);
		expect(lines[1]).toContain("chrome-devtools-mcp");
		expect(lines[1]).toContain("implementation=mcporter-envelope-call");
		expect(lines[1]).toContain("integrity=consistent");
		expect(lines[1]).toContain("task=unproven");
		expect(lines[1]).toContain("auth_methods=none");
	});

	test("a mismatched or unknown adapter id fails before any evidence or secret work", async () => {
		const result = await runForTest(
			["lanes", "show", "--adapter", "made-up-adapter", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "browser_lane_unknown" });
		// Machine-readable recovery (R27): the envelope names the valid ids and
		// exactly one next safe action; no prose parsing required.
		const data = json.data as Record<string, unknown>;
		expect(data.valid_lane_ids).toEqual([...BROWSER_USE_ADAPTER_LANE_IDS]);
		expect(json.continuation).toMatchObject({
			next_action_id: "list_adapter_lanes",
		});
	});

	test.each(["toString", "constructor", "__proto__"])(
		"prototype-chain id %s fails as unknown through the public surface",
		async (id) => {
			const result = await runForTest(
				["lanes", "show", "--adapter", id, "--json"],
				makeRuntime(),
			);
			expect(result.exitCode).toBe(20);
			expect(parseJson(result.stdout).error).toMatchObject({
				code: "browser_lane_unknown",
			});
		},
	);

	test.each(Object.keys(BROWSER_USE_REJECTED_LANE_ALIASES))(
		"identity alias %s is rejected with the exact-id rule, never silently mapped",
		async (alias) => {
			const result = await runForTest(
				["lanes", "show", "--adapter", alias, "--json"],
				makeRuntime(),
			);
			expect(result.exitCode).toBe(20);
			const json = parseJson(result.stdout);
			expect(json.error).toMatchObject({ code: "browser_lane_alias_rejected" });
			expect(JSON.stringify(json.error)).toContain("attachment.adapter_id");
		},
	);

	test("lanes show without --adapter is a usage rejection", async () => {
		const result = await runForTest(["lanes", "show", "--json"], makeRuntime());
		expect(result.exitCode).toBe(2);
	});

	test("lanes show --plain routes the typed failure to stderr", async () => {
		const result = await runForTest(
			["lanes", "show", "--adapter", "made-up-adapter", "--plain"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(20);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("browser_lane_unknown");
	});
});

describe("Browser Connect stays connection-only (R2, U1 verification)", () => {
	test("the Verified Handoff Envelope carries no auth field on any key path", () => {
		// Compatibility coverage over the REAL captured envelope: harvest every
		// object key and reject auth/credential vocabulary. The PRODUCER-owned
		// drift gate lives in Browser Connect's own tests (model + adapters
		// connection-only sweeps); this capture proves the consumer-side wire
		// shape stayed compatible.
		const authShaped =
			/(auth|credential|secret|password|passwd|token|otp|vault|passkey)/i;
		const envelope = JSON.parse(REAL_VERIFIED_HANDOFF_ENVELOPE);
		const offenders: string[] = [];
		const walk = (value: unknown, path: string): void => {
			if (Array.isArray(value)) {
				for (const [index, entry] of value.entries()) {
					walk(entry, `${path}[${index}]`);
				}
				return;
			}
			if (typeof value === "object" && value !== null) {
				for (const [key, entry] of Object.entries(value)) {
					if (authShaped.test(key)) offenders.push(`${path}.${key}`);
					walk(entry, `${path}.${key}`);
				}
			}
		};
		walk(envelope, "envelope");
		expect(offenders).toEqual([]);
	});
});
