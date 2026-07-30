import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { advanceActivationEpoch, readActivationEpoch } from "./browser-use-locks";
import { openBrowserUsePaths } from "./browser-use-paths";
import {
	fixedClock,
	makeVolatileOverlayFs,
	type VolatileOverlayFs,
} from "./browser-use-platform-test-helpers";
import {
	type BrowserUseArtifactManifestPayload,
	type BrowserUseSourceSnapshotPayload,
	encodeDurableRecord,
	parseDurableRecord,
} from "./browser-use-schemas";
import { readDurableFile } from "./browser-use-store";
import {
	type RetentionDeps,
	RETENTION_FAILURE_EVIDENCE_MS,
	artifactBytesPath,
	artifactManifestPath,
	artifactTombstonePath,
	deleteArtifact,
	exportArtifact,
	generationFilePath,
	generationRecordPath,
	listPendingTombstones,
	readArtifactStatus,
	sourceSnapshotPath,
	stageGeneration,
	sweepExpiredArtifacts,
	writeArtifactManifest,
	writeSourceSnapshot,
} from "./browser-use-retention";

// =========================================================================
// Retention substrate proof (platform plan 2026-07-21-002 U2, R29).
//
// Owns the ledger rows: S16 (idempotent crash-resumable two-phase deletion),
// S17 (deleted vs present vs missing vs corrupt four-way truth over
// fixtures), S18 (export ownership transfer: hash-verified, retention flips
// to export, sweeps skip it, in-root destinations refused), and V2
// (power-loss mid-stageGeneration and mid-advanceActivationEpoch preserves
// the prior generation record and prior epoch; reapply converges to a
// verified no-op). All crash points run against the volatile-overlay fake; the
// injected fixed clock is the only time source.
// =========================================================================

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "browser-use-platform");

const overlays: VolatileOverlayFs[] = [];

afterAll(() => {
	for (const overlay of overlays) {
		overlay.dispose();
	}
});

