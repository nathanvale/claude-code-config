import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserUseCorpusCensus } from "./browser-use-migration-model";
import {
	applyBrowserUseMigration,
	inventoryBrowserUseMigration,
	planBrowserUseMigration,
} from "./browser-use-migration";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
	makeVolatileOverlayFs,
	type VolatileOverlayFs,
} from "./browser-use-platform-test-helpers";
import type { RetentionDeps } from "./browser-use-retention";
import { generationRecordPath } from "./browser-use-retention";
import { readDurableFile } from "./browser-use-store";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { runForTest } from "./browser-use";

// =========================================================================
// Migration and legacy corpus acceptance (DDA-K01..K05).
//
// K01 (C,E): `migration status` reports each corpus state from the installed
//   CLI — empty, legacy-present (inventoried/planned), migrated (verified).
// K02 (C,E,H): `migration inventory` and `migration plan` are strictly
//   read-only — a byte+hash filesystem snapshot of the source is unchanged.
// K03 (C,H): `migration apply` is idempotent and resumable — a crash mid-apply
//   then a rerun converges to the same staged terminal state; a double apply
//   reports a verified no-op. Driven on the volatile-overlay fake at the
//   hermetic tier (mirrors the retention V2 crash-resume idiom).
// K04 (C,H): legacy source bytes are never modified until `migration verify`
//   passes — the source tree hash is identical across inventory, plan, apply,
//   and verify.
// K05 (C,H): a secret-positive Import Candidate is refused per candidate and
//   reported (`quarantine-secret`), while safe siblings still `stage`.
// =========================================================================

const disposables: { dispose(): void }[] = [];
const overlays: VolatileOverlayFs[] = [];

const FIXTURES = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
);
const safeCorpus = join(FIXTURES, "safe-corpus");
const classificationCorpus = join(FIXTURES, "classification-corpus");
// A hermetic scaled mirror of the dotfiles corpus shape with KNOWN counts:
// two portals, three formal artifacts (playbooks), four scripts (two of which
// are also domain-script actions), one auth narrative, one login capability,
// two Target Flows, and two Oncore-style fill-timesheet candidates for one
// canonical flow. Counts are asserted directly rather than against the live
// corpus, which the plan documents as a moving R3 baseline.
const corpusBaseline = join(FIXTURES, "corpus-baseline");
const KNOWN_BASELINE_CENSUS: BrowserUseCorpusCensus = {
	formal_artifacts: 3,
	target_flows: 2,
	scripts: 4,
	auth_narratives: 1,
	login_capabilities: 1,
	domain_script_actions: 2,
};

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
	for (const overlay of overlays) overlay.dispose();
});

// A byte+hash filesystem snapshot of a directory tree, sorted by relative
// path. Two snapshots comparing equal proves the source was untouched.
function snapshotTree(root: string): Array<[string, string]> {
	const rows: Array<[string, string]> = [];
	const walk = (dir: string, prefix: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		)) {
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path, rel);
				continue;
			}
			rows.push([
				rel,
				createHash("sha256").update(readFileSync(path)).digest("hex"),
			]);
		}
	};
	walk(root, "");
	return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// Overlay-backed world over fictitious XDG roots (retention V2 idiom). The
// source corpus is seeded into the same overlay so migration reads it through
// the crash-injecting fs.
async function makeOverlayWorld(): Promise<{
	overlay: VolatileOverlayFs;
	deps: RetentionDeps;
}> {
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
	return {
		overlay,
		deps: { fs: overlay.fs, paths: opened.paths, clock: fixedClock().now },
	};
}

