import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BranchStationEvidence } from "@side-quest/cli-command-facade";
import {
	assertStationEnvelope,
	buildStationEvidence,
	describeCliProcessRun,
	runCliProcess,
	type CliProcessResult,
	type StationScenario,
} from "@side-quest/cli-command-facade/testing";
import {
	createCleanupRegistry,
	drainCleanup,
	makeTempDir,
	writePackageJson,
} from "@side-quest/cli-test-fixtures";
import {
	findStorybookDocsLoopBranchStationCatalogDrift,
	projectStorybookDocsLoopStationMap,
	storybookDocsLoopBranchStationCatalog,
} from "../src/front-doors/storybook-docs-loop/branch-station-catalog.ts";

const RUNNER_PATH = fileURLToPath(
	new URL("../src/front-doors/storybook-docs-loop/cli.ts", import.meta.url),
);
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url)).replace(
	/\/tests$/,
	"",
);

type Station = (typeof storybookDocsLoopBranchStationCatalog)[number];
type StationId = Station["id"];

const registry = createCleanupRegistry();

afterEach(() => {
	drainCleanup(registry);
});

async function runLoop(
	args: readonly string[],
	options: { label: string; cwd?: string; home?: string } = { label: "docs-loop" },
): Promise<CliProcessResult> {
	const home = options.home ?? makeTempDir(registry, "docs-loop-home");
	return runCliProcess({
		label: options.label,
		argv: [process.execPath, RUNNER_PATH, ...args],
		cwd: options.cwd ?? PACKAGE_ROOT,
		env: {
			...process.env,
			HOME: home,
			XDG_STATE_HOME: join(home, "state"),
			XDG_CACHE_HOME: join(home, "cache"),
		},
		timeoutMs: 15_000,
	});
}

function makeStoryRepo(prefix: string): string {
	const repo = makeTempDir(registry, prefix);
	const packageRoot = join(repo, "packages", "portal-ui");
	const buttonDir = join(packageRoot, "src", "ui", "Button");
	const textInputDir = join(packageRoot, "src", "ui", "TextInput");
	const searchInputDir = join(packageRoot, "src", "ui", "SearchInput");
	mkdirSync(buttonDir, { recursive: true });
	mkdirSync(textInputDir, { recursive: true });
	mkdirSync(searchInputDir, { recursive: true });
	writePackageJson(packageRoot, { name: "@packages/portal-ui" });
	writeFileSync(
		join(buttonDir, "Button.stories.tsx"),
		[
			"const meta = { title: 'UI/Button' };",
			"export default meta;",
			"export const Default = {};",
			"export const UxTips = {};",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(buttonDir, "Button.matrix.stories.tsx"),
		"export const Matrix = {};",
	);
	writeFileSync(
		join(buttonDir, "Button.states.stories.tsx"),
		"export const Disabled = {};",
	);
	writeFileSync(join(buttonDir, "Button.test.tsx"), "test('button', () => {});");
	writeFileSync(join(buttonDir, "README.md"), "# Button\n");
	writeFileSync(
		join(textInputDir, "TextInput.stories.tsx"),
		"export const Default = {};",
	);
	writeFileSync(
		join(searchInputDir, "SearchInput.stories.tsx"),
		"export const Default = {};",
	);
	return repo;
}

async function createRun(input: {
	repo: string;
	home: string;
	run: string;
	batchSize?: string;
}): Promise<void> {
	const result = await runLoop(
		[
			"batch",
			"--repo",
			input.repo,
			"--pkg",
			"packages/portal-ui",
			"--run",
			input.run,
			"--batch-size",
			input.batchSize ?? "1",
			"--json",
		],
		{ label: `setup ${input.run}`, home: input.home },
	);
	expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
}

async function markField(input: {
	repo: string;
	home: string;
	run: string;
	field: string;
	status?: string;
	reason?: string;
}): Promise<void> {
	const args = [
		"mark",
		"--repo",
		input.repo,
		"--run",
		input.run,
		"--field",
		input.field,
		"--status",
		input.status ?? "done",
		"--json",
	];
	if (input.reason) args.splice(args.length - 1, 0, "--reason", input.reason);
	const result = await runLoop(args, {
		label: `mark ${input.field}`,
		home: input.home,
	});
	expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
}

async function markRequiredFields(repo: string, home: string, run: string): Promise<void> {
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
		await markField({ repo, home, run, field });
	}
}

