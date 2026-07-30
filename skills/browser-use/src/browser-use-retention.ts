// ---------------------------------------------------------------------------
// Retention substrate (platform plan 2026-07-21-002 U2, R29; AE12/AE14).
//
// Immutable staged generations and source snapshots (the mechanics U3/U7
// fill with corpus content), artifact manifests, idempotent crash-resumable
// two-phase deletion with redacted tombstones, the deleted-vs-missing-vs-
// corrupt-vs-present four-way truth, the retention sweep, and export
// ownership transfer. This module owns the on-disk NAMING contract for
// artifacts, generations, and snapshots (the exported *Path helpers); every
// byte it persists flows through the store's durable-write pipeline.
//
// Import direction: schemas + store + paths + core only. No lease logic, run
// mutation, or migration inventory (U3). Per-artifact advisory locks serialize
// manifest writes, exports, and deletes. A recorded generation is NEVER edited
// in place: an identical re-stage first verifies the complete staged tree. No
// Date.now anywhere — time enters through the injected clock; ids are
// caller-supplied and content hashes are sha256.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { redactUnsafeText } from "./browser-use-core";
import type {
	BrowserUseAdmittedPaths,
	BrowserUsePlatformFs,
} from "./browser-use-paths";
import {
	type BrowserUseArtifactManifestPayload,
	type BrowserUseGenerationPayload,
	type BrowserUseSourceSnapshotPayload,
	type BrowserUseTombstonePayload,
	encodeDurableRecord,
	findRedactionViolations,
	parseDurableRecord,
} from "./browser-use-schemas";
import {
	type StoreFailure,
	readDurableFile,
	withExclusiveFileLock,
	writeDurableFile,
} from "./browser-use-store";

// --- Deps + typed failures ---------------------------------------------------

/** Injected seams: the platform fs port, admitted paths, and the clock. */
export type RetentionDeps = {
	fs: BrowserUsePlatformFs;
	paths: BrowserUseAdmittedPaths;
	clock: () => number;
};

/**
 * Retention failure codes: the retention-owned refusals plus store failures
 * passed through verbatim (their codes are already in the diagnostic
 * registry).
 */
export type BrowserUseRetentionFailureCode =
	| "retention_collision"
	| "artifact_missing"
	| "artifact_corrupt"
	| "export_destination_unsafe"
	| "export_verify_failed"
	| StoreFailure["code"];

/** One typed retention failure; `message` is redacted, never a raw path. */
export type BrowserUseRetentionFailure = {
	ok: false;
	code: BrowserUseRetentionFailureCode;
	message: string;
};

/** R29 retention window for failure/drift evidence: seven days. */
export const RETENTION_FAILURE_EVIDENCE_MS = 7 * 24 * 60 * 60 * 1000;

// Advisory-lock staleness for retention ownership operations.
const RETENTION_LOCK_STALE_MS = 30_000;
let exportSequence = 0;

// The on-disk suffixes reserved for retention metadata next to artifact bytes.
const MANIFEST_SUFFIX = ".manifest.json";
const TOMBSTONE_SUFFIX = ".tombstone.json";

function retentionFailure(
	code: BrowserUseRetentionFailureCode,
	message: string,
): BrowserUseRetentionFailure {
	return { ok: false, code, message: redactUnsafeText(message) };
}

// Error messages carry only the errno code, never the node message: node
// error strings embed quoted paths redactUnsafeText is not shaped to catch.
function errorCode(error: unknown): string {
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" && code !== "" ? code : "unknown";
}

// --- The naming contract -----------------------------------------------------

// Ids become single path segments under admitted roots (the paths precedent);
// the reserved metadata suffixes are refused so an artifact's BYTES file can
// never collide with another artifact's manifest or tombstone.
function assertSafeId(id: string, label: string): void {
	if (
		id === "" ||
		id === "." ||
		id === ".." ||
		id.includes("/") ||
		id.includes("\\") ||
		id.includes("\0") ||
		id.endsWith(MANIFEST_SUFFIX) ||
		id.endsWith(TOMBSTONE_SUFFIX)
	) {
		throw new TypeError(`${label} is not a safe single path segment`);
	}
}

/**
 * Raw artifact bytes: `<state>/artifacts/<runId>/<artifactId>`.
 *
 * @param paths - Admitted Target XDG Shape
 * @param runId - Owning shared run id
 * @param artifactId - Artifact id (single path segment)
 * @returns Absolute bytes path
 */
export function artifactBytesPath(
	paths: BrowserUseAdmittedPaths,
	runId: string,
	artifactId: string,
): string {
	assertSafeId(artifactId, "artifactId");
	return join(paths.state.artifactDir(runId), artifactId);
}

/**
 * Artifact manifest record: `<state>/artifacts/<runId>/<artifactId>.manifest.json`.
 *
 * @param paths - Admitted Target XDG Shape
 * @param runId - Owning shared run id
 * @param artifactId - Artifact id (single path segment)
 * @returns Absolute manifest path
 */
export function artifactManifestPath(
	paths: BrowserUseAdmittedPaths,
	runId: string,
	artifactId: string,
): string {
	assertSafeId(artifactId, "artifactId");
	return join(paths.state.artifactDir(runId), `${artifactId}${MANIFEST_SUFFIX}`);
}

/**
 * Retention tombstone record: `<state>/artifacts/<runId>/<artifactId>.tombstone.json`.
 * The tombstone outlives the bytes and manifest by design (R29).
 *
 * @param paths - Admitted Target XDG Shape
 * @param runId - Owning shared run id
 * @param artifactId - Artifact id (single path segment)
 * @returns Absolute tombstone path
 */
export function artifactTombstonePath(
	paths: BrowserUseAdmittedPaths,
	runId: string,
	artifactId: string,
): string {
	assertSafeId(artifactId, "artifactId");
	return join(paths.state.artifactDir(runId), `${artifactId}${TOMBSTONE_SUFFIX}`);
}

/**
 * Generation record: `<state>/generations/<generationId>.json` — a SIBLING of
 * the generation's file directory, so no staged relPath can collide with it.
 *
 * @param paths - Admitted Target XDG Shape
 * @param generationId - Generation id (single path segment)
 * @returns Absolute generation record path
 */
