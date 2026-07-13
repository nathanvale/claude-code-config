import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { BranchStationEvidence } from "@side-quest/cli-command-facade";
import {
	assertStationEnvelope,
	buildStationEvidence,
	describeCliProcessRun,
	runCliProcess,
	type CliProcessResult,
	type StationRuntimeEnvelope,
	type StationScenario,
} from "@side-quest/cli-command-facade/testing";

import {
	findSetupBranchStationCatalogDrift,
	projectSetupStationMap,
	setupBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import { STARTUP_LINKS } from "../src/startup-topology.ts";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_PATH = join(PACKAGE_ROOT, "src/cli.ts");
const FIXTURE_RUNNER = join(PACKAGE_ROOT, "tests/setup-process-fixture.ts");
const cleanup: string[] = [];

type SetupStation = (typeof setupBranchStationCatalog)[number];
type StationId = SetupStation["id"];

interface Fixture {
	root: string;
	source: string;
	home: string;
	state: string;
	hooks: string;
}

afterAll(async () => {
	for (const path of cleanup.reverse()) await rm(path, { recursive: true, force: true });
});

const stationScenarios = Object.fromEntries(
	setupBranchStationCatalog.map((station) => [station.id, { run: runStation }]),
) as Record<StationId, StationScenario<SetupStation>>;

describe("setup catalog-driven process evidence", () => {
	test("scenario keys stay exhaustive with the Branch Station catalog", () => {
		expect(Object.keys(stationScenarios).sort()).toEqual(
			setupBranchStationCatalog.map((station) => station.id).sort(),
		);
	});

	test("covers every declared TypeScript station through a real Bun process", async () => {
		const evidence: BranchStationEvidence[] = [];
		for (const station of setupBranchStationCatalog) {
			evidence.push(await stationScenarios[station.id].run(station));
		}
		expect(findSetupBranchStationCatalogDrift(evidence)).toEqual([]);
		const map = projectSetupStationMap(evidence);
		expect(map.findings).toEqual([]);
		expect(map.stations.every((entry) => entry.evidence.status === "covered")).toBe(true);
	}, 120_000);
});

async function runStation(station: SetupStation): Promise<BranchStationEvidence> {
	const fixture = await makeFixture(station.id.replaceAll(".", "-"));
	const scenario = await prepareScenario(station.id, fixture);
	const result = await runSetup(station, fixture, scenario.argv, scenario.fault, scenario.direct);
	const envelope = assertStationEnvelope(station, result);
	assertSetupStation(station, result, envelope);
	return buildStationEvidence(station, result, envelope);
}

async function prepareScenario(
	id: StationId,
	fixture: Fixture,
): Promise<{ argv: string[]; fault?: string; direct?: boolean }> {
	const [command] = id.split(".") as [string];
	const project = [command, "--scope", "project", "--repo", fixture.source, "--json"];
	const user = [command, "--json"];

	if (id.endsWith("invalid_usage")) return { argv: [command, "--bogus", "--json"] };
	if (id.endsWith("runtime_failure")) {
		return { argv: [command, "--json"], fault: command === "commands" ? "commands_runtime" : "runtime" };
	}
	if (id.endsWith("invalid_target")) {
		return {
			argv: [command, ...(id.includes("check_invalid") ? ["--check"] : []), "--scope", "project", "--repo", join(fixture.root, "missing"), "--json"],
			direct: true,
		};
	}

	switch (id) {
		case "status.healthy": await projectLinks(fixture); return { argv: project };
		case "status.clean_slate": return { argv: project };
		case "status.drift": await driftedProject(fixture); return { argv: project };
		case "status.blocked": await blockedProject(fixture); return { argv: project };
		case "doctor.healthy": await projectLinks(fixture); return { argv: project };
		case "doctor.repairable": return { argv: project };
		case "doctor.blocked": await blockedProject(fixture); return { argv: project };
		case "doctor.duplicate_scope": await duplicateScope(fixture); return { argv: project };
		case "doctor.setup_dependency_unhealthy": await healthyUser(fixture); return { argv: user, fault: "instruction" };
		case "doctor.stale_operation_lock": await operationLock(fixture, false); return { argv: project };
		case "sync.check_clean": await projectLinks(fixture); return { argv: [...project.slice(0, 1), "--check", ...project.slice(1)] };
		case "sync.check_changes": return { argv: [...project.slice(0, 1), "--check", ...project.slice(1)] };
		case "sync.check_blocked": await blockedProject(fixture); return { argv: [...project.slice(0, 1), "--check", ...project.slice(1)] };
		case "sync.applied": return { argv: project };
		case "sync.noop": await projectLinks(fixture); return { argv: project };
		case "sync.partial": await userSource(fixture, false); return { argv: user };
		case "sync.blocked": await blockedProject(fixture); return { argv: project };
		case "sync.concurrent_change": return { argv: project, fault: "concurrent" };
		case "sync.operation_busy": await operationLock(fixture, true); return { argv: project };
		case "sync.apply_failure": return { argv: project, fault: "apply_failure" };
		case "sync.hook_failure": await healthyUser(fixture); return { argv: user, fault: "hook" };
		case "sync.instruction_failure": await healthyUser(fixture); return { argv: user, fault: "instruction" };
		case "sync.runbook_failure": await healthyUser(fixture); await rm(join(fixture.source, "runbooks/issue-to-pr-v2/cli.ts")); return { argv: user };
		case "unlink.check_removable": await projectLinks(fixture); return { argv: [...project.slice(0, 1), "--check", ...project.slice(1)] };
		case "unlink.check_noop": return { argv: [...project.slice(0, 1), "--check", ...project.slice(1)] };
		case "unlink.check_blocked": await unsafeProjectRoot(fixture); return { argv: [...project.slice(0, 1), "--check", ...project.slice(1)] };
		case "unlink.removed": await projectLinks(fixture); return { argv: project };
		case "unlink.noop": return { argv: project };
		case "unlink.concurrent_change": await projectLinks(fixture); return { argv: project, fault: "unlink_concurrent" };
		case "unlink.operation_busy": await operationLock(fixture, true); return { argv: project };
		case "unlink.partial_failure": await projectLinks(fixture); return { argv: project, fault: "unlink_failure" };
		case "catalog.listed": return { argv: project };
		case "catalog.matched": return { argv: ["catalog", "alpha", ...project.slice(1)] };
		case "catalog.not_found": return { argv: ["catalog", "missing", ...project.slice(1)] };
		case "commands.catalog": return { argv: ["commands", "--json"] };
		default: throw new Error(`No process fixture for ${id}`);
	}
}

async function runSetup(
	station: SetupStation,
	fixture: Fixture,
	argv: readonly string[],
	fault = "none",
	direct = false,
): Promise<CliProcessResult> {
	return runCliProcess({
		label: station.id,
		argv: [process.execPath, direct ? CLI_PATH : FIXTURE_RUNNER, ...argv],
		cwd: PACKAGE_ROOT,
		env: {
			...process.env,
			HOME: fixture.home,
			SETUP_FIXTURE_SOURCE: fixture.source,
			SETUP_FIXTURE_HOME: fixture.home,
			SETUP_FIXTURE_STATE: fixture.state,
			SETUP_FIXTURE_HOOKS: fixture.hooks,
			SETUP_FIXTURE_FAULT: fault,
		},
	});
}

function assertSetupStation(
	station: SetupStation,
	result: CliProcessResult,
	envelope: StationRuntimeEnvelope,
): void {
	const data = envelope.data;
	if (station.id !== "commands.catalog") {
		expect(data?.station, describeCliProcessRun(result)).toBe(station.id);
	}
	if (station.expectedActionId) {
		expect(data?.next_action, describeCliProcessRun(result)).toBe(station.expectedActionId);
	}
	expect(result.stdout.trim().split("\n").filter((line) => line.startsWith("{")).length).toBe(1);
	if (result.stderr) expect(result.stderr).not.toContain('"status"');
}

async function makeFixture(prefix: string): Promise<Fixture> {
	const root = await mkdtemp(join(tmpdir(), `setup-station-${prefix}-`));
	cleanup.push(root);
	const fixture = {
		root,
		source: join(root, "source"),
		home: join(root, "home"),
		state: join(root, "state"),
		hooks: join(root, "hooks"),
	};
	await Promise.all(Object.values(fixture).slice(1).map((path) => mkdir(path, { recursive: true })));
	await writeSkill(fixture.source, "alpha");
	return fixture;
}

async function writeSkill(source: string, id: string): Promise<void> {
	await mkdir(join(source, "skills", id), { recursive: true });
	await writeFile(join(source, "skills", id, "SKILL.md"), `---\nname: ${id}\ndescription: ${id}\n---\n`);
}

async function projectLinks(fixture: Fixture): Promise<void> {
	for (const root of [".agents/skills", ".claude/skills"]) {
		const directory = join(fixture.source, root);
		await mkdir(directory, { recursive: true });
		await symlink(relative(directory, join(fixture.source, "skills/alpha")), join(directory, "alpha"));
	}
}

async function driftedProject(fixture: Fixture): Promise<void> {
	await writeSkill(fixture.source, "beta");
	await projectLinks(fixture);
	await rm(join(fixture.source, ".agents/skills/alpha"));
	await symlink(relative(join(fixture.source, ".agents/skills"), join(fixture.source, "skills/beta")), join(fixture.source, ".agents/skills/alpha"));
}

async function blockedProject(fixture: Fixture): Promise<void> {
	await mkdir(join(fixture.source, ".claude/skills"), { recursive: true });
	await writeFile(join(fixture.source, ".claude/skills/alpha"), "foreign\n");
}

async function unsafeProjectRoot(fixture: Fixture): Promise<void> {
	const outside = join(fixture.root, "outside");
	await mkdir(outside);
	await symlink(outside, join(fixture.source, ".claude"));
}

async function duplicateScope(fixture: Fixture): Promise<void> {
	await mkdir(join(fixture.home, ".claude/skills"), { recursive: true });
	await symlink(join(fixture.source, "skills/alpha"), join(fixture.home, ".claude/skills/alpha"));
}

async function userSource(fixture: Fixture, includeContext: boolean): Promise<void> {
	for (const entry of STARTUP_LINKS) {
		if (!includeContext && entry.source === "context") continue;
		const source = join(fixture.source, entry.source);
		if (entry.source.includes(".")) {
			await mkdir(dirname(source), { recursive: true });
			await writeFile(source, "fixture\n");
		} else {
			await mkdir(source, { recursive: true });
		}
	}
	await mkdir(join(fixture.source, "scripts/hooks"), { recursive: true });
	await writeFile(join(fixture.source, "scripts/hooks/pre-commit"), "hook\n");
	for (const directory of ["references", "templates", "lib"]) {
		await mkdir(join(fixture.source, "runbooks/issue-to-pr-v2", directory), { recursive: true });
		await writeFile(join(fixture.source, "runbooks/issue-to-pr-v2", directory, "item"), "x\n");
	}
	await writeFile(join(fixture.source, "runbooks/issue-to-pr-v2/cli.ts"), "export {};\n");
}

async function healthyUser(fixture: Fixture): Promise<void> {
	await userSource(fixture, true);
	for (const root of [".agents/skills", ".claude/skills"]) {
		const directory = join(fixture.home, root);
		await mkdir(directory, { recursive: true });
		await symlink(join(fixture.source, "skills/alpha"), join(directory, "alpha"));
	}
	for (const entry of STARTUP_LINKS) {
		const destination = join(fixture.home, entry.destination);
		await mkdir(dirname(destination), { recursive: true });
		await symlink(join(fixture.source, entry.source), destination);
	}
	await writeFile(join(fixture.hooks, "pre-commit"), "hook\n");
	await chmod(join(fixture.hooks, "pre-commit"), 0o755);
}

async function operationLock(fixture: Fixture, busy: boolean): Promise<void> {
	const target = await realpath(fixture.source);
	const digest = createHash("sha256").update(target).digest("hex").slice(0, 20);
	const lock = join(fixture.state, `project-${digest}.lock`);
	await mkdir(lock, { recursive: true });
	await writeFile(join(lock, "owner.json"), `${JSON.stringify({
		pid: busy ? process.pid : 999_999_999,
		token: "fixture",
		acquired_at: "2026-07-13T00:00:00.000Z",
	})}\n`);
}
