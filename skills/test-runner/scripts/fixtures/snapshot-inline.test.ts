import { describe, expect, test } from "bun:test";

function snapshotPayload(): string {
	return "stable snapshot: actual";
}

describe("snapshot inline fixture", () => {
	test("matches inline snapshot", () => {
		expect(snapshotPayload()).toMatchInlineSnapshot(
			`"stable snapshot: expected"`,
		);
	});
});
