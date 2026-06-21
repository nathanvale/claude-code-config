import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	type StorybookDocsLoopCommand,
	storybookDocsLoopContracts,
} from "../src/front-doors/storybook-docs-loop/command-contract.ts";
import {
	DOCS_LOOP_COMMANDS_CONTRACT_ID,
	DOCS_LOOP_RUN_CARD_CONTRACT_ID,
} from "../src/front-doors/storybook-docs-loop/docs-loop-model.ts";
import { runForTest } from "../src/front-doors/storybook-docs-loop/cli.ts";
import {
	DocsLoopStateError,
	createDefaultStorybookDocsLoopRuntime,
	readDocsLoopRunState,
	resolveDocsLoopStorage,
	resolveRunStatePath,
	writeDocsLoopRunState,
} from "../src/front-doors/storybook-docs-loop/docs-loop-state.ts";
import {
	discoverDocsLoopInventory,
	discoverDocsLoopInventorySet,
} from "../src/front-doors/storybook-docs-loop/docs-loop-inventory.ts";

const contractEntries = Object.entries(storybookDocsLoopContracts) as Array<
	[
		StorybookDocsLoopCommand,
		(typeof storybookDocsLoopContracts)[StorybookDocsLoopCommand],
	]
>;

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function makeTempRoot(prefix: string): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), `docs-loop-${prefix}-`));
	cleanupPaths.push(path);
	return path;
}

describe("docs-loop command contract", () => {
	test("declares valid facade contracts", () => {
		const parsed = parseCommandFacadeContract(storybookDocsLoopContracts, {
			path: "skills/storybook/src/front-doors/storybook-docs-loop/command-contract.ts",
			writeImplyingMutations: new Set(["state_write", "cache_destroy"]),
		});
		expect(parsed.ok).toBe(true);
	});

	test("commands --json projects every docs-loop command", () => {
		const tree = projectCommandDiscoveryTree(contractEntries, {
			includeFlagDescriptions: true,
		});
		expect(Object.keys(tree.commands).sort()).toEqual([
			"advance",
			"batch",
			"commands",
			"doctor",
			"mark",
			"purge",
			"resume",
			"single",
			"status",
		]);
	});

	test("discovery output includes result contract metadata", () => {
		const tree = projectCommandDiscoveryTree(contractEntries, {
			includeFlagDescriptions: true,
		});
		const commands = tree.commands as Record<
			string,
			{ result_contract?: { id: string } }
		>;
		expect(commands.single?.result_contract?.id).toBe(
			DOCS_LOOP_RUN_CARD_CONTRACT_ID,
		);
		expect(commands.commands?.result_contract?.id).toBe(
			DOCS_LOOP_COMMANDS_CONTRACT_ID,
		);
	});

	test("read-only commands do not declare write side effects", () => {
		for (const command of ["single", "resume", "status", "doctor", "commands"] as const) {
			const effects = new Set<string>(
				storybookDocsLoopContracts[command].sideEffects,
			);
			expect(effects.has("write")).toBe(false);
			expect(effects.has("destructive")).toBe(false);
		}
	});

	test("state/cache commands declare scoped mutation side effects", () => {
		expect(storybookDocsLoopContracts.batch.sideEffects).toContain("write");
		expect(storybookDocsLoopContracts.advance.sideEffects).toContain("write");
		expect(storybookDocsLoopContracts.mark.sideEffects).toContain("write");
		expect(storybookDocsLoopContracts.purge.sideEffects).toContain(
			"destructive",
		);
	});
});

