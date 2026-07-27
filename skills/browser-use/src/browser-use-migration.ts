// Clean-break migration engine. Inventory freezes the source snapshot before
// later phases may assign dispositions or stage outputs. All five public
// commands read and write BrowserUseMigrationState; activation is outside this
// module and remains unchanged until U7.

import { createHash } from "node:crypto";
import { isAbsolute, join, normalize } from "node:path";
import { redactUnsafeText } from "./browser-use-core";
import type {
	BrowserUseMigrationDisposition,
	BrowserUseMigrationFailure,
	BrowserUseMigrationState,
} from "./browser-use-migration-model";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import type { BrowserUseSourceSnapshotPayload } from "./browser-use-schemas";
import type { RetentionDeps } from "./browser-use-retention";
import {
	generationFilePath,
	stageGeneration,
	writeSourceSnapshot,
} from "./browser-use-retention";
import { readDurableFile, writeDurableFile } from "./browser-use-store";

const MIGRATION_STATE_FILE = "migration-state.json";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function migrationFailure(
	code: BrowserUseMigrationFailure["code"],
	message: string,
): BrowserUseMigrationFailure {
	return { ok: false, code, message: redactUnsafeText(message) };
}

function migrationStatePath(deps: RetentionDeps): string {
	return join(deps.paths.state.migrationsDir, MIGRATION_STATE_FILE);
}

async function writeMigrationState(
	deps: RetentionDeps,
	state: BrowserUseMigrationState,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	await deps.fs.mkdir(deps.paths.state.migrationsDir, {
		recursive: true,
		mode: 0o700,
	});
	const written = await writeDurableFile(deps.fs, {
		path: migrationStatePath(deps),
		contents: `${JSON.stringify(state, null, 2)}\n`,
	});
	if (!written.ok) {
		return migrationFailure("store_flush_failed", written.failure.message);
	}
	return { ok: true, state };
}

async function inventoryEntries(
	fs: BrowserUsePlatformFs,
	root: string,
): Promise<
	| { ok: true; entries: BrowserUseSourceSnapshotPayload["entries"] }
	| BrowserUseMigrationFailure
> {
	const rootStat = await fs.lstat(root);
	if (rootStat?.kind !== "directory") {
		return migrationFailure(
			"migration_source_invalid",
			"migration source must be an existing directory.",
		);
	}
	const entries: Array<BrowserUseSourceSnapshotPayload["entries"][number]> = [];
	async function walk(directory: string, prefix: string): Promise<void> {
		for (const name of [...(await fs.readDirectory(directory))].sort()) {
			const path = join(directory, name);
			const relativePath = prefix === "" ? name : `${prefix}/${name}`;
			const stat = await fs.lstat(path);
			if (stat === undefined) {
				throw Object.assign(new Error("source changed during inventory"), {
					code: "SOURCE_DRIFT",
				});
			}
			if (stat.kind === "directory") {
				await walk(path, relativePath);
				continue;
			}
			if (stat.kind !== "file" && stat.kind !== "symlink") {
				entries.push({
					relative_path: relativePath,
					type: "symlink",
					size: stat.size ?? 0,
					mode: stat.mode,
					content_hash: sha256(`unsupported:${relativePath}:${stat.mode}`),
				});
				continue;
			}
			entries.push({
				relative_path: relativePath,
				type: stat.kind,
				size: stat.size ?? 0,
				mode: stat.mode,
				content_hash:
					stat.kind === "file"
						? await fs.hashFile(path)
						: sha256(`symlink:${relativePath}:${stat.size ?? 0}`),
			});
		}
	}
	try {
		await walk(root, "");
		return { ok: true, entries };
	} catch {
		return migrationFailure(
			"migration_source_drift",
			"migration source changed or became unreadable during inventory.",
		);
	}
}

/**
 * Freeze the current source tree into an immutable source snapshot.
 *
 * @param deps - Admitted platform store dependencies
 * @param sourceRoot - Absolute legacy corpus root
 * @returns Shared migration status or one typed refusal
 *
 * @example
 * ```typescript
 * const result = await inventoryBrowserUseMigration(deps, "/legacy/corpus")
 * ```
 */