export function generationRecordPath(
	paths: BrowserUseAdmittedPaths,
	generationId: string,
): string {
	assertSafeId(generationId, "generationId");
	return join(paths.state.generationsDir, `${generationId}.json`);
}

/**
 * One staged generation file: `<state>/generations/<generationId>/<relPath>`.
 *
 * @param paths - Admitted Target XDG Shape
 * @param generationId - Generation id (single path segment)
 * @param relPath - Slash-separated relative path inside the generation
 * @returns Absolute staged-file path
 */
export function generationFilePath(
	paths: BrowserUseAdmittedPaths,
	generationId: string,
	relPath: string,
): string {
	assertSafeId(generationId, "generationId");
	return join(
		paths.state.generationsDir,
		generationId,
		...safeRelSegments(relPath),
	);
}

/**
 * Source snapshot record: `<state>/migrations/snapshots/<snapshotId>.json`
 * (R10 — snapshots belong to the migration surface U3 consumes).
 *
 * @param paths - Admitted Target XDG Shape
 * @param snapshotId - Snapshot id (single path segment)
 * @returns Absolute snapshot record path
 */
export function sourceSnapshotPath(
	paths: BrowserUseAdmittedPaths,
	snapshotId: string,
): string {
	assertSafeId(snapshotId, "snapshotId");
	return join(paths.state.migrationsDir, "snapshots", `${snapshotId}.json`);
}

// A generation relPath is a chain of safe segments; anything that could
// escape the generation directory is a caller bug, not a typed refusal.
function safeRelSegments(relPath: string): string[] {
	const segments = relPath.split("/");
	for (const segment of segments) {
		if (
			segment === "" ||
			segment === "." ||
			segment === ".." ||
			segment.includes("\\") ||
			segment.includes("\0")
		) {
			throw new TypeError("relPath is not a safe relative path");
		}
	}
	return segments;
}

// --- Shared record helpers ---------------------------------------------------

function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function retentionLockPath(
	paths: BrowserUseAdmittedPaths,
	identity: string,
): string {
	const digest = sha256Hex(identity).slice(0, 32);
	return join(paths.runtime.locksDir, `retention-${digest}.lock`);
}

async function withRetentionLock<T extends { ok: boolean }>(
	deps: RetentionDeps,
	identity: string,
	holderId: string,
	body: () => Promise<T>,
): Promise<T | BrowserUseRetentionFailure> {
	await deps.fs.mkdir(deps.paths.runtime.locksDir, {
		recursive: true,
		mode: 0o700,
	});
	const result = await withExclusiveFileLock<T>(
		deps.fs,
		{
			lockPath: retentionLockPath(deps.paths, identity),
			holderId,
			staleAfterMs: RETENTION_LOCK_STALE_MS,
			clock: deps.clock,
		},
		body,
	);
	if ("failure" in result) {
		return retentionFailure(result.failure.code, result.failure.message);
	}
	return result;
}

async function withArtifactLock<T extends { ok: boolean }>(
	deps: RetentionDeps,
	ref: { runId: string; artifactId: string },
	holderId: string,
	body: () => Promise<T>,
): Promise<T | BrowserUseRetentionFailure> {
	return await withRetentionLock(
		deps,
		`artifact\0${ref.runId}\0${ref.artifactId}`,
		holderId,
		body,
	);
}

function manifestAdmissionProblem(
	manifest: BrowserUseArtifactManifestPayload,
	expected?: { runId: string; artifactId: string },
): string | undefined {
	if (
		expected !== undefined &&
		(manifest.run_id !== expected.runId || manifest.artifact_id !== expected.artifactId)
	) {
		return "manifest payload identity does not match its run/artifact path.";
	}
	const violations = findRedactionViolations(manifest);
	if (violations.length > 0) {
		return "manifest contains secret-shaped or sensitive durable data.";
	}
	try {
		const target = new URL(manifest.sanitized_target.origin);
		if (
			(target.protocol !== "https:" && target.protocol !== "http:") ||
			target.origin !== manifest.sanitized_target.origin
		) {
			return "sanitized_target.origin must be an origin-only http(s) value.";
		}
	} catch {
		return "sanitized_target.origin must be an origin-only http(s) value.";
	}
	const pathShape = manifest.sanitized_target.path_shape;
	if (
		pathShape !== undefined &&
		(!pathShape.startsWith("/") || pathShape.includes("?") || pathShape.includes("#"))
	) {
		return "sanitized_target.path_shape must be a query-free path shape.";
	}
	return undefined;
}

function parseManifestForRef(
	raw: string,
	ref: { runId: string; artifactId: string },
):
	| { ok: true; payload: BrowserUseArtifactManifestPayload }
	| BrowserUseRetentionFailure {
	const parsed = parseDurableRecord(raw, "artifact-manifest");
	if (!parsed.ok) {
		return retentionFailure(
			"artifact_corrupt",
			`manifest for artifact ${ref.artifactId} does not parse: ${parsed.message}`,
		);
	}
	const problem = manifestAdmissionProblem(parsed.payload, ref);
	if (problem !== undefined) {
		return retentionFailure(
			"artifact_corrupt",
			`manifest for artifact ${ref.artifactId} is invalid: ${problem}`,
		);
	}
	return { ok: true, payload: parsed.payload };
}

function parseTombstoneForRef(
	raw: string,
	ref: { runId: string; artifactId: string },
):
	| { ok: true; payload: BrowserUseTombstonePayload }
	| BrowserUseRetentionFailure {
	const parsed = parseDurableRecord(raw, "tombstone");
	if (!parsed.ok) {
		return retentionFailure(
			"artifact_corrupt",
			`tombstone for artifact ${ref.artifactId} does not parse: ${parsed.message}`,
		);
	}
	if (
		parsed.payload.run_id !== ref.runId ||
		parsed.payload.artifact_id !== ref.artifactId
	) {
		return retentionFailure(
			"artifact_corrupt",
			`tombstone for artifact ${ref.artifactId} has mismatched path identity.`,
		);
	}
	return { ok: true, payload: parsed.payload };
}

