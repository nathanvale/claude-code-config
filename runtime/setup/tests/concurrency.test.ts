import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { applySetup } from "../src/apply.ts";
import { inspectSetup, type SetupInspectionInput } from "../src/inspection.ts";
import { acquireOperationLock } from "../src/operation-lock.ts";
import { unlinkSetup } from "../src/unlink.ts";

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

	test("uses a stable target-derived project lock", async () => {
		const stateRoot = await mkdtemp(join(tmpdir(), "setup-lock-project-"));
		const first = await acquireOperationLock({ scope: "project", targetAnchor: "/repo/../repo", stateRoot });
		const second = await acquireOperationLock({ scope: "project", targetAnchor: "/repo", stateRoot });
		expect(first.status).toBe("acquired");
		expect(second.status).toBe("busy");
		if (first.status === "acquired") await first.release();
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
});
