import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	artifactBytesPath,
	artifactTombstonePath,
	writeArtifactManifest,
} from "./browser-use-retention";
import type { RunStoreDeps } from "./browser-use-runs";
import {
	type BrowserUseArtifactManifestPayload,
	encodeDurableRecord,
} from "./browser-use-schemas";
import { runForTest } from "./browser-use";
import {
	enoent,
	makeRuntime,
	parseJson,
	TARGETS_CONTRACT,
} from "./browser-use-test-helpers";

// =========================================================================
// Daily Driver Acceptance Ledger — status-families cluster.
//
// DDA-H23  repair status/apply touch EXACTLY the declared broken state; a
//          whole-store filesystem diff proves nothing else changed.
// DDA-H24  artifact list projects the run-scoped manifest; an absent manifest
//          (empty store, or a run dir with no manifest) yields a typed ok-empty
//          envelope, never an error.
// DDA-H25  targets status distinguishes fresh, stale, and absent run-scoped
//          selected state as three distinct typed projections.
//
// Contract (C), process (E), and hermetic (H) tiers only. Every case drives the
// REAL CLI driver via runForTest against a real temp XDG store (H23/H24) or the
// in-memory state seam (H25). No live browser, no network.
// =========================================================================

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	base: string;
	deps: RunStoreDeps;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		env: xdg.env,
		base: xdg.base,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
	};
}

function sha256(contents: string): string {
	return createHash("sha256").update(contents).digest("hex");
}

// Whole-tree content fingerprint: every file under `root`, keyed by its path
// relative to `root`, mapped to a content hash. Directory topology is captured
// implicitly by the key set. Used to prove repair apply touched EXACTLY the
// declared broken files and nothing else in the store (H23 filesystem diff).
function fingerprintTree(root: string): Map<string, string> {
	const fingerprint = new Map<string, string>();
	function walk(dir: string): void {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const abs = join(dir, entry);
			const stat = statSync(abs);
			if (stat.isDirectory()) {
				// Record the directory itself so a created/removed EMPTY dir is a diff.
				fingerprint.set(`${relative(root, abs)}/`, "dir");
				walk(abs);
			} else {
				fingerprint.set(relative(root, abs), sha256(readFileSync(abs, "utf-8")));
			}
		}
	}
	walk(root);
	return fingerprint;
}

// The exact set of relative paths whose fingerprint changed between two trees
// (added, removed, or content-modified), sorted for a stable assertion.
function changedPaths(
	before: Map<string, string>,
	after: Map<string, string>,
): string[] {
	const changed = new Set<string>();
	for (const [path, hash] of before) {
		if (after.get(path) !== hash) changed.add(path);
	}
	for (const [path, hash] of after) {
		if (before.get(path) !== hash) changed.add(path);
	}
	return [...changed].sort();
}

async function seedPresentArtifact(
	deps: RunStoreDeps,
	runId: string,
	artifactId: string,
	contents: string,
): Promise<void> {
	const bytesPath = artifactBytesPath(deps.paths, runId, artifactId);
	await deps.fs.mkdir(dirname(bytesPath), { recursive: true, mode: 0o700 });
	await deps.fs.writeFileDurable(bytesPath, contents, 0o600);
	const manifest: BrowserUseArtifactManifestPayload = {
		artifact_id: artifactId,
		run_id: runId,
		task_intent: "scrape",
		adapter_id: "chrome-devtools-mcp",
		adapter_version: "1.0.0",
		sanitized_target: { origin: "https://example.test" },
		producer_capability: "snapshot_refs",
		content_hash: sha256(contents),
		sensitivity: "high",
		retention: "ephemeral",
		outcome_ref: null,
		created_at_epoch_ms: 1_000,
		export_receipt: null,
	};
	const written = await writeArtifactManifest(deps, manifest);
	expect(written.ok).toBe(true);
}

// --- DDA-H23 -----------------------------------------------------------------