describe("docs-loop CLI front door", () => {
	test("top-level help includes advertised commands", async () => {
		const result = await runForTest(["--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("storybook-docs-loop single");
		expect(result.stdout).toContain("storybook-docs-loop batch");
		expect(result.stdout).toContain("storybook-docs-loop purge");
		expect(result.stderr).toBe("");
	});

	test("command help includes command-specific usage", async () => {
		const result = await runForTest(["help", "mark"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("storybook-docs-loop mark");
		expect(result.stdout).toContain("--field");
		expect(result.stdout).toContain("--status");
		expect(result.stderr).toBe("");
	});

	test("--version writes version text to stdout", async () => {
		const result = await runForTest(["--version"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("storybook-docs-loop 0.1.0\n");
		expect(result.stderr).toBe("");
	});

	test("commands --json performs no target repo probe", async () => {
		const result = await runForTest(["commands", "--json"]);
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		const envelope = JSON.parse(result.stdout);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.contract_id).toBe(DOCS_LOOP_COMMANDS_CONTRACT_ID);
		expect(Object.keys(envelope.data.commands)).toContain("single");
	});

	test("missing required flags return JSON usage errors when --json is present", async () => {
		const result = await runForTest(["single", "--json"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe("");
		const envelope = JSON.parse(result.stdout);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
		expect(envelope.error.recoverability).toBe("change_input");
	});
});

describe("docs-loop state runtime", () => {
	test("unset XDG env values resolve to HOME fallbacks", async () => {
		const home = await makeTempRoot("home");
		const runtime = createDefaultStorybookDocsLoopRuntime({
			getEnv: (name) => (name === "HOME" ? home : undefined),
		});
		const storage = resolveDocsLoopStorage(runtime);
		expect(storage.stateBase).toBe(join(home, ".local/state"));
		expect(storage.cacheBase).toBe(join(home, ".cache"));
	});

	test("absolute XDG env values are accepted", async () => {
		const home = await makeTempRoot("home");
		const state = await makeTempRoot("state");
		const cache = await makeTempRoot("cache");
		const runtime = createDefaultStorybookDocsLoopRuntime({
			getEnv: (name) =>
				({
					HOME: home,
					XDG_STATE_HOME: state,
					XDG_CACHE_HOME: cache,
				})[name],
		});
		const storage = resolveDocsLoopStorage(runtime);
		expect(storage.stateBase).toBe(state);
		expect(storage.cacheBase).toBe(cache);
	});

	test("relative XDG env values fail before writing", async () => {
		const home = await makeTempRoot("home");
		const runtime = createDefaultStorybookDocsLoopRuntime({
			getEnv: (name) =>
				({
					HOME: home,
					XDG_STATE_HOME: "relative-state",
				})[name],
		});
		await expect(
			writeDocsLoopRunState(runtime, "/repo", minimalState("xdg-run")),
		).rejects.toMatchObject({
			code: "xdg_state_home_relative",
			retrySafe: true,
		});
	});

	test("state directories and files are owner-only", async () => {
		const home = await makeTempRoot("home");
		const runtime = createDefaultStorybookDocsLoopRuntime({
			getEnv: (name) => (name === "HOME" ? home : undefined),
		});
		const state = minimalState("mode-run");
		await writeDocsLoopRunState(runtime, "/repo", state);
		const paths = resolveRunStatePath(runtime, "/repo", "mode-run");
		const dirMode = (await stat(paths.runDir)).mode & 0o777;
		const fileMode = (await stat(paths.stateFile)).mode & 0o777;
		expect(dirMode).toBe(0o700);
		expect(fileMode).toBe(0o600);
	});

	test("write failure leaves no partial final state file", async () => {
		const home = await makeTempRoot("home");
		const runtime = createDefaultStorybookDocsLoopRuntime({
			getEnv: (name) => (name === "HOME" ? home : undefined),
			writeTextFile: async () => {
				throw new Error("write failed");
			},
		});
		await expect(
			writeDocsLoopRunState(runtime, "/repo", minimalState("fail-run")),
		).rejects.toThrow("write failed");
		const paths = resolveRunStatePath(runtime, "/repo", "fail-run");
		await expect(readFile(paths.stateFile, "utf8")).rejects.toThrow();
	});

	test("corrupt state JSON returns repairable error", async () => {
		const home = await makeTempRoot("home");
		const runtime = createDefaultStorybookDocsLoopRuntime({
			getEnv: (name) => (name === "HOME" ? home : undefined),
		});
		const paths = resolveRunStatePath(runtime, "/repo", "corrupt-run");
		await runtime.mkdir(paths.runDir, { recursive: true, mode: 0o700 });
		await writeFile(paths.stateFile, "{not-json", { mode: 0o600 });
		await expect(
			readDocsLoopRunState(runtime, "/repo", "corrupt-run"),
		).rejects.toBeInstanceOf(DocsLoopStateError);
		await expect(
			readDocsLoopRunState(runtime, "/repo", "corrupt-run"),
		).rejects.toMatchObject({
			code: "corrupt_state_json",
			retrySafe: true,
		});
	});

	test("serialized state omits private payload fields", async () => {
		const home = await makeTempRoot("home");
		const runtime = createDefaultStorybookDocsLoopRuntime({
			getEnv: (name) => (name === "HOME" ? home : undefined),
		});
		await writeDocsLoopRunState(runtime, "/repo", {
			...minimalState("private-run"),
			raw_prompt: "secret prompt",
			transcript: "secret transcript",
			cookies: "session",
			auth_url: "https://user:pass@example.test/path",
			browser_payload: { html: "<main />" },
			nested: {
				api_secret: "hidden",
				kept: "visible",
			},
		});
		const paths = resolveRunStatePath(runtime, "/repo", "private-run");
		const serialized = await readFile(paths.stateFile, "utf8");
		expect(serialized).not.toContain("secret prompt");
		expect(serialized).not.toContain("secret transcript");
		expect(serialized).not.toContain("session");
		expect(serialized).not.toContain("user:pass");
		expect(serialized).not.toContain("<main");
		expect(serialized).not.toContain("hidden");
		expect(serialized).toContain("visible");
	});
});

describe("docs-loop inventory", () => {
	test("component name resolves a story cluster", async () => {
		const repo = await makeInventoryFixture();
		const runtime = createDefaultStorybookDocsLoopRuntime({
			cwd: () => repo,
			getEnv: (name) => (name === "HOME" ? repo : undefined),
		});
		const result = await discoverDocsLoopInventory(runtime, {
			repo,
			pkg: "packages/portal-ui",
			component: "Button",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") throw new Error("expected ok inventory");
		expect(result.cluster.component).toBe("Button");
		expect(result.cluster.main_story).toBe(
			"packages/portal-ui/src/ui/Button/Button.stories.tsx",
		);
		expect(result.cluster.matrix_stories).toContain(
			"packages/portal-ui/src/ui/Button/Button.matrix.stories.tsx",
		);
		expect(result.cluster.focused_stories).toContain(
			"packages/portal-ui/src/ui/Button/Button.states.stories.tsx",
		);
		expect(result.cluster.nearby_tests).toContain(
			"packages/portal-ui/src/ui/Button/Button.test.tsx",
		);
		expect(result.cluster.evidence_files).toContain(
			"packages/portal-ui/src/ui/Button/README.md",
		);
		expect(result.cluster.story_id_hints).toContain("ui-button--default");
	});

	test("story path resolves the owning component cluster", async () => {
		const repo = await makeInventoryFixture();
		const runtime = createDefaultStorybookDocsLoopRuntime({
			cwd: () => repo,
			getEnv: (name) => (name === "HOME" ? repo : undefined),
		});
		const result = await discoverDocsLoopInventory(runtime, {
			repo,
			pkg: "packages/portal-ui",
			story: "packages/portal-ui/src/ui/Button/Button.matrix.stories.tsx",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") throw new Error("expected ok inventory");
		expect(result.cluster.component).toBe("Button");
		expect(result.cluster.matrix_stories).toContain(
			"packages/portal-ui/src/ui/Button/Button.matrix.stories.tsx",
		);
	});

	test("missing package path returns blocked target data", async () => {
		const repo = await makeInventoryFixture();
		const runtime = createDefaultStorybookDocsLoopRuntime({
			cwd: () => repo,
			getEnv: (name) => (name === "HOME" ? repo : undefined),
		});
		const result = await discoverDocsLoopInventory(runtime, {
			repo,
			pkg: "packages/missing",
			component: "Button",
		});
		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") throw new Error("expected blocked inventory");
		expect(result.reason).toBe("package_not_found");
		expect(result.next_safe_action).toContain("Check the package path");
	});

	test("ambiguous component names return small alternatives", async () => {
		const repo = await makeInventoryFixture();
		const runtime = createDefaultStorybookDocsLoopRuntime({
			cwd: () => repo,
			getEnv: (name) => (name === "HOME" ? repo : undefined),
		});
		const result = await discoverDocsLoopInventory(runtime, {
			repo,
			pkg: "packages/portal-ui",
			component: "Input",
		});
		expect(result.status).toBe("ambiguous");
		if (result.status !== "ambiguous") {
			throw new Error("expected ambiguous inventory");
		}
		expect(result.alternatives).toEqual(["SearchInput", "TextInput"]);
	});

	test("inventory does not report files outside package boundary", async () => {
		const repo = await makeInventoryFixture();
		await writeFile(
			join(repo, "packages", "outside", "Button.stories.tsx"),
			"export const Outside = {};",
		).catch(async () => {
			await mkdir(join(repo, "packages", "outside"), { recursive: true });
			await writeFile(
				join(repo, "packages", "outside", "Button.stories.tsx"),
				"export const Outside = {};",
			);
		});
		const runtime = createDefaultStorybookDocsLoopRuntime({
			cwd: () => repo,
			getEnv: (name) => (name === "HOME" ? repo : undefined),
		});
		const result = await discoverDocsLoopInventory(runtime, {
			repo,
			pkg: "packages/portal-ui",
			component: "Button",
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") throw new Error("expected ok inventory");
		expect(JSON.stringify(result.cluster)).not.toContain("packages/outside");
	});
});

describe("docs-loop command semantics", () => {
	test("single emits a run card without durable state writes", async () => {
		const { repo, runtime } = await makeCliFixture("single");
		const result = await runForTest(
			[
				"single",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--component",
				"Button",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.data.run).toBe(null);
		expect(envelope.data.cluster.main_story).toBe(
			"packages/portal-ui/src/ui/Button/Button.stories.tsx",
		);
		const storage = resolveDocsLoopStorage(runtime);
		await expect(readFile(storage.stateRoot, "utf8")).rejects.toThrow();
	});

	test("batch creates durable run state with cursor and ledger skeleton", async () => {
		const { repo, runtime } = await makeCliFixture("batch");
		const result = await runForTest(
			[
				"batch",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--run",
				"test-run",
				"--batch-size",
				"1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.data.run).toBe("test-run");
		expect(envelope.data.current_batch[0].component).toBe("Button");
		const state = await readDocsLoopRunState(runtime, repo, "test-run");
		expect(state.cursor).toBe(0);
		expect(state.batch_size).toBe(1);
		expect(JSON.stringify(state)).toContain("default_primary");
	});

	test("status and resume read existing state", async () => {
		const { repo, runtime } = await makeCliFixture("status");
		await runForTest(
			[
				"batch",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--run",
				"status-run",
				"--batch-size",
				"1",
				"--json",
			],
			runtime,
		);
		const status = await runForTest(
			["status", "--repo", repo, "--run", "status-run", "--json"],
			runtime,
		);
		expect(status.exitCode).toBe(0);
		expect(JSON.parse(status.stdout).data.total_items).toBe(3);
		const resume = await runForTest(
			["resume", "--repo", repo, "--run", "status-run", "--json"],
			runtime,
		);
		expect(resume.exitCode).toBe(0);
		expect(JSON.parse(resume.stdout).data.current_batch[0].component).toBe(
			"Button",
		);
	});

	test("resume infers one active run and rejects multiple choices", async () => {
		const { repo, runtime } = await makeCliFixture("infer");
		await runForTest(
			["batch", "--repo", repo, "--pkg", "packages/portal-ui", "--run", "one", "--json"],
			runtime,
		);
		const inferred = await runForTest(["resume", "--repo", repo, "--json"], runtime);
		expect(inferred.exitCode).toBe(0);
		expect(JSON.parse(inferred.stdout).data.run).toBe("one");
		await runForTest(
			["batch", "--repo", repo, "--pkg", "packages/portal-ui", "--run", "two", "--json"],
			runtime,
		);
		const multiple = await runForTest(["resume", "--repo", repo, "--json"], runtime);
		expect(multiple.exitCode).toBe(2);
		expect(JSON.parse(multiple.stdout).error.message).toContain("one, two");
	});

	test("mark writes receipts and resume surfaces receipt state", async () => {
		const { repo, runtime } = await makeCliFixture("mark");
		await runForTest(
			["batch", "--repo", repo, "--pkg", "packages/portal-ui", "--run", "mark-run", "--json"],
			runtime,
		);
		const mark = await runForTest(
			[
				"mark",
				"--repo",
				repo,
				"--run",
				"mark-run",
				"--component",
				"Button",
				"--field",
				"preview",
				"--status",
				"done",
				"--json",
			],
			runtime,
		);
		expect(mark.exitCode).toBe(0);
		const resume = await runForTest(
			["resume", "--repo", repo, "--run", "mark-run", "--json"],
			runtime,
		);
		expect(JSON.parse(resume.stdout).data.verification_receipts.preview.status).toBe(
			"done",
		);
	});

	test("mark rejects components outside the run", async () => {
		const { repo, runtime } = await makeCliFixture("mark-component");
		await runForTest(
			["batch", "--repo", repo, "--pkg", "packages/portal-ui", "--run", "mark-run", "--json"],
			runtime,
		);
		const result = await runForTest(
			[
				"mark",
				"--repo",
				repo,
				"--run",
				"mark-run",
				"--component",
				"Missing",
				"--field",
				"preview",
				"--status",
				"done",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout).error.message).toContain(
			"not in this run",
		);
	});

	test("advance gates degraded items and records forced advance reason", async () => {
		const { repo, runtime } = await makeCliFixture("advance");
		await runForTest(
			[
				"batch",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--run",
				"advance-run",
				"--batch-size",
				"1",
				"--json",
			],
			runtime,
		);
		for (const field of [
			"default_primary",
			"matrix",
			"ux_tips",
			"preview",
			"a11y_story_tests",
			"screenshot",
			"registry",
			"fallow",
		]) {
			await runForTest(
				[
					"mark",
					"--repo",
					repo,
					"--run",
					"advance-run",
					"--field",
					field,
					"--status",
					"done",
					"--json",
				],
				runtime,
			);
		}
		const gated = await runForTest(
			["advance", "--repo", repo, "--run", "advance-run", "--json"],
			runtime,
		);
		expect(gated.exitCode).toBe(2);
		const forced = await runForTest(
			[
				"advance",
				"--repo",
				repo,
				"--run",
				"advance-run",
				"--force",
				"--reason",
				"optional docs intentionally skipped",
				"--json",
			],
			runtime,
		);
		expect(forced.exitCode).toBe(0);
		const state = await readDocsLoopRunState(runtime, repo, "advance-run");
		expect(state.cursor).toBe(1);
		expect(JSON.stringify(state)).toContain("optional docs intentionally skipped");
	});

	test("advance gates every item in the current batch", async () => {
		const { repo, runtime } = await makeCliFixture("advance-batch");
		await runForTest(
			[
				"batch",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--run",
				"advance-batch-run",
				"--batch-size",
				"2",
				"--json",
			],
			runtime,
		);
		for (const field of [
			"default_primary",
			"matrix",
			"ux_tips",
			"preview",
			"a11y_story_tests",
			"screenshot",
			"registry",
			"fallow",
		]) {
			await runForTest(
				[
					"mark",
					"--repo",
					repo,
					"--run",
					"advance-batch-run",
					"--component",
					"Button",
					"--field",
					field,
					"--status",
					"done",
					"--json",
				],
				runtime,
			);
		}
		for (const field of [
			"focused_stories",
			"optional_docs_inclusion",
			"blocker_or_degraded_reason",
		]) {
			await runForTest(
				[
					"mark",
					"--repo",
					repo,
					"--run",
					"advance-batch-run",
					"--component",
					"Button",
					"--field",
					field,
					"--status",
					"na",
					"--reason",
					"not applicable",
					"--json",
				],
				runtime,
			);
		}
		const result = await runForTest(
			["advance", "--repo", repo, "--run", "advance-batch-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(JSON.parse(result.stdout).error.message).toContain(
			"verified, skipped, degraded, or blocked",
		);
		const state = await readDocsLoopRunState(runtime, repo, "advance-batch-run");
		expect(state.cursor).toBe(0);
	});

	test("doctor reports corrupt state with repair hint", async () => {
		const { repo, runtime } = await makeCliFixture("doctor");
		const paths = resolveRunStatePath(runtime, repo, "doctor-run");
		await runtime.mkdir(paths.runDir, { recursive: true, mode: 0o700 });
		await writeFile(paths.stateFile, "{bad", { mode: 0o600 });
		const result = await runForTest(
			["doctor", "--repo", repo, "--run", "doctor-run", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.data.status).toBe("repairable");
		expect(envelope.data.problems[0].code).toBe("corrupt_state_json");
	});

	test("purge previews by default and deletes with force", async () => {
		const { repo, runtime } = await makeCliFixture("purge");
		await runForTest(
			["batch", "--repo", repo, "--pkg", "packages/portal-ui", "--run", "purge-run", "--json"],
			runtime,
		);
		const preview = await runForTest(
			["purge", "--repo", repo, "--run", "purge-run", "--json"],
			runtime,
		);
		expect(JSON.parse(preview.stdout).data.deleted).toBe(false);
		await readDocsLoopRunState(runtime, repo, "purge-run");
		const purged = await runForTest(
			["purge", "--repo", repo, "--run", "purge-run", "--force", "--json"],
			runtime,
		);
		expect(JSON.parse(purged.stdout).data.deleted).toBe(true);
		await expect(
			readDocsLoopRunState(runtime, repo, "purge-run"),
		).rejects.toMatchObject({ code: "state_missing" });
	});

	test("purge infers one active run and rejects multiple choices", async () => {
		const { repo, runtime } = await makeCliFixture("purge-infer");
		await runForTest(
			[
				"batch",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--run",
				"one",
				"--json",
			],
			runtime,
		);
		const inferred = await runForTest(["purge", "--repo", repo, "--json"], runtime);
		expect(inferred.exitCode).toBe(0);
		expect(JSON.parse(inferred.stdout).data.matched_runs).toEqual(["one"]);
		await runForTest(
			[
				"batch",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--run",
				"two",
				"--json",
			],
			runtime,
		);
		const multiple = await runForTest(["purge", "--repo", repo, "--json"], runtime);
		expect(multiple.exitCode).toBe(2);
		expect(JSON.parse(multiple.stdout).error.message).toContain("one, two");
	});

	test("--plain emits compact human output", async () => {
		const { repo, runtime } = await makeCliFixture("plain");
		const result = await runForTest(
			[
				"single",
				"--repo",
				repo,
				"--pkg",
				"packages/portal-ui",
				"--component",
				"Button",
				"--plain",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("command: single");
		expect(result.stdout).toContain("component: Button");
	});
});

function minimalState(run: string): Record<string, unknown> {
	return {
		run,
		repo: "/repo",
		pkg: ".",
		created_at: "2026-06-21T00:00:00.000Z",
		updated_at: "2026-06-21T00:00:00.000Z",
		cursor: 0,
		batch_size: 1,
		inventory: [],
		current_batch: [],
		ledger: {},
	};
}

async function makeInventoryFixture(): Promise<string> {
	const repo = await makeTempRoot("inventory");
	const buttonDir = join(repo, "packages", "portal-ui", "src", "ui", "Button");
	const textInputDir = join(
		repo,
		"packages",
		"portal-ui",
		"src",
		"ui",
		"TextInput",
	);
	const searchInputDir = join(
		repo,
		"packages",
		"portal-ui",
		"src",
		"ui",
		"SearchInput",
	);
	await mkdir(buttonDir, { recursive: true });
	await mkdir(textInputDir, { recursive: true });
	await mkdir(searchInputDir, { recursive: true });
	await writeFile(
		join(buttonDir, "Button.stories.tsx"),
		[
			"const meta = { title: 'UI/Button' };",
			"export default meta;",
			"export const Default = {};",
			"export const UxTips = {};",
			"",
		].join("\n"),
	);
	await writeFile(
		join(buttonDir, "Button.matrix.stories.tsx"),
		"export const Matrix = {};",
	);
	await writeFile(
		join(buttonDir, "Button.states.stories.tsx"),
		"export const Disabled = {};",
	);
	await writeFile(join(buttonDir, "Button.test.tsx"), "test('button', () => {});");
	await writeFile(join(buttonDir, "README.md"), "# Button\n");
	await writeFile(
		join(textInputDir, "TextInput.stories.tsx"),
		"export const Default = {};",
	);
	await writeFile(
		join(searchInputDir, "SearchInput.stories.tsx"),
		"export const Default = {};",
	);
	await writeFile(
		join(repo, "packages", "portal-ui", "package.json"),
		JSON.stringify({ name: "@packages/portal-ui" }),
	);
	return repo;
}

async function makeCliFixture(
	label: string,
): Promise<{
	repo: string;
	runtime: ReturnType<typeof createDefaultStorybookDocsLoopRuntime>;
}> {
	const repo = await makeInventoryFixture();
	const home = await makeTempRoot(`home-${label}`);
	const runtime = createDefaultStorybookDocsLoopRuntime({
		cwd: () => repo,
		now: () => 1_797_782_400_000,
		uniqueId: () => `${label}-unique`,
		getEnv: (name) => (name === "HOME" ? home : undefined),
	});
	return { repo, runtime };
}
