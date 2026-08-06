import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { isInsideOrEqual, unsafeExistingParent } from "../src/path-safety.ts";

describe("path containment", () => {
	test("accepts the root itself", () => {
		expect(isInsideOrEqual("/repo", "/repo")).toBe(true);
	});

	test("accepts a child of the root", () => {
		expect(isInsideOrEqual("/repo", "/repo/skills/fallow")).toBe(true);
	});

	test("rejects a parent of the root", () => {
		expect(isInsideOrEqual("/repo/skills", "/repo")).toBe(false);
	});
});

describe("unsafe existing parent", () => {
	test("accepts parents that canonicalize inside the anchor", async () => {
		const anchor = await anchorFixture();
		await mkdir(join(anchor, "nested"));
		expect(await unsafeExistingParent(anchor, join(anchor, "nested/deeper/leaf"))).toBeUndefined();
	});

	test("rejects an existing parent that escapes the anchor", async () => {
		const anchor = await anchorFixture();
		const outside = await mkdtemp(join(tmpdir(), "path-safety-outside-"));
		await symlink(outside, join(anchor, "escape"));
		expect(await unsafeExistingParent(anchor, join(anchor, "escape/leaf"))).toBe(join(anchor, "escape"));
	});

	test("fails closed on an existing parent whose realpath cannot resolve", async () => {
		const anchor = await anchorFixture();
		await symlink(join(anchor, "loop-b"), join(anchor, "loop-a"));
		await symlink(join(anchor, "loop-a"), join(anchor, "loop-b"));
		expect(await unsafeExistingParent(anchor, join(anchor, "loop-a/leaf"))).toBe(join(anchor, "loop-a"));
	});

	test("fails closed when the anchor itself does not exist", async () => {
		const anchor = await anchorFixture();
		const missing = join(anchor, "missing-home");
		expect(await unsafeExistingParent(missing, join(missing, ".bun/bin/tool"))).toBeDefined();
	});
});

async function anchorFixture(): Promise<string> {
	return realpath(await mkdtemp(join(tmpdir(), "path-safety-")));
}
