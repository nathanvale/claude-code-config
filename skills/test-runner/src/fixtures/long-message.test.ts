import { describe, expect, test } from "bun:test";

function operationPacket(): string {
	return [
		"expected operation packet",
		"with bounded repair hints",
		"and enough nearby context for a cold agent to choose the next action",
	].join(" ");
}

describe("long message fixture", () => {
	test("surfaces long assertion message", () => {
		expect(operationPacket()).toBe(
			[
				"expected operation packet",
				"with durable repair hints",
				"and enough nearby context for a cold agent to choose the next action",
			].join(" "),
		);
	});
});