async function tombstoneMutationRefusal(
	deps: RetentionDeps,
	ref: { runId: string; artifactId: string },
): Promise<BrowserUseRetentionFailure | undefined> {
	const read = await readDurableFile(
		deps.fs,
		artifactTombstonePath(deps.paths, ref.runId, ref.artifactId),
	);
	if (read.status === "missing") return undefined;
	if (read.status === "unreadable") {
		return retentionFailure(
			"artifact_corrupt",
			`tombstone for artifact ${ref.artifactId} is unreadable.`,
		);
	}
	const parsed = parseTombstoneForRef(read.raw, ref);
	if (!parsed.ok) return parsed;
	return retentionFailure(
		"retention_collision",
		`artifact ${ref.artifactId} is tombstoned and cannot be recreated or exported.`,
	);
}

async function unlinkTolerateMissing(
	fs: BrowserUsePlatformFs,
	path: string,
): Promise<void> {
	try {
		await fs.unlink(path);
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}
}

async function listDirIfPresent(
	fs: BrowserUsePlatformFs,
	dir: string,
): Promise<readonly string[]> {
	const stat = await fs.lstat(dir);
	if (stat === undefined || stat.kind !== "directory") return [];
	return await fs.readDirectory(dir);
}

async function syncDirBestEffort(
	fs: BrowserUsePlatformFs,
	dir: string,
): Promise<void> {
	try {
		await fs.syncDirectory(dir);
	} catch {
		// Durability aid only: a failed dir flush after an unlink at worst
		// resurrects bytes BEHIND a durable tombstone, which readArtifactStatus
		// already classifies as deleted and a repair rerun reconverges.
	}
}

// --- Artifact manifest (R29 immutable write) ---------------------------------

/**
 * Immutable manifest write: target absent -> durable write; present with the
 * identical `content_hash` -> verified no-op success; present with a
 * different hash -> typed fatal `retention_collision` (the plan's U3
 * collision philosophy — colliding evidence is never silently replaced).
 * `exportArtifact` is the ONE sanctioned rewrite path.
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @param manifest - Full manifest payload (ids become path segments)
 * @returns Verified-noop flag, or one typed retention failure
 */
export async function writeArtifactManifest(
	deps: RetentionDeps,
	manifest: BrowserUseArtifactManifestPayload,
): Promise<{ ok: true; verified_noop: boolean } | BrowserUseRetentionFailure> {
	return await withArtifactLock(
		deps,
		{
			runId: manifest.run_id,
			artifactId: manifest.artifact_id,
		},
		"retention-manifest",
		async () => await writeArtifactManifestUnderLock(deps, manifest),
	);
}

async function writeArtifactManifestUnderLock(
	deps: RetentionDeps,
	manifest: BrowserUseArtifactManifestPayload,
): Promise<{ ok: true; verified_noop: boolean } | BrowserUseRetentionFailure> {
	const admissionProblem = manifestAdmissionProblem(manifest);
	if (admissionProblem !== undefined) {
		return retentionFailure(
			"artifact_corrupt",
			`artifact manifest failed durable admission: ${admissionProblem}`,
		);
	}
	const tombstoneRefusal = await tombstoneMutationRefusal(deps, {
		runId: manifest.run_id,
		artifactId: manifest.artifact_id,
	});
	if (tombstoneRefusal !== undefined) return tombstoneRefusal;
	const path = artifactManifestPath(deps.paths, manifest.run_id, manifest.artifact_id);
	const existing = await readDurableFile(deps.fs, path);
	if (existing.status === "unreadable") {
		return retentionFailure(
			"artifact_corrupt",
			`standing manifest for artifact ${manifest.artifact_id} is unreadable.`,
		);
	}
	if (existing.status === "present") {
		const parsed = parseManifestForRef(existing.raw, {
			runId: manifest.run_id,
			artifactId: manifest.artifact_id,
		});
		if (!parsed.ok) {
			return parsed;
		}
		if (parsed.payload.content_hash === manifest.content_hash) {
			return { ok: true, verified_noop: true };
		}
		return retentionFailure(
			"retention_collision",
			`artifact ${manifest.artifact_id} already has a manifest with a different content hash.`,
		);
	}
	await deps.fs.mkdir(deps.paths.state.artifactDir(manifest.run_id), {
		recursive: true,
		mode: 0o700,
	});
	const written = await writeDurableFile(deps.fs, {
		path,
		contents: encodeDurableRecord("artifact-manifest", manifest),
	});
	if (!written.ok) {
		return retentionFailure(written.failure.code, written.failure.message);
	}
	return { ok: true, verified_noop: false };
}

// --- Four-way artifact truth (R29) --------------------------------------------

/**
 * The R29 four-way truth. Check order: tombstone (pending OR complete) ->
 * "deleted"; manifest present + bytes hash-match -> "present"; manifest
 * present + bytes absent or hash-mismatch -> "corrupt"; neither record ->
 * "missing". A tombstone or manifest that exists but cannot be read or
 * parsed is "corrupt" — truth exists on disk but cannot be trusted.
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @param ref - Run + artifact ids
 * @returns One of the four artifact statuses
 */
export async function readArtifactStatus(
	deps: RetentionDeps,
	ref: { runId: string; artifactId: string },
): Promise<
	| { status: "present"; manifest: BrowserUseArtifactManifestPayload }
	| { status: "deleted"; tombstone: BrowserUseTombstonePayload }
	| { status: "missing" }
	| { status: "corrupt"; message: string }
> {
	const tombstoneRead = await readDurableFile(
		deps.fs,
		artifactTombstonePath(deps.paths, ref.runId, ref.artifactId),
	);
	if (tombstoneRead.status === "unreadable") {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`tombstone for artifact ${ref.artifactId} is unreadable.`,
			),
		};
	}
	if (tombstoneRead.status === "present") {
		const tombstone = parseTombstoneForRef(tombstoneRead.raw, ref);
		if (!tombstone.ok) {
			return {
				status: "corrupt",
				message: tombstone.message,
			};
		}
		return { status: "deleted", tombstone: tombstone.payload };
	}
	const manifestRead = await readDurableFile(
		deps.fs,
		artifactManifestPath(deps.paths, ref.runId, ref.artifactId),
	);
	if (manifestRead.status === "missing") return { status: "missing" };
	if (manifestRead.status === "unreadable") {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`manifest for artifact ${ref.artifactId} is unreadable.`,
			),
		};
	}
	const manifest = parseManifestForRef(manifestRead.raw, ref);
	if (!manifest.ok) {
		return {
			status: "corrupt",
			message: manifest.message,
		};
	}
	let bytesHash: string;
	try {
		bytesHash = await deps.fs.hashFile(
			artifactBytesPath(deps.paths, ref.runId, ref.artifactId),
		);
	} catch (error) {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`manifest for artifact ${ref.artifactId} is present but its bytes could not be hashed (${errorCode(error)}).`,
			),
		};
	}
	if (bytesHash !== manifest.payload.content_hash) {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`bytes for artifact ${ref.artifactId} do not match the manifest content hash.`,
			),
		};
	}
	return { status: "present", manifest: manifest.payload };
}

