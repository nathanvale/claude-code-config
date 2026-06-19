import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerCodexProject, deregisterCodexProject } from "../src/codex-state.ts";

describe("codex-state", () => {
	let tempDir: string;
	let originalCodexHome: string | undefined;

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
		const state = JSON.parse(await readFile(join(tempDir, ".codex-global-state.json"), "utf-8"));
		expect(state["electron-saved-workspace-roots"]).toEqual(["/some/worktree"]);
	});

	test("registerCodexProject appends to existing roots", async () => {
		await writeFile(
			join(tempDir, ".codex-global-state.json"),
			JSON.stringify({ "electron-saved-workspace-roots": ["/existing"] }),
		);
		await registerCodexProject("/new/worktree");
		const state = JSON.parse(await readFile(join(tempDir, ".codex-global-state.json"), "utf-8"));
		expect(state["electron-saved-workspace-roots"]).toEqual(["/existing", "/new/worktree"]);
	});

	test("registerCodexProject is idempotent", async () => {
		await registerCodexProject("/some/worktree");
		await registerCodexProject("/some/worktree");
		const state = JSON.parse(await readFile(join(tempDir, ".codex-global-state.json"), "utf-8"));
		expect(state["electron-saved-workspace-roots"]).toEqual(["/some/worktree"]);
	});

	test("registerCodexProject preserves other state keys", async () => {
		await writeFile(
			join(tempDir, ".codex-global-state.json"),
			JSON.stringify({ "other-key": "value", "electron-saved-workspace-roots": [] }),
		);
		await registerCodexProject("/worktree");
		const state = JSON.parse(await readFile(join(tempDir, ".codex-global-state.json"), "utf-8"));
		expect(state["other-key"]).toBe("value");
		expect(state["electron-saved-workspace-roots"]).toEqual(["/worktree"]);
	});

	test("deregisterCodexProject removes path from roots", async () => {
		await writeFile(
			join(tempDir, ".codex-global-state.json"),
			JSON.stringify({ "electron-saved-workspace-roots": ["/keep", "/remove", "/also-keep"] }),
		);
		await deregisterCodexProject("/remove");
		const state = JSON.parse(await readFile(join(tempDir, ".codex-global-state.json"), "utf-8"));
		expect(state["electron-saved-workspace-roots"]).toEqual(["/keep", "/also-keep"]);
	});

	test("deregisterCodexProject is a no-op when path is absent", async () => {
		await writeFile(
			join(tempDir, ".codex-global-state.json"),
			JSON.stringify({ "electron-saved-workspace-roots": ["/keep"] }),
		);
		await deregisterCodexProject("/not-there");
		const state = JSON.parse(await readFile(join(tempDir, ".codex-global-state.json"), "utf-8"));
		expect(state["electron-saved-workspace-roots"]).toEqual(["/keep"]);
	});

	test("deregisterCodexProject handles missing state file", async () => {
		await deregisterCodexProject("/whatever");
		// No throw, no file created
	});
});
