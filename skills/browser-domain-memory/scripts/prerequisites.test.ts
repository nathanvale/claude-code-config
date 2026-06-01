import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	REPO_ROOT,
	REQUIRED_PROTOTYPE_SOURCES,
	allOk,
	checkPrototypeEvidence,
} from "./prerequisites";

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

/** Build a temp repo root containing every required prototype source dir. */
async function makeCompletePrototypeTree(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "bdm-prereq-"));
	cleanupPaths.push(root);
	for (const source of REQUIRED_PROTOTYPE_SOURCES) {
		await mkdir(join(root, source.path), { recursive: true });
	}
	return root;
}

describe("prototype evidence inventory", () => {
	test("present roots: all required sources resolve to success", async () => {
		const root = await makeCompletePrototypeTree();
		const results = await checkPrototypeEvidence(root);

		expect(results).toHaveLength(REQUIRED_PROTOTYPE_SOURCES.length);
		expect(allOk(results)).toBe(true);
	});

	test("missing root: removing browser-use-uplift names that root", async () => {
		const root = await makeCompletePrototypeTree();
		await rm(join(root, "prototypes/browser-use-uplift"), {
			recursive: true,
			force: true,
		});

		const results = await checkPrototypeEvidence(root);
		expect(allOk(results)).toBe(false);

		const rootFailure = results.find((r) => r.id === "browser-use-uplift-root");
		expect(rootFailure?.ok).toBe(false);
		expect(rootFailure?.detail).toContain("prototypes/browser-use-uplift");
	});

	test("missing named subsource: removing one subdir names that exact source", async () => {
		const root = await makeCompletePrototypeTree();
		await rm(join(root, "prototypes/browser-use-uplift/recorder-json"), {
			recursive: true,
			force: true,
		});

		const results = await checkPrototypeEvidence(root);
		const failure = results.find((r) => r.id === "recorder-json");
		expect(failure?.ok).toBe(false);
		expect(failure?.detail).toContain(
			"prototypes/browser-use-uplift/recorder-json",
		);
		// Sibling sources stay ok — failure is scoped to the missing path.
		expect(results.find((r) => r.id === "runbook-dual")?.ok).toBe(true);
	});

	test("empty tree: every source fails and names its path", async () => {
		const root = await mkdtemp(join(tmpdir(), "bdm-prereq-empty-"));
		cleanupPaths.push(root);

		const results = await checkPrototypeEvidence(root);
		expect(results.every((r) => !r.ok)).toBe(true);
		for (const result of results) {
			expect(result.detail).toContain("missing prototype source");
		}
	});

	test("real repo tree satisfies the inventory (durable evidence is present)", async () => {
		// Local-only guard (R3): the restored prototype set must resolve against
		// the real repo root, proving the durable evidence is actually on disk.
		const results = await checkPrototypeEvidence(REPO_ROOT);
		const missing = results.filter((r) => !r.ok);
		expect(missing.map((r) => r.detail)).toEqual([]);
		expect(allOk(results)).toBe(true);
	});
});
