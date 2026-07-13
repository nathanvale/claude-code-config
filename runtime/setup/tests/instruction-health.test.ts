import { describe, expect, test } from "bun:test";

import { checkInstructionHealth } from "../src/instruction-health.ts";

describe("instruction health", () => {
	test("captures successful child output", async () => {
		const result = await checkInstructionHealth("/repo", async () => ({ exitCode: 0, stdout: "child out\n", stderr: "child err\n" }));
		expect(result).toMatchObject({ healthy: true, stdout: "child out\n", stderr: "child err\n" });
	});

	test("maps child failure to package-owned finding", async () => {
		const result = await checkInstructionHealth("/repo", async () => ({ exitCode: 1, stdout: "bad\n", stderr: "why\n" }));
		expect(result.finding).toMatchObject({ id: "instruction_unhealthy", repair: "repair_instructions" });
	});
});