// --- Two-phase idempotent deletion (R29) --------------------------------------

/**
 * Two-phase idempotent deletion (R29):
 *   1) durable tombstone `phase: "pending"` (the intent record)
 *   2) unlink artifact bytes + manifest + cache index entries under
 *      `paths.cache.indexesDir` keyed by artifact id (ENOENT tolerated)
 *   3) rewrite the tombstone `phase: "complete"`
 * Reapply from ANY interruption point converges: a standing pending
 * tombstone resumes at step 2 with ITS recorded reason and intent instant
 * (the caller's arguments never rewrite recorded intent), and deleting an
 * already-deleted artifact returns the existing complete tombstone as an
 * idempotent success.
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @param input - Run + artifact ids and the deletion reason
 * @returns The complete tombstone, or one typed retention failure
 */
type DeleteArtifactInput = {
	runId: string;
	artifactId: string;
	reason: BrowserUseTombstonePayload["reason"];
};

type DeleteArtifactResult =
	| { ok: true; tombstone: BrowserUseTombstonePayload }
	| BrowserUseRetentionFailure;

export async function deleteArtifact(
	deps: RetentionDeps,
	input: DeleteArtifactInput,
): Promise<DeleteArtifactResult> {
	return await withArtifactLock(
		deps,
		input,
		"retention-delete",
		async () => await deleteArtifactUnderLock(deps, input),
	);
}

async function deleteArtifactUnderLock(
	deps: RetentionDeps,
	input: DeleteArtifactInput,
): Promise<DeleteArtifactResult> {
	const tombstonePath = artifactTombstonePath(
		deps.paths,
		input.runId,
		input.artifactId,
	);
	let pending: BrowserUseTombstonePayload;
	const standing = await readDurableFile(deps.fs, tombstonePath);
	if (standing.status === "unreadable") {
		return retentionFailure(
			"artifact_corrupt",
			`tombstone for artifact ${input.artifactId} is unreadable; repair before deleting.`,
		);
	}
	if (standing.status === "present") {
		const parsed = parseTombstoneForRef(standing.raw, {
			runId: input.runId,
			artifactId: input.artifactId,
		});
		if (!parsed.ok) {
			return parsed;
		}
		if (parsed.payload.phase === "complete") {
			// Idempotent success: deletion already converged.
			return { ok: true, tombstone: parsed.payload };
		}
		pending = parsed.payload;
	} else {
		const manifestRead = await readDurableFile(
			deps.fs,
			artifactManifestPath(deps.paths, input.runId, input.artifactId),
		);
		if (manifestRead.status === "missing") {
			return retentionFailure(
				"artifact_missing",
				`artifact ${input.artifactId} has no manifest and no tombstone; nothing to delete.`,
			);
		}
		if (manifestRead.status === "unreadable") {
			return retentionFailure(
				"artifact_corrupt",
				`manifest for artifact ${input.artifactId} is unreadable; repair before deleting.`,
			);
		}
		const manifest = parseManifestForRef(manifestRead.raw, {
			runId: input.runId,
			artifactId: input.artifactId,
		});
		if (!manifest.ok) {
			return manifest;
		}
		// Re-observe ownership on this FRESH read: an export that completed
		// between a sweep's initial manifest read and this one transferred the
		// artifact outside default retention. Refuse rather than destroy the
		// export receipt + bytes (the only durable proof of where the
		// high-sensitivity bytes went). The idempotent-reapply path above (a
		// standing pending/complete tombstone) short-circuits before this
		// branch, so an in-progress delete still converges.
		if (manifest.payload.retention === "export") {
			return retentionFailure(
				"export_destination_unsafe",
				`artifact ${input.artifactId} was exported outside default retention; refusing to delete an export-owned artifact.`,
			);
		}
		pending = {
			artifact_id: input.artifactId,
			run_id: input.runId,
			retention: manifest.payload.retention,
			reason: input.reason,
			phase: "pending",
			deleted_at_epoch_ms: deps.clock(),
		};
		const intent = await writeDurableFile(deps.fs, {
			path: tombstonePath,
			contents: encodeDurableRecord("tombstone", pending),
		});
		if (!intent.ok) {
			return retentionFailure(intent.failure.code, intent.failure.message);
		}
	}
	// Phase 2: remove bytes, manifest, and rebuildable index entries. Every
	// unlink tolerates ENOENT so any reapply point converges.
	try {
		await unlinkTolerateMissing(
			deps.fs,
			artifactBytesPath(deps.paths, input.runId, input.artifactId),
		);
		await unlinkTolerateMissing(
			deps.fs,
			artifactManifestPath(deps.paths, input.runId, input.artifactId),
		);
		for (const entry of await listDirIfPresent(deps.fs, deps.paths.cache.indexesDir)) {
			if (entry === input.artifactId || entry.startsWith(`${input.artifactId}.`)) {
				await unlinkTolerateMissing(deps.fs, join(deps.paths.cache.indexesDir, entry));
			}
		}
	} catch (error) {
		return retentionFailure(
			"store_flush_failed",
			`artifact deletion failed while removing bytes (${errorCode(error)}).`,
		);
	}
	await syncDirBestEffort(deps.fs, deps.paths.state.artifactDir(input.runId));
	await syncDirBestEffort(deps.fs, deps.paths.cache.indexesDir);
	// Phase 3: converge on the complete tombstone, preserving recorded intent.
	const complete: BrowserUseTombstonePayload = { ...pending, phase: "complete" };
	const committed = await writeDurableFile(deps.fs, {
		path: tombstonePath,
		contents: encodeDurableRecord("tombstone", complete),
	});
	if (!committed.ok) {
		return retentionFailure(committed.failure.code, committed.failure.message);
	}
	return { ok: true, tombstone: complete };
}

