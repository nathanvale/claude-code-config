import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerCodexProject, deregisterCodexProject } from "../src/codex-state.ts";

describe("codex-state", () => {
	let tempDir: string;
	let originalCodexHome: string | undefined;
	const statePath = () => join(tempDir, ".codex-global-state.json");
	const readState = async () => JSON.parse(await readFile(statePath(), "utf-8"));
	const roots = async () => (await readState())["electron-saved-workspace-roots"];
	const seed = async (state: Record<string, unknown>) =>
		writeFile(statePath(), JSON.stringify(state));

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "codex-state-test-"));
		originalCodexHome = process.env.CODEX_HOME;
		process.env.CODEX_HOME = tempDir;
	});

	afterEach(async () => {
		if (originalCodexHome === undefined) {
			delete process.env.CODEX_HOME;
		} else {
			process.env.CODEX_HOME = originalCodexHome;
		}
		await rm(tempDir, { recursive: true, force: true });
	});

	test("registerCodexProject creates state file when absent", async () => {
		await registerCodexProject("/some/worktree");
		expect(await roots()).toEqual(["/some/worktree"]);
	});

	test("registerCodexProject appends to existing roots", async () => {
		await seed({ "electron-saved-workspace-roots": ["/existing"] });
		await registerCodexProject("/new/worktree");
		expect(await roots()).toEqual(["/existing", "/new/worktree"]);
	});

	test("registerCodexProject is idempotent", async () => {
		await registerCodexProject("/some/worktree");
		await registerCodexProject("/some/worktree");
		expect(await roots()).toEqual(["/some/worktree"]);
	});

	test("registerCodexProject preserves other state keys", async () => {
		await seed({ "other-key": "value", "electron-saved-workspace-roots": [] });
		await registerCodexProject("/worktree");
		const state = await readState();
		expect(state["other-key"]).toBe("value");
		expect(state["electron-saved-workspace-roots"]).toEqual(["/worktree"]);
	});

	test("deregisterCodexProject removes path from roots", async () => {
		await seed({ "electron-saved-workspace-roots": ["/keep", "/remove", "/also-keep"] });
		await deregisterCodexProject("/remove");
		expect(await roots()).toEqual(["/keep", "/also-keep"]);
	});

	test("deregisterCodexProject is a no-op when path is absent", async () => {
		await seed({ "electron-saved-workspace-roots": ["/keep"] });
		await deregisterCodexProject("/not-there");
		expect(await roots()).toEqual(["/keep"]);
	});

	test("deregisterCodexProject handles missing state file", async () => {
		await deregisterCodexProject("/whatever");
	});

	test("registerCodexProject creates parent directory when absent", async () => {
		const nested = join(tempDir, "nested", "deep");
		process.env.CODEX_HOME = nested;
		await registerCodexProject("/worktree");
		const state = JSON.parse(await readFile(join(nested, ".codex-global-state.json"), "utf-8"));
		expect(state["electron-saved-workspace-roots"]).toEqual(["/worktree"]);
	});

	test("readState propagates non-ENOENT errors", async () => {
		await writeFile(statePath(), "not valid json");
		await expect(registerCodexProject("/worktree")).rejects.toThrow();
	});
});