export async function inventoryBrowserUseMigration(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	if (!isAbsolute(sourceRoot)) {
		return migrationFailure(
			"migration_source_invalid",
			"migration source must be an absolute path.",
		);
	}
	const normalizedRoot = normalize(sourceRoot);
	const inventoried = await inventoryEntries(deps.fs, normalizedRoot);
	if (!inventoried.ok) return inventoried;
	const snapshotDigest = sha256(JSON.stringify(inventoried.entries));
	const snapshotId = `snapshot-${snapshotDigest.slice(0, 16)}`;
	const snapshot: BrowserUseSourceSnapshotPayload = {
		snapshot_id: snapshotId,
		root_identity: sha256(`root:${normalizedRoot}`),
		entries: inventoried.entries,
		snapshot_digest: snapshotDigest,
	};
	const frozen = await writeSourceSnapshot(deps, snapshot);
	if (!frozen.ok) {
		return migrationFailure(
			frozen.code === "retention_collision"
				? "retention_collision"
				: frozen.code === "store_lock_contended"
					? "store_lock_contended"
					: "store_flush_failed",
			frozen.message,
		);
	}
	const state: BrowserUseMigrationState = {
		contract: "browser-use.migration-status",
		schema_version: "1",
		phase: "inventoried",
		snapshot_id: snapshotId,
		snapshot_digest: snapshotDigest,
		source_root_identity: snapshot.root_identity,
		source_entry_count: snapshot.entries.length,
		disposition_count: 0,
		dispositions: [],
		staged_generation: null,
		last_apply_verified_noop: null,
		activation_state: "unchanged",
	};
	return await writeMigrationState(deps, state);
}

/**
 * Read the one status contract shared by every migration phase.
 *
 * @param deps - Admitted platform store dependencies
 * @returns Current state, including an explicit empty state on a clean machine
 *
 * @example
 * ```typescript
 * const status = await readBrowserUseMigrationStatus(deps)
 * ```
 */
export async function readBrowserUseMigrationStatus(
	deps: RetentionDeps,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	const read = await readDurableFile(deps.fs, migrationStatePath(deps));
	if (read.status === "missing") {
		return {
			ok: true,
			state: {
				contract: "browser-use.migration-status",
				schema_version: "1",
				phase: "empty",
				snapshot_id: null,
				snapshot_digest: null,
				source_root_identity: null,
				source_entry_count: 0,
				disposition_count: 0,
				dispositions: [],
				staged_generation: null,
				last_apply_verified_noop: null,
				activation_state: "unchanged",
			},
		};
	}
	if (read.status === "unreadable") {
		return migrationFailure(
			"migration_state_corrupt",
			"migration state is unreadable.",
		);
	}
	try {
		const state = JSON.parse(read.raw) as BrowserUseMigrationState;
		if (
			state.contract !== "browser-use.migration-status" ||
			state.schema_version !== "1" ||
			typeof state.phase !== "string" ||
			!Array.isArray(state.dispositions) ||
			state.activation_state !== "unchanged"
		) {
			return migrationFailure(
				"migration_state_corrupt",
				"migration state does not match schema version 1.",
			);
		}
		return { ok: true, state };
	} catch {
		return migrationFailure(
			"migration_state_corrupt",
			"migration state is not valid JSON.",
		);
	}
}