function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function fixtureText(name: string): string {
	return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

// Overlay-backed world over fictitious logical XDG roots; the admitted paths
// stay valid across overlay.crash() because durable dirs re-materialize.
async function makeWorld(startEpochMs = 10_000): Promise<{
	overlay: VolatileOverlayFs;
	deps: RetentionDeps;
	clock: ReturnType<typeof fixedClock>;
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
	const clock = fixedClock(startEpochMs);
	return {
		overlay,
		deps: { fs: overlay.fs, paths: opened.paths, clock: clock.now },
		clock,
	};
}

function makeManifest(
	overrides: Partial<BrowserUseArtifactManifestPayload> = {},
): BrowserUseArtifactManifestPayload {
	return {
		artifact_id: "artifact-1",
		run_id: "run-1",
		task_intent: "frontend-test",
		adapter_id: "playwright-cdp",
		adapter_version: "1.0.0",
		sanitized_target: { origin: "https://example.test", path_shape: "/reports/:num" },
		producer_capability: "trace-capture",
		content_hash: sha256Hex("artifact bytes"),
		sensitivity: "high",
		retention: "failure-evidence",
		outcome_ref: null,
		created_at_epoch_ms: 2_000,
		export_receipt: null,
		...overrides,
	};
}

// Bytes + matching manifest, the way producers will seed evidence.
async function seedArtifact(
	deps: RetentionDeps,
	input: {
		runId: string;
		artifactId: string;
		contents: string;
		retention: BrowserUseArtifactManifestPayload["retention"];
		createdAtEpochMs?: number;
	},
): Promise<BrowserUseArtifactManifestPayload> {
	await deps.fs.mkdir(deps.paths.state.artifactDir(input.runId), {
		recursive: true,
		mode: 0o700,
	});
	await deps.fs.writeFileDurable(
		artifactBytesPath(deps.paths, input.runId, input.artifactId),
		input.contents,
		0o600,
	);
	const manifest = makeManifest({
		artifact_id: input.artifactId,
		run_id: input.runId,
		content_hash: sha256Hex(input.contents),
		retention: input.retention,
		created_at_epoch_ms: input.createdAtEpochMs ?? 2_000,
	});
	const written = await writeArtifactManifest(deps, manifest);
	expect(written).toEqual({ ok: true, verified_noop: false });
	return manifest;
}

describe("writeArtifactManifest immutable write (R29)", () => {
	test("an absent manifest is written durably in canonical form with private modes", async () => {
		const { deps } = await makeWorld();
		const manifest = makeManifest();
		const result = await writeArtifactManifest(deps, manifest);
		expect(result).toEqual({ ok: true, verified_noop: false });
		const path = artifactManifestPath(deps.paths, "run-1", "artifact-1");
		expect(await deps.fs.readTextFile(path)).toBe(
			encodeDurableRecord("artifact-manifest", manifest),
		);
		expect((await deps.fs.lstat(path))?.mode).toBe(0o600);
	});

	test("an identical content-hash rewrite is a verified no-op that leaves the disk bytes untouched", async () => {
		const { deps } = await makeWorld();
		const manifest = makeManifest();
		await writeArtifactManifest(deps, manifest);
		// A replay recomputes timestamps; the content hash is the identity.
		const replay = await writeArtifactManifest(deps, {
			...manifest,
			created_at_epoch_ms: 9_999,
		});
		expect(replay).toEqual({ ok: true, verified_noop: true });
		expect(
			await deps.fs.readTextFile(
				artifactManifestPath(deps.paths, "run-1", "artifact-1"),
			),
		).toBe(encodeDurableRecord("artifact-manifest", manifest));
	});

	test("a different content hash is a typed fatal retention_collision and writes nothing", async () => {
		const { deps } = await makeWorld();
		const manifest = makeManifest();
		await writeArtifactManifest(deps, manifest);
		const collided = await writeArtifactManifest(deps, {
			...manifest,
			content_hash: sha256Hex("different bytes"),
		});
		expect(collided).toMatchObject({ ok: false, code: "retention_collision" });
		expect(
			await deps.fs.readTextFile(
				artifactManifestPath(deps.paths, "run-1", "artifact-1"),
			),
		).toBe(encodeDurableRecord("artifact-manifest", manifest));
	});

	test("a tombstone permanently blocks manifest recreation", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir(deps.paths.state.artifactDir("run-1"), {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFileDurable(
			artifactTombstonePath(deps.paths, "run-1", "artifact-1"),
			encodeDurableRecord("tombstone", {
				artifact_id: "artifact-1",
				run_id: "run-1",
				retention: "failure-evidence",
				reason: "explicit-delete",
				phase: "complete",
				deleted_at_epoch_ms: 3_000,
			}),
			0o600,
		);
		expect(await writeArtifactManifest(deps, makeManifest())).toMatchObject({
			ok: false,
			code: "retention_collision",
		});
	});

	test("unsafe artifact ids are a TypeError caller bug, including reserved metadata suffixes", async () => {
		const { deps } = await makeWorld();
		expect(() => artifactBytesPath(deps.paths, "run-1", "../evil")).toThrow(TypeError);
		expect(() =>
			artifactManifestPath(deps.paths, "run-1", "x.manifest.json"),
		).toThrow(TypeError);
		expect(() =>
			artifactTombstonePath(deps.paths, "run-1", "x.tombstone.json"),
			).toThrow(TypeError);
		});

	test("raw target details and secret-shaped manifest fields are refused before persistence", async () => {
		const { deps } = await makeWorld();
		for (const manifest of [
			makeManifest({
				artifact_id: "raw-target",
				sanitized_target: {
					origin: "https://example.test/private?account=7",
					path_shape: "/private",
				},
			}),
			makeManifest({
				artifact_id: "secret-shaped",
				producer_capability: "op://vault/item/field",
			}),
		]) {
			const result = await writeArtifactManifest(deps, manifest);
			expect(result).toMatchObject({ ok: false, code: "artifact_corrupt" });
			expect(
				await readDurableFile(
					deps.fs,
					artifactManifestPath(deps.paths, manifest.run_id, manifest.artifact_id),
				),
			).toEqual({ status: "missing" });
		}
	});
});

describe("readArtifactStatus four-way truth (R29; S17)", () => {
	test("S17: deleted, present, missing, and corrupt are distinct over the durable fixtures", async () => {
		const { deps } = await makeWorld();
		const runId = "run-fixture-1";
		await deps.fs.mkdir(deps.paths.state.artifactDir(runId), {
			recursive: true,
			mode: 0o700,
		});
		// Present: fixture manifest whose content_hash matches the bytes fixture.
		await deps.fs.writeFileDurable(
			artifactManifestPath(deps.paths, runId, "artifact-present-1"),
			fixtureText("artifact-manifest-present.json"),
			0o600,
		);
		await deps.fs.writeFileDurable(
			artifactBytesPath(deps.paths, runId, "artifact-present-1"),
			fixtureText("artifact-bytes-present.txt"),
			0o600,
		);
		// Deleted: the complete-tombstone fixture.
		await deps.fs.writeFileDurable(
			artifactTombstonePath(deps.paths, runId, "artifact-fixture-2"),
			fixtureText("tombstone-complete.json"),
			0o600,
		);
		// Corrupt: the manifest fixture with drifted bytes.
		await deps.fs.writeFileDurable(
			artifactManifestPath(deps.paths, runId, "artifact-fixture-1"),
			fixtureText("artifact-manifest.json"),
			0o600,
		);
		await deps.fs.writeFileDurable(
			artifactBytesPath(deps.paths, runId, "artifact-fixture-1"),
			"drifted bytes\n",
			0o600,
		);

		const present = await readArtifactStatus(deps, {
			runId,
			artifactId: "artifact-present-1",
		});
		expect(present.status).toBe("present");
		if (present.status !== "present") throw new Error("unreachable");
		expect(present.manifest.artifact_id).toBe("artifact-present-1");

		const deleted = await readArtifactStatus(deps, {
			runId,
			artifactId: "artifact-fixture-2",
		});
		expect(deleted.status).toBe("deleted");
		if (deleted.status !== "deleted") throw new Error("unreachable");
		expect(deleted.tombstone.phase).toBe("complete");

		expect(
			await readArtifactStatus(deps, { runId, artifactId: "no-such-artifact" }),
		).toEqual({ status: "missing" });

		const corrupt = await readArtifactStatus(deps, {
			runId,
			artifactId: "artifact-fixture-1",
		});
		expect(corrupt.status).toBe("corrupt");
		if (corrupt.status !== "corrupt") throw new Error("unreachable");
		expect(corrupt.message).toContain("do not match");
	});

	test("a manifest whose payload identity disagrees with its path is corrupt", async () => {
		const { deps } = await makeWorld();
		const path = artifactManifestPath(deps.paths, "run-path", "artifact-path");
		await deps.fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await deps.fs.writeFileDurable(
			path,
			encodeDurableRecord(
				"artifact-manifest",
				makeManifest({
					run_id: "run-other",
					artifact_id: "artifact-other",
					content_hash: sha256Hex("bytes"),
				}),
			),
			0o600,
		);
		await deps.fs.writeFileDurable(
			artifactBytesPath(deps.paths, "run-path", "artifact-path"),
			"bytes",
			0o600,
		);
		expect(
			await readArtifactStatus(deps, {
				runId: "run-path",
				artifactId: "artifact-path",
			}),
		).toMatchObject({ status: "corrupt" });
		expect(
			await deleteArtifact(deps, {
				runId: "run-path",
				artifactId: "artifact-path",
				reason: "explicit-delete",
			}),
		).toMatchObject({ ok: false, code: "artifact_corrupt" });
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		expect(
			await exportArtifact(deps, {
				runId: "run-path",
				artifactId: "artifact-path",
				destinationPath: "/exports/mismatch.har",
			}),
		).toMatchObject({ ok: false, code: "artifact_corrupt" });
	});

	test("a pending tombstone whose payload identity disagrees with its path is not repairable", async () => {
		const { deps } = await makeWorld();
		const path = artifactTombstonePath(deps.paths, "run-path", "artifact-path");
		await deps.fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await deps.fs.writeFileDurable(
			path,
			encodeDurableRecord("tombstone", {
				artifact_id: "artifact-other",
				run_id: "run-other",
				retention: "ephemeral",
				reason: "retention-expiry",
				phase: "pending",
				deleted_at_epoch_ms: 1_000,
			}),
			0o600,
		);
		expect(await listPendingTombstones(deps)).toEqual([]);
		expect(
			await deleteArtifact(deps, {
				runId: "run-path",
				artifactId: "artifact-path",
				reason: "retention-expiry",
			}),
		).toMatchObject({ ok: false, code: "artifact_corrupt" });
	});

	test("a pending tombstone already reads deleted — deletion intent is truth", async () => {
		const { deps } = await makeWorld();
		const runId = "run-fixture-1";
		await deps.fs.mkdir(deps.paths.state.artifactDir(runId), {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFileDurable(
			artifactTombstonePath(deps.paths, runId, "artifact-fixture-1"),
			fixtureText("tombstone-pending.json"),
			0o600,
		);
		const status = await readArtifactStatus(deps, {
			runId,
			artifactId: "artifact-fixture-1",
		});
		expect(status.status).toBe("deleted");
		if (status.status !== "deleted") throw new Error("unreachable");
		expect(status.tombstone.phase).toBe("pending");
	});

	test("a manifest with absent bytes is corrupt, distinct from missing", async () => {
		const { deps } = await makeWorld();
		await writeArtifactManifest(deps, makeManifest());
		const status = await readArtifactStatus(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
		});
		expect(status.status).toBe("corrupt");
		if (status.status !== "corrupt") throw new Error("unreachable");
		expect(status.message).toContain("ENOENT");
	});
});

describe("deleteArtifact two-phase idempotent deletion (R29; S16)", () => {
	test("a full delete removes bytes, manifest, and artifact-keyed cache index entries, leaving a complete tombstone", async () => {
		const { deps, clock } = await makeWorld();
		await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			contents: "har-body\n",
			retention: "failure-evidence",
		});
		await deps.fs.mkdir(deps.paths.cache.indexesDir, { recursive: true, mode: 0o700 });
		for (const entry of [
			"artifact-1.json",
			"artifact-1.entries.idx",
			"artifact-1x.json",
			"other.json",
		]) {
			await deps.fs.writeFileDurable(
				join(deps.paths.cache.indexesDir, entry),
				"{}",
				0o600,
			);
		}
		const result = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			reason: "explicit-delete",
		});
		expect(result).toEqual({
			ok: true,
			tombstone: {
				artifact_id: "artifact-1",
				run_id: "run-1",
				retention: "failure-evidence",
				reason: "explicit-delete",
				phase: "complete",
				deleted_at_epoch_ms: clock.now(),
			},
		});
		expect(
			await deps.fs.lstat(artifactBytesPath(deps.paths, "run-1", "artifact-1")),
		).toBeUndefined();
		expect(
			await deps.fs.lstat(artifactManifestPath(deps.paths, "run-1", "artifact-1")),
		).toBeUndefined();
		// Only artifact-keyed index entries fall; near-miss prefixes survive.
		expect(await deps.fs.readDirectory(deps.paths.cache.indexesDir)).toEqual(
			expect.arrayContaining(["artifact-1x.json", "other.json"]),
		);
		expect(await deps.fs.readDirectory(deps.paths.cache.indexesDir)).toHaveLength(2);
		const status = await readArtifactStatus(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
		});
		expect(status.status).toBe("deleted");
	});

	test("S16: a crash before the pending tombstone commits leaves the artifact present; reapply converges", async () => {
		const { overlay, deps } = await makeWorld();
		await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			contents: "har-body\n",
			retention: "failure-evidence",
		});
		const artifactDir = deps.paths.state.artifactDir("run-1");
		overlay.hooks.onBeforeFsync = (path) => {
			// The first artifactDir flush is the pending tombstone's dir flush.
			if (path === artifactDir) {
				overlay.hooks.onBeforeFsync = undefined;
				overlay.crash();
			}
		};
		const crashed = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			reason: "explicit-delete",
		});
		expect(crashed).toMatchObject({ ok: false, code: "store_flush_failed" });
		// The intent never committed: the artifact is still fully present.
		expect(
			(await readArtifactStatus(deps, { runId: "run-1", artifactId: "artifact-1" }))
				.status,
		).toBe("present");
		const reapplied = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			reason: "explicit-delete",
		});
		expect(reapplied).toMatchObject({
			ok: true,
			tombstone: { phase: "complete" },
		});
		expect(
			(await readArtifactStatus(deps, { runId: "run-1", artifactId: "artifact-1" }))
				.status,
		).toBe("deleted");
	});

	test("S16: a crash after the byte unlinks resumes from the pending tombstone, preserving recorded intent", async () => {
		const { overlay, deps, clock } = await makeWorld();
		await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			contents: "har-body\n",
			retention: "failure-evidence",
		});
		const intentEpochMs = clock.now();
		let tempFsyncs = 0;
		overlay.hooks.onBeforeFsync = (path) => {
			if (!path.includes(".tmp-")) return;
			tempFsyncs += 1;
			// Temp flush 1 is the pending tombstone; temp flush 2 is the
			// complete tombstone — crash after the unlinks, before completion.
			if (tempFsyncs === 2) {
				overlay.hooks.onBeforeFsync = undefined;
				overlay.crash();
			}
		};
		const crashed = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			reason: "explicit-delete",
		});
		expect(crashed).toMatchObject({ ok: false, code: "store_flush_failed" });
		// Pending intent survived the crash; bytes and manifest are gone.
		expect(
			await deps.fs.lstat(artifactBytesPath(deps.paths, "run-1", "artifact-1")),
		).toBeUndefined();
		expect(
			await deps.fs.lstat(artifactManifestPath(deps.paths, "run-1", "artifact-1")),
		).toBeUndefined();
		expect(await listPendingTombstones(deps)).toMatchObject([
			{ artifact_id: "artifact-1", phase: "pending" },
		]);
		// Reapply later with a DIFFERENT reason: the recorded intent wins.
		clock.advance(5_000);
		const reapplied = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			reason: "retention-expiry",
		});
		expect(reapplied).toEqual({
			ok: true,
			tombstone: {
				artifact_id: "artifact-1",
				run_id: "run-1",
				retention: "failure-evidence",
				reason: "explicit-delete",
				phase: "complete",
				deleted_at_epoch_ms: intentEpochMs,
			},
		});
		expect(await listPendingTombstones(deps)).toEqual([]);
	});

	test("S16: deleting an already-deleted artifact returns the existing tombstone unchanged", async () => {
		const { deps, clock } = await makeWorld();
		await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			contents: "har-body\n",
			retention: "ephemeral",
		});
		const first = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			reason: "explicit-delete",
		});
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error("unreachable");
		clock.advance(60_000);
		const again = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			reason: "retention-expiry",
		});
		expect(again).toEqual({ ok: true, tombstone: first.tombstone });
	});

	test("deleting an artifact with no manifest and no tombstone is a typed artifact_missing", async () => {
		const { deps } = await makeWorld();
		const result = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "never-existed",
			reason: "explicit-delete",
		});
		expect(result).toMatchObject({ ok: false, code: "artifact_missing" });
	});

	test("an export-owned artifact is refused on the fresh manifest read; bytes, manifest, and a later sweep leave it intact", async () => {
		const { deps } = await makeWorld();
		// An export completed (retention flipped to export) with no standing
		// tombstone — the sweep-read/delete-read race that would destroy the
		// export receipt + bytes.
		const manifest = await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "exported-1",
			contents: "exported bytes\n",
			retention: "export",
		});
		const refused = await deleteArtifact(deps, {
			runId: "run-1",
			artifactId: "exported-1",
			reason: "explicit-delete",
		});
		expect(refused).toMatchObject({
			ok: false,
			code: "export_destination_unsafe",
		});
		// The redacted message never leaks a path.
		if (refused.ok) throw new Error("unreachable");
		expect(refused.message).not.toContain("/");
		// Bytes, manifest, and the four-way truth are untouched; no tombstone.
		expect(
			await deps.fs.readTextFile(
				artifactBytesPath(deps.paths, "run-1", "exported-1"),
			),
		).toBe("exported bytes\n");
		const onDisk = await readDurableFile(
			deps.fs,
			artifactManifestPath(deps.paths, "run-1", "exported-1"),
		);
		if (onDisk.status !== "present") throw new Error("manifest destroyed");
		expect(onDisk.raw).toBe(encodeDurableRecord("artifact-manifest", manifest));
		expect(
			await deps.fs.lstat(
				artifactTombstonePath(deps.paths, "run-1", "exported-1"),
			),
		).toBeUndefined();
		expect(
			(await readArtifactStatus(deps, { runId: "run-1", artifactId: "exported-1" }))
				.status,
		).toBe("present");
		// A sweep over the same artifact leaves it intact (its typed delete
		// refusal is a skip, not a fatal).
		const swept = await sweepExpiredArtifacts(deps, {
			isRunTerminal: async () => true,
		});
		expect(swept.deleted).toEqual([]);
		expect(
			(await readArtifactStatus(deps, { runId: "run-1", artifactId: "exported-1" }))
				.status,
		).toBe("present");
	});
});

