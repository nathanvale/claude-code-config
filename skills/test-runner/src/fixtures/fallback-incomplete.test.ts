import { describe, test } from "bun:test";

describe("fallback incomplete fixture", () => {
	test("keeps parser fallback useful", () => {
		throw new Error("manual failure without matcher facts");
	});
});
