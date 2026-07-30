import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { inventoryBrowserUseMigration } from "./browser-use-migration";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
	makeVolatileOverlayFs,
	type VolatileOverlayFs,
} from "./browser-use-platform-test-helpers";
import type { RetentionDeps } from "./browser-use-retention";

const disposables: Array<{ dispose(): void }> = [];
const sourceRoots: string[] = [];
const overlays: VolatileOverlayFs[] = [];

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
	for (const overlay of overlays) overlay.dispose();
	for (const sourceRoot of sourceRoots) {
		rmSync(sourceRoot, { recursive: true, force: true });
	}
});

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function makeWorld(): Promise<{
	deps: RetentionDeps;
	sourceRoot: string;
	statePath: string;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const opened = await openBrowserUsePaths(createDefaultPlatformFs(), xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	const deps: RetentionDeps = {
		fs: createDefaultPlatformFs(),
		paths: opened.paths,
		clock: fixedClock().now,
	};
	const sourceRoot = mkdtempSync(join(tmpdir(), "bu-migration-v1-"));
	sourceRoots.push(sourceRoot);
	writeFileSync(join(sourceRoot, "runbook.md"), "safe runbook\n", {
		mode: 0o600,
	});
	mkdirSync(deps.paths.state.migrationsDir, {
		recursive: true,
		mode: 0o700,
	});
	return {
		deps,
		sourceRoot,
		statePath: join(deps.paths.state.migrationsDir, "migration-state.json"),
	};
}

function legacyStateRaw(sourceRoot: string): string {
	const state = {
		contract: "browser-use.migration-status",
		schema_version: "1",
		phase: "planned",
		snapshot_id: "snapshot-1111111111111111",
		snapshot_digest: "1".repeat(64),
		source_root_identity: sha256(`root:${normalize(sourceRoot)}`),
		source_entry_count: 1,
		disposition_count: 1,
		dispositions: [
			{
				source_relative_path: "runbook.md",
				source_content_hash: "2".repeat(64),
				disposition: "stage",
				reason: "legacy reviewed candidate",
				transform_version: "copy-v1",
				logical_destination_id: "knowledge/runbook.md",
				expected_hash: "2".repeat(64),
			},
		],
		staged_generation: null,
		last_apply_verified_noop: null,
		activation_state: "unchanged",
	};
	return `${JSON.stringify(state, null, 2)}\n`;
}

describe("migration inventory upgrades an exact schema-v1 ledger", () => {
	test("archives exact legacy bytes and replaces them with a fresh v2 inventory", async () => {
		const { deps, sourceRoot, statePath } = await makeWorld();
		const legacyRaw = legacyStateRaw(sourceRoot);
		writeFileSync(statePath, legacyRaw, { mode: 0o600 });

		const upgraded = await inventoryBrowserUseMigration(deps, sourceRoot);

		expect(upgraded).toMatchObject({
			ok: true,
			state: {
				schema_version: "2",
				phase: "inventoried",
				source_entry_count: 1,
				disposition_count: 0,
				dispositions: [],
				activation_state: "unchanged",
			},
		});
		const archivePath = join(
			deps.paths.state.migrationsDir,
			"legacy-state",
			`migration-state-v1-${sha256(legacyRaw)}.json`,
		);
		expect(readFileSync(archivePath, "utf8")).toBe(legacyRaw);
		expect(statSync(archivePath).mode & 0o777).toBe(0o600);
		expect(JSON.parse(readFileSync(statePath, "utf8"))).toMatchObject({
			schema_version: "2",
			phase: "inventoried",
		});
	});

	test("refuses a different source root without changing or archiving the ledger", async () => {
		const { deps, sourceRoot, statePath } = await makeWorld();
		const otherSourceRoot = mkdtempSync(join(tmpdir(), "bu-migration-v1-other-"));
		sourceRoots.push(otherSourceRoot);
		writeFileSync(join(otherSourceRoot, "runbook.md"), "other\n");
		const legacyRaw = legacyStateRaw(sourceRoot);
		writeFileSync(statePath, legacyRaw, { mode: 0o600 });

		expect(
			await inventoryBrowserUseMigration(deps, otherSourceRoot),
		).toMatchObject({
			ok: false,
			code: "migration_source_drift",
		});
		expect(readFileSync(statePath, "utf8")).toBe(legacyRaw);
		expect(() =>
			statSync(join(deps.paths.state.migrationsDir, "legacy-state")),
		).toThrow();
	});

	test("refuses malformed v1 state without changing or archiving it", async () => {
		const { deps, sourceRoot, statePath } = await makeWorld();
		const malformedRaw = legacyStateRaw(sourceRoot).replace(
			'"disposition_count": 1',
			'"disposition_count": 2',
		);
		writeFileSync(statePath, malformedRaw, { mode: 0o600 });

		expect(await inventoryBrowserUseMigration(deps, sourceRoot)).toMatchObject({
			ok: false,
			code: "migration_state_corrupt",
		});
		expect(readFileSync(statePath, "utf8")).toBe(malformedRaw);
		expect(() =>
			statSync(join(deps.paths.state.migrationsDir, "legacy-state")),
		).toThrow();
	});

	test("refuses semantically impossible v1 writer states", async () => {
		const { deps, sourceRoot, statePath } = await makeWorld();
		const base = JSON.parse(legacyStateRaw(sourceRoot)) as Record<
			string,
			unknown
		>;
		const dispositions = base.dispositions as Array<Record<string, unknown>>;
		const impossibleStates = [
			{
				...base,
				dispositions: [
					{
						...dispositions[0],
						expected_hash: "3".repeat(64),
					},
				],
			},
			{
				...base,
				dispositions: [
					{
						...dispositions[0],
						logical_destination_id: "other/runbook.md",
					},
				],
			},
			{
				...base,
				dispositions: [
					{
						...dispositions[0],
						transform_version: "copy-v2",
					},
				],
			},
			{
				...base,
				phase: "staged",
				staged_generation: "generation-4444444444444444",
				last_apply_verified_noop: false,
			},
			...["a//b", "a/./b", "a/"].map((sourcePath) => ({
				...base,
				dispositions: [
					{
						...dispositions[0],
						source_relative_path: sourcePath,
						logical_destination_id: `knowledge/${sourcePath}`,
					},
				],
			})),
		];

		for (const impossible of impossibleStates) {
			const raw = `${JSON.stringify(impossible, null, 2)}\n`;
			writeFileSync(statePath, raw, { mode: 0o600 });
			expect(await inventoryBrowserUseMigration(deps, sourceRoot)).toMatchObject({
				ok: false,
				code: "migration_state_corrupt",
			});
			expect(readFileSync(statePath, "utf8")).toBe(raw);
		}
	});

	test("accepts a canonical POSIX filename containing a backslash", async () => {
		const { deps, sourceRoot, statePath } = await makeWorld();
		const state = JSON.parse(legacyStateRaw(sourceRoot)) as Record<
			string,
			unknown
		>;
		const dispositions = state.dispositions as Array<Record<string, unknown>>;
		state.dispositions = [
			{
				...dispositions[0],
				source_relative_path: String.raw`run\book.md`,
				logical_destination_id: String.raw`knowledge/run\book.md`,
			},
		];
		const raw = `${JSON.stringify(state, null, 2)}\n`;
		writeFileSync(statePath, raw, { mode: 0o600 });

		expect(await inventoryBrowserUseMigration(deps, sourceRoot)).toMatchObject({
			ok: true,
			state: { schema_version: "2", phase: "inventoried" },
		});
	});

	test("refuses to trust an existing archive with public permissions", async () => {
		const { deps, sourceRoot, statePath } = await makeWorld();
		const legacyRaw = legacyStateRaw(sourceRoot);
		writeFileSync(statePath, legacyRaw, { mode: 0o600 });
		const archiveDir = join(
			deps.paths.state.migrationsDir,
			"legacy-state",
		);
		mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
		const archivePath = join(
			archiveDir,
			`migration-state-v1-${sha256(legacyRaw)}.json`,
		);
		writeFileSync(archivePath, legacyRaw, { mode: 0o600 });
		chmodSync(archivePath, 0o644);

		expect(await inventoryBrowserUseMigration(deps, sourceRoot)).toMatchObject({
			ok: false,
			code: "migration_collision",
		});
		expect(readFileSync(statePath, "utf8")).toBe(legacyRaw);
	});

	test("retry makes a visible archive durable before committing v2", async () => {
		const overlay = makeVolatileOverlayFs();
		overlays.push(overlay);
		const opened = await openBrowserUsePaths(overlay.fs, {
			HOME: "/home/agent",
			XDG_CONFIG_HOME: "/xdg/config",
			XDG_DATA_HOME: "/xdg/data",
			XDG_STATE_HOME: "/xdg/state",
			XDG_CACHE_HOME: "/xdg/cache",
		});
		if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
		const deps: RetentionDeps = {
			fs: overlay.fs,
			paths: opened.paths,
			clock: fixedClock().now,
		};
		const sourceRoot = "/legacy/v1-corpus";
		await deps.fs.mkdir(sourceRoot, { recursive: true, mode: 0o700 });
		await deps.fs.writeFileDurable(
			join(sourceRoot, "runbook.md"),
			"safe runbook\n",
			0o600,
		);
		await deps.fs.mkdir(deps.paths.state.migrationsDir, {
			recursive: true,
			mode: 0o700,
		});
		const statePath = join(
			deps.paths.state.migrationsDir,
			"migration-state.json",
		);
		const legacyRaw = legacyStateRaw(sourceRoot);
		await deps.fs.writeFileDurable(statePath, legacyRaw, 0o600);
		const archiveDir = join(
			deps.paths.state.migrationsDir,
			"legacy-state",
		);
		const archivePath = join(
			archiveDir,
			`migration-state-v1-${sha256(legacyRaw)}.json`,
		);
		let refusedArchiveFlush = false;
		overlay.hooks.onBeforeFsync = (path) => {
			if (path === archiveDir && !refusedArchiveFlush) {
				refusedArchiveFlush = true;
				throw Object.assign(new Error("simulated archive directory flush"), {
					code: "EIO",
				});
			}
		};

		expect(await inventoryBrowserUseMigration(deps, sourceRoot)).toMatchObject({
			ok: false,
			code: "store_flush_failed",
		});
		expect(await deps.fs.readTextFile(archivePath)).toBe(legacyRaw);

		overlay.hooks.onBeforeFsync = undefined;
		expect(await inventoryBrowserUseMigration(deps, sourceRoot)).toMatchObject({
			ok: true,
			state: { schema_version: "2" },
		});
		overlay.crash();

		expect(await deps.fs.readTextFile(archivePath)).toBe(legacyRaw);
		expect(JSON.parse(await deps.fs.readTextFile(statePath))).toMatchObject({
			schema_version: "2",
			phase: "inventoried",
		});
	});
});
