import { lstat, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { applySetup } from "../src/apply.ts";
import { inspectSetup, type SetupInspectionInput } from "../src/inspection.ts";
import { acquireOperationLock, acquireVisibilityLocks, inspectOperationLock } from "../src/operation-lock.ts";
import { unlinkSetup } from "../src/unlink.ts";
import { applySetupDomains } from "../src/setup-domains.ts";

describe("setup operation lock", () => {
	test("serializes one user mutation across callers", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "setup-lock-"));
		const first = await acquireOperationLock({ scope: "user", targetAnchor: "/home/a", stateRoot });
		const second = await acquireOperationLock({ scope: "user", targetAnchor: "/home/b", stateRoot });
		expect(first.status).toBe("acquired");
		expect(second.status).toBe("busy");
		if (first.status === "acquired") await first.release();
	});

	test("diagnoses stale evidence without reclaiming it", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "setup-lock-stale-"));
		const lockPath = join(stateRoot, "user.lock");
		await mkdir(lockPath);
		await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: 99999999, token: "old" }));

		const result = await acquireOperationLock({ scope: "user", targetAnchor: "/home", stateRoot });
		expect(result).toMatchObject({ status: "stale", path: lockPath });
		expect(await Bun.file(join(lockPath, "owner.json")).exists()).toBe(true);
	});

	test("inspects stale evidence without creating a missing lock", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "setup-lock-inspect-"));
		const missing = await inspectOperationLock({ scope: "user", targetAnchor: "/home", stateRoot });
		expect(missing.status).toBe("missing");
		const lockPath = join(stateRoot, "user.lock");
		await mkdir(lockPath);
		await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: 99999999, token: "old" }));
		const stale = await inspectOperationLock({ scope: "user", targetAnchor: "/home", stateRoot });
		expect(stale).toMatchObject({ status: "stale", path: lockPath });
	});

	test("uses a stable target-derived project lock", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "setup-lock-project-"));
		const first = await acquireOperationLock({ scope: "project", targetAnchor: "/repo/../repo", stateRoot });
		const second = await acquireOperationLock({ scope: "project", targetAnchor: "/repo", stateRoot });
		expect(first.status).toBe("acquired");
		expect(second.status).toBe("busy");
		if (first.status === "acquired") await first.release();
	});

	test("keeps unrelated canonical ids independently writable", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "setup-lock-visibility-"));
		const alpha = await acquireVisibilityLocks({ canonicalIds: ["alpha"], stateRoot });
		const beta = await acquireVisibilityLocks({ canonicalIds: ["beta"], stateRoot });
		expect(alpha.status).toBe("acquired");
		expect(beta.status).toBe("acquired");
		if (beta.status === "acquired") await beta.release();
		if (alpha.status === "acquired") await alpha.release();
	});

	test("releases earlier canonical-id locks when a later id is busy", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "setup-lock-visibility-rollback-"));
		const beta = await acquireVisibilityLocks({ canonicalIds: ["beta"], stateRoot });
		const contender = await acquireVisibilityLocks({ canonicalIds: ["alpha", "beta"], stateRoot });
		const alpha = await acquireVisibilityLocks({ canonicalIds: ["alpha"], stateRoot });
		expect(beta.status).toBe("acquired");
		expect(contender.status).toBe("busy");
		expect(alpha.status).toBe("acquired");
		if (alpha.status === "acquired") await alpha.release();
		if (beta.status === "acquired") await beta.release();
	});

	test("serializes sync and unlink through the same scope lock", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-lock-mutations-"));
		const source = join(root, "source");
		const home = join(root, "home");
		const stateRoot = join(root, "state");
		await mkdir(join(source, "skills/alpha"), { recursive: true });
		await writeFile(join(source, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
		await mkdir(home);
		const input: SetupInspectionInput = { scope: "user", sourceRepoRoot: source, homeDir: home };
		let continueInspection = () => {};
		const held = new Promise<void>((resolve) => { continueInspection = resolve; });
		let inspectionEntered = () => {};
		const entered = new Promise<void>((resolve) => { inspectionEntered = resolve; });
		const sync = applySetup(input, {
			stateRoot,
			inspect: async (nextInput) => {
				inspectionEntered();
				await held;
				return inspectSetup(nextInput);
			},
		});
		await entered;
		const unlink = await unlinkSetup(input, { stateRoot });
		expect(unlink).toMatchObject({ state: "blocked", station: "unlink.operation_busy" });
		continueInspection();
		expect((await sync).station).toBe("sync.applied");
	});

	test("allows only one same-id user and project apply", async () => {
		const fixture = await crossScopeFixture();
		let continueUser = () => {};
		const held = new Promise<void>((resolve) => { continueUser = resolve; });
		let userEntered = () => {};
		const entered = new Promise<void>((resolve) => { userEntered = resolve; });
		let paused = false;
		const user = applySetup(fixture.userInput, {
			stateRoot: fixture.stateRoot,
			beforeSymlink: async () => {
				if (paused) return;
				paused = true;
				userEntered();
				await held;
			},
		});
		await entered;

		const project = await applySetup(fixture.projectInput, { stateRoot: fixture.stateRoot });
		expect(project).toMatchObject({ state: "blocked", station: "sync.operation_busy" });
		expect(project.findings).toEqual([expect.objectContaining({ id: "operation_busy", repair: "retry" })]);
		continueUser();
		expect(await user).toMatchObject({ state: "applied", station: "sync.applied" });

		expect(await exists(join(fixture.home, ".claude/skills/alpha"))).toBe(true);
		expect(await exists(join(fixture.home, ".agents/skills/alpha"))).toBe(true);
		expect(await exists(join(fixture.project, ".claude/skills/alpha"))).toBe(false);
		expect(await exists(join(fixture.project, ".agents/skills/alpha"))).toBe(false);
		expect((await inspectSetup(fixture.projectInput)).duplicate_scope_ids).toEqual(["alpha"]);
	});

	test("keeps same-id project apply out while user unlink owns visibility", async () => {
		const fixture = await crossScopeFixture();
		await applySetup(fixture.userInput, { stateRoot: fixture.stateRoot });
		let continueUnlink = () => {};
		const held = new Promise<void>((resolve) => { continueUnlink = resolve; });
		let unlinkEntered = () => {};
		const entered = new Promise<void>((resolve) => { unlinkEntered = resolve; });
		let paused = false;
		const unlink = unlinkSetup(fixture.userInput, {
			stateRoot: fixture.stateRoot,
			beforeRemove: async () => {
				if (paused) return;
				paused = true;
				unlinkEntered();
				await held;
			},
		});
		await entered;

		const project = await applySetup(fixture.projectInput, { stateRoot: fixture.stateRoot });
		expect(project).toMatchObject({ state: "blocked", station: "sync.operation_busy" });
		continueUnlink();
		expect(await unlink).toMatchObject({ state: "removed", station: "unlink.removed" });
		expect(await exists(join(fixture.project, ".agents/skills/alpha"))).toBe(false);
	});

	test("serializes hook and receipt mutation through the existing user lock", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-hook-lock-"));
		const source = join(root, "source");
		const home = join(root, "home");
		const hooks = join(root, "hooks");
		const stateRoot = join(root, "state");
		await mkdir(join(source, "skills"), { recursive: true });
		await mkdir(join(source, "scripts/hooks"), { recursive: true });
		await mkdir(home);
		await mkdir(hooks);
		await writeFile(join(source, "scripts/hooks/pre-commit"), "hook\n", { mode: 0o755 });
		for (const directory of ["lib", "references", "templates"]) {
			await mkdir(join(source, "runbooks/issue-to-pr-v2", directory), { recursive: true });
			await writeFile(join(source, "runbooks/issue-to-pr-v2", directory, "item"), "fixture\n");
		}
		await writeFile(join(source, "runbooks/issue-to-pr-v2/cli.ts"), "fixture\n");
		const input: SetupInspectionInput = { scope: "user", sourceRepoRoot: source, homeDir: home };
		let releaseMutation = () => {};
		const held = new Promise<void>((resolve) => { releaseMutation = resolve; });
		let mutationEntered = () => {};
		const entered = new Promise<void>((resolve) => { mutationEntered = resolve; });
		const first = applySetupDomains(input, {
			stateRoot,
			hookPath: async () => hooks,
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			beforeHookMutation: async (phase) => {
				if (phase !== "pending_receipt") return;
				mutationEntered();
				await held;
			},
		});
		await entered;

		const second = await applySetupDomains(input, {
			stateRoot,
			hookPath: async () => { throw new Error("hook inspection must remain behind the lock"); },
			instructionRunner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		});
		expect(second).toMatchObject({ state: "blocked", station: "sync.operation_busy" });
		releaseMutation();
		expect((await first).domains.find((domain) => domain.domain === "hooks")?.failed).toEqual([]);
	});
});

async function crossScopeFixture() {
	const root = await mkdtemp(join(tmpdir(), "setup-lock-cross-scope-"));
	const source = join(root, "source");
	const home = join(root, "home");
	const project = join(root, "project");
	const stateRoot = join(root, "state");
	for (const catalog of [join(source, "skills/alpha"), join(project, "skills/alpha")]) {
		await mkdir(catalog, { recursive: true });
		await writeFile(join(catalog, "SKILL.md"), "---\nname: alpha\ndescription: alpha\n---\n");
	}
	await mkdir(home);
	return {
		home,
		project,
		stateRoot,
		userInput: { scope: "user", sourceRepoRoot: source, homeDir: home } satisfies SetupInspectionInput,
		projectInput: { scope: "project", sourceRepoRoot: source, projectRepoRoot: project, homeDir: home } satisfies SetupInspectionInput,
	};
}

async function exists(path: string): Promise<boolean> {
	return lstat(path).then(() => true, () => false);
}