describe("sweepExpiredArtifacts (R29 retention classes)", () => {
	test("ephemeral-of-terminal and failure-evidence strictly older than seven days fall; live, fresh, boundary, and export survive", async () => {
		const { deps, clock } = await makeWorld();
		clock.set(RETENTION_FAILURE_EVIDENCE_MS + 1);
		await seedArtifact(deps, {
			runId: "run-terminal",
			artifactId: "ephemeral-terminal",
			contents: "a\n",
			retention: "ephemeral",
			createdAtEpochMs: clock.now(),
		});
		await seedArtifact(deps, {
			runId: "run-live",
			artifactId: "ephemeral-live",
			contents: "b\n",
			retention: "ephemeral",
			createdAtEpochMs: clock.now(),
		});
		await seedArtifact(deps, {
			runId: "run-evidence",
			artifactId: "evidence-expired",
			contents: "c\n",
			retention: "failure-evidence",
			createdAtEpochMs: 0,
		});
		await seedArtifact(deps, {
			runId: "run-evidence",
			artifactId: "evidence-boundary",
			contents: "d\n",
			retention: "failure-evidence",
			createdAtEpochMs: 1,
		});
		await seedArtifact(deps, {
			runId: "run-terminal",
			artifactId: "exported-old",
			contents: "e\n",
			retention: "export",
			createdAtEpochMs: 0,
		});
		const swept = await sweepExpiredArtifacts(deps, {
			isRunTerminal: async (runId) => runId === "run-terminal",
		});
		expect(swept.deleted).toEqual(["ephemeral-terminal", "evidence-expired"]);
		const expired = await readArtifactStatus(deps, {
			runId: "run-evidence",
			artifactId: "evidence-expired",
		});
		expect(expired.status).toBe("deleted");
		if (expired.status !== "deleted") throw new Error("unreachable");
		expect(expired.tombstone.reason).toBe("retention-expiry");
		for (const [runId, artifactId] of [
			["run-live", "ephemeral-live"],
			["run-evidence", "evidence-boundary"],
			["run-terminal", "exported-old"],
		] as const) {
			expect((await readArtifactStatus(deps, { runId, artifactId })).status).toBe(
				"present",
			);
		}
	});

	test("a missing artifacts tree sweeps to an empty result", async () => {
		const { deps } = await makeWorld();
		expect(
			await sweepExpiredArtifacts(deps, { isRunTerminal: async () => true }),
		).toEqual({ deleted: [] });
	});
});

