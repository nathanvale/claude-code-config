import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { captureFilePreImage, fingerprintValue } from "../src/pre-image.ts";

test("request fingerprints are stable across JSON object key order", () => {
	expect(fingerprintValue({ query: "alpha", options: { limit: 3 } })).toBe(
		fingerprintValue({ options: { limit: 3 }, query: "alpha" }),
	);
});

test("request fingerprints use locale-independent codepoint key order", () => {
	expect(fingerprintValue({ api_key: 3, a: 2, "api-key": 4, B: 1 })).toBe(
		"sha256:2111dccfb7dda933527cee71d94298c2d6566ba07f368019320e8c8e2d5c9a7f",
	);
});

test("file pre-images capture exact bytes and mode", async () => {
	const root = await mkdtemp(join(tmpdir(), "tool-execution-pre-image-"));
	const path = join(root, "target.txt");
	await writeFile(path, "abc");
	await chmod(path, 0o640);

	expect(await captureFilePreImage(path)).toEqual({
		kind: "file",
		sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		size: 3,
		mode: 0o640,
	});
});

test("file pre-images distinguish absent paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "tool-execution-pre-image-"));
	expect(await captureFilePreImage(join(root, "missing.txt"))).toEqual({
		kind: "absent",
	});
});

test("file pre-images reject directories", async () => {
	const root = await mkdtemp(join(tmpdir(), "tool-execution-pre-image-"));
	const path = join(root, "directory");
	await mkdir(path);
	await expect(captureFilePreImage(path)).rejects.toThrow(
		"Pre-image target must be a file.",
	);
});