// --- Retention sweep (R29 classes) --------------------------------------------

/**
 * Retention sweep (R29): "ephemeral" artifacts of terminal runs and
 * "failure-evidence" artifacts STRICTLY older than
 * `RETENTION_FAILURE_EVIDENCE_MS` are deleted via
 * `deleteArtifact(reason: "retention-expiry")`. "export" artifacts are NEVER
 * swept — their ownership transferred outside default retention. An export
 * that completes AFTER this loop's manifest read is re-observed by
 * `deleteArtifact` on its own fresh read and returned as a typed
 * `export_destination_unsafe` skip, so a post-read ownership transfer is never
 * destroyed. Manifests that fail to read or parse are skipped (repair owns
 * them); a crash mid-sweep resumes because each delete is independently
 * idempotent.
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @param input - Terminal-run oracle (the runs module owns run truth)
 * @returns Sorted ids of the artifacts deleted by this sweep
 */
export async function sweepExpiredArtifacts(
	deps: RetentionDeps,
	input: { isRunTerminal: (runId: string) => Promise<boolean> },
): Promise<{ deleted: readonly string[] }> {
	const deleted: string[] = [];
	for (const runId of await listDirIfPresent(deps.fs, deps.paths.state.artifactsDir)) {
		const runDir = join(deps.paths.state.artifactsDir, runId);
		const stat = await deps.fs.lstat(runDir);
		if (stat === undefined || stat.kind !== "directory") continue;
		for (const entry of await deps.fs.readDirectory(runDir)) {
			if (!entry.endsWith(MANIFEST_SUFFIX)) continue;
			const read = await readDurableFile(deps.fs, join(runDir, entry));
			if (read.status !== "present") continue;
			const artifactId = entry.slice(0, -MANIFEST_SUFFIX.length);
			const manifest = parseManifestForRef(read.raw, { runId, artifactId });
			if (!manifest.ok) continue;
			const payload = manifest.payload;
			if (payload.retention === "export") continue;
			const expired =
				payload.retention === "ephemeral"
					? await input.isRunTerminal(payload.run_id)
					: deps.clock() - payload.created_at_epoch_ms >
						RETENTION_FAILURE_EVIDENCE_MS;
			if (!expired) continue;
			const result = await deleteArtifact(deps, {
				runId,
				artifactId,
				reason: "retention-expiry",
			});
			if (result.ok) deleted.push(payload.artifact_id);
		}
	}
	return { deleted: deleted.sort() };
}

// --- Export ownership transfer (R29) ------------------------------------------

/**
 * Export ownership transfer (R29). `destinationPath` must be absolute and
 * outside EVERY admitted browser-use root (else typed
 * `export_destination_unsafe`). Under the artifact ownership lock: copy to a
 * sibling temp, durably flush and hash it, link it into place without
 * replacement + sync the destination directory, re-hash the published bytes,
 * then durably commit the export
 * receipt. `destination_digest` is the sha256 of the destination path, never
 * the raw path (R13 redaction). Re-export to the same destination is
 * idempotent; a different destination after transfer is a typed collision.
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @param input - Run + artifact ids and the absolute destination path
 * @returns The rewritten manifest, or one typed retention failure
 */
type ExportArtifactInput = {
	runId: string;
	artifactId: string;
	destinationPath: string;
};

type ExportArtifactResult =
	| { ok: true; manifest: BrowserUseArtifactManifestPayload }
	| BrowserUseRetentionFailure;

export async function exportArtifact(
	deps: RetentionDeps,
	input: ExportArtifactInput,
): Promise<ExportArtifactResult> {
	if (!isAbsolute(input.destinationPath)) {
		return retentionFailure(
			"export_destination_unsafe",
			"export destination must be an absolute path outside every browser-use root.",
		);
	}
	const destination = normalize(input.destinationPath);
	for (const root of Object.values(deps.paths.resolution.roots)) {
		if (destination === root || destination.startsWith(`${root}${sep}`)) {
			return retentionFailure(
				"export_destination_unsafe",
				"export destination sits inside a browser-use root; exports must leave default-retention ownership.",
			);
		}
	}
	return await withArtifactLock(
		deps,
		input,
		"retention-export",
		async () =>
			await withRetentionLock(
				deps,
				`destination\0${destination}`,
				"retention-export-destination",
				async () =>
					await exportArtifactUnderLock(deps, {
						...input,
						destinationPath: destination,
					}),
			),
	);
}