describe("exportArtifact ownership transfer (R29; S18)", () => {
	test("S18: export outside every root is hash-verified, flips retention to export, and sweeps skip it", async () => {
		const { deps, clock } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			contents: "har-body\n",
			retention: "failure-evidence",
			createdAtEpochMs: 0,
		});
		clock.set(RETENTION_FAILURE_EVIDENCE_MS + 1);
		const destination = "/exports/copy.har";
		const result = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: destination,
		});
		expect(result).toMatchObject({
			ok: true,
			manifest: {
				retention: "export",
				export_receipt: {
					destination_digest: sha256Hex(destination),
					exported_at_epoch_ms: clock.now(),
				},
			},
		});
		expect(await deps.fs.readTextFile(destination)).toBe("har-body\n");
		// The rewritten manifest is the disk truth and the receipt carries a
		// path DIGEST, never the raw destination path.
		const onDisk = await readDurableFile(
			deps.fs,
			artifactManifestPath(deps.paths, "run-1", "artifact-1"),
		);
		if (onDisk.status !== "present") throw new Error("manifest missing");
		expect(onDisk.raw).not.toContain("/exports");
		// Outside default retention: an otherwise-expiring sweep skips it.
		expect(
			await sweepExpiredArtifacts(deps, { isRunTerminal: async () => true }),
		).toEqual({ deleted: [] });
		expect(
			(await readArtifactStatus(deps, { runId: "run-1", artifactId: "artifact-1" }))
				.status,
		).toBe("present");
	});

	test("the committed export destination survives a simulated power loss", async () => {
		const { overlay, deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await seedArtifact(deps, {
			runId: "run-durable-export",
			artifactId: "artifact-durable-export",
			contents: "durable export\n",
			retention: "failure-evidence",
		});
		const result = await exportArtifact(deps, {
			runId: "run-durable-export",
			artifactId: "artifact-durable-export",
			destinationPath: "/exports/durable.har",
		});
		expect(result.ok).toBe(true);
		overlay.crash();
		expect(await deps.fs.readTextFile("/exports/durable.har")).toBe(
			"durable export\n",
		);
	});

	test("a post-rename manifest sync failure retries without deleting the export", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await seedArtifact(deps, {
			runId: "run-uncertain-export",
			artifactId: "artifact-uncertain-export",
			contents: "uncertain export\n",
			retention: "failure-evidence",
		});
		const manifestDir = deps.paths.state.artifactDir("run-uncertain-export");
		const originalFs = deps.fs;
		let failOnce = true;
		const uncertainDeps: RetentionDeps = {
			...deps,
			fs: {
				...originalFs,
				async syncDirectory(path) {
					await originalFs.syncDirectory(path);
					if (failOnce && path === manifestDir) {
						failOnce = false;
						throw Object.assign(new Error("uncertain manifest sync"), {
							code: "EIO",
						});
					}
				},
			},
		};
		const result = await exportArtifact(uncertainDeps, {
			runId: "run-uncertain-export",
			artifactId: "artifact-uncertain-export",
			destinationPath: "/exports/uncertain.har",
		});
		expect(result).toMatchObject({
			ok: true,
			manifest: { retention: "export" },
		});
		expect(await deps.fs.readTextFile("/exports/uncertain.har")).toBe(
			"uncertain export\n",
		);
		const standing = await readDurableFile(
			deps.fs,
			artifactManifestPath(
				deps.paths,
				"run-uncertain-export",
				"artifact-uncertain-export",
			),
		);
		expect(standing).toMatchObject({ status: "present" });
		if (standing.status !== "present") throw new Error("manifest missing");
		expect(parseDurableRecord(standing.raw, "artifact-manifest")).toMatchObject({
			ok: true,
			payload: { retention: "export" },
		});
	});

	test("an existing export destination is never replaced", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await deps.fs.writeFileDurable("/exports/existing.har", "owner bytes\n", 0o600);
		await seedArtifact(deps, {
			runId: "run-existing-destination",
			artifactId: "artifact-existing-destination",
			contents: "new bytes\n",
			retention: "failure-evidence",
		});
		const result = await exportArtifact(deps, {
			runId: "run-existing-destination",
			artifactId: "artifact-existing-destination",
			destinationPath: "/exports/existing.har",
		});
		expect(result).toMatchObject({ ok: false, code: "retention_collision" });
		expect(await deps.fs.readTextFile("/exports/existing.har")).toBe("owner bytes\n");
		expect(
			(
				await readArtifactStatus(deps, {
					runId: "run-existing-destination",
					artifactId: "artifact-existing-destination",
				})
			).status,
		).toBe("present");
	});

	test("a tombstoned artifact cannot be exported even if stale bytes reappear", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await deps.fs.mkdir(deps.paths.state.artifactDir("run-deleted-export"), {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFileDurable(
			artifactTombstonePath(
				deps.paths,
				"run-deleted-export",
				"artifact-deleted-export",
			),
			encodeDurableRecord("tombstone", {
				artifact_id: "artifact-deleted-export",
				run_id: "run-deleted-export",
				retention: "failure-evidence",
				reason: "explicit-delete",
				phase: "complete",
				deleted_at_epoch_ms: 3_000,
			}),
			0o600,
		);
		expect(
			await exportArtifact(deps, {
				runId: "run-deleted-export",
				artifactId: "artifact-deleted-export",
				destinationPath: "/exports/deleted.har",
			}),
		).toMatchObject({ ok: false, code: "retention_collision" });
		expect(await deps.fs.lstat("/exports/deleted.har")).toBeUndefined();
	});

	test("delete cannot enter while export owns the artifact lock", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await seedArtifact(deps, {
			runId: "run-export-race",
			artifactId: "artifact-export-race",
			contents: "race bytes\n",
			retention: "failure-evidence",
		});
		const originalFs = deps.fs;
		let releaseCopy!: () => void;
		const copyGate = new Promise<void>((resolve) => {
			releaseCopy = resolve;
		});
		let reachedCopy!: () => void;
		const reachedCopyPromise = new Promise<void>((resolve) => {
			reachedCopy = resolve;
		});
		let pauseOnce = true;
		const gatedDeps: RetentionDeps = {
			...deps,
			fs: {
				...originalFs,
				async copyFileDurable(source, destination) {
					await originalFs.copyFileDurable(source, destination);
					if (pauseOnce) {
						pauseOnce = false;
						reachedCopy();
						await copyGate;
					}
				},
			},
		};
		const exporting = exportArtifact(gatedDeps, {
			runId: "run-export-race",
			artifactId: "artifact-export-race",
			destinationPath: "/exports/race.har",
		});
		await reachedCopyPromise;
		const deleting = await deleteArtifact(gatedDeps, {
			runId: "run-export-race",
			artifactId: "artifact-export-race",
			reason: "explicit-delete",
		});
		expect(deleting).toMatchObject({ ok: false, code: "store_lock_contended" });
		releaseCopy();
		expect(await exporting).toMatchObject({
			ok: true,
			manifest: { retention: "export" },
		});
		expect(
			(await readArtifactStatus(gatedDeps, {
				runId: "run-export-race",
				artifactId: "artifact-export-race",
			})).status,
		).toBe("present");
	});

	test("S18: a destination inside any browser-use root (or a relative one) is export_destination_unsafe", async () => {
		const { deps } = await makeWorld();
		await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			contents: "har-body\n",
			retention: "failure-evidence",
		});
		const inside = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: join(deps.paths.resolution.roots.state, "escape.har"),
		});
		expect(inside).toMatchObject({ ok: false, code: "export_destination_unsafe" });
		if (inside.ok) throw new Error("unreachable");
		expect(inside.message).not.toContain("/xdg");
		const relative = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: "exports/copy.har",
		});
		expect(relative).toMatchObject({ ok: false, code: "export_destination_unsafe" });
		const rootItself = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: deps.paths.resolution.roots.cache,
		});
		expect(rootItself).toMatchObject({
			ok: false,
			code: "export_destination_unsafe",
		});
	});

	test("a hash-mismatched copy is export_verify_failed, the destination is unlinked, and the manifest keeps its class", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await deps.fs.mkdir(deps.paths.state.artifactDir("run-1"), {
			recursive: true,
			mode: 0o700,
		});
		// Bytes drifted after the manifest was written.
		await deps.fs.writeFileDurable(
			artifactBytesPath(deps.paths, "run-1", "artifact-1"),
			"drifted bytes\n",
			0o600,
		);
		const manifest = makeManifest({ content_hash: sha256Hex("expected bytes\n") });
		await writeArtifactManifest(deps, manifest);
		const result = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: "/exports/copy.har",
		});
		expect(result).toMatchObject({ ok: false, code: "export_verify_failed" });
		expect(await deps.fs.lstat("/exports/copy.har")).toBeUndefined();
		const onDisk = await readDurableFile(
			deps.fs,
			artifactManifestPath(deps.paths, "run-1", "artifact-1"),
		);
		if (onDisk.status !== "present") throw new Error("manifest missing");
		const parsed = parseDurableRecord(onDisk.raw, "artifact-manifest");
		if (!parsed.ok) throw new Error("manifest corrupt");
		expect(parsed.payload.retention).toBe("failure-evidence");
	});

	test("re-export to the same destination is idempotent; a different destination after transfer collides", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		await seedArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			contents: "har-body\n",
			retention: "failure-evidence",
		});
		const first = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: "/exports/copy.har",
		});
		expect(first.ok).toBe(true);
		const replay = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: "/exports/copy.har",
		});
		expect(replay).toMatchObject({
			ok: true,
			manifest: { retention: "export" },
		});
		const moved = await exportArtifact(deps, {
			runId: "run-1",
			artifactId: "artifact-1",
			destinationPath: "/exports/elsewhere.har",
		});
		expect(moved).toMatchObject({ ok: false, code: "retention_collision" });
	});

	test("exporting a missing artifact is artifact_missing; absent bytes under a manifest are artifact_corrupt", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir("/exports", { recursive: true, mode: 0o700 });
		expect(
			await exportArtifact(deps, {
				runId: "run-1",
				artifactId: "never-existed",
				destinationPath: "/exports/x.har",
			}),
		).toMatchObject({ ok: false, code: "artifact_missing" });
		await writeArtifactManifest(deps, makeManifest());
		expect(
			await exportArtifact(deps, {
				runId: "run-1",
				artifactId: "artifact-1",
				destinationPath: "/exports/x.har",
			}),
		).toMatchObject({ ok: false, code: "artifact_corrupt" });
	});
});

