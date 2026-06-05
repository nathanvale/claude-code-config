import { describe, expect, test } from "bun:test";

describe("timeout fixture", () => {
	test("times out a slow promise", async () => {
		await Bun.sleep(200);
		expect(true).toBe(true);
	}, 50);
});