describe("DDA-H23 repair status/apply touch exactly the declared broken state", () => {
	test("status lists exactly the broken state; apply fixes exactly it; whole-store diff shows nothing else touched", async () => {
		const store = await makeStore();

		// A healthy artifact that repair must NEVER touch — the negative control.
		await seedPresentArtifact(store.deps, "run-keep", "art-keep", "keep-bytes");

		// The declared broken state: one pending tombstone (retention converges it)
		// and one recognized durable-write orphan temp file (repair removes it).
		const tombstonePath = artifactTombstonePath(
			store.deps.paths,
			"run-broken",
			"art-broken",
		);
		await store.deps.fs.mkdir(dirname(tombstonePath), {
			recursive: true,
			mode: 0o700,
		});
		await store.deps.fs.writeFileDurable(
			tombstonePath,
			encodeDurableRecord("tombstone", {
				artifact_id: "art-broken",
				run_id: "run-broken",
				retention: "ephemeral",
				reason: "retention-expiry",
				phase: "pending",
				deleted_at_epoch_ms: 1_000,
			}),
			0o600,
		);
		const orphanPath = `${store.deps.paths.state.runsDir}/orphan.tmp-9-3`;
		await store.deps.fs.mkdir(store.deps.paths.state.runsDir, {
			recursive: true,
			mode: 0o700,
		});
		await store.deps.fs.writeFile(orphanPath, "", 0o600);

		// repair status lists EXACTLY the broken state and routes to apply_repair.
		const status = await runForTest(
			["repair", "status", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(status.exitCode).toBe(0);
		const statusData = parseJson(status.stdout).data as Record<string, unknown>;
		const pending = statusData.pending_tombstones as Array<
			Record<string, unknown>
		>;
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({
			artifact_id: "art-broken",
			run_id: "run-broken",
			phase: "pending",
		});
		expect(statusData.orphan_temp_files).toEqual([orphanPath]);
		expect(statusData.next_action).toBe("apply_repair");

		// Snapshot the whole state tree, apply, then diff.
		const stateRoot = store.env.XDG_STATE_HOME as string;
		const before = fingerprintTree(stateRoot);

		const applied = await runForTest(
			["repair", "apply", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(applied.exitCode).toBe(0);
		expect(parseJson(applied.stdout).data).toMatchObject({
			repaired_tombstone_count: 1,
			removed_orphan_count: 1,
			repaired_artifact_ids: ["art-broken"],
			next_action: "inspect_repair_status",
		});

		const after = fingerprintTree(stateRoot);
		const changed = changedPaths(before, after);

		// EXACTLY two DATA effects: the orphan temp file is gone, and the pending
		// tombstone record content changed (phase pending -> complete). The healthy
		// artifact and every other store record are byte-identical. The repair's own
		// activation-epoch barrier legitimately establishes an EMPTY leases/ scaffold
		// directory (its own serialization infrastructure, not a touch of user data);
		// separate that expected empty-dir infrastructure from the data diff rather
		// than pretend repair runs with zero footprint.
		const tombstoneRel = relative(stateRoot, tombstonePath);
		const orphanRel = relative(stateRoot, orphanPath);
		const dataChanges = changed.filter((path) => !path.endsWith("/"));
		expect(dataChanges).toEqual([orphanRel, tombstoneRel].sort());
		// The ONLY additional filesystem entry the repair created is its own empty
		// lease-barrier directory; it leaves no lease FILE behind (the barrier
		// released), so nothing in leases/ is a durable record.
		const newDirs = changed.filter(
			(path) => path.endsWith("/") && !before.has(path),
		);
		expect(newDirs).toEqual(["browser-use/leases/"]);
		expect([...after.keys()].some((path) => path.startsWith("browser-use/leases/") && !path.endsWith("/"))).toBe(false);

		// Prove the direction of each change: orphan removed, tombstone completed,
		// healthy artifact untouched.
		expect(before.has(orphanRel)).toBe(true);
		expect(after.has(orphanRel)).toBe(false);
		const standing = JSON.parse(readFileSync(tombstonePath, "utf-8")) as {
			payload: { phase: string };
		};
		expect(standing.payload.phase).toBe("complete");

		// The negative-control artifact's manifest + bytes are byte-for-byte intact.
		const keepBytes = artifactBytesPath(store.deps.paths, "run-keep", "art-keep");
		const keepRel = relative(stateRoot, keepBytes);
		expect(after.get(keepRel)).toBe(before.get(keepRel));

		// A follow-up status confirms the broken state is fully cleared.
		const post = await runForTest(
			["repair", "status", "--json"],
			makeRuntime({ env: store.env }),
		);
		const postData = parseJson(post.stdout).data as Record<string, unknown>;
		expect(postData.pending_tombstones).toEqual([]);
		expect(postData.orphan_temp_files).toEqual([]);
		expect(postData.next_action).toBe("inspect_shared_run");
	});
});

// --- DDA-H24 -----------------------------------------------------------------

describe("DDA-H24 artifact list projects the manifest; absent manifest is a typed ok-empty envelope", () => {
	test("an empty store (no artifacts written) yields exit 0 and an ok empty envelope", async () => {
		const store = await makeStore();
		const result = await runForTest(
			["artifact", "list", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.status ?? "ok").not.toBe("error");
		expect(json.error).toBeFalsy();
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.artifact-manifest");
		expect(data.artifact_count).toBe(0);
		expect(data.artifacts).toEqual([]);
		// A typed ok result still carries a next safe action, never a failure code.
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"inspect_shared_run",
		);
	});

	test("a --run filter whose manifest dir is absent yields exit 0 and an ok empty projection", async () => {
		const store = await makeStore();
		// Seed one real artifact under a DIFFERENT run so the store is non-empty,
		// then ask for a run that never produced a manifest directory.
		await seedPresentArtifact(store.deps, "run-real", "art-real", "real-bytes");
		const result = await runForTest(
			["artifact", "list", "--run", "run-absent", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.error).toBeFalsy();
		const data = json.data as Record<string, unknown>;
		expect(data.run).toBe("run-absent");
		expect(data.artifact_count).toBe(0);
		expect(data.artifacts).toEqual([]);
	});

	test("a run WITH a manifest projects its rows (the non-empty control)", async () => {
		const store = await makeStore();
		await seedPresentArtifact(store.deps, "run-real", "art-real", "real-bytes");
		const result = await runForTest(
			["artifact", "list", "--run", "run-real", "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.artifact_count).toBe(1);
		const rows = data.artifacts as Array<Record<string, unknown>>;
		expect(rows[0]).toMatchObject({
			run_id: "run-real",
			artifact_id: "art-real",
			status: "present",
		});
	});
});

// --- DDA-H25 -----------------------------------------------------------------

describe("DDA-H25 targets status distinguishes fresh, stale, and absent selected state", () => {
	// A valid persisted selected-target state, as `targets select` writes it. The
	// TTL window is [emitted_at_ms, expires_at_ms); `now` decides fresh vs stale.
	const EMITTED_AT_MS = 1_000;
	const EXPIRES_AT_MS = 1_000 + 15 * 60_000;
	function stateFile(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			contract: TARGETS_CONTRACT,
			schema_version: "2",
			run_id: "run-status-25",
			selected_adapter_id: "chrome-devtools-mcp",
			verified_endpoint_identity: "127.0.0.1:9222",
			handoff_evidence_id: "evid-25",
			target_envelope_id: "env-25",
			target_candidate_id: "cid-25",
			selected_candidate_ordinal: 1,
			emitted_at_ms: EMITTED_AT_MS,
			expires_at_ms: EXPIRES_AT_MS,
			display: { origin: "https://example.com", path_shape: "/app", title: "App" },
			...overrides,
		});
	}

	function statusRuntime(input: { files?: Record<string, string>; now: number }) {
		const files = { ...(input.files ?? {}) };
		return makeRuntime({
			now: () => input.now,
			readStdin: async () => "",
			readTextFile: async (path: string) => {
				if (path in files) return files[path];
				throw enoent(path);
			},
			writeTextFile: async () => {},
		});
	}

	test("fresh state (now inside the TTL) projects a live selected target at exit 0", async () => {
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			statusRuntime({ files: { "/state.json": stateFile() }, now: 2_000 }),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(json.error).toBeFalsy();
		const data = json.data as Record<string, unknown>;
		const selected = data.selected_target as Record<string, unknown>;
		expect(selected).toMatchObject({
			run_id: "run-status-25",
			candidate_ordinal: 1,
			target_envelope_id: "env-25",
		});
		expect(selected.expires_in_ms as number).toBeGreaterThan(0);
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"operate_selected_browser_target",
		);
	});

	test("stale state (now past expires_at_ms) fails closed as target_state_stale", async () => {
		const result = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			// One ms past the exclusive TTL upper bound.
			statusRuntime({ files: { "/state.json": stateFile() }, now: EXPIRES_AT_MS }),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_state_stale" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refresh_target_selection",
		);
	});

	test("absent state (no state file) fails closed as target_state_missing", async () => {
		const result = await runForTest(
			["targets", "status", "--state", "/absent.json", "--json"],
			statusRuntime({ files: {}, now: 2_000 }),
		);
		expect(result.exitCode).toBe(20);
		const json = parseJson(result.stdout);
		expect(json.error).toMatchObject({ code: "target_state_missing" });
		expect((json.continuation as Record<string, unknown>).next_action_id).toBe(
			"refresh_target_selection",
		);
	});

	test("the three projections are mutually distinct (code + exit)", async () => {
		const fresh = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			statusRuntime({ files: { "/state.json": stateFile() }, now: 2_000 }),
		);
		const stale = await runForTest(
			["targets", "status", "--state", "/state.json", "--json"],
			statusRuntime({ files: { "/state.json": stateFile() }, now: EXPIRES_AT_MS }),
		);
		const absent = await runForTest(
			["targets", "status", "--state", "/absent.json", "--json"],
			statusRuntime({ files: {}, now: 2_000 }),
		);
		const codeOf = (stdout: string): string => {
			const json = parseJson(stdout);
			const error = json.error as Record<string, unknown> | null | undefined;
			return error ? String(error.code) : "ok:selected_target";
		};
		const signatures = new Set([
			`${fresh.exitCode}:${codeOf(fresh.stdout)}`,
			`${stale.exitCode}:${codeOf(stale.stdout)}`,
			`${absent.exitCode}:${codeOf(absent.stdout)}`,
		]);
		expect(signatures.size).toBe(3);
	});
});

// =========================================================================
// E-tier: the SAME H23/H24/H25 oracles proven across a real process boundary.
//
// The cases above drive runForTest, which never crosses a process boundary.
// Tier E demands the REAL CLI spawned as a subprocess: `bun browser-use.ts
// <command> --json` against a hermetic temp XDG store seeded on disk via the
// SAME store helpers the in-process cases use. The child inherits only HOME
// plus the temp XDG roots, so every store path resolves under the hermetic
// base and any leak would be attributable. No live browser, no network.
//
// H25 note: the spawned CLI reads wall-clock `now` (Date.now()) — there is no
// clock env seam — so freshness is proven with timestamps anchored to the real
// now at spawn time rather than the fixed 1_000 the in-process cases inject.
// =========================================================================

const BROWSER_USE_CLI = join(
	dirname(fileURLToPath(import.meta.url)),
	"browser-use.ts",
);
const SPAWN_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = SPAWN_TIMEOUT_MS + 10_000;

// Spawn the real CLI over a seeded store. `env` is the temp XDG record the
// makeStore helper already built; only HOME + the XDG roots reach the child so
// the seeded store is the only state it can read. Extra env is merged for the
// state-file cases (none needed today). Returns exit code + parsed stdout.
async function spawnBrowserUse(
	env: Record<string, string | undefined>,
	args: readonly string[],
): Promise<{ exitCode: number; stdout: string; json: Record<string, unknown> }> {
	const child = Bun.spawn([process.execPath, BROWSER_USE_CLI, ...args], {
		env: {
			HOME: env.HOME,
			XDG_CONFIG_HOME: env.XDG_CONFIG_HOME,
			XDG_DATA_HOME: env.XDG_DATA_HOME,
			XDG_STATE_HOME: env.XDG_STATE_HOME,
			XDG_CACHE_HOME: env.XDG_CACHE_HOME,
		} as Record<string, string>,
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = setTimeout(() => child.kill(), SPAWN_TIMEOUT_MS);
	const [stdout, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		child.exited,
	]);
	clearTimeout(timeout);
	return { exitCode, stdout, json: parseJson(stdout) };
}

// --- DDA-H23 (E) -------------------------------------------------------------

describe("DDA-H23 (E) spawned repair status/apply touch exactly the declared broken state", () => {
	test(
		"the real spawned CLI lists exactly the seeded breakage and apply fixes exactly it",
		async () => {
			const store = await makeStore();

			// A healthy artifact the repair must NEVER touch — the negative control.
			await seedPresentArtifact(store.deps, "run-keep", "art-keep", "keep-bytes");

			// The declared broken state: one pending tombstone + one recognized
			// durable-write orphan temp file, seeded through the same store fs.
			const tombstonePath = artifactTombstonePath(
				store.deps.paths,
				"run-broken",
				"art-broken",
			);
			await store.deps.fs.mkdir(dirname(tombstonePath), {
				recursive: true,
				mode: 0o700,
			});
			await store.deps.fs.writeFileDurable(
				tombstonePath,
				encodeDurableRecord("tombstone", {
					artifact_id: "art-broken",
					run_id: "run-broken",
					retention: "ephemeral",
					reason: "retention-expiry",
					phase: "pending",
					deleted_at_epoch_ms: 1_000,
				}),
				0o600,
			);
			const orphanPath = `${store.deps.paths.state.runsDir}/orphan.tmp-9-3`;
			await store.deps.fs.mkdir(store.deps.paths.state.runsDir, {
				recursive: true,
				mode: 0o700,
			});
			await store.deps.fs.writeFile(orphanPath, "", 0o600);

			// Spawned `repair status` lists EXACTLY the seeded breakage.
			const status = await spawnBrowserUse(store.env, [
				"repair",
				"status",
				"--json",
			]);
			expect(status.exitCode).toBe(0);
			const statusData = status.json.data as Record<string, unknown>;
			const pending = statusData.pending_tombstones as Array<
				Record<string, unknown>
			>;
			expect(pending).toHaveLength(1);
			expect(pending[0]).toMatchObject({
				artifact_id: "art-broken",
				run_id: "run-broken",
				phase: "pending",
			});
			expect(statusData.orphan_temp_files).toEqual([orphanPath]);
			expect(statusData.next_action).toBe("apply_repair");

			// Snapshot the whole state tree, spawn `repair apply`, then diff.
			const stateRoot = store.env.XDG_STATE_HOME as string;
			const before = fingerprintTree(stateRoot);

			const applied = await spawnBrowserUse(store.env, [
				"repair",
				"apply",
				"--json",
			]);
			expect(applied.exitCode).toBe(0);
			expect(applied.json.data).toMatchObject({
				repaired_tombstone_count: 1,
				removed_orphan_count: 1,
				repaired_artifact_ids: ["art-broken"],
				next_action: "inspect_repair_status",
			});

			const after = fingerprintTree(stateRoot);
			const changed = changedPaths(before, after);

			// EXACTLY two DATA effects: the orphan temp file is gone and the pending
			// tombstone record content changed (phase pending -> complete). Every
			// other store record — including the healthy artifact — is byte-identical.
			const tombstoneRel = relative(stateRoot, tombstonePath);
			const orphanRel = relative(stateRoot, orphanPath);
			const dataChanges = changed.filter((path) => !path.endsWith("/"));
			expect(dataChanges).toEqual([orphanRel, tombstoneRel].sort());
			// The only additional entry the repair created is its own empty
			// lease-barrier directory; it leaves no lease FILE behind.
			const newDirs = changed.filter(
				(path) => path.endsWith("/") && !before.has(path),
			);
			expect(newDirs).toEqual(["browser-use/leases/"]);
			expect(
				[...after.keys()].some(
					(path) =>
						path.startsWith("browser-use/leases/") && !path.endsWith("/"),
				),
			).toBe(false);

			// Direction of each change: orphan removed, tombstone completed, healthy
			// artifact untouched.
			expect(before.has(orphanRel)).toBe(true);
			expect(after.has(orphanRel)).toBe(false);
			const standing = JSON.parse(readFileSync(tombstonePath, "utf-8")) as {
				payload: { phase: string };
			};
			expect(standing.payload.phase).toBe("complete");
			const keepBytes = artifactBytesPath(
				store.deps.paths,
				"run-keep",
				"art-keep",
			);
			const keepRel = relative(stateRoot, keepBytes);
			expect(after.get(keepRel)).toBe(before.get(keepRel));

			// A follow-up spawned status confirms the broken state is fully cleared.
			const post = await spawnBrowserUse(store.env, [
				"repair",
				"status",
				"--json",
			]);
			const postData = post.json.data as Record<string, unknown>;
			expect(postData.pending_tombstones).toEqual([]);
			expect(postData.orphan_temp_files).toEqual([]);
			expect(postData.next_action).toBe("inspect_shared_run");
		},
		TEST_TIMEOUT_MS,
	);
});

// --- DDA-H24 (E) -------------------------------------------------------------

describe("DDA-H24 (E) spawned artifact list projects the manifest; absent manifest is a typed ok-empty envelope", () => {
	test(
		"an absent manifest yields exit 0 and an ok empty envelope across the process boundary",
		async () => {
			const store = await makeStore();
			const result = await spawnBrowserUse(store.env, [
				"artifact",
				"list",
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			const json = result.json;
			expect(json.status ?? "ok").not.toBe("error");
			expect(json.error).toBeFalsy();
			const data = json.data as Record<string, unknown>;
			expect(data.contract).toBe("browser-use.artifact-manifest");
			expect(data.artifact_count).toBe(0);
			expect(data.artifacts).toEqual([]);
			expect(
				(json.continuation as Record<string, unknown>).next_action_id,
			).toBe("inspect_shared_run");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"a run WITH a seeded manifest projects its row across the process boundary",
		async () => {
			const store = await makeStore();
			await seedPresentArtifact(
				store.deps,
				"run-real",
				"art-real",
				"real-bytes",
			);
			const result = await spawnBrowserUse(store.env, [
				"artifact",
				"list",
				"--run",
				"run-real",
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			const data = result.json.data as Record<string, unknown>;
			expect(data.artifact_count).toBe(1);
			const rows = data.artifacts as Array<Record<string, unknown>>;
			expect(rows[0]).toMatchObject({
				run_id: "run-real",
				artifact_id: "art-real",
				status: "present",
			});
		},
		TEST_TIMEOUT_MS,
	);
});

// --- DDA-H25 (E) -------------------------------------------------------------

describe("DDA-H25 (E) spawned targets status distinguishes fresh, stale, and absent selected state", () => {
	// Build a valid persisted selected-target state anchored to a supplied
	// `expires_at_ms`. The spawned CLI reads wall-clock `now`, so freshness is
	// controlled by choosing expires_at_ms relative to the real Date.now() the
	// child observes — a far-future expiry is fresh, a past expiry is stale.
	function stateFileAtExpiry(expiresAtMs: number): string {
		return JSON.stringify({
			contract: TARGETS_CONTRACT,
			schema_version: "2",
			run_id: "run-status-25e",
			selected_adapter_id: "chrome-devtools-mcp",
			verified_endpoint_identity: "127.0.0.1:9222",
			handoff_evidence_id: "evid-25e",
			target_envelope_id: "env-25e",
			target_candidate_id: "cid-25e",
			selected_candidate_ordinal: 1,
			emitted_at_ms: expiresAtMs - 15 * 60_000,
			expires_at_ms: expiresAtMs,
			display: {
				origin: "https://example.com",
				path_shape: "/app",
				title: "App",
			},
		});
	}

	// Write the state file under the store base so it shares the hermetic root.
	function writeState(base: string, contents: string): string {
		const path = join(base, "selected-target-state.json");
		writeFileSync(path, contents, "utf-8");
		return path;
	}

	test(
		"fresh state (far-future expiry) projects a live selected target at exit 0",
		async () => {
			const store = await makeStore();
			// Expiry an hour past the real spawn-time now: guaranteed fresh.
			const statePath = writeState(
				store.base,
				stateFileAtExpiry(Date.now() + 60 * 60_000),
			);
			const result = await spawnBrowserUse(store.env, [
				"targets",
				"status",
				"--state",
				statePath,
				"--json",
			]);
			expect(result.exitCode).toBe(0);
			expect(result.json.error).toBeFalsy();
			const data = result.json.data as Record<string, unknown>;
			const selected = data.selected_target as Record<string, unknown>;
			expect(selected).toMatchObject({
				run_id: "run-status-25e",
				candidate_ordinal: 1,
				target_envelope_id: "env-25e",
			});
			expect(selected.expires_in_ms as number).toBeGreaterThan(0);
			expect(
				(result.json.continuation as Record<string, unknown>).next_action_id,
			).toBe("operate_selected_browser_target");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"stale state (past expiry) fails closed as target_state_stale",
		async () => {
			const store = await makeStore();
			// Expiry a minute BEFORE the real spawn-time now: guaranteed stale.
			const statePath = writeState(
				store.base,
				stateFileAtExpiry(Date.now() - 60_000),
			);
			const result = await spawnBrowserUse(store.env, [
				"targets",
				"status",
				"--state",
				statePath,
				"--json",
			]);
			expect(result.exitCode).toBe(20);
			expect(result.json.error).toMatchObject({ code: "target_state_stale" });
			expect(
				(result.json.continuation as Record<string, unknown>).next_action_id,
			).toBe("refresh_target_selection");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"absent state (no state file) fails closed as target_state_missing",
		async () => {
			const store = await makeStore();
			const absentPath = join(store.base, "no-such-state.json");
			const result = await spawnBrowserUse(store.env, [
				"targets",
				"status",
				"--state",
				absentPath,
				"--json",
			]);
			expect(result.exitCode).toBe(20);
			expect(result.json.error).toMatchObject({ code: "target_state_missing" });
			expect(
				(result.json.continuation as Record<string, unknown>).next_action_id,
			).toBe("refresh_target_selection");
		},
		TEST_TIMEOUT_MS,
	);

	test(
		"the three spawned projections are mutually distinct (code + exit)",
		async () => {
			const freshStore = await makeStore();
			const freshPath = writeState(
				freshStore.base,
				stateFileAtExpiry(Date.now() + 60 * 60_000),
			);
			const staleStore = await makeStore();
			const stalePath = writeState(
				staleStore.base,
				stateFileAtExpiry(Date.now() - 60_000),
			);
			const absentStore = await makeStore();
			const absentPath = join(absentStore.base, "no-such-state.json");

			const fresh = await spawnBrowserUse(freshStore.env, [
				"targets",
				"status",
				"--state",
				freshPath,
				"--json",
			]);
			const stale = await spawnBrowserUse(staleStore.env, [
				"targets",
				"status",
				"--state",
				stalePath,
				"--json",
			]);
			const absent = await spawnBrowserUse(absentStore.env, [
				"targets",
				"status",
				"--state",
				absentPath,
				"--json",
			]);
			const codeOf = (json: Record<string, unknown>): string => {
				const error = json.error as Record<string, unknown> | null | undefined;
				return error ? String(error.code) : "ok:selected_target";
			};
			const signatures = new Set([
				`${fresh.exitCode}:${codeOf(fresh.json)}`,
				`${stale.exitCode}:${codeOf(stale.json)}`,
				`${absent.exitCode}:${codeOf(absent.json)}`,
			]);
			expect(signatures.size).toBe(3);
		},
		TEST_TIMEOUT_MS,
	);
});