async function exportArtifactUnderLock(
	deps: RetentionDeps,
	input: ExportArtifactInput,
): Promise<ExportArtifactResult> {
	const manifestPath = artifactManifestPath(deps.paths, input.runId, input.artifactId);
	const destination = input.destinationPath;
	const tombstoneRefusal = await tombstoneMutationRefusal(deps, input);
	if (tombstoneRefusal !== undefined) return tombstoneRefusal;
	const manifestRead = await readDurableFile(deps.fs, manifestPath);
	if (manifestRead.status === "missing") {
		return retentionFailure(
			"artifact_missing",
			`artifact ${input.artifactId} has no manifest; nothing to export.`,
		);
	}
	if (manifestRead.status === "unreadable") {
		return retentionFailure(
			"artifact_corrupt",
			`manifest for artifact ${input.artifactId} is unreadable.`,
		);
	}
	const parsed = parseManifestForRef(manifestRead.raw, {
		runId: input.runId,
		artifactId: input.artifactId,
	});
	if (!parsed.ok) {
		return parsed;
	}
	const manifest = parsed.payload;
	const destinationDigest = sha256Hex(destination);
	if (manifest.retention === "export" && manifest.export_receipt !== null) {
		if (manifest.export_receipt.destination_digest === destinationDigest) {
			// Idempotent replay of a completed transfer.
			return { ok: true, manifest };
		}
		return retentionFailure(
			"retention_collision",
			`artifact ${input.artifactId} ownership already transferred to a different destination.`,
		);
	}
	exportSequence += 1;
	const destinationDir = dirname(destination);
	const tempDestination = join(
		destinationDir,
		`.browser-use-export-${process.pid}-${exportSequence}.tmp`,
	);
	let published = false;
	try {
		await deps.fs.copyFileDurable(
			artifactBytesPath(deps.paths, input.runId, input.artifactId),
			tempDestination,
		);
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			return retentionFailure(
				"artifact_corrupt",
				`artifact ${input.artifactId} bytes are absent; nothing to export.`,
			);
		}
		return retentionFailure(
			"store_flush_failed",
			`export copy failed (${errorCode(error)}).`,
		);
	}
	const copiedHash = await deps.fs.hashFile(tempDestination);
	if (copiedHash !== manifest.content_hash) {
		try {
			await deps.fs.unlink(tempDestination);
		} catch {
			// Best-effort: an unverifiable copy must not be left claiming to be
			// the artifact, but a failed unlink cannot mask the typed failure.
		}
		return retentionFailure(
			"export_verify_failed",
			`exported bytes for artifact ${input.artifactId} do not match the manifest content hash; the destination was removed.`,
		);
	}
	try {
		await deps.fs.linkFileNoReplace(tempDestination, destination);
		published = true;
		await deps.fs.syncDirectory(destinationDir);
		if ((await deps.fs.hashFile(destination)) !== manifest.content_hash) {
			throw Object.assign(new Error("published export hash mismatch"), {
				code: "EVERIFY",
			});
		}
		await deps.fs.unlink(tempDestination);
		await deps.fs.syncDirectory(destinationDir);
	} catch (error) {
		try {
			await deps.fs.unlink(published ? destination : tempDestination);
			await deps.fs.syncDirectory(destinationDir);
		} catch {
			// Cleanup remains best effort; the typed failure never claims transfer.
		}
		const code = errorCode(error);
		if (code === "EEXIST") {
			return retentionFailure(
				"retention_collision",
				`export destination already exists; refusing to replace another owner's bytes.`,
			);
		}
		return retentionFailure(
			code === "EVERIFY" ? "export_verify_failed" : "store_flush_failed",
			`export destination commit failed (${code}).`,
		);
	}
	const next: BrowserUseArtifactManifestPayload = {
		...manifest,
		retention: "export",
		export_receipt: {
			destination_digest: destinationDigest,
			exported_at_epoch_ms: deps.clock(),
		},
	};
	const written = await writeDurableFile(deps.fs, {
		path: manifestPath,
		contents: encodeDurableRecord("artifact-manifest", next),
	});
	if (!written.ok) {
		// The store can report failure after its rename but before the parent
		// directory barrier returns. Retry the exact idempotent commit before
		// considering cleanup, so a committed export receipt can never coexist
		// with a destination this process removed.
		const retried = await writeDurableFile(deps.fs, {
			path: manifestPath,
			contents: encodeDurableRecord("artifact-manifest", next),
		});
		if (retried.ok) return { ok: true, manifest: next };

		const observed = await readDurableFile(deps.fs, manifestPath);
		const observedManifest =
			observed.status === "present"
				? parseManifestForRef(observed.raw, {
						runId: input.runId,
						artifactId: input.artifactId,
					})
				: undefined;
		const receiptObserved =
			observedManifest?.ok === true &&
			observedManifest.payload.retention === "export" &&
			observedManifest.payload.export_receipt?.destination_digest ===
				destinationDigest;
		if (!receiptObserved) {
			// Re-establish the pre-export manifest durably before deleting the
			// destination. If rollback also fails, preserve the destination:
			// ownership is uncertain and destructive cleanup would be unsafe.
			const rolledBack = await writeDurableFile(deps.fs, {
				path: manifestPath,
				contents: encodeDurableRecord("artifact-manifest", manifest),
			});
			if (rolledBack.ok) {
				try {
					await deps.fs.unlink(destination);
					await deps.fs.syncDirectory(destinationDir);
				} catch {
					// The typed failure never claims transfer.
				}
			}
		}
		return retentionFailure(written.failure.code, written.failure.message);
	}
	return { ok: true, manifest: next };
}

// --- Immutable generation staging + snapshots (AE12 substrate) ----------------

/**
 * One file to stage into a generation. Two byte-faithful forms:
 *
 * - `{ relPath, contents }` — inline UTF-8 text. The staged bytes are the
 *   UTF-8 encoding of `contents`; the manifest per-file hash is the hash of
 *   those written bytes (identical to `hashFile` of the staged path).
 * - `{ relPath, copyFromSource }` — byte-for-byte copy of an existing file at
 *   absolute path `copyFromSource`. The staged bytes equal the source bytes
 *   VERBATIM (no UTF-8 decode), so a non-UTF-8 source is preserved without
 *   loss. Use this form when the source hash was taken over raw file bytes.
 *
 * Both forms hash the WRITTEN BYTES for the manifest, so retention's
 * `content_hash` basis and a byte-based caller expectation (e.g. migration's
 * `expected_hash` from `fs.hashFile`) agree, and `readGenerationPairs`
 * (which re-hashes on-disk bytes) verifies clean.
 */
export type StageGenerationFile =
	| { relPath: string; contents: string; copyFromSource?: undefined }
	| { relPath: string; copyFromSource: string; contents?: undefined };

async function readGenerationPairs(
	fs: BrowserUsePlatformFs,
	root: string,
): Promise<readonly (readonly [string, string])[] | undefined> {
	const rootStat = await fs.lstat(root);
	if (rootStat === undefined || rootStat.kind !== "directory") return undefined;
	const pairs: Array<readonly [string, string]> = [];
	async function walk(dir: string, prefix: string): Promise<boolean> {
		for (const entry of [...(await fs.readDirectory(dir))].sort()) {
			const path = join(dir, entry);
			const relPath = prefix === "" ? entry : `${prefix}/${entry}`;
			const stat = await fs.lstat(path);
			if (stat?.kind === "directory") {
				if (!(await walk(path, relPath))) return false;
				continue;
			}
			if (stat?.kind !== "file") return false;
			pairs.push([relPath, await fs.hashFile(path)]);
		}
		return true;
	}
	if (!(await walk(root, ""))) return undefined;
	return pairs.sort(([leftPath], [rightPath]) =>
		leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0,
	);
}