async function markAllFields(repo: string, home: string, run: string): Promise<void> {
	await markRequiredFields(repo, home, run);
	for (const field of [
		"focused_stories",
		"optional_docs_inclusion",
		"blocker_or_degraded_reason",
	]) {
		await markField({
			repo,
			home,
			run,
			field,
			status: "na",
			reason: "not applicable",
		});
	}
}

function corruptRunState(home: string, run: string): void {
	const stateRoot = join(home, "state", "storybook-docs-loop", "repos");
	const files = findFiles(stateRoot).filter((file) => file.endsWith(`${run}.json`));
	if (files.length !== 1) throw new Error(`expected one state file for ${run}`);
	writeFileSync(files[0], "{bad");
}

function findFiles(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(root, entry.name);
		return entry.isDirectory() ? findFiles(path) : [path];
	});
}

async function runScenario(
	station: Station,
	args: readonly string[],
	setup?: (input: { repo: string; home: string }) => Promise<void> | void,
): Promise<BranchStationEvidence> {
	const repo = makeStoryRepo(station.id.replace(/[^a-z0-9]/gi, "-"));
	const home = makeTempDir(registry, `${station.id.replace(/[^a-z0-9]/gi, "-")}-home`);
	await setup?.({ repo, home });
	const result = await runLoop(argsWithRepo(args, repo), {
		label: station.id,
		home,
	});
	const envelope = assertStationEnvelope(station, result);
	return buildStationEvidence(station, result, envelope);
}

function argsWithRepo(args: readonly string[], repo: string): string[] {
	return args.map((arg) => (arg === "$REPO" ? repo : arg));
}