describe("stageGeneration immutable staging (AE12 substrate; V2)", () => {
	const FILES = [
		{ relPath: "vendors/site.md", contents: "vendor knowledge\n" },
		{ relPath: "index.md", contents: "index\n" },
	];

	test("staging writes files durably, then commits the record; identical restage in any order is a verified no-op", async () => {
		const { deps, clock } = await makeWorld();
		const staged = await stageGeneration(deps, {
			generationId: "gen-1",
			files: FILES,
		});
		expect(staged).toMatchObject({
			ok: true,
			verified_noop: false,
			record: {
				generation_id: "gen-1",
				status: "staged",
				staged_at_epoch_ms: clock.now(),
			},
		});
		if (!staged.ok) throw new Error("unreachable");
		expect(
			await deps.fs.readTextFile(
				generationFilePath(deps.paths, "gen-1", "vendors/site.md"),
			),
		).toBe("vendor knowledge\n");
		// Restage later, with the files in a different input order.
		clock.advance(60_000);
		const restaged = await stageGeneration(deps, {
			generationId: "gen-1",
			files: [...FILES].reverse(),
		});
		expect(restaged).toEqual({
			ok: true,
			verified_noop: true,
			record: staged.record,
		});
	});

	test("mixed nested paths verify in global relPath order rather than directory-local DFS order", async () => {
		const { deps } = await makeWorld();
		const files = [
			{ relPath: "a/z.md", contents: "nested\n" },
			{ relPath: "a-plain.md", contents: "root\n" },
			{ relPath: "b.md", contents: "later\n" },
		];

		expect(
			await stageGeneration(deps, {
				generationId: "gen-global-order",
				files,
			}),
		).toMatchObject({ ok: true, verified_noop: false });
		expect(
			await stageGeneration(deps, {
				generationId: "gen-global-order",
				files: [...files].reverse(),
			}),
		).toMatchObject({ ok: true, verified_noop: true });
	});

	test("content drift against a recorded generation is a typed fatal retention_collision; nothing is rewritten", async () => {
		const { deps } = await makeWorld();
		await stageGeneration(deps, { generationId: "gen-1", files: FILES });
		const drifted = await stageGeneration(deps, {
			generationId: "gen-1",
			files: [{ relPath: "index.md", contents: "tampered\n" }],
		});
		expect(drifted).toMatchObject({ ok: false, code: "retention_collision" });
		expect(
			await deps.fs.readTextFile(generationFilePath(deps.paths, "gen-1", "index.md")),
		).toBe("index\n");
	});

	test("same-id generation staging is serialized across callers", async () => {
		const { deps } = await makeWorld();
		const originalFs = deps.fs;
		let releaseWrite!: () => void;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		let reachedWrite!: () => void;
		const reachedWritePromise = new Promise<void>((resolve) => {
			reachedWrite = resolve;
		});
		let pauseOnce = true;
		const gatedDeps: RetentionDeps = {
			...deps,
			fs: {
				...originalFs,
				async writeFileDurable(path, contents, mode) {
					await originalFs.writeFileDurable(path, contents, mode);
					if (pauseOnce && path.includes("/generations/gen-serialized/")) {
						pauseOnce = false;
						reachedWrite();
						await writeGate;
					}
				},
			},
		};
		const first = stageGeneration(gatedDeps, {
			generationId: "gen-serialized",
			files: [{ relPath: "index.md", contents: "first\n" }],
		});
		await reachedWritePromise;
		expect(
			await stageGeneration(gatedDeps, {
				generationId: "gen-serialized",
				files: [{ relPath: "index.md", contents: "second\n" }],
			}),
		).toMatchObject({ ok: false, code: "store_lock_contended" });
		releaseWrite();
		expect(await first).toMatchObject({ ok: true, verified_noop: false });
	});

	test("a committed record with a missing staged file is corrupt, never a verified no-op", async () => {
		const { deps } = await makeWorld();
		await stageGeneration(deps, { generationId: "gen-missing", files: FILES });
		await deps.fs.unlink(
			generationFilePath(deps.paths, "gen-missing", "vendors/site.md"),
		);
		const restaged = await stageGeneration(deps, {
			generationId: "gen-missing",
			files: FILES,
		});
		expect(restaged).toMatchObject({ ok: false, code: "store_record_corrupt" });
	});

	test("an unexpected staged path blocks the generation record commit", async () => {
		const { deps } = await makeWorld();
		const extra = generationFilePath(deps.paths, "gen-extra", "unexpected.md");
		await deps.fs.mkdir(dirname(extra), { recursive: true, mode: 0o700 });
		await deps.fs.writeFileDurable(extra, "unexpected\n", 0o600);
		const staged = await stageGeneration(deps, {
			generationId: "gen-extra",
			files: FILES,
		});
		expect(staged).toMatchObject({ ok: false, code: "store_record_corrupt" });
		expect(
			await readDurableFile(deps.fs, generationRecordPath(deps.paths, "gen-extra")),
		).toEqual({ status: "missing" });
	});

	test("V2: a crash before the record commit preserves the prior generation; reapply completes, then verifies as a no-op", async () => {
		const { overlay, deps } = await makeWorld();
		const prior = await stageGeneration(deps, { generationId: "gen-1", files: FILES });
		if (!prior.ok) throw new Error("unreachable");
		const gen2Record = generationRecordPath(deps.paths, "gen-2");
		overlay.hooks.onBeforeFsync = (path) => {
			// gen-2's staged FILES flush first; crash on the record's temp flush.
			if (path.startsWith(gen2Record)) {
				overlay.hooks.onBeforeFsync = undefined;
				overlay.crash();
			}
		};
		const crashed = await stageGeneration(deps, {
			generationId: "gen-2",
			files: [{ relPath: "index.md", contents: "second generation\n" }],
		});
		expect(crashed).toMatchObject({ ok: false, code: "store_flush_failed" });
		// Prior generation record + files survive intact; gen-2 never committed.
		expect(
			await readDurableFile(deps.fs, generationRecordPath(deps.paths, "gen-1")),
		).toMatchObject({ status: "present" });
		expect(
			await deps.fs.readTextFile(generationFilePath(deps.paths, "gen-1", "index.md")),
		).toBe("index\n");
		expect(
			await readDurableFile(deps.fs, gen2Record),
		).toEqual({ status: "missing" });
		// Reapply completes the uncommitted stage; a second reapply verifies.
		const reapplied = await stageGeneration(deps, {
			generationId: "gen-2",
			files: [{ relPath: "index.md", contents: "second generation\n" }],
		});
		expect(reapplied).toMatchObject({ ok: true, verified_noop: false });
		const verified = await stageGeneration(deps, {
			generationId: "gen-2",
			files: [{ relPath: "index.md", contents: "second generation\n" }],
		});
		expect(verified).toMatchObject({ ok: true, verified_noop: true });
	});

	test("V2: a crash during a staged file's flush also leaves the prior generation intact", async () => {
		const { overlay, deps } = await makeWorld();
		await stageGeneration(deps, { generationId: "gen-1", files: FILES });
		const gen3Dir = join(deps.paths.state.generationsDir, "gen-3");
		overlay.hooks.onBeforeFsync = (path) => {
			if (path.startsWith(`${gen3Dir}/`)) {
				overlay.hooks.onBeforeFsync = undefined;
				overlay.crash();
			}
		};
		const crashed = await stageGeneration(deps, {
			generationId: "gen-3",
			files: [{ relPath: "index.md", contents: "third\n" }],
		});
		expect(crashed).toMatchObject({ ok: false, code: "store_flush_failed" });
		expect(
			await readDurableFile(deps.fs, generationRecordPath(deps.paths, "gen-1")),
		).toMatchObject({ status: "present" });
		expect(
			await readDurableFile(deps.fs, generationRecordPath(deps.paths, "gen-3")),
		).toEqual({ status: "missing" });
	});

	test("V2: a crash mid-advanceActivationEpoch preserves the prior epoch; reapply converges, then is idempotent", async () => {
		const { overlay, deps } = await makeWorld();
		// Establish a durable prior epoch through the real advance (an absent
		// record is epoch 1 by definition, so this commits epoch 2).
		expect(await advanceActivationEpoch(deps, { expectedEpoch: 1 })).toEqual({
			ok: true,
			epoch: 2,
		});
		const priorBytes = await deps.fs.readTextFile(deps.paths.state.epochFile);
		expect(priorBytes).toBe(encodeDurableRecord("activation-epoch", { epoch: 2 }));
		// Crash on the epoch record's own temp-file flush INSIDE the advance:
		// the epoch half of V2 goes through advanceActivationEpoch itself, so
		// a non-durable epoch write in locks could never pass this test.
		overlay.hooks.onBeforeFsync = (path) => {
			if (path.startsWith(deps.paths.state.epochFile)) {
				overlay.hooks.onBeforeFsync = undefined;
				overlay.crash();
			}
		};
		const crashed = await advanceActivationEpoch(deps, { expectedEpoch: 2 });
		expect(crashed).toMatchObject({ ok: false, code: "epoch_store_failed" });
		// The prior epoch record survives byte-identical and stays in force.
		expect(await deps.fs.readTextFile(deps.paths.state.epochFile)).toBe(priorBytes);
		expect(await readActivationEpoch(deps)).toBe(2);
		// Reapply completes the interrupted advance; repeating the SAME advance
		// afterwards is the AE12 idempotent no-op.
		expect(await advanceActivationEpoch(deps, { expectedEpoch: 2 })).toEqual({
			ok: true,
			epoch: 3,
		});
		expect(await advanceActivationEpoch(deps, { expectedEpoch: 2 })).toEqual({
			ok: true,
			epoch: 3,
		});
	});

	test("unsafe relPaths and duplicate relPaths are TypeError caller bugs", async () => {
		const { deps } = await makeWorld();
		for (const relPath of ["../escape.md", "/absolute.md", "a//b.md", "a\\b.md"]) {
			await expect(
				stageGeneration(deps, {
					generationId: "gen-bad",
					files: [{ relPath, contents: "x" }],
				}),
			).rejects.toThrow(TypeError);
		}
		await expect(
			stageGeneration(deps, {
				generationId: "gen-bad",
				files: [
					{ relPath: "same.md", contents: "x" },
					{ relPath: "same.md", contents: "y" },
				],
			}),
		).rejects.toThrow(TypeError);
	});
});

