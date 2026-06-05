import { describe, expect, test } from "bun:test";

function priceWithTax(price: number): number {
	return price * 1.1;
}

describe("failing fixture", () => {
	test("calculates tax-inclusive price", () => {
		expect(priceWithTax(10)).toBe(13);
	});
});

