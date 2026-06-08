import { describe, expect, test } from "bun:test";
import { classifyCoverageValue } from "./coverage-target";

describe("coverage fixture", () => {
	test("covers a subset of branches", () => {
		expect(classifyCoverageValue(12)).toBe("large");
		expect(classifyCoverageValue(0)).toBe("zero");
	});
});
