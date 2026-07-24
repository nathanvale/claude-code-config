import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_ADAPTER_LANE_IDS,
	BROWSER_USE_LANE_EVIDENCE_CLASSES,
	BROWSER_USE_REJECTED_LANE_ALIASES,
} from "./browser-use-adapter-model";
import {
	REAL_VERIFIED_HANDOFF_ENVELOPE,
} from "./browser-connect-handoff-fixtures";
import { BROWSER_USE_ADAPTER_LANES_CONTRACT_ID } from "./command-contract";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

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
				schema_version: "2",
			});
			const implementation = lane.native_implementation as Record<
				string,
				unknown
			>;
			if (implementation.implemented === true) {
				expect(implementation.execution_interface).toBe(
					"mcporter-envelope-call",
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
		]);
	});

	test("lanes list --plain projects the same facts as JSON (human/JSON parity)", async () => {
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
		for (const [index, lane] of BROWSER_USE_ADAPTER_LANE_IDS.entries()) {
			const line = lines[index + 1] ?? "";
			expect(line.startsWith(`${lane} `)).toBe(true);
			const row = rows[index] as Record<string, unknown>;
			const implementation = row.native_implementation as Record<
				string,
				unknown
			>;
			expect(line).toContain(
				`implementation=${
					implementation.implemented === true
						? String(implementation.execution_interface)
						: "unavailable"
				}`,
			);
			expect(line).toContain(`integrity=${String(row.integrity_state)}`);
			expect(line).toContain("connection=unproven");
			expect(line).toContain("task=unproven");
			expect(line).toContain("auth=unproven");
			expect(line).toContain("auth_methods=none");
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
			schema_version: "2",
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
		// Consumer-side sweep over the REAL captured envelope: harvest every
		// object key and reject auth/credential vocabulary. Browser Connect's
		// Adapter Definition may never grow into a credential transport; a new
		// auth-named envelope field fails here before any consumer parses it.
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
