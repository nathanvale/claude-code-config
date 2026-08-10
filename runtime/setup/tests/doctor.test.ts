import { describe, expect, test } from "bun:test";

import { diagnoseFindings } from "../src/doctor.ts";
import type { SetupFinding } from "../src/model.ts";

describe("setup doctor", () => {
	test.each([
		["broken_managed_link", "run_sync"],
		["duplicate_scope", "human_repair"],
		["dependency_unhealthy", "repair_dependency"],
		["hook_unhealthy", "repair_hooks"],
		["hook_ownership_unproven", "human_repair"],
	] as const)("explains %s with ownership, impact, and repair", (id, repair) => {
		const diagnosis = diagnoseFindings([finding(id)]);

		expect(diagnosis.findings[0]?.owner.length).toBeGreaterThan(0);
		expect(diagnosis.findings[0]?.why?.length).toBeGreaterThan(0);
		expect(diagnosis.findings[0]?.repair).toBe(repair);
	});

	test("routes unproven hook ownership to the existing human-repair blocker", () => {
		const diagnosis = diagnoseFindings([finding("hook_ownership_unproven")]);

		expect(diagnosis).toMatchObject({
			station: "doctor.blocked",
			next_action: "human_repair",
		});
	});

	test("gives duplicate scope precedence and exactly one next action", () => {
		const diagnosis = diagnoseFindings([
			finding("broken_managed_link"),
			finding("duplicate_scope"),
		]);

		expect(diagnosis).toMatchObject({
			station: "doctor.duplicate_scope",
			next_action: "human_repair",
		});
	});
});

function finding(id: SetupFinding["id"]): SetupFinding {
	return { id, owner: "fixture", summary: `${id} observed.`, repair: "run_doctor" };
}