/**
 * Verified retained-generation classification.
 *
 * A present result proves the durable generation record still matches the
 * complete immutable tree. Runtime resume and activation use this rather than
 * trusting either record or directory independently.
 */
export type BrowserUseGenerationStatus =
	| { status: "missing" }
	| {
			status: "present";
			record: BrowserUseGenerationPayload;
			files: readonly (readonly [string, string])[];
	  }
	| { status: "corrupt"; message: string };

/**
 * Read one retained generation and verify its record/tree digest.
 *
 * @param deps - Admitted store dependencies
 * @param generationId - Immutable generation identity
 * @returns Missing, verified present, or typed corrupt classification
 *
 * @example
 * ```typescript
 * const status = await readGenerationStatus(deps, "generation-a")
 * ```
 */
export async function readGenerationStatus(
	deps: RetentionDeps,
	generationId: string,
): Promise<BrowserUseGenerationStatus> {
	if (
		generationId === "" ||
		generationId === "." ||
		generationId === ".." ||
		generationId.includes("/") ||
		generationId.includes("\\") ||
		generationId.includes("\0")
	) {
		return {
			status: "corrupt",
			message: "generation identity is not a safe path segment.",
		};
	}
	const recordRead = await readDurableFile(
		deps.fs,
		generationRecordPath(deps.paths, generationId),
	);
	if (recordRead.status === "missing") return { status: "missing" };
	if (recordRead.status === "unreadable") {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`generation ${generationId} record is unreadable.`,
			),
		};
	}
	const parsed = parseDurableRecord(recordRead.raw, "generation");
	if (!parsed.ok || parsed.payload.generation_id !== generationId) {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`generation ${generationId} record does not match its identity.`,
			),
		};
	}
	const files = await readGenerationPairs(
		deps.fs,
		join(deps.paths.state.generationsDir, generationId),
	);
	if (
		files === undefined ||
		sha256Hex(JSON.stringify(files)) !== parsed.payload.content_hash
	) {
		return {
			status: "corrupt",
			message: redactUnsafeText(
				`generation ${generationId} record does not match its immutable tree.`,
			),
		};
	}
	return { status: "present", record: parsed.payload, files };
}

/**
 * Immutable generation staging (AE12 substrate; U3/U7 fill content and
 * perform real activation). Files land durably under
 * `<state>/generations/<id>/`, THEN the generation record commits (status
 * "staged") — the record is the commit point, so a crash mid-stage leaves
 * no record and reapply simply restages the uncommitted files. An existing
 * record short-circuits before any file I/O: an identical restage (same
 * content hash, any input order) is a verified no-op and content drift is a
 * typed fatal `retention_collision`. Generations are NEVER edited in place.
 * The content hash is sha256 over the sorted (relPath, fileHash) pairs.
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @param input - Generation id and its files (each a StageGenerationFile:
 *   inline `contents` text or a byte-faithful `copyFromSource` copy)
 * @returns The generation record + verified-noop flag, or one typed failure
 */
export async function stageGeneration(
	deps: RetentionDeps,
	input: {
		generationId: string;
		files: readonly StageGenerationFile[];
	},
): Promise<
	| { ok: true; record: BrowserUseGenerationPayload; verified_noop: boolean }
	| BrowserUseRetentionFailure
> {
	const recordPath = generationRecordPath(deps.paths, input.generationId);
	return await withRetentionLock(
		deps,
		`generation\0${input.generationId}`,
		"retention-generation",
		async () => await stageGenerationUnderLock(deps, input, recordPath),
	);
}

async function stageGenerationUnderLock(
	deps: RetentionDeps,
	input: {
		generationId: string;
		files: readonly StageGenerationFile[];
	},
	recordPath: string,
): Promise<
	| { ok: true; record: BrowserUseGenerationPayload; verified_noop: boolean }
	| BrowserUseRetentionFailure
> {
	const sorted = [...input.files].sort((a, b) =>
		a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
	);
	// The manifest per-file hash is the hash of the BYTES that will land on
	// disk, so it equals `hashFile(stagedPath)` used by readGenerationPairs and
	// by byte-based callers. Inline text: hash its UTF-8 encoding (matches the
	// bytes writeFileDurable persists). Byte copy: hash the source file bytes.
	const pairs: (readonly [string, string])[] = [];
	for (const file of sorted) {
		safeRelSegments(file.relPath); // throws TypeError on an unsafe relPath
		const hash =
			file.copyFromSource === undefined
				? sha256Hex(file.contents)
				: await deps.fs.hashFile(file.copyFromSource);
		pairs.push([file.relPath, hash] as const);
	}
	for (let index = 1; index < pairs.length; index += 1) {
		if (pairs[index]?.[0] === pairs[index - 1]?.[0]) {
			throw new TypeError("generation files carry a duplicate relPath");
		}
	}
	const contentHash = sha256Hex(JSON.stringify(pairs));
	const standing = await readDurableFile(deps.fs, recordPath);
	if (standing.status === "unreadable") {
		return retentionFailure(
			"store_record_corrupt",
			`generation record ${input.generationId} is unreadable.`,
		);
	}
	if (standing.status === "present") {
		const parsed = parseDurableRecord(standing.raw, "generation");
		if (!parsed.ok) {
			return retentionFailure(
				"store_record_corrupt",
				`generation record ${input.generationId} does not parse: ${parsed.message}`,
			);
		}
		if (parsed.payload.content_hash === contentHash) {
			const observed = await readGenerationPairs(
				deps.fs,
				join(deps.paths.state.generationsDir, input.generationId),
			);
			if (observed === undefined || !isDeepStrictEqual(observed, pairs)) {
				return retentionFailure(
					"store_record_corrupt",
					`generation ${input.generationId} record does not match its staged tree.`,
				);
			}
			return { ok: true, record: parsed.payload, verified_noop: true };
		}
		return retentionFailure(
			"retention_collision",
			`generation ${input.generationId} is already recorded with a different content hash; generations are immutable.`,
		);
	}
	const generationRoot = join(
		deps.paths.state.generationsDir,
		input.generationId,
	);
	try {
		await deps.fs.mkdir(generationRoot, {
			recursive: true,
			mode: 0o700,
		});
		const directories = new Set<string>([generationRoot]);
		let copySequence = 0;
		for (const file of sorted) {
			const filePath = generationFilePath(deps.paths, input.generationId, file.relPath);
			const fileDir = dirname(filePath);
			if (!directories.has(fileDir)) {
				await deps.fs.mkdir(fileDir, { recursive: true, mode: 0o700 });
			}
			let current = fileDir;
			while (current.startsWith(`${generationRoot}${sep}`)) {
				directories.add(current);
				current = dirname(current);
			}
			if (file.copyFromSource === undefined) {
				const written = await writeDurableFile(deps.fs, {
					path: filePath,
					contents: file.contents,
				});
				if (!written.ok) return retentionFailure(written.failure.code, written.failure.message);
				continue;
			}
			// Byte-faithful copy: durable-copy to a temp sibling, then atomic
			// rename into place (mirrors writeDurableFile's crash-safe publish so
			// the staged bytes equal the source bytes verbatim).
			copySequence += 1;
			const tempPath = `${filePath}.tmp-${process.pid}-${copySequence}`;
			await deps.fs.copyFileDurable(file.copyFromSource, tempPath);
			await deps.fs.rename(tempPath, filePath);
		}
		for (const dir of [...directories].sort((a, b) => b.length - a.length)) {
			await deps.fs.syncDirectory(dir);
		}
		await deps.fs.syncDirectory(deps.paths.state.generationsDir);
	} catch (error) {
		return retentionFailure(
			"store_flush_failed",
			`generation staging failed before the record commit (${errorCode(error)}).`,
		);
	}
	const observed = await readGenerationPairs(deps.fs, generationRoot);
	if (observed === undefined || !isDeepStrictEqual(observed, pairs)) {
		return retentionFailure(
			"store_record_corrupt",
			`generation ${input.generationId} staged tree does not match the commit manifest.`,
		);
	}
	const record: BrowserUseGenerationPayload = {
		generation_id: input.generationId,
		content_hash: contentHash,
		status: "staged",
		staged_at_epoch_ms: deps.clock(),
	};
	const committed = await writeDurableFile(deps.fs, {
		path: recordPath,
		contents: encodeDurableRecord("generation", record),
	});
	if (!committed.ok) {
		return retentionFailure(committed.failure.code, committed.failure.message);
	}
	return { ok: true, record, verified_noop: false };
}

