import { describe, expect, test } from "bun:test";

function packetVersion(): string {
	return "leaf-packet-v1";
}

describe("workspace", () => {
	describe("agent runner", () => {
		describe("projection registry", () => {
			describe("repair packet", () => {
				test("renders leaf packet", () => {
					expect(packetVersion()).toBe("leaf-packet-v2");
				});
			});
		});
	});
});
