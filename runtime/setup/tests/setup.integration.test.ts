import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
import { createVaultGitHostEnrollment } from "../src/vault-git-host-enrollment.ts";
import {
	hashHookBytes,
	hookProvenanceIdentity,
	readHookProvenance,
} from "../src/hook-provenance.ts";
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

	test("cycles an explicit Git project through the production process entrypoint", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-production-project-"));
		cleanup.push(root);
		const project = join(root, "project");
		const home = join(root, "home");
		await mkdir(project);
		await mkdir(home);
		const initialized = Bun.spawnSync(["git", "-C", project, "init", "--quiet"]);
		expect(initialized.exitCode).toBe(0);
		await writeSkill(project, "alpha");

		const cases = [
			{ argv: ["sync", "--check"], exitCode: 1, station: "sync.check_changes" },
			{ argv: ["sync"], exitCode: 0, station: "sync.applied" },
			{ argv: ["status"], exitCode: 0, station: "status.healthy" },
			{ argv: ["unlink", "--check"], exitCode: 1, station: "unlink.check_removable" },
			{ argv: ["unlink"], exitCode: 0, station: "unlink.removed" },
		] as const;
		for (const entry of cases) {
			const result = await runCliProcess({
				label: `production:${entry.station}`,
				argv: [
					process.execPath,
					CLI_PATH,
					...entry.argv,
					"--scope",
					"project",
					"--repo",
					project,
					"--json",
				],
				cwd: PACKAGE_ROOT,
				env: { ...process.env, HOME: home },
			});
			expect(result.exitCode, describeCliProcessRun(result)).toBe(entry.exitCode);
			const envelope = JSON.parse(result.stdout) as { data?: { station?: string } };
			expect(envelope.data?.station, describeCliProcessRun(result)).toBe(entry.station);
		}

		for (const rootName of [".agents/skills", ".claude/skills"]) {
			expect(await lstat(join(project, rootName, "alpha")).then(() => true, () => false)).toBe(false);
		}
		expect(await Bun.file(join(project, "skills/alpha/SKILL.md")).exists()).toBe(true);
	}, 30_000);
});

describe("setup copied-hook migration process", () => {
	test.each([
		"pre-commit-setup-v1",
		"pre-commit-legacy-installer",
	] as const)("previews, migrates, verifies, and retains the %s predecessor", async (fixtureName) => {
		const fixture = await makeFixture(`migration-${fixtureName}`);
		const evidence = await prepareHookMigration(fixture, fixtureName);

		const preview = await runSetup(`${fixtureName}:preview`, fixture, ["sync", "--check", "--json"]);
		expect(preview.exitCode, describeCliProcessRun(preview)).toBe(1);
		expect(JSON.parse(preview.stdout).data.station).toBe("sync.check_changes");
		expect(await readFile(evidence.destination)).toEqual(evidence.predecessorBytes);
		expect(await Bun.file(evidence.identity.receipt_path).exists()).toBe(false);

		const applied = await runSetup(`${fixtureName}:apply`, fixture, ["sync", "--json"]);
		expect(applied.exitCode, describeCliProcessRun(applied)).toBe(0);
		expect(JSON.parse(applied.stdout).data.station).toBe("sync.applied");
		expect(await readFile(evidence.destination)).toEqual(evidence.sourceBytes);
		expect(await readHookProvenance(evidence.identity)).toMatchObject({
			status: "valid",
			receipt: {
				state: "stable",
				installed_digest: hashHookBytes(evidence.sourceBytes),
				source_digest: hashHookBytes(evidence.sourceBytes),
			},
		});

		const status = await runSetup(`${fixtureName}:status`, fixture, ["status", "--json"]);
		expect(status.exitCode, describeCliProcessRun(status)).toBe(0);
		expect(JSON.parse(status.stdout).data.station).toBe("status.healthy");

		const hookAfterSync = await readFile(evidence.destination);
		const receiptAfterSync = await readFile(evidence.identity.receipt_path);
		const unlinked = await runSetup(`${fixtureName}:unlink`, fixture, ["unlink", "--json"]);
		expect(unlinked.exitCode, describeCliProcessRun(unlinked)).toBe(0);
		expect(JSON.parse(unlinked.stdout).data.station).toBe("unlink.removed");
		expect(await readFile(evidence.destination)).toEqual(hookAfterSync);
		expect(await readFile(evidence.identity.receipt_path)).toEqual(receiptAfterSync);
	}, 30_000);

	test("preserves a one-byte predecessor variant without creating provenance", async () => {
		const fixture = await makeFixture("migration-one-byte-variant");
		const evidence = await prepareHookMigration(fixture, "pre-commit-setup-v1");
		const variant = Buffer.from(evidence.predecessorBytes);
		variant[0] = variant[0] === 0x23 ? 0x24 : 0x23;
		await writeFile(evidence.destination, variant, { mode: 0o755 });

		const preview = await runSetup("variant:preview", fixture, ["sync", "--check", "--json"]);
		expect(preview.exitCode, describeCliProcessRun(preview)).toBe(1);
		expect(JSON.parse(preview.stdout).data.station).toBe("sync.check_blocked");
		expect(await readFile(evidence.destination)).toEqual(variant);
		expect(await Bun.file(evidence.identity.receipt_path).exists()).toBe(false);

		const applied = await runSetup("variant:apply", fixture, ["sync", "--json"]);
		expect(applied.exitCode, describeCliProcessRun(applied)).toBe(1);
		expect(["sync.blocked", "sync.partial"]).toContain(JSON.parse(applied.stdout).data.station);
		expect(await readFile(evidence.destination)).toEqual(variant);
		expect(await Bun.file(evidence.identity.receipt_path).exists()).toBe(false);
	}, 30_000);
});