describe("writeSourceSnapshot immutable write (R10)", () => {
	function makeSnapshot(
		overrides: Partial<BrowserUseSourceSnapshotPayload> = {},
	): BrowserUseSourceSnapshotPayload {
		return {
			snapshot_id: "snap-1",
			root_identity: "warm-chrome-profile",
			entries: [
				{
					relative_path: "prefs.json",
					type: "file",
					size: 12,
					mode: 0o600,
					content_hash: sha256Hex("prefs"),
				},
			],
			snapshot_digest: "digest-1",
			...overrides,
		};
	}

	test("absent -> written; identical digest -> verified no-op; different digest -> retention_collision", async () => {
		const { deps } = await makeWorld();
		const snapshot = makeSnapshot();
		expect(await writeSourceSnapshot(deps, snapshot)).toEqual({
			ok: true,
			verified_noop: false,
		});
		expect(
			await deps.fs.readTextFile(sourceSnapshotPath(deps.paths, "snap-1")),
		).toBe(encodeDurableRecord("source-snapshot", snapshot));
		expect(await writeSourceSnapshot(deps, snapshot)).toEqual({
			ok: true,
			verified_noop: true,
		});
		expect(
			await writeSourceSnapshot(deps, makeSnapshot({ snapshot_digest: "digest-2" })),
		).toMatchObject({ ok: false, code: "retention_collision" });
	});

	test("same-id snapshot writes are serialized across callers", async () => {
		const { deps } = await makeWorld();
		const originalFs = deps.fs;
		const snapshotPath = sourceSnapshotPath(deps.paths, "snap-serialized");
		let releaseWrite!: () => void;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		let reachedWrite!: () => void;
		const reachedWritePromise = new Promise<void>((resolve) => {
			reachedWrite = resolve;
		});
		let pauseOnce = true;
		const gatedDeps: RetentionDeps = {
			...deps,
			fs: {
				...originalFs,
				async writeFileDurable(path, contents, mode) {
					await originalFs.writeFileDurable(path, contents, mode);
					if (pauseOnce && path.startsWith(snapshotPath)) {
						pauseOnce = false;
						reachedWrite();
						await writeGate;
					}
				},
			},
		};
		const first = writeSourceSnapshot(
			gatedDeps,
			makeSnapshot({
				snapshot_id: "snap-serialized",
				snapshot_digest: "digest-first",
			}),
		);
		await reachedWritePromise;
		expect(
			await writeSourceSnapshot(
				gatedDeps,
				makeSnapshot({
					snapshot_id: "snap-serialized",
					snapshot_digest: "digest-second",
				}),
			),
		).toMatchObject({ ok: false, code: "store_lock_contended" });
		releaseWrite();
		expect(await first).toEqual({ ok: true, verified_noop: false });
	});
});