function duplicateYamlKey(contents: string): string | undefined {
	const scopes: Array<{ indent: number; keys: Set<string> }> = [];
	for (const rawLine of contents.split(/\r?\n/)) {
		if (/^\s*(?:#.*)?$/.test(rawLine)) continue;
		const matched = rawLine.match(
			/^(\s*)(?:-\s+)?(?:"([^"]+)"|'([^']+)'|([^:#][^:]*?))\s*:(?:\s|$)/,
		);
		if (!matched) continue;
		const indent = matched[1]?.replaceAll("\t", "  ").length ?? 0;
		const sequenceItem = rawLine.trimStart().startsWith("- ");
		const effectiveIndent = sequenceItem ? indent + 1 : indent;
		while (
			scopes.length > 0 &&
			(scopes.at(-1)?.indent ?? -1) > effectiveIndent
		) {
			scopes.pop();
		}
		if (sequenceItem && scopes.at(-1)?.indent === effectiveIndent) scopes.pop();
		let scope = scopes.at(-1);
		if (scope?.indent !== effectiveIndent) {
			scope = { indent: effectiveIndent, keys: new Set<string>() };
			scopes.push(scope);
		}
		const key = (matched[2] ?? matched[3] ?? matched[4] ?? "").trim();
		if (scope.keys.has(key)) return key;
		scope.keys.add(key);
	}
	return undefined;
}

// File-content secret classifier. Gates `quarantine-secret`, so a false
// positive merely over-quarantines (safe) and a false negative stages a secret
// (the bug) — bias toward catching. This is a deliberate broadened LOCAL regex
// list rather than a reuse of auth-bindings `secretShapeFindingOf`: that guard
// classifies one already-extracted VALUE against auth-pointer shapes (op://,
// wss://, otpauth://, base32 TOTP seeds), whereas migration must scan whole file
// TEXT for `key: value` / env / JWT / PEM shapes it does not cover. Reusing it
// would both miss these shapes and point the migration module at the auth module
// (wrong dependency direction). Keep the two vocabularies separate.
function hasSecretMaterial(contents: string): boolean {
	return [
		// PEM private key blocks.
		/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
		// Service-account and other *_TOKEN env assignments.
		/\bOP_SERVICE_ACCOUNT_TOKEN\s*=/i,
		// Line-anchored `key: value` for the narrow original key list.
		/^\s*(?:password|passwd|token|secret|cookie|authorization)\s*:\s*\S+/im,
		// Common secret keys anywhere on a line, in `:` or `=` value form.
		// Covers client_secret, aws_secret_access_key, aws_access_key_id,
		// api_key / api-key / apikey, and private_key value assignments.
		/\b(?:client_secret|aws_secret_access_key|aws_access_key_id|api[_-]?key|private_key)\s*[:=]\s*\S+/i,
		// Bearer / Basic authorization tokens with a non-empty credential.
		/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
		// Bounded JWT: three base64url segments separated by dots, each of a
		// plausible length (header/payload >= 10 chars, signature >= 10).
		/\beyJ[A-Za-z0-9_-]{9,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
	].some((pattern) => pattern.test(contents));
}

function dispositionFor(
	entry: BrowserUseSourceSnapshotPayload["entries"][number],
	contents: string | undefined,
):
	| { ok: true; disposition: BrowserUseMigrationDisposition }
	| BrowserUseMigrationFailure {
	const relativePath = entry.relative_path;
	const lower = relativePath.toLowerCase();
	const base = {
		source_relative_path: relativePath,
		source_content_hash: entry.content_hash,
		transform_version: "copy-v1",
	};
	function quarantined(
		disposition: Exclude<
			BrowserUseMigrationDisposition["disposition"],
			"stage"
		>,
		reason: string,
	): { ok: true; disposition: BrowserUseMigrationDisposition } {
		return {
			ok: true,
			disposition: {
				...base,
				disposition,
				reason,
				logical_destination_id: null,
				expected_hash: null,
			},
		};
	}
	if (/(?:~|\.bak|\.backup|\.old|\.orig)$/.test(lower)) {
		return quarantined("quarantine-backup", "backup artifacts remain inactive");
	}
	if (
		entry.type !== "file" ||
		(entry.mode & 0o111) !== 0 ||
		/\.(?:js|cjs|mjs|ts|tsx|sh|bash|zsh|py|rb|pl)$/.test(lower)
	) {
		return quarantined(
			entry.type === "file"
				? "quarantine-executable"
				: "quarantine-unsupported",
			entry.type === "file"
				? "unreviewed executable code remains inactive"
				: "non-file source entries remain inactive",
		);
	}
	if (contents !== undefined && hasSecretMaterial(contents)) {
		return quarantined(
			"quarantine-secret",
			"secret-shaped material remains inactive",
		);
	}
	if (
		lower.includes("browser-domain-memory") ||
		lower.includes("side-quest") ||
		lower.includes("retired")
	) {
		return quarantined(
			"quarantine-obsolete",
			"retired owner or obsolete path remains inactive",
		);
	}
	if (!/\.(?:md|txt|json|ya?ml)$/.test(lower) || contents === undefined) {
		return quarantined(
			"quarantine-unsupported",
			"unsupported source type remains inactive pending review",
		);
	}
	if (/\.ya?ml$/.test(lower)) {
		const duplicate = duplicateYamlKey(contents);
		if (duplicate !== undefined) {
			return migrationFailure(
				"migration_yaml_duplicate_key",
				`YAML source contains duplicate mapping key ${duplicate}.`,
			);
		}
		try {
			Bun.YAML.parse(contents);
		} catch {
			return migrationFailure(
				"migration_yaml_invalid",
				"YAML source is malformed.",
			);
		}
	}
	return {
		ok: true,
		disposition: {
			...base,
			disposition: "stage",
			reason: "safe text source is eligible for inactive staging",
			logical_destination_id: `knowledge/${relativePath}`,
			expected_hash: entry.content_hash,
		},
	};
}

/**
 * Assign a complete disposition and provenance row to every frozen entry.
 *
 * @param deps - Admitted platform store dependencies
 * @param sourceRoot - Absolute source root matching the frozen identity
 * @returns Planned shared migration state or one typed refusal
 *
 * @example
 * ```typescript
 * const result = await planBrowserUseMigration(deps, "/legacy/corpus")
 * ```
 */
export async function planBrowserUseMigration(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	if (!isAbsolute(sourceRoot)) {
		return migrationFailure(
			"migration_source_invalid",
			"migration source must be an absolute path.",
		);
	}
	const standing = await readBrowserUseMigrationStatus(deps);
	if (!standing.ok) return standing;
	if (
		standing.state.phase === "empty" ||
		standing.state.snapshot_digest === null ||
		standing.state.source_root_identity === null
	) {
		return migrationFailure(
			"migration_state_missing",
			"inventory must freeze a source snapshot before planning.",
		);
	}
	const normalizedRoot = normalize(sourceRoot);
	if (sha256(`root:${normalizedRoot}`) !== standing.state.source_root_identity) {
		return migrationFailure(
			"migration_source_drift",
			"planning source root does not match the frozen source identity.",
		);
	}
	const inventoried = await inventoryEntries(deps.fs, normalizedRoot);
	if (!inventoried.ok) return inventoried;
	if (
		sha256(JSON.stringify(inventoried.entries)) !== standing.state.snapshot_digest
	) {
		return migrationFailure(
			"migration_source_drift",
			"source bytes changed after the frozen snapshot.",
		);
	}
	const dispositions: BrowserUseMigrationDisposition[] = [];
	for (const entry of inventoried.entries) {
		let contents: string | undefined;
		if (entry.type === "file") {
			try {
				contents = await deps.fs.readTextFile(
					join(normalizedRoot, entry.relative_path),
				);
			} catch {
				// A source file readable at snapshot time became unreadable
				// (ENOENT/EACCES/EISDIR) before this loop: return the typed drift
				// refusal instead of letting the throw escape the contract.
				return migrationFailure(
					"migration_source_drift",
					"a source file became unreadable after the frozen snapshot.",
				);
			}
		}
		const classified = dispositionFor(entry, contents);
		if (!classified.ok) return classified;
		dispositions.push(classified.disposition);
	}
	const state: BrowserUseMigrationState = {
		...standing.state,
		phase: "planned",
		disposition_count: dispositions.length,
		dispositions,
		staged_generation: null,
		last_apply_verified_noop: null,
		activation_state: "unchanged",
	};
	return await writeMigrationState(deps, state);
}

async function validateFrozenSource(
	deps: RetentionDeps,
	state: BrowserUseMigrationState,
	sourceRoot: string,
): Promise<
	| {
			ok: true;
			root: string;
			entries: BrowserUseSourceSnapshotPayload["entries"];
	  }
	| BrowserUseMigrationFailure
> {
	if (!isAbsolute(sourceRoot)) {
		return migrationFailure(
			"migration_source_invalid",
			"migration source must be an absolute path.",
		);
	}
	if (
		state.snapshot_digest === null ||
		state.source_root_identity === null ||
		state.phase === "empty"
	) {
		return migrationFailure(
			"migration_state_missing",
			"inventory must freeze a source snapshot first.",
		);
	}
	const root = normalize(sourceRoot);
	if (sha256(`root:${root}`) !== state.source_root_identity) {
		return migrationFailure(
			"migration_source_drift",
			"source root does not match the frozen source identity.",
		);
	}
	const inventoried = await inventoryEntries(deps.fs, root);
	if (!inventoried.ok) return inventoried;
	if (sha256(JSON.stringify(inventoried.entries)) !== state.snapshot_digest) {
		return migrationFailure(
			"migration_source_drift",
			"source bytes changed after the frozen snapshot.",
		);
	}
	return { ok: true, root, entries: inventoried.entries };
}

function dispositionsComplete(
	state: BrowserUseMigrationState,
	entries: BrowserUseSourceSnapshotPayload["entries"],
): boolean {
	if (
		state.disposition_count !== entries.length ||
		state.dispositions.length !== entries.length
	) {
		return false;
	}
	const entriesByPath = new Map(
		entries.map((entry) => [entry.relative_path, entry] as const),
	);
	const seen = new Set<string>();
	for (const disposition of state.dispositions) {
		const entry = entriesByPath.get(disposition.source_relative_path);
		if (
			entry === undefined ||
			seen.has(disposition.source_relative_path) ||
			disposition.source_content_hash !== entry.content_hash ||
			disposition.transform_version === ""
		) {
			return false;
		}
		seen.add(disposition.source_relative_path);
		if (
			disposition.disposition === "stage"
				? disposition.logical_destination_id === null ||
					disposition.expected_hash === null
				: disposition.logical_destination_id !== null ||
					disposition.expected_hash !== null
		) {
			return false;
		}
	}
	return seen.size === entries.length;
}

/**
 * Stage every planned safe output into one immutable inactive generation.
 *
 * @param deps - Admitted platform store dependencies
 * @param sourceRoot - Absolute source root matching the frozen identity
 * @returns Staged shared migration state or one typed refusal
 *
 * @example
 * ```typescript
 * const result = await applyBrowserUseMigration(deps, "/legacy/corpus")
 * ```
 */
export async function applyBrowserUseMigration(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	const standing = await readBrowserUseMigrationStatus(deps);
	if (!standing.ok) return standing;
	const frozen = await validateFrozenSource(deps, standing.state, sourceRoot);
	if (!frozen.ok) return frozen;
	if (!dispositionsComplete(standing.state, frozen.entries)) {
		return migrationFailure(
			"migration_disposition_incomplete",
			"every frozen source entry needs one complete disposition before apply.",
		);
	}
	const files: Array<{ relPath: string; contents: string }> = [];
	for (const disposition of standing.state.dispositions) {
		if (disposition.disposition !== "stage") continue;
		let contents: string;
		try {
			contents = await deps.fs.readTextFile(
				join(frozen.root, disposition.source_relative_path),
			);
		} catch {
			// A staged source file readable at snapshot time became unreadable
			// (ENOENT/EACCES/EISDIR) before this loop: return the typed drift
			// refusal instead of letting the throw escape the contract.
			return migrationFailure(
				"migration_source_drift",
				"a source file became unreadable after the frozen snapshot.",
			);
		}
		if (sha256(contents) !== disposition.expected_hash) {
			return migrationFailure(
				"migration_source_drift",
				"a staged source file no longer matches its expected hash.",
			);
		}
		files.push({
			relPath: disposition.logical_destination_id as string,
			contents,
		});
	}
	const generationId = `generation-${standing.state.snapshot_digest?.slice(0, 16)}`;
	const staged = await stageGeneration(deps, { generationId, files });
	if (!staged.ok) {
		return migrationFailure(
			staged.code === "retention_collision"
				? "migration_collision"
				: staged.code === "store_lock_contended"
					? "store_lock_contended"
					: "store_flush_failed",
			staged.message,
		);
	}
	return await writeMigrationState(deps, {
		...standing.state,
		phase: "staged",
		staged_generation: staged.record.generation_id,
		last_apply_verified_noop: staged.verified_noop,
		activation_state: "unchanged",
	});
}

/**
 * Verify the frozen source, dispositions, provenance, and staged file hashes.
 *
 * @param deps - Admitted platform store dependencies
 * @param sourceRoot - Absolute source root matching the frozen identity
 * @returns Verified shared migration state or one typed refusal
 *
 * @example
 * ```typescript
 * const result = await verifyBrowserUseMigration(deps, "/legacy/corpus")
 * ```
 */
export async function verifyBrowserUseMigration(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	const standing = await readBrowserUseMigrationStatus(deps);
	if (!standing.ok) return standing;
	const frozen = await validateFrozenSource(deps, standing.state, sourceRoot);
	if (!frozen.ok) return frozen;
	if (
		standing.state.staged_generation === null ||
		!dispositionsComplete(standing.state, frozen.entries)
	) {
		return migrationFailure(
			"migration_disposition_incomplete",
			"verification requires complete dispositions and one staged generation.",
		);
	}
	for (const disposition of standing.state.dispositions) {
		if (disposition.disposition !== "stage") continue;
		const path = generationFilePath(
			deps.paths,
			standing.state.staged_generation,
			disposition.logical_destination_id as string,
		);
		const stat = await deps.fs.lstat(path);
		if (
			stat?.kind !== "file" ||
			(await deps.fs.hashFile(path)) !== disposition.expected_hash
		) {
			return migrationFailure(
				"migration_verify_failed",
				"staged output is missing or does not match its expected hash.",
			);
		}
	}
	return await writeMigrationState(deps, {
		...standing.state,
		phase: "verified",
		activation_state: "unchanged",
	});
}