async function runStation(station: SetupStation): Promise<BranchStationEvidence> {
	const fixture = await makeFixture(station.id.replaceAll(".", "-"));
	const scenario = await prepareScenario(station.id, fixture);
	const before = await snapshotFixture(fixture);
	const result = await runSetup(station, fixture, scenario.argv, scenario.fault, scenario.direct, scenario.stdin);
	const after = await snapshotFixture(fixture);
	const envelope = assertStationEnvelope(station, result);
	assertSetupStation(station, result, envelope);
	assertMutationExpectation(station, before, after);
	return buildStationEvidence(station, result, envelope);
}

function assertMutationExpectation(
	station: SetupStation,
	before: readonly string[],
	after: readonly string[],
): void {
	const stable = new Set([
		"read_only",
		"no_runtime_state_read",
		"check_only",
		"fails_closed_without_writes",
	]);
	const changed = new Set([
		"writes_selected_safe_domains",
		"stops_remaining_writes",
		"stops_after_failed_syscall",
		"removes_proven_links",
		"stops_remaining_removals",
		"partial_proven_removal",
	]);
	const expectation = station.mutationExpectation;
	expect(
		stable.has(expectation) || changed.has(expectation),
		`${station.id}: unknown mutation expectation '${expectation}'`,
	).toBe(true);
	if (stable.has(expectation)) {
		expect(after, `${station.id}: ${expectation}`).toEqual(before);
	} else {
		expect(after, `${station.id}: ${expectation}`).not.toEqual(before);
	}
}

async function snapshotFixture(fixture: Fixture): Promise<readonly string[]> {
	const snapshot: string[] = [];
	for (const [name, path] of Object.entries(fixture).sort(([left], [right]) => left.localeCompare(right))) {
		await snapshotPath(path, name, snapshot);
	}
	return snapshot;
}

async function snapshotPath(path: string, label: string, snapshot: string[]): Promise<void> {
	let stat: Awaited<ReturnType<typeof lstat>>;
	try {
		stat = await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			snapshot.push(`${label}:missing`);
			return;
		}
		throw error;
	}
	if (stat.isSymbolicLink()) {
		snapshot.push(`${label}:link:${await readlink(path)}`);
		return;
	}
	if (stat.isDirectory()) {
		snapshot.push(`${label}:dir:${stat.mode & 0o777}`);
		for (const entry of (await readdir(path)).sort()) {
			await snapshotPath(join(path, entry), `${label}/${entry}`, snapshot);
		}
		return;
	}
	const digest = createHash("sha256").update(await readFile(path)).digest("hex");
	snapshot.push(`${label}:file:${stat.mode & 0o777}:${digest}`);
}