/**
 * Immutable source-snapshot write (R10; consumed by U3). Target absent ->
 * durable write; present with the identical `snapshot_digest` -> verified
 * no-op; present with a different digest -> typed fatal
 * `retention_collision`.
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @param snapshot - Full snapshot payload
 * @returns Verified-noop flag, or one typed retention failure
 */
export async function writeSourceSnapshot(
	deps: RetentionDeps,
	snapshot: BrowserUseSourceSnapshotPayload,
): Promise<{ ok: true; verified_noop: boolean } | BrowserUseRetentionFailure> {
	const path = sourceSnapshotPath(deps.paths, snapshot.snapshot_id);
	return await withRetentionLock(
		deps,
		`snapshot\0${snapshot.snapshot_id}`,
		"retention-snapshot",
		async () => await writeSourceSnapshotUnderLock(deps, snapshot, path),
	);
}

async function writeSourceSnapshotUnderLock(
	deps: RetentionDeps,
	snapshot: BrowserUseSourceSnapshotPayload,
	path: string,
): Promise<{ ok: true; verified_noop: boolean } | BrowserUseRetentionFailure> {
	const standing = await readDurableFile(deps.fs, path);
	if (standing.status === "unreadable") {
		return retentionFailure(
			"store_record_corrupt",
			`source snapshot ${snapshot.snapshot_id} is unreadable.`,
		);
	}
	if (standing.status === "present") {
		const parsed = parseDurableRecord(standing.raw, "source-snapshot");
		if (!parsed.ok) {
			return retentionFailure(
				"store_record_corrupt",
				`source snapshot ${snapshot.snapshot_id} does not parse: ${parsed.message}`,
			);
		}
		if (parsed.payload.snapshot_digest === snapshot.snapshot_digest) {
			return { ok: true, verified_noop: true };
		}
		return retentionFailure(
			"retention_collision",
			`source snapshot ${snapshot.snapshot_id} already exists with a different digest; snapshots are immutable.`,
		);
	}
	await deps.fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const written = await writeDurableFile(deps.fs, {
		path,
		contents: encodeDurableRecord("source-snapshot", snapshot),
	});
	if (!written.ok) {
		return retentionFailure(written.failure.code, written.failure.message);
	}
	return { ok: true, verified_noop: false };
}

// --- Repair projection --------------------------------------------------------

/**
 * Every pending tombstone across the artifacts tree: deletions whose intent
 * committed but whose byte removal never completed. `repair status` projects
 * these; rerunning `deleteArtifact` on each converges it. A missing
 * artifacts tree is an empty projection; unparsable tombstones are skipped
 * (they surface as "corrupt" through `readArtifactStatus`).
 *
 * @param deps - Fs port, admitted paths, injected clock
 * @returns Pending tombstones sorted by artifact id
 */
export async function listPendingTombstones(
	deps: RetentionDeps,
): Promise<readonly BrowserUseTombstonePayload[]> {
	const pending: BrowserUseTombstonePayload[] = [];
	for (const runId of await listDirIfPresent(deps.fs, deps.paths.state.artifactsDir)) {
		const runDir = join(deps.paths.state.artifactsDir, runId);
		const stat = await deps.fs.lstat(runDir);
		if (stat === undefined || stat.kind !== "directory") continue;
		for (const entry of await deps.fs.readDirectory(runDir)) {
			if (!entry.endsWith(TOMBSTONE_SUFFIX)) continue;
			const read = await readDurableFile(deps.fs, join(runDir, entry));
			if (read.status !== "present") continue;
			const artifactId = entry.slice(0, -TOMBSTONE_SUFFIX.length);
			const parsed = parseTombstoneForRef(read.raw, { runId, artifactId });
			if (!parsed.ok || parsed.payload.phase !== "pending") continue;
			pending.push(parsed.payload);
		}
	}
	return pending.sort((a, b) =>
		a.artifact_id < b.artifact_id ? -1 : a.artifact_id > b.artifact_id ? 1 : 0,
	);
}
