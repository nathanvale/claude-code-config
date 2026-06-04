import { describe, expect, test } from "bun:test";

describe("live Fallow compatibility", () => {
	test.skipIf(process.env.FALLOW_RUNNER_LIVE !== "1")(
		"checks current Fallow CLI compatibility when explicitly enabled",
		() => {
			expect(process.env.FALLOW_RUNNER_LIVE).toBe("1");
		},
	);
});