const stationScenarios: Record<StationId, StationScenario<Station>> = {
	"single.component_json": {
		run: (s) =>
			runScenario(s, [
				"single",
				"--repo",
				"$REPO",
				"--pkg",
				"packages/portal-ui",
				"--component",
				"Button",
				"--json",
			]),
	},
	"single.story_json": {
		run: (s) =>
			runScenario(s, [
				"single",
				"--repo",
				"$REPO",
				"--pkg",
				"packages/portal-ui",
				"--story",
				"packages/portal-ui/src/ui/Button/Button.stories.tsx",
				"--json",
			]),
	},
	"single.missing_target": {
		run: (s) => runScenario(s, ["single", "--repo", "$REPO", "--json"]),
	},
	"batch.create_run": {
		run: (s) =>
			runScenario(s, [
				"batch",
				"--repo",
				"$REPO",
				"--pkg",
				"packages/portal-ui",
				"--run",
				"create-run",
				"--json",
			]),
	},
	"batch.invalid_size": {
		run: (s) =>
			runScenario(s, [
				"batch",
				"--repo",
				"$REPO",
				"--pkg",
				"packages/portal-ui",
				"--batch-size",
				"0",
				"--json",
			]),
	},
	"resume.current_batch": {
		run: (s) =>
			runScenario(
				s,
				["resume", "--repo", "$REPO", "--run", "resume-run", "--json"],
				({ repo, home }) => createRun({ repo, home, run: "resume-run" }),
			),
	},
	"resume.missing_run": {
		run: (s) =>
			runScenario(s, [
				"resume",
				"--repo",
				"$REPO",
				"--run",
				"missing-run",
				"--json",
			]),
	},
	"status.summary_json": {
		run: (s) =>
			runScenario(
				s,
				["status", "--repo", "$REPO", "--run", "status-run", "--json"],
				({ repo, home }) => createRun({ repo, home, run: "status-run" }),
			),
	},
	"advance.next_batch": {
		run: (s) =>
			runScenario(
				s,
				["advance", "--repo", "$REPO", "--run", "advance-ok", "--json"],
				async ({ repo, home }) => {
					await createRun({ repo, home, run: "advance-ok" });
					await markAllFields(repo, home, "advance-ok");
				},
			),
	},
	"advance.degraded_without_force": {
		run: (s) =>
			runScenario(
				s,
				["advance", "--repo", "$REPO", "--run", "advance-degraded", "--json"],
				async ({ repo, home }) => {
					await createRun({ repo, home, run: "advance-degraded" });
					await markRequiredFields(repo, home, "advance-degraded");
				},
			),
	},
	"advance.degraded_with_force": {
		run: (s) =>
			runScenario(
				s,
				[
					"advance",
					"--repo",
					"$REPO",
					"--run",
					"advance-force",
					"--force",
					"--reason",
					"accepted degraded receipts",
					"--json",
				],
				async ({ repo, home }) => {
					await createRun({ repo, home, run: "advance-force" });
					await markRequiredFields(repo, home, "advance-force");
				},
			),
	},
	"mark.field_done": {
		run: (s) =>
			runScenario(
				s,
				[
					"mark",
					"--repo",
					"$REPO",
					"--run",
					"mark-done",
					"--field",
					"preview",
					"--status",
					"done",
					"--json",
				],
				({ repo, home }) => createRun({ repo, home, run: "mark-done" }),
			),
	},
	"mark.field_na": {
		run: (s) =>
			runScenario(
				s,
				[
					"mark",
					"--repo",
					"$REPO",
					"--run",
					"mark-na",
					"--field",
					"matrix",
					"--status",
					"na",
					"--reason",
					"single variant",
					"--json",
				],
				({ repo, home }) => createRun({ repo, home, run: "mark-na" }),
			),
	},
	"mark.field_blocked": {
		run: (s) =>
			runScenario(
				s,
				[
					"mark",
					"--repo",
					"$REPO",
					"--run",
					"mark-blocked",
					"--field",
					"preview",
					"--status",
					"blocked",
					"--reason",
					"preview unavailable",
					"--json",
				],
				({ repo, home }) => createRun({ repo, home, run: "mark-blocked" }),
			),
	},
	"mark.invalid_field": {
		run: (s) =>
			runScenario(s, [
				"mark",
				"--repo",
				"$REPO",
				"--field",
				"unknown",
				"--status",
				"done",
				"--json",
			]),
	},
	"mark.missing_run": {
		run: (s) =>
			runScenario(s, [
				"mark",
				"--repo",
				"$REPO",
				"--run",
				"missing",
				"--field",
				"preview",
				"--status",
				"done",
				"--json",
			]),
	},
	"doctor.corrupt_state": {
		run: (s) =>
			runScenario(
				s,
				["doctor", "--repo", "$REPO", "--run", "doctor-bad", "--json"],
				async ({ repo, home }) => {
					await createRun({ repo, home, run: "doctor-bad" });
					corruptRunState(home, "doctor-bad");
				},
			),
	},
	"purge.preview_required": {
		run: (s) =>
			runScenario(
				s,
				["purge", "--repo", "$REPO", "--run", "purge-preview", "--json"],
				({ repo, home }) => createRun({ repo, home, run: "purge-preview" }),
			),
	},
	"purge.force_run": {
		run: (s) =>
			runScenario(
				s,
				[
					"purge",
					"--repo",
					"$REPO",
					"--run",
					"purge-force",
					"--force",
					"--json",
				],
				({ repo, home }) => createRun({ repo, home, run: "purge-force" }),
			),
	},
	"purge.force_old_state": {
		run: (s) =>
			runScenario(
				s,
				[
					"purge",
					"--repo",
					"$REPO",
					"--older-than",
					"0d",
					"--force",
					"--json",
				],
				({ repo, home }) => createRun({ repo, home, run: "purge-old" }),
			),
	},
	"commands.docs_loop_discovery_json": {
		run: (s) => runScenario(s, ["commands", "--json"]),
	},
	"single.help_top_level": {
		run: async (station) => {
			const result = await runLoop(["--help"], { label: station.id });
			expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
			expect(result.stdout, describeCliProcessRun(result)).toContain("Usage:");
			return buildStationEvidence(station, result, {});
		},
	},
	"single.version_stdout": {
		run: async (station) => {
			const result = await runLoop(["--version"], { label: station.id });
			expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
			expect(result.stdout, describeCliProcessRun(result)).toContain(
				"storybook-docs-loop",
			);
			return buildStationEvidence(station, result, {});
		},
	},
};

describe("storybook-docs-loop Branch Station integration", () => {
	test("every catalog station has a process-boundary scenario row", () => {
		expect(Object.keys(stationScenarios).sort()).toEqual(
			storybookDocsLoopBranchStationCatalog.map((station) => station.id).sort(),
		);
	});

	test("catalog-driven process-boundary rows cover reachable stations", async () => {
		const evidence: BranchStationEvidence[] = [];
		for (const station of storybookDocsLoopBranchStationCatalog) {
			evidence.push(await stationScenarios[station.id].run(station));
		}
		const map = projectStorybookDocsLoopStationMap(evidence);
		const missingRequired = map.stations.filter(
			(station) =>
				station.classification === "required" &&
				station.evidence.status === "missing",
		);
		expect(missingRequired).toEqual([]);
		expect(map.findings).toEqual([]);
	});

	test("catalog validates against live command discovery", () => {
		const drift = findStorybookDocsLoopBranchStationCatalogDrift();
		const commandDrift = drift.filter(
			(d) => d.category === "station_references_unknown_command",
		);
		expect(commandDrift).toEqual([]);
	});
});
