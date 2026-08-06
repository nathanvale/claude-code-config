import { describe, test } from "bun:test";

function loadCustomer(): void {
	throw new Error("domain exception: customer id missing");
}

describe("thrown error fixture", () => {
	test("reports domain exception", () => {
		loadCustomer();
	});
});