async function prepareScenario(
	id: StationId,
	fixture: Fixture,
): Promise<{ argv: string[]; fault?: string; direct?: boolean; stdin?: string }> {
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
		case "catalog.blocked": await rm(join(fixture.source, "skills/alpha/SKILL.md")); return { argv: ["catalog", "alpha", ...project.slice(1)] };
		case "catalog.not_found": return { argv: ["catalog", "missing", ...project.slice(1)] };
		case "commands.catalog": return { argv: ["commands", "--json"] };
		case "sync.vault_git_inputs_required":
			return { argv: ["sync", "--domain", "vault-git", "--check", "--json"] };
		case "sync.vault_git_selected": {
			await vaultGitSourceFixture(fixture);
			await enrollVaultGit(fixture, await vaultGitSshFixture(fixture));
			return { argv: ["sync", "--domain", "vault-git", "--check", "--json"] };
		}
		case "sync.vault_git_ssh_prerequisite":
			return {
				argv: ["sync", "--domain", "vault-git", "--check", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
				stdin: JSON.stringify({
					ssh_identity_file_path: join(fixture.root, "missing-identity"),
					ssh_public_key_path: join(fixture.root, "missing-identity.pub"),
					ssh_known_hosts_path: join(fixture.root, "missing-known-hosts"),
				}),
			};
		case "sync.vault_git_enrollment_ready":
			return {
				argv: ["sync", "--domain", "vault-git", "--check", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
				stdin: JSON.stringify(await vaultGitSshFixture(fixture)),
			};
		case "sync.vault_git_applied": {
			await vaultGitSourceFixture(fixture);
			return {
				argv: ["sync", "--domain", "vault-git", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
				stdin: JSON.stringify(await vaultGitSshFixture(fixture)),
			};
		}
		case "sync.vault_git_noop": {
			await vaultGitSourceFixture(fixture);
			const ssh = await vaultGitSshFixture(fixture);
			await enrollVaultGit(fixture, ssh);
			return {
				argv: ["sync", "--domain", "vault-git", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
				stdin: JSON.stringify(ssh),
			};
		}
		case "sync.vault_git_selection_blocked": {
			await vaultGitSourceFixture(fixture);
			await vaultGitActiveWork(fixture);
			return {
				argv: ["sync", "--domain", "vault-git", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
				stdin: JSON.stringify(await vaultGitSshFixture(fixture)),
			};
		}
		case "sync.vault_git_rollback_ready": {
			await vaultGitUpgradeFixture(fixture);
			return { argv: ["sync", "--domain", "vault-git", "--rollback", "--check", "--json"] };
		}
		case "sync.vault_git_rollback_applied": {
			await vaultGitUpgradeFixture(fixture);
			return { argv: ["sync", "--domain", "vault-git", "--rollback", "--json"] };
		}
		case "sync.vault_git_rollback_blocked": {
			await vaultGitUpgradeFixture(fixture);
			await vaultGitActiveWork(fixture);
			return { argv: ["sync", "--domain", "vault-git", "--rollback", "--json"] };
		}
		default: throw new Error(`No process fixture for ${id}`);
	}
}

function vaultGitEntrypoint(fixture: Fixture): string {
	return join(fixture.source, "runtime", "vault-git-transaction-manager", "src", "cli.ts");
}

async function vaultGitSourceFixture(fixture: Fixture, source = "station fixture vault git"): Promise<void> {
	const entrypoint = vaultGitEntrypoint(fixture);
	await mkdir(dirname(entrypoint), { recursive: true });
	await writeFile(entrypoint, `#!/usr/bin/env bun\nconsole.log(${JSON.stringify(source)});\n`);
	if (!(await Bun.file(join(fixture.source, ".git", "HEAD")).exists())) {
		vaultGitGit(fixture.source, ["init", "--initial-branch=main"]);
	}
	vaultGitGit(fixture.source, ["add", "."]);
	vaultGitGit(fixture.source, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", source]);
	vaultGitGit(fixture.source, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

async function vaultGitSshFixture(fixture: Fixture): Promise<Record<string, string>> {
	const identity = join(fixture.root, "repository-writer");
	const generated = Bun.spawnSync([
		"/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", identity,
	]);
	if (generated.exitCode !== 0) throw new Error("fixture ssh-keygen failed");
	const knownHosts = join(fixture.root, "known_hosts");
	await writeFile(
		knownHosts,
		"github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureReviewedHostKey\n",
	);
	await chmod(identity, 0o600);
	await chmod(knownHosts, 0o600);
	return {
		ssh_identity_file_path: identity,
		ssh_public_key_path: `${identity}.pub`,
		ssh_known_hosts_path: knownHosts,
	};
}

async function enrollVaultGit(fixture: Fixture, ssh: Record<string, string>): Promise<void> {
	const enrollment = createVaultGitHostEnrollment({
		configRoot: join(fixture.home, ".config", "context", "vault-git"),
		dataRoot: join(fixture.home, ".local", "share", "context", "vault-git"),
		selectorPath: join(fixture.home, ".bun", "bin", "vault-git"),
		sourceRepoRoot: fixture.source,
		runtimeEntrypoint: vaultGitEntrypoint(fixture),
		inspectWorkState: async () => "clear",
	});
	const result = await enrollment.apply({
		sshIdentityFilePath: ssh.ssh_identity_file_path as string,
		sshPublicKeyPath: ssh.ssh_public_key_path as string,
		sshKnownHostsPath: ssh.ssh_known_hosts_path as string,
	});
	if (result.state !== "applied" && result.state !== "noop") {
		throw new Error(`vault-git enrollment fixture failed: ${result.state}`);
	}
}

async function vaultGitUpgradeFixture(fixture: Fixture): Promise<void> {
	await vaultGitSourceFixture(fixture);
	const ssh = await vaultGitSshFixture(fixture);
	await enrollVaultGit(fixture, ssh);
	await vaultGitSourceFixture(fixture, "station fixture vault git two");
	await enrollVaultGit(fixture, ssh);
}

async function vaultGitActiveWork(fixture: Fixture): Promise<void> {
	const receipt = join(
		fixture.home, ".local", "state", "vault-git-transaction-manager",
		"c".repeat(64), "current.json",
	);
	await mkdir(dirname(receipt), { recursive: true, mode: 0o700 });
	await writeFile(receipt, `${JSON.stringify({ phase: "writing" })}\n`, { mode: 0o600 });
}

function vaultGitGit(cwd: string, args: readonly string[]): void {
	const result = Bun.spawnSync(["/usr/bin/git", ...args], {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
	});
	if (result.exitCode !== 0) {
		throw new Error(`vault-git fixture git ${args[0] ?? "command"} failed`);
	}
}

async function runSetup(
	label: SetupStation | string,
	fixture: Fixture,
	argv: readonly string[],
	fault = "none",
	direct = false,
	stdin?: string,
): Promise<CliProcessResult> {
	return runCliProcess({
		label: typeof label === "string" ? label : label.id,
		argv: [process.execPath, direct ? CLI_PATH : FIXTURE_RUNNER, ...argv],
		cwd: PACKAGE_ROOT,
		...(stdin === undefined ? {} : { stdin }),
		env: {
			...process.env,
			HOME: fixture.home,
			XDG_CONFIG_HOME: join(fixture.home, ".config"),
			XDG_DATA_HOME: join(fixture.home, ".local", "share"),
			XDG_STATE_HOME: join(fixture.home, ".local", "state"),
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

async function prepareHookMigration(
	fixture: Fixture,
	fixtureName: "pre-commit-setup-v1" | "pre-commit-legacy-installer",
) {
	await userSource(fixture, true);
	const source = join(fixture.source, "scripts/hooks/pre-commit");
	const destination = join(fixture.hooks, "pre-commit");
	const sourceBytes = await readFile(join(PACKAGE_ROOT, "../../scripts/hooks/pre-commit"));
	const predecessorBytes = await readFile(join(PACKAGE_ROOT, `tests/fixtures/${fixtureName}`));
	await writeFile(source, sourceBytes, { mode: 0o755 });
	await writeFile(destination, predecessorBytes, { mode: 0o755 });
	await chmod(source, 0o755);
	await chmod(destination, 0o755);
	const identity = await hookProvenanceIdentity({
		stateRoot: fixture.state,
		hookDirectory: fixture.hooks,
		hookName: "pre-commit",
	});
	return { source, destination, sourceBytes, predecessorBytes, identity };
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