describe("listPendingTombstones repair projection", () => {
	test("projects only pending tombstones, across run directories, sorted by artifact id", async () => {
		const { deps } = await makeWorld();
		await deps.fs.mkdir(deps.paths.state.artifactDir("run-fixture-1"), {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFileDurable(
			artifactTombstonePath(deps.paths, "run-fixture-1", "artifact-fixture-1"),
			fixtureText("tombstone-pending.json"),
			0o600,
		);
		await deps.fs.writeFileDurable(
			artifactTombstonePath(deps.paths, "run-fixture-1", "artifact-fixture-2"),
			fixtureText("tombstone-complete.json"),
			0o600,
		);
		await deps.fs.mkdir(deps.paths.state.artifactDir("run-2"), {
			recursive: true,
			mode: 0o700,
		});
		await deps.fs.writeFileDurable(
			artifactTombstonePath(deps.paths, "run-2", "aa-first"),
			encodeDurableRecord("tombstone", {
				artifact_id: "aa-first",
				run_id: "run-2",
				retention: "ephemeral",
				reason: "explicit-delete",
				phase: "pending",
				deleted_at_epoch_ms: 5_000,
			}),
			0o600,
		);
		const pending = await listPendingTombstones(deps);
		expect(pending.map((tombstone) => tombstone.artifact_id)).toEqual([
			"aa-first",
			"artifact-fixture-1",
		]);
		expect(pending.every((tombstone) => tombstone.phase === "pending")).toBe(true);
	});

	test("a missing artifacts tree is an empty projection", async () => {
		const { deps } = await makeWorld();
		expect(await listPendingTombstones(deps)).toEqual([]);
	});
});