// Seed a safe single-file corpus into an overlay-mapped source root.
async function seedOverlaySource(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<void> {
	await deps.fs.mkdir(sourceRoot, { recursive: true, mode: 0o700 });
	await deps.fs.writeFileDurable(
		join(sourceRoot, "note.md"),
		"safe knowledge\n",
		0o600,
	);
}

describe("DDA-K01 migration status reports each corpus state", () => {
	test("empty corpus reports phase empty; legacy-present reports inventoried then planned; migrated reports verified", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		// Empty corpus: no durable migration state exists yet.
		const empty = await runForTest(["migration", "status", "--json"], runtime);
		expect(empty.exitCode).toBe(0);
		expect(parseJson(empty.stdout).data).toMatchObject({
			contract: "browser-use.migration-status",
			phase: "empty",
			snapshot_id: null,
			source_entry_count: 0,
			disposition_count: 0,
			staged_generation: null,
			activation_state: "unchanged",
		});

		// Legacy-present, freshly inventoried.
		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", safeCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		expect(
			parseJson(
				(await runForTest(["migration", "status", "--json"], runtime)).stdout,
			).data,
		).toMatchObject({
			phase: "inventoried",
			source_entry_count: 1,
			disposition_count: 0,
			staged_generation: null,
		});

		// Legacy-present, planned.
		expect(
			(
				await runForTest(
					["migration", "plan", "--source", safeCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		expect(
			parseJson(
				(await runForTest(["migration", "status", "--json"], runtime)).stdout,
			).data,
		).toMatchObject({ phase: "planned", disposition_count: 1 });

		// Migrated: apply then verify.
		expect(
			(
				await runForTest(
					["migration", "apply", "--source", safeCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		expect(
			(
				await runForTest(
					["migration", "verify", "--source", safeCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const migrated = await runForTest(["migration", "status", "--json"], runtime);
		expect(migrated.exitCode).toBe(0);
		expect(parseJson(migrated.stdout).data).toMatchObject({
			phase: "verified",
			source_entry_count: 1,
			disposition_count: 1,
			staged_generation: expect.stringMatching(/^generation-[0-9a-f]{16}$/),
			activation_state: "unchanged",
		});
	});
});

describe("DDA-K02 inventory and plan are strictly read-only", () => {
	test("the source filesystem snapshot is byte-identical before and after inventory and plan", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		const before = snapshotTree(classificationCorpus);
		expect(before.length).toBeGreaterThan(0);

		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", classificationCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const afterInventory = snapshotTree(classificationCorpus);
		expect(afterInventory).toEqual(before);

		expect(
			(
				await runForTest(
					["migration", "plan", "--source", classificationCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const afterPlan = snapshotTree(classificationCorpus);
		expect(afterPlan).toEqual(before);
	});
});

describe("DDA-K03 apply is idempotent and resumable", () => {
	test("a crash mid-apply leaves no committed generation; a rerun converges and a double apply reports a verified no-op", async () => {
		const { overlay, deps } = await makeOverlayWorld();
		const sourceRoot = "/legacy/k03-corpus";
		await seedOverlaySource(deps, sourceRoot);

		expect((await inventoryBrowserUseMigration(deps, sourceRoot)).ok).toBe(true);
		expect((await planBrowserUseMigration(deps, sourceRoot)).ok).toBe(true);

		// Crash on the generation record's own temp-file flush, AFTER the staged
		// tree has flushed. `stageGeneration` writes `<generationsDir>/<id>.json`
		// last via writeDurableFile, so its temp path is the deepest `.json`
		// flush under the generations dir — distinct from the staged files that
		// live under `<generationsDir>/<id>/...`.
		const recordFlushPrefix = join(deps.paths.state.generationsDir, "generation-");
		overlay.hooks.onBeforeFsync = (path) => {
			if (path.startsWith(recordFlushPrefix) && /\.json(?:\.tmp|$)/.test(path)) {
				overlay.hooks.onBeforeFsync = undefined;
				overlay.crash();
			}
		};
		const crashed = await applyBrowserUseMigration(deps, sourceRoot);
		expect(crashed).toMatchObject({ ok: false });

		// Rerun converges to the staged terminal state.
		const reran = await applyBrowserUseMigration(deps, sourceRoot);
		expect(reran).toMatchObject({
			ok: true,
			state: {
				phase: "staged",
				last_apply_verified_noop: false,
				activation_state: "unchanged",
			},
		});
		if (!reran.ok) throw new Error("unreachable");
		const generationId = reran.state.staged_generation;
		expect(generationId).toMatch(/^generation-[0-9a-f]{16}$/);
		expect(
			await readDurableFile(
				deps.fs,
				generationRecordPath(deps.paths, generationId as string),
			),
		).toMatchObject({ status: "present" });

		// Double apply is a verified no-op: same terminal state, same generation.
		const again = await applyBrowserUseMigration(deps, sourceRoot);
		expect(again).toMatchObject({
			ok: true,
			state: {
				phase: "staged",
				last_apply_verified_noop: true,
				staged_generation: generationId,
				activation_state: "unchanged",
			},
		});
	});
});

describe("DDA-K04 legacy source is never modified until verify passes", () => {
	test("the source tree hash is identical across inventory, plan, apply, and verify", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		const frozen = snapshotTree(safeCorpus);
		expect(frozen.length).toBe(1);

		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", safeCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		expect(snapshotTree(safeCorpus)).toEqual(frozen);

		expect(
			(
				await runForTest(
					["migration", "plan", "--source", safeCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		expect(snapshotTree(safeCorpus)).toEqual(frozen);

		expect(
			(
				await runForTest(
					["migration", "apply", "--source", safeCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		// Apply stages an INACTIVE copy; the legacy source is still untouched.
		expect(snapshotTree(safeCorpus)).toEqual(frozen);

		const verified = await runForTest(
			["migration", "verify", "--source", safeCorpus, "--json"],
			runtime,
		);
		expect(verified.exitCode).toBe(0);
		expect(parseJson(verified.stdout).data).toMatchObject({ phase: "verified" });
		// Verify is a hash proof, not a mutation; the source is still untouched.
		expect(snapshotTree(safeCorpus)).toEqual(frozen);
	});
});

describe("DDA-K05 secret-positive candidates are refused per candidate", () => {
	test("plan quarantines each secret-bearing candidate by name while safe siblings still stage", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", classificationCorpus, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const planned = await runForTest(
			["migration", "plan", "--source", classificationCorpus, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(0);
		const dispositions = (
			parseJson(planned.stdout).data as Record<string, unknown>
		).dispositions as Array<Record<string, unknown>>;
		const byPath = new Map(
			dispositions.map((row) => [
				row.source_relative_path as string,
				row,
			]),
		);

		// Each secret candidate is refused per candidate and named in the plan.
		for (const secretCandidate of ["credentials.txt", "client-secret.env"]) {
			const row = byPath.get(secretCandidate);
			expect(row?.disposition).toBe("quarantine-secret");
			// Never salvaged: no destination, no expected hash.
			expect(row?.logical_destination_id).toBeNull();
			expect(row?.expected_hash).toBeNull();
			expect(row?.reason).toMatch(/inactive/);
		}

		// A safe sibling still proceeds to stage in the same plan.
		const safe = byPath.get("service.yml");
		expect(safe?.disposition).toBe("stage");
		expect(safe?.logical_destination_id).toBe("knowledge/service.yml");

		// The refusal is per candidate, not a whole-corpus abort: the plan itself
		// succeeds and every entry carries one disposition.
		expect(
			(parseJson(planned.stdout).data as Record<string, unknown>).disposition_count,
		).toBe(dispositions.length);
	});
});

// =========================================================================
// U1 corpus classification, census, and canonical provenance (R1-R7,
// AE1-AE2).
//
// The plan requires migration scope + provenance to be mechanically complete:
// artifact class, formal-flow identity, canonical-target id, overlapping count
// assertions, and count-drift refusal — all emitted through the migration
// ledger, never encoded in prose.
// =========================================================================

// Copy a fixture tree into a mutable temp dir so a test may add/remove/rename
// entries without touching the read-only committed fixture.
const mutableCopies: string[] = [];
afterAll(() => {
	for (const dir of mutableCopies) rmSync(dir, { recursive: true, force: true });
});
function mutableCopyOf(fixtureRoot: string): string {
	const dest = realpathSync(mkdtempSync(join(tmpdir(), "bu-mig-copy-")));
	mutableCopies.push(dest);
	cpSync(fixtureRoot, dest, { recursive: true });
	return dest;
}

// Open real store deps over a temp XDG env so a test may call the migration
// engine directly (the census-drift gate is an engine parameter in U1, not yet
// a CLI flag).
async function openDeps(
	env: Record<string, string | undefined>,
): Promise<RetentionDeps> {
	const opened = await openBrowserUsePaths(createDefaultPlatformFs(), env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		fs: createDefaultPlatformFs(),
		paths: opened.paths,
		clock: fixedClock().now,
	};
}

describe("U1 corpus census and classification", () => {
	test("known baseline produces the expected overlapping census, per-class dispositions, and canonical provenance edges", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", corpusBaseline, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const planned = await runForTest(
			["migration", "plan", "--source", corpusBaseline, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(0);
		const data = parseJson(planned.stdout).data as Record<string, unknown>;

		// R3 overlapping count assertions: a domain-script action is counted in
		// BOTH scripts and domain_script_actions; a `### <name>` heading without
		// the `Flow:` prefix does NOT inflate target_flows.
		expect(data.corpus_census).toEqual(KNOWN_BASELINE_CENSUS);

		// Every entry carries exactly one classified artifact class (R2).
		const dispositions = data.dispositions as Array<Record<string, unknown>>;
		const classByPath = Object.fromEntries(
			dispositions.map((row) => [
				row.source_relative_path,
				row.artifact_class,
			]),
		);
		expect(classByPath).toMatchObject({
			"acme-portal/acme-portal.md": "domain-prose",
			"acme-portal/capabilities/login.yaml": "login-capability",
			"acme-portal/domain-script-actions/diagnose-grid-state.js":
				"domain-script-action",
			"acme-portal/domain-script-actions/fill-entry.js": "domain-script-action",
			"acme-portal/playbooks/fill-timesheet-a-2026-01-01.json": "formal-playbook",
			"acme-portal/playbooks/fill-timesheet-b-2026-02-02.json": "formal-playbook",
			"acme-portal/runbook-acme-login.md": "auth-narrative",
			"acme-portal/runs/run-1/note.txt": "run-evidence",
			"acme-portal/scripts/fill-week.js": "script",
			"beta-portal/beta-portal.md": "domain-prose",
			"beta-portal/playbooks/extract-data.yaml": "formal-playbook",
			"beta-portal/scripts/list-data.js": "script",
		});

		// AE2 / R4: the two fill-timesheet candidates resolve to ONE canonical
		// flow whose provenance lists BOTH sources — one intent, two candidates,
		// distinct dispositions, one canonical id.
		const canonicalTargets = data.canonical_targets as Array<
			Record<string, unknown>
		>;
		const oncore = canonicalTargets.find(
			(row) => row.canonical_target_id === "acme-portal/fill-timesheet",
		);
		expect(oncore?.source_relative_paths).toEqual([
			"acme-portal/playbooks/fill-timesheet-a-2026-01-01.json",
			"acme-portal/playbooks/fill-timesheet-b-2026-02-02.json",
		]);
		// Both candidate rows still carry their own disposition + provenance edge.
		for (const candidate of [
			"acme-portal/playbooks/fill-timesheet-a-2026-01-01.json",
			"acme-portal/playbooks/fill-timesheet-b-2026-02-02.json",
		]) {
			const row = dispositions.find(
				(entry) => entry.source_relative_path === candidate,
			);
			expect(row?.canonical_target_id).toBe("acme-portal/fill-timesheet");
			expect(row?.formal_flow_id).toBe("acme-portal/fill-timesheet");
		}

		// No executable or secret-positive entry ever stages as trusted.
		for (const row of dispositions) {
			if (
				row.artifact_class === "script" ||
				row.artifact_class === "domain-script-action"
			) {
				expect(row.disposition).toBe("quarantine-executable");
			}
		}
	});

	test("AE1: adding an unclassified/new source makes planning refuse against the recorded baseline with count drift", async () => {
		const source = mutableCopyOf(corpusBaseline);
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		// The pristine copy still matches the known baseline census.
		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", source, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const clean = await planBrowserUseMigration(
			await openDeps(xdg.env),
			source,
			KNOWN_BASELINE_CENSUS,
		);
		expect(clean).toMatchObject({ ok: true });

		// Add one new formal playbook: the census now has 4 formal artifacts,
		// so a plan gated on the frozen baseline refuses with migration_count_drift
		// and its drifting field named — planning is blocked until the new entry
		// is accounted for.
		writeFileSync(
			join(source, "acme-portal", "playbooks", "fill-timesheet-c-2026-03-03.json"),
			`${JSON.stringify({
				candidate: {
					id: "acme-fill-timesheet-c",
					domain: "acme-portal",
					flow: "fill-timesheet",
					lifecycleState: "local_candidate",
					steps: [{ id: "s1", kind: "open", action: "open" }],
				},
			})}\n`,
		);
		// Re-inventory to freeze the new snapshot, then plan against the OLD
		// baseline census.
		const xdg2 = makeTempXdgEnv();
		disposables.push(xdg2);
		const runtime2 = makeRuntime({ env: xdg2.env });
		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", source, "--json"],
					runtime2,
				)
			).exitCode,
		).toBe(0);
		const drifted = await planBrowserUseMigration(
			await openDeps(xdg2.env),
			source,
			KNOWN_BASELINE_CENSUS,
		);
		expect(drifted).toMatchObject({
			ok: false,
			code: "migration_count_drift",
		});
		if (drifted.ok) throw new Error("unreachable");
		expect(drifted.message).toMatch(/formal_artifacts expected 3, found 4/);
	});

	test("R1/KTD12: inventory and plan leave the full source tree byte-identical (pre/post hash over the fixture tree)", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		const before = snapshotTree(corpusBaseline);
		expect(before.length).toBeGreaterThan(0);
		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", corpusBaseline, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		expect(snapshotTree(corpusBaseline)).toEqual(before);
		expect(
			(
				await runForTest(
					["migration", "plan", "--source", corpusBaseline, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		expect(snapshotTree(corpusBaseline)).toEqual(before);
	});
});

// =========================================================================
// E-tier spawned-process reruns for K01 and K02.
//
// The in-process suites above prove the C/H oracles through runForTest, which
// never crosses a real process boundary. Tier E demands the REAL installed CLI
// spawned as a subprocess: the proof is the boundary itself, not a captured
// fixture. These are ADDITIVE — they encode the SAME oracles the in-process
// tests prove, so a spawn regression (env plumbing, exit code, stdout envelope)
// is caught at the tier the ledger names.
//
// The spawn idiom mirrors browser-use-sec-seams.test.ts: spawn the real
// browser-use.ts entry via `process.execPath` (bun), a hermetic env (a
// realpath-resolved temp HOME + XDG roots so the durable migration store lives
// only inside the sandbox and the XDG symlink-ancestor guard is satisfied), and
// assert exit code + parsed stdout envelope. No live browser, no network.
// =========================================================================

const BROWSER_USE_CLI = join(
	dirname(fileURLToPath(import.meta.url)),
	"browser-use.ts",
);
const SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

const spawnRoots: string[] = [];
afterAll(() => {
	for (const root of spawnRoots) rmSync(root, { recursive: true, force: true });
});

// A hermetic, realpath-resolved temp base carrying HOME + the four XDG roots.
// realpathSync collapses /tmp -> /private/tmp on macOS so the CLI's XDG
// symlink-ancestor guard (R12) admits the sandbox; the same base is reused
// across a spawn sequence so durable migration state persists between
// invocations, exactly as makeTempXdgEnv does for the in-process suites.
function makeSpawnXdg(): {
	env: Record<string, string>;
} {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "bu-mig-spawn-")));
	spawnRoots.push(base);
	const home = join(base, "home");
	mkdirSync(home, { recursive: true, mode: 0o700 });
	return {
		env: {
			HOME: home,
			XDG_CONFIG_HOME: join(base, "config"),
			XDG_DATA_HOME: join(base, "data"),
			XDG_STATE_HOME: join(base, "state"),
			XDG_CACHE_HOME: join(base, "cache"),
		},
	};
}

async function spawnBrowserUse(
	args: readonly string[],
	env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([process.execPath, BROWSER_USE_CLI, ...args], {
		// A neutral cwd inside the sandbox: the migration --source is passed as an
		// absolute path, so the child inherits no repo state.
		cwd: env.HOME,
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, stderr };
}

function parseSpawn(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

describe("DDA-K01 migration status reports each corpus state (spawned CLI)", () => {
	test(
		"the real spawned CLI reports empty, then inventoried, then planned, then verified over one durable store",
		async () => {
			const { env } = makeSpawnXdg();

			// Empty corpus: no durable migration state exists in the fresh sandbox.
			const empty = await spawnBrowserUse(["migration", "status", "--json"], env);
			expect(empty.exitCode).toBe(0);
			expect((parseSpawn(empty.stdout).data as Record<string, unknown>)).toMatchObject({
				contract: "browser-use.migration-status",
				phase: "empty",
				snapshot_id: null,
				source_entry_count: 0,
				disposition_count: 0,
				staged_generation: null,
				activation_state: "unchanged",
			});

			// Legacy-present, freshly inventoried through a second process.
			const inventory = await spawnBrowserUse(
				["migration", "inventory", "--source", safeCorpus, "--json"],
				env,
			);
			expect(inventory.exitCode).toBe(0);
			const afterInventory = await spawnBrowserUse(
				["migration", "status", "--json"],
				env,
			);
			expect(afterInventory.exitCode).toBe(0);
			expect(parseSpawn(afterInventory.stdout).data).toMatchObject({
				phase: "inventoried",
				source_entry_count: 1,
				disposition_count: 0,
				staged_generation: null,
			});

			// Legacy-present, planned.
			expect(
				(
					await spawnBrowserUse(
						["migration", "plan", "--source", safeCorpus, "--json"],
						env,
					)
				).exitCode,
			).toBe(0);
			const afterPlan = await spawnBrowserUse(["migration", "status", "--json"], env);
			expect(afterPlan.exitCode).toBe(0);
			expect(parseSpawn(afterPlan.stdout).data).toMatchObject({
				phase: "planned",
				disposition_count: 1,
			});

			// Migrated: apply then verify, each its own spawned process.
			expect(
				(
					await spawnBrowserUse(
						["migration", "apply", "--source", safeCorpus, "--json"],
						env,
					)
				).exitCode,
			).toBe(0);
			expect(
				(
					await spawnBrowserUse(
						["migration", "verify", "--source", safeCorpus, "--json"],
						env,
					)
				).exitCode,
			).toBe(0);
			const migrated = await spawnBrowserUse(["migration", "status", "--json"], env);
			expect(migrated.exitCode).toBe(0);
			expect(parseSpawn(migrated.stdout).data).toMatchObject({
				phase: "verified",
				source_entry_count: 1,
				disposition_count: 1,
				staged_generation: expect.stringMatching(/^generation-[0-9a-f]{16}$/),
				activation_state: "unchanged",
			});
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});

describe("DDA-K02 inventory and plan are strictly read-only (spawned CLI)", () => {
	test(
		"the source filesystem snapshot is byte-identical before and after the real spawned inventory and plan",
		async () => {
			const { env } = makeSpawnXdg();

			const before = snapshotTree(classificationCorpus);
			expect(before.length).toBeGreaterThan(0);

			const inventory = await spawnBrowserUse(
				["migration", "inventory", "--source", classificationCorpus, "--json"],
				env,
			);
			expect(inventory.exitCode).toBe(0);
			// The real subprocess touched no source byte.
			expect(snapshotTree(classificationCorpus)).toEqual(before);

			const plan = await spawnBrowserUse(
				["migration", "plan", "--source", classificationCorpus, "--json"],
				env,
			);
			expect(plan.exitCode).toBe(0);
			expect(snapshotTree(classificationCorpus)).toEqual(before);
		},
		SPAWN_TEST_TIMEOUT_MS,
	);
});
