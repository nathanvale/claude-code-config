// Clean-break migration phase engine. Inventory freezes the source snapshot
// before later phases may assign dispositions or stage outputs. This module
// owns phase-state persistence and delegates generation authority to the plain
// activation owner.

import { createHash } from "node:crypto";
import { isAbsolute, join, normalize } from "node:path";
import { redactUnsafeText } from "./browser-use-core";
import currentCorpusReceipt from "./browser-use-migration-corpus-receipt.json";
import {
	activateBrowserUseGeneration,
	projectActiveGenerationStatus,
	type BrowserUseGenerationCandidateClosureRead,
	validateBrowserUseGenerationCandidateClosure,
	validateBrowserUseGenerationCandidateForMigrationState,
} from "./browser-use-generation-activation";
import { BROWSER_USE_ARTIFACT_CLASSES } from "./browser-use-migration-model";
import type {
	BrowserUseArtifactClass,
	BrowserUseCanonicalTarget,
	BrowserUseCorpusCensus,
	BrowserUseCorpusReceipt,
	BrowserUseMigrationDisposition,
	BrowserUseMigrationFailure,
	BrowserUseMigrationState,
	BrowserUseMigrationStatus,
	BrowserUseTargetProvenance,
} from "./browser-use-migration-model";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import type {
	BrowserUseCorpusGenerationCandidatePayload,
	BrowserUseSourceSnapshotPayload,
} from "./browser-use-schemas";
import type { RetentionDeps } from "./browser-use-retention";
import {
	generationFilePath,
	stageGeneration,
	type StageGenerationFile,
	writeSourceSnapshot,
} from "./browser-use-retention";
import {
	readDurableFile,
	replaceDurableFileIfUnchanged,
	withExclusiveFileLock,
	writeDurableFile,
} from "./browser-use-store";

const MIGRATION_STATE_FILE = "migration-state.json";
const MIGRATION_OWNER_LOCK_FILE = "migration-owner.lock";
const MIGRATION_OWNER_LOCK_STALE_AFTER_MS = 30 * 60 * 1_000;

export {
	CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
	readActiveCorpusManifest,
	readRetainedCorpusGenerationManifest,
	tripActiveGenerationEffectFence,
	validateBrowserUseGenerationCandidateClosure,
	validateBrowserUseGenerationCandidateForMigrationState,
} from "./browser-use-generation-activation";
export type {
	BrowserUseActiveCorpusManifestRead,
	BrowserUseGenerationCandidateClosureRead,
	BrowserUseRetainedCorpusGenerationRead,
} from "./browser-use-generation-activation";

const CORPUS_CENSUS_FIELDS = [
	"formal_artifacts",
	"target_flows",
	"scripts",
	"auth_narratives",
	"login_capabilities",
	"domain_script_actions",
] as const satisfies readonly (keyof BrowserUseCorpusCensus)[];

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

function migrationOwnerLockPath(deps: RetentionDeps): string {
	return join(deps.paths.runtime.locksDir, MIGRATION_OWNER_LOCK_FILE);
}

function durableMigrationState(
	state: BrowserUseMigrationState | BrowserUseMigrationStatus,
): BrowserUseMigrationState {
	if ("active_generation" in state) {
		const { active_generation: _projection, ...durable } = state;
		return durable;
	}
	return state;
}

function encodeMigrationState(
	state: BrowserUseMigrationState | BrowserUseMigrationStatus,
): string {
	return `${JSON.stringify(durableMigrationState(state), null, 2)}\n`;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value <= Number.MAX_SAFE_INTEGER
	);
}

function isCorpusCensus(value: unknown): value is BrowserUseCorpusCensus {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return CORPUS_CENSUS_FIELDS.every((field) =>
		isNonNegativeSafeInteger(record[field]),
	);
}

function isCanonicalTarget(value: unknown): value is BrowserUseCanonicalTarget {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.canonical_target_id === "string" &&
		record.canonical_target_id.length > 0 &&
		Array.isArray(record.source_relative_paths) &&
		record.source_relative_paths.length > 0 &&
		record.source_relative_paths.every((path) => typeof path === "string")
	);
}

function isTargetProvenance(value: unknown): value is BrowserUseTargetProvenance {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.source_relative_path === "string" &&
		typeof record.source_flow_id === "string" &&
		(record.canonical_target_id === null ||
			typeof record.canonical_target_id === "string") &&
		(record.activation === "canonical" || record.activation === "inactive") &&
		typeof record.reason === "string"
	);
}

async function writeMigrationState(
	deps: RetentionDeps,
	state: BrowserUseMigrationState | BrowserUseMigrationStatus,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	const durableState = durableMigrationState(state);
	await deps.fs.mkdir(deps.paths.state.migrationsDir, {
		recursive: true,
		mode: 0o700,
	});
	const written = await writeDurableFile(deps.fs, {
		path: migrationStatePath(deps),
		contents: encodeMigrationState(durableState),
	});
	if (!written.ok) {
		return migrationFailure("store_flush_failed", written.failure.message);
	}
	return { ok: true, state: durableState };
}

async function writeMigrationStateIfUnchanged(
	deps: RetentionDeps,
	state: BrowserUseMigrationState | BrowserUseMigrationStatus,
	expectedRaw: string,
): Promise<
	{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure
> {
	const durableState = durableMigrationState(state);
	const written = await replaceDurableFileIfUnchanged(deps.fs, {
		path: migrationStatePath(deps),
		expectedRaw,
		contents: encodeMigrationState(durableState),
	});
	if (!written.ok) {
		return migrationFailure(
			written.failure.code === "store_record_conflict" ||
				written.failure.code === "store_record_missing"
				? "migration_activation_conflict"
				: written.failure.code === "store_record_corrupt"
					? "migration_state_corrupt"
					: "store_flush_failed",
			written.failure.message,
		);
	}
	return { ok: true, state: durableState };
}

async function withMigrationOwnerLock<
	T extends { ok: true } | BrowserUseMigrationFailure,
>(
	deps: RetentionDeps,
	holderId: string,
	body: () => Promise<T>,
): Promise<T | BrowserUseMigrationFailure> {
	try {
		await deps.fs.mkdir(deps.paths.runtime.locksDir, {
			recursive: true,
			mode: 0o700,
		});
	} catch {
		return migrationFailure(
			"store_flush_failed",
			"migration owner lock directory could not be created.",
		);
	}
	const outcome = await withExclusiveFileLock<T>(
		deps.fs,
		{
			lockPath: migrationOwnerLockPath(deps),
			holderId,
			staleAfterMs: MIGRATION_OWNER_LOCK_STALE_AFTER_MS,
			clock: deps.clock,
		},
		body,
	);
	if (!outcome.ok && "failure" in outcome) {
		return migrationFailure(
			outcome.failure.code === "store_lock_contended"
				? "store_lock_contended"
				: "store_flush_failed",
			outcome.failure.message,
		);
	}
	return outcome;
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
	return await withMigrationOwnerLock(
		deps,
		"migration-inventory",
		async () => await inventoryBrowserUseMigrationUnderLock(deps, sourceRoot),
	);
}

async function inventoryBrowserUseMigrationUnderLock(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<
	{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure
> {
	if (!isAbsolute(sourceRoot)) {
		return migrationFailure(
			"migration_source_invalid",
			"migration source must be an absolute path.",
		);
	}
	const standing = await readBrowserUseMigrationStatus(deps);
	if (!standing.ok) return standing;
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
		schema_version: "2",
		phase: "inventoried",
		snapshot_id: snapshotId,
		snapshot_digest: snapshotDigest,
		source_root_identity: snapshot.root_identity,
		source_entry_count: snapshot.entries.length,
		disposition_count: 0,
		dispositions: [],
		corpus_census: null,
		canonical_targets: [],
		target_provenance: [],
		staged_generation: null,
		last_apply_verified_noop: null,
		activation_state: standing.state.activation_state,
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
): Promise<{ ok: true; state: BrowserUseMigrationStatus } | BrowserUseMigrationFailure> {
	const read = await readDurableFile(deps.fs, migrationStatePath(deps));
	if (read.status === "missing") {
		const projected = await projectActiveGenerationStatus(deps, "unchanged");
		if (!projected.ok) return projected;
		return {
			ok: true,
			state: {
				contract: "browser-use.migration-status",
				schema_version: "2",
				phase: "empty",
				snapshot_id: null,
				snapshot_digest: null,
				source_root_identity: null,
				source_entry_count: 0,
				disposition_count: 0,
				dispositions: [],
				corpus_census: null,
				canonical_targets: [],
				target_provenance: [],
				staged_generation: null,
				last_apply_verified_noop: null,
				activation_state:
					projected.activeGeneration.current === null
						? "unchanged"
						: "active",
				active_generation: projected.activeGeneration,
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
			state.schema_version !== "2" ||
			typeof state.phase !== "string" ||
			!Array.isArray(state.dispositions) ||
			!Array.isArray(state.canonical_targets) ||
			!("corpus_census" in state) ||
			(state.corpus_census !== null && !isCorpusCensus(state.corpus_census)) ||
			!state.canonical_targets.every(isCanonicalTarget) ||
			(state.target_provenance !== undefined &&
				(!Array.isArray(state.target_provenance) ||
					!state.target_provenance.every(isTargetProvenance))) ||
			(state.activation_state !== "unchanged" &&
				state.activation_state !== "active")
		) {
			return migrationFailure(
				"migration_state_corrupt",
				"migration state does not match schema version 2.",
			);
		}
		const projected = await projectActiveGenerationStatus(
			deps,
			state.activation_state,
		);
		if (!projected.ok) return projected;
		return {
			ok: true,
			state: {
				...state,
				target_provenance: state.target_provenance ?? [],
				activation_state:
					projected.activeGeneration.current === null
						? "unchanged"
						: "active",
				active_generation: projected.activeGeneration,
			},
		};
	} catch {
		return migrationFailure(
			"migration_state_corrupt",
			"migration state is not valid JSON.",
		);
	}
}

function lineIndent(rawLine: string): number {
	return (rawLine.match(/^\s*/)?.[0]?.replaceAll("\t", "  ").length ?? 0);
}

function duplicateYamlKey(contents: string): string | undefined {
	const scopes: Array<{ indent: number; keys: Set<string> }> = [];
	// When a mapping value is a block scalar (`|`, `>` with optional chomping or
	// indent indicators), every following line more indented than the key is
	// literal content — never a nested mapping key. Track that indent so those
	// content lines (which may themselves read as `key: value`) are skipped
	// until indentation returns to the key's column or shallower.
	let blockScalarIndent: number | undefined;
	for (const rawLine of contents.split(/\r?\n/)) {
		if (/^\s*(?:#.*)?$/.test(rawLine)) continue;
		if (blockScalarIndent !== undefined) {
			if (lineIndent(rawLine) > blockScalarIndent) continue;
			blockScalarIndent = undefined;
		}
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
		// A `|`/`>` block-scalar value opens a literal region indented deeper than
		// this key; quoted scalars stay on the same line and open nothing.
		const value = rawLine.slice(matched[0].length);
		if (/^[|>][+-]?\d*[+-]?\s*(?:#.*)?$/.test(value.trim())) {
			blockScalarIndent = effectiveIndent;
		}
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
		// Auth pointers and live browser endpoints never enter durable knowledge.
		/\b(?:op|wss?|otpauth):\/\/\S+/i,
		// Plausible base32 TOTP seed.
		/\b[A-Z2-7]{32,}\b/i,
	].some((pattern) => pattern.test(contents));
}

const SCRIPT_EXTENSION = /\.(?:js|cjs|mjs|ts|tsx|sh|bash|zsh|py|rb|pl)$/;

// A login/okta narrative is an auth-import candidate (R29), never a business
// runbook — recognised by BASENAME token shape only. A domain whose name merely
// contains "okta" (e.g. `ellucian-okta/ellucian-okta.md` domain prose) must not
// be misrouted to auth: the token must anchor in the file's own basename.
function isAuthNarrative(relativeOrBase: string): boolean {
	const base = relativeOrBase.split("/").at(-1) ?? relativeOrBase;
	return /(?:^|[-_])(?:okta|login|sign-?in|sso)(?:[-_.]|$)/.test(base);
}

type DomainPath = {
	domain: string;
	backup_root: string | null;
};

// Resolve a service identity from either the full browser-automation namespace,
// a domains-root invocation, or a recognized historical domain backup root.
function domainPathFor(relativePath: string): DomainPath {
	const parts = relativePath.split("/");
	if (parts[0] === "domains" && parts.length > 1) {
		return { domain: parts[1] ?? "", backup_root: null };
	}
	if (
		parts[0] === "backups" &&
		/^domains-(?:before|after)-/.test(parts[1] ?? "") &&
		parts.length > 2
	) {
		return {
			domain: parts[2] ?? "",
			backup_root: `backups/${parts[1]}`,
		};
	}
	if (/^domains-(?:before|after)-/.test(parts[0] ?? "") && parts.length > 1) {
		return { domain: parts[1] ?? "", backup_root: parts[0] ?? null };
	}
	return { domain: parts[0] ?? relativePath, backup_root: null };
}

function isBackupPath(relativePath: string): boolean {
	return (
		domainPathFor(relativePath).backup_root !== null ||
		relativePath.split("/")[0] === "backups"
	);
}

// Classify one source entry into its artifact class (R2/R3). Classification is
// a READ-ONLY predicate over the relative path shape (plus content only for
// flow extraction elsewhere); it never depends on trusting a legacy label.
function artifactClassFor(
	entry: BrowserUseSourceSnapshotPayload["entries"][number],
): BrowserUseArtifactClass {
	const lower = entry.relative_path.toLowerCase();
	const base = lower.split("/").at(-1) ?? lower;
	const isScript =
		entry.type === "file" &&
		(SCRIPT_EXTENSION.test(lower) || (entry.mode & 0o111) !== 0);
	// A domain-script action is a script that also lives in the registry dir
	// (R3: "10 domain-script actions that are also scripts"). Only the .js/.ts
	// asset counts as an action; the registry JSON itself is supporting.
	if (
		lower.split("/").includes("domain-script-actions") &&
		isScript &&
		SCRIPT_EXTENSION.test(lower)
	) {
		return "domain-script-action";
	}
	if (lower.includes("/capabilities/") && /login/.test(base)) {
		return "login-capability";
	}
	// Playbooks are explicit formal artifacts regardless of their extension.
	if (lower.includes("/playbooks/")) return "formal-playbook";
	if (/^runbook[-_].+\.md$/.test(base) || base === "runbook.md") {
		return isAuthNarrative(base) ? "auth-narrative" : "formal-runbook";
	}
	if (isScript) return "script";
	if (lower.includes("/runs/")) return "run-evidence";
	if (base.includes("selector")) return "selector-asset";
	// A domain's OWN notes file (`<domain>/<domain>.md`) is domain prose even when
	// the domain name contains an auth token (e.g. `ellucian-okta/ellucian-okta.md`).
	const domain = domainPathFor(lower).domain;
	const baseName = base.replace(/\.[^.]+$/, "");
	const isDomainNotes = baseName === domain;
	if (!isDomainNotes && isAuthNarrative(base) && /\.(?:md|txt)$/.test(lower)) {
		return "auth-narrative";
	}
	if (/\.md$/.test(lower)) return "domain-prose";
	return "supporting";
}

// The domain segment is the first path component of a domain-rooted corpus.
function domainOf(relativePath: string): string {
	return domainPathFor(relativePath).domain;
}

const SERVICE_ID_BY_LEGACY_DOMAIN: Readonly<Record<string, string>> = {
	"iteraterecruitment-oncoreservices": "oncore",
	"manpowergroup-fasttrack360": "fasttrack",
	"api-explorer-xero": "xero",
	"go-xero": "xero",
};

function canonicalFlowId(domain: string, flow: string): string | null {
	const service = SERVICE_ID_BY_LEGACY_DOMAIN[domain] ?? domain;
	if (service === "oncore") {
		if (flow === "authenticate-session" || flow === "submit-timesheet") return null;
		if (
			flow === "fill-timesheet" ||
			flow === "list-timesheets" ||
			flow.startsWith("fill-timesheet-")
		) {
			return "oncore/fill-timesheet";
		}
	}
	if (service === "fasttrack") {
		if (flow === "submit-timesheet") return null;
		if (
			flow === "fill-week" ||
			flow === "add-breaks" ||
			flow === "save-timesheet" ||
			flow === "list-timesheets"
		) {
			return "fasttrack/fill-week";
		}
	}
	if (service === "xero") {
		if (flow === "extract-bankstatementsplus") {
			return "xero/extract-bankstatementsplus";
		}
		if (flow === "post-banktransaction") {
			return "xero/post-banktransaction";
		}
		if (flow.startsWith("reconcile")) return "xero/reconcile-batch";
	}
	return `${service}/${flow}`;
}

// Extract the declared flow id from a formal artifact's parsed body (R4).
// JSON/YAML may carry `{ candidate: { flow } }` or a top-level `flow`.
// Deliberately ignore YAML `name`: it may use a different identifier convention.
// Fall back to the basename so every formal artifact has one stable flow identity.
function formalFlowIdFor(
	entry: BrowserUseSourceSnapshotPayload["entries"][number],
	artifactClass: BrowserUseArtifactClass,
	contents: string | undefined,
): string | null {
	if (
		artifactClass !== "formal-playbook" &&
		artifactClass !== "formal-runbook"
	) {
		return null;
	}
	const domain = domainOf(entry.relative_path);
	const base = (entry.relative_path.split("/").at(-1) ?? "").replace(
		/\.[^.]+$/,
		"",
	);
	let flow: string | undefined;
	if (contents !== undefined) {
		const lower = entry.relative_path.toLowerCase();
		try {
			const parsed = (
				/\.json$/.test(lower) ? JSON.parse(contents) : Bun.YAML.parse(contents)
			) as unknown;
			if (parsed !== null && typeof parsed === "object") {
				const record = parsed as Record<string, unknown>;
				const candidate = record.candidate;
				const candidateFlow =
					candidate !== null &&
					typeof candidate === "object" &&
					typeof (candidate as Record<string, unknown>).flow === "string"
						? ((candidate as Record<string, unknown>).flow as string)
						: undefined;
				const directFlow =
					typeof record.flow === "string" ? record.flow : undefined;
				flow = candidateFlow ?? directFlow;
			}
		} catch {
			// A malformed body still yields a basename-derived flow id; strict YAML
			// validity is enforced separately in dispositionFor.
		}
	}
	return canonicalFlowId(domain, flow ?? base);
}

// The canonical target id collapses many candidates of the same intent into one
// flow (R4): both Oncore fill-timesheet candidates share `<domain>/fill-timesheet`.
function canonicalTargetIdFor(formalFlowId: string | null): string | null {
	return formalFlowId;
}

function reviewedActionProvenanceFor(
	relativePath: string,
	artifactClass: BrowserUseArtifactClass,
): BrowserUseTargetProvenance[] {
	if (
		artifactClass === "domain-script-action" &&
		domainOf(relativePath) === "iteraterecruitment-oncoreservices" &&
		relativePath.endsWith("/domain-script-actions/diagnose-grid-state.js")
	) {
		return [
			{
				source_relative_path: relativePath,
				source_flow_id: "timesheet-diagnose",
				canonical_target_id: "oncore/timesheet-diagnose",
				activation: "canonical",
				reason: "reviewed current action supplies bounded diagnosis authority",
			},
		];
	}
	return [];
}

// Count `### Flow: <name>` headings inside domain prose (R3 Target Flows). The
// predicate is exact — a `### diagnose-grid-state` heading without the `Flow:`
// prefix is NOT a Target Flow and must not inflate the count.
function targetFlowCount(contents: string): number {
	let count = 0;
	for (const line of contents.split(/\r?\n/)) {
		if (/^#{2,4}\s+Flow:\s+\S/.test(line)) count += 1;
	}
	return count;
}

// Fold the per-entry classifications into the overlapping mechanical census
// (R3). `target_flows` is accumulated separately from prose content because it
// counts headings inside files, not files themselves.
function censusFor(
	dispositions: readonly BrowserUseMigrationDisposition[],
	targetFlows: number,
): BrowserUseCorpusCensus {
	const isClass = (
		row: BrowserUseMigrationDisposition,
		artifactClass: BrowserUseArtifactClass,
	): boolean => row.artifact_class === artifactClass;
	return {
		formal_artifacts: dispositions.filter(
			(row) =>
				isClass(row, "formal-runbook") || isClass(row, "formal-playbook"),
		).length,
		// A domain-script action is ALSO a script: both predicates count it (R3).
		scripts: dispositions.filter(
			(row) =>
				isClass(row, "script") || isClass(row, "domain-script-action"),
		).length,
		domain_script_actions: dispositions.filter((row) =>
			isClass(row, "domain-script-action"),
		).length,
		auth_narratives: dispositions.filter((row) =>
			isClass(row, "auth-narrative"),
		).length,
		login_capabilities: dispositions.filter((row) =>
			isClass(row, "login-capability"),
		).length,
		target_flows: targetFlows,
	};
}

// Build the canonical-target provenance edges (R4): every canonical id lists
// every source that feeds it, so two candidates of one intent (both Oncore
// fill-timesheet playbooks) resolve to ONE canonical flow with two sources.
function canonicalTargetsFor(
	provenance: readonly BrowserUseTargetProvenance[],
): BrowserUseCanonicalTarget[] {
	const byCanonical = new Map<string, string[]>();
	for (const row of provenance) {
		if (row.activation !== "canonical" || row.canonical_target_id === null) {
			continue;
		}
		const sources = byCanonical.get(row.canonical_target_id) ?? [];
		if (!sources.includes(row.source_relative_path)) {
			sources.push(row.source_relative_path);
		}
		byCanonical.set(row.canonical_target_id, sources);
	}
	return [...byCanonical.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([canonical_target_id, source_relative_paths]) => ({
			canonical_target_id,
			source_relative_paths: [...source_relative_paths].sort(),
		}));
}

function backupTimestamp(backupRoot: string): string {
	return backupRoot.match(/(\d{8}T\d{6})/)?.[1] ?? "";
}

// Preserve only the newest copy of formal artifacts whose canonical target has
// no current formal source. All other backup entries remain quarantined.
function preservedBackupFormalPaths(
	entries: readonly BrowserUseSourceSnapshotPayload["entries"][number][],
	contentsByPath: ReadonlyMap<string, string>,
): Set<string> {
	const formal = entries.flatMap((entry) => {
		const artifactClass = artifactClassFor(entry);
		if (
			artifactClass !== "formal-playbook" &&
			artifactClass !== "formal-runbook"
		) {
			return [];
		}
		const target = formalFlowIdFor(
			entry,
			artifactClass,
			contentsByPath.get(entry.relative_path),
		);
		return target === null ? [] : [{ entry, target }];
	});
	const currentTargets = new Set(
		formal
			.filter(({ entry }) => !isBackupPath(entry.relative_path))
			.map(({ target }) => target),
	);
	const newestRootByTarget = new Map<string, string>();
	for (const { entry, target } of formal) {
		const root = domainPathFor(entry.relative_path).backup_root;
		if (root === null || currentTargets.has(target)) continue;
		const existing = newestRootByTarget.get(target);
		if (
			existing === undefined ||
			backupTimestamp(root) > backupTimestamp(existing)
		) {
			newestRootByTarget.set(target, root);
		}
	}
	return new Set(
		formal.flatMap(({ entry, target }) =>
			domainPathFor(entry.relative_path).backup_root ===
			newestRootByTarget.get(target)
				? [entry.relative_path]
				: [],
		),
	);
}

function trackerProvenanceFor(
	relativePath: string,
	contents: string,
): BrowserUseTargetProvenance[] {
	if (!relativePath.endsWith("/legacy-runtime-migration.yaml")) return [];
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(contents);
	} catch {
		return [];
	}
	if (parsed === null || typeof parsed !== "object") return [];
	const entries = (parsed as Record<string, unknown>).entries;
	if (!Array.isArray(entries)) return [];
	const provenance: BrowserUseTargetProvenance[] = [];
	for (const value of entries) {
		if (value === null || typeof value !== "object") continue;
		const record = value as Record<string, unknown>;
		if (typeof record.domain !== "string" || typeof record.flow !== "string") {
			continue;
		}
		const canonicalTargetId = canonicalFlowId(record.domain, record.flow);
		provenance.push({
			source_relative_path: relativePath,
			source_flow_id: record.flow,
			canonical_target_id: canonicalTargetId,
			activation: canonicalTargetId === null ? "inactive" : "canonical",
			reason:
				canonicalTargetId === null
					? "auth and submit tracker entries remain non-executable provenance"
					: "legacy tracker flow maps to an existing catalog builder identity",
		});
	}
	return provenance;
}

function dispositionFor(
	entry: BrowserUseSourceSnapshotPayload["entries"][number],
	contents: string | undefined,
	preservedBackupFormal: ReadonlySet<string> = new Set(),
):
	| { ok: true; disposition: BrowserUseMigrationDisposition }
	| BrowserUseMigrationFailure {
	const relativePath = entry.relative_path;
	const lower = relativePath.toLowerCase();
	const artifactClass = artifactClassFor(entry);
	const formalFlowId = formalFlowIdFor(entry, artifactClass, contents);
	const base = {
		source_relative_path: relativePath,
		artifact_class: artifactClass,
		formal_flow_id: formalFlowId,
		canonical_target_id: canonicalTargetIdFor(formalFlowId),
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
	if (
		isBackupPath(relativePath) ||
		/(?:~|\.bak|\.backup|\.old|\.orig)(?:\.|$)/.test(lower)
	) {
		if (
			preservedBackupFormal.has(relativePath) &&
			formalFlowId !== null &&
			(artifactClass === "formal-playbook" ||
				artifactClass === "formal-runbook")
		) {
			return {
				ok: true,
				disposition: {
					...base,
					disposition: "provenance-only",
					reason:
						"latest unique formal backup retained as inactive provenance only",
					logical_destination_id: null,
					expected_hash: null,
				},
			};
		}
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
		artifactClass === "auth-narrative" ||
		artifactClass === "login-capability"
	) {
		return quarantined(
			"provenance-only",
			"authentication source is retained as redacted candidate provenance only",
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

// The sanitized current-corpus receipt binds the reviewed relative path set and
// its overlapping census without retaining absolute paths or private contents.
const BROWSER_USE_CURRENT_CORPUS_RECEIPT =
	currentCorpusReceipt as BrowserUseCorpusReceipt;

/** @deprecated Use the path-bound current corpus receipt. */
export const BROWSER_USE_R3_CORPUS_BASELINE =
	BROWSER_USE_CURRENT_CORPUS_RECEIPT;

function isCorpusReceipt(
	value: BrowserUseCorpusCensus | BrowserUseCorpusReceipt,
): value is BrowserUseCorpusReceipt {
	return "contract" in value && value.contract === "browser-use.corpus-receipt";
}

function relativePathDigest(
	entries: readonly BrowserUseSourceSnapshotPayload["entries"][number][],
): string {
	return sha256(
		JSON.stringify(entries.map((entry) => entry.relative_path).sort()),
	);
}

function censusDrift(
	expected: BrowserUseCorpusCensus,
	actual: BrowserUseCorpusCensus,
): string | undefined {
	const drifted = (
		Object.keys(expected) as Array<keyof BrowserUseCorpusCensus>
	).filter((field) => expected[field] !== actual[field]);
	if (drifted.length === 0) return undefined;
	return drifted
		.map((field) => `${field} expected ${expected[field]}, found ${actual[field]}`)
		.join("; ");
}

/**
 * Assign a complete disposition and provenance row to every frozen entry.
 *
 * @param deps - Admitted platform store dependencies
 * @param sourceRoot - Absolute source root matching the frozen identity
 * @param expectedCensus - Optional fixture census or sanitized corpus receipt
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
	expectedCensus?: BrowserUseCorpusCensus | BrowserUseCorpusReceipt,
): Promise<{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure> {
	return await withMigrationOwnerLock(
		deps,
		"migration-plan",
		async () =>
			await planBrowserUseMigrationUnderLock(
				deps,
				sourceRoot,
				expectedCensus,
			),
	);
}

async function planBrowserUseMigrationUnderLock(
	deps: RetentionDeps,
	sourceRoot: string,
	expectedCensus?: BrowserUseCorpusCensus | BrowserUseCorpusReceipt,
): Promise<
	{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure
> {
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
	const contentsByPath = new Map<string, string>();
	for (const entry of inventoried.entries) {
		if (entry.type !== "file") continue;
		try {
			contentsByPath.set(
				entry.relative_path,
				await deps.fs.readTextFile(join(normalizedRoot, entry.relative_path)),
			);
		} catch {
			return migrationFailure(
				"migration_source_drift",
				"a source file became unreadable after the frozen snapshot.",
			);
		}
	}
	const preservedBackupFormal = preservedBackupFormalPaths(
		inventoried.entries,
		contentsByPath,
	);
	const dispositions: BrowserUseMigrationDisposition[] = [];
	const targetProvenance: BrowserUseTargetProvenance[] = [];
	let targetFlows = 0;
	for (const entry of inventoried.entries) {
		const contents = contentsByPath.get(entry.relative_path);
		const classified = dispositionFor(
			entry,
			contents,
			preservedBackupFormal,
		);
		if (!classified.ok) return classified;
		// Target Flows are declared as headings inside domain prose (R3); only
		// domain-prose markdown contributes to the flow tally.
		if (
			classified.disposition.artifact_class === "domain-prose" &&
			contents !== undefined
		) {
			targetFlows += targetFlowCount(contents);
		}
		dispositions.push(classified.disposition);
		if (
			classified.disposition.formal_flow_id !== null &&
			!isBackupPath(entry.relative_path)
		) {
			targetProvenance.push({
				source_relative_path: entry.relative_path,
				source_flow_id:
					classified.disposition.formal_flow_id.split("/").at(-1) ?? "",
				canonical_target_id: classified.disposition.canonical_target_id,
				activation: "canonical",
				reason: "current formal artifact maps to catalog authority",
			});
		}
		if (
			classified.disposition.disposition === "provenance-only" &&
			classified.disposition.formal_flow_id !== null
		) {
			targetProvenance.push({
				source_relative_path: entry.relative_path,
				source_flow_id:
					classified.disposition.formal_flow_id.split("/").at(-1) ?? "",
				canonical_target_id: classified.disposition.canonical_target_id,
				activation: "canonical",
				reason: "latest unique formal backup supplies provenance only",
			});
		}
		if (contents !== undefined) {
			targetProvenance.push(
				...trackerProvenanceFor(entry.relative_path, contents),
			);
		}
		targetProvenance.push(
			...reviewedActionProvenanceFor(
				entry.relative_path,
				classified.disposition.artifact_class,
			),
		);
	}
	const census = censusFor(dispositions, targetFlows);
	const sourceBasename = normalizedRoot.split("/").filter(Boolean).at(-1);
	const expectedContract =
		expectedCensus ??
		(sourceBasename === "browser-automation"
			? BROWSER_USE_CURRENT_CORPUS_RECEIPT
			: undefined);
	if (expectedContract !== undefined) {
		const expected = isCorpusReceipt(expectedContract)
			? expectedContract.corpus_census
			: expectedContract;
		const pathDrift = isCorpusReceipt(expectedContract)
			? expectedContract.source_entry_count !== inventoried.entries.length ||
				expectedContract.relative_path_digest !==
					relativePathDigest(inventoried.entries)
				? `path receipt expected ${expectedContract.source_entry_count} entries at ${expectedContract.relative_path_digest}, found ${inventoried.entries.length} entries at ${relativePathDigest(inventoried.entries)}`
				: undefined
			: undefined;
		const drift = pathDrift ?? censusDrift(expected, census);
		if (drift !== undefined) {
			return migrationFailure(
				"migration_count_drift",
				`corpus census drifted from the recorded baseline: ${drift}.`,
			);
		}
	}
	const state: BrowserUseMigrationState = {
		...standing.state,
		phase: "planned",
		disposition_count: dispositions.length,
		dispositions,
		corpus_census: census,
		canonical_targets: canonicalTargetsFor(targetProvenance),
		target_provenance: targetProvenance,
		staged_generation: null,
		last_apply_verified_noop: null,
		activation_state: standing.state.activation_state,
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
			disposition.transform_version === "" ||
			// Every entry carries exactly one classified artifact class (R2/R3),
			// and a canonical-target edge only exists for a formal flow (R4). A
			// persisted record could carry any string here, so validate against
			// the known class set rather than the compile-time union.
			!BROWSER_USE_ARTIFACT_CLASSES.includes(
				disposition.artifact_class as BrowserUseArtifactClass,
			) ||
			(disposition.canonical_target_id !== null &&
				disposition.formal_flow_id === null)
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
	return await withMigrationOwnerLock(
		deps,
		"migration-apply",
		async () => await applyBrowserUseMigrationUnderLock(deps, sourceRoot),
	);
}

async function applyBrowserUseMigrationUnderLock(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<
	{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure
> {
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
	const files: Array<{ relPath: string; copyFromSource: string }> = [];
	for (const disposition of standing.state.dispositions) {
		if (disposition.disposition !== "stage") continue;
		const sourcePath = join(frozen.root, disposition.source_relative_path);
		// Drift check is byte-vs-byte: expected_hash was set at inventory time
		// from fs.hashFile (raw bytes), so re-hash the raw bytes here. Hashing
		// UTF-8-decoded text instead would misfire on any non-UTF-8 source, whose
		// U+FFFD replacement chars hash differently than the bytes on disk and
		// would report a spurious, unclearable migration_source_drift.
		let sourceHash: string;
		try {
			sourceHash = await deps.fs.hashFile(sourcePath);
		} catch {
			// A staged source file readable at snapshot time became unreadable
			// (ENOENT/EACCES/EISDIR) before this loop: return the typed drift
			// refusal instead of letting the throw escape the contract.
			return migrationFailure(
				"migration_source_drift",
				"a source file became unreadable after the frozen snapshot.",
			);
		}
		if (sourceHash !== disposition.expected_hash) {
			return migrationFailure(
				"migration_source_drift",
				"a staged source file no longer matches its expected hash.",
			);
		}
		// Stage a BYTE-FAITHFUL copy of the source, not a UTF-8-decoded text
		// re-write. A non-UTF-8 source (arbitrary bytes in a .txt/.json) survives
		// verbatim, so the staged file's bytes equal expected_hash and verify's
		// hashFile(stagedPath) === expected_hash holds. Reading text here would
		// lossily map non-UTF-8 bytes to U+FFFD and permanently break verify.
		files.push({
			relPath: disposition.logical_destination_id as string,
			copyFromSource: sourcePath,
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
		activation_state: standing.state.activation_state,
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
	return await withMigrationOwnerLock(
		deps,
		"migration-verify",
		async () => await verifyBrowserUseMigrationUnderLock(deps, sourceRoot),
	);
}

async function verifyBrowserUseMigrationUnderLock(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<
	{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure
> {
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
		activation_state: standing.state.activation_state,
	});
}

/**
 * Adopt one generated candidate into the exact verified migration state.
 *
 * The migration owner serializes preflight, immutable staging, closure
 * validation, and authoritative state adoption. The final exact-byte compare
 * refuses a non-cooperative state change before the authoritative write.
 *
 * @param deps - Admitted migration-store dependencies
 * @param input - Candidate payload and exact immutable files to stage
 * @returns Adopted verified state plus committed closure, or one typed refusal
 *
 * @example
 * ```typescript
 * const adopted = await adoptBrowserUseGenerationCandidate(deps, {
 *   candidate,
 *   files,
 * })
 * ```
 */
export async function adoptBrowserUseGenerationCandidate(
	deps: RetentionDeps,
	input: {
		candidate: BrowserUseCorpusGenerationCandidatePayload;
		files: readonly StageGenerationFile[];
	},
): Promise<
	| {
			ok: true;
			state: BrowserUseMigrationState;
			closure: Extract<
				BrowserUseGenerationCandidateClosureRead,
				{ ok: true }
			>;
			verified_noop: boolean;
	  }
	| BrowserUseMigrationFailure
> {
	return await withMigrationOwnerLock(
		deps,
		`migration-adopt-${input.candidate.generation_id}`,
		async () => {
			const statePath = migrationStatePath(deps);
			const before = await readDurableFile(deps.fs, statePath);
			if (before.status === "missing") {
				return migrationFailure(
					"migration_state_missing",
					"generation adoption requires verified migration state.",
				);
			}
			if (before.status === "unreadable") {
				return migrationFailure(
					"migration_state_corrupt",
					"migration state is unreadable.",
				);
			}
			const standing = await readBrowserUseMigrationStatus(deps);
			if (!standing.ok) return standing;
			const preflightState = await readDurableFile(deps.fs, statePath);
			if (
				preflightState.status !== "present" ||
				preflightState.raw !== before.raw
			) {
				return migrationFailure(
					"migration_activation_conflict",
					"verified migration state changed before candidate preflight.",
				);
			}
			const preflight =
				await validateBrowserUseGenerationCandidateForMigrationState(
					deps,
					input.candidate,
					standing.state,
				);
			if (!preflight.ok) return preflight;
			let staged: Awaited<ReturnType<typeof stageGeneration>>;
			try {
				staged = await stageGeneration(deps, {
					generationId: input.candidate.generation_id,
					files: input.files,
				});
			} catch {
				return migrationFailure(
					"migration_generation_corrupt",
					"generation staging could not be completed safely.",
				);
			}
			if (!staged.ok) {
				return migrationFailure(
					staged.code === "retention_collision"
						? "retention_collision"
						: staged.code === "store_lock_contended"
							? "store_lock_contended"
							: staged.code === "store_record_corrupt"
								? "migration_generation_corrupt"
								: "store_flush_failed",
					staged.message,
				);
			}
			let closure: BrowserUseGenerationCandidateClosureRead;
			try {
				closure = await validateBrowserUseGenerationCandidateClosure(
					deps,
					input.candidate.generation_id,
				);
			} catch {
				return migrationFailure(
					"migration_generation_corrupt",
					"staged generation could not be read back safely.",
				);
			}
			if (!closure.ok) return closure;
			const committedBinding =
				await validateBrowserUseGenerationCandidateForMigrationState(
					deps,
					closure.candidate,
					standing.state,
				);
			if (!committedBinding.ok) return committedBinding;
			const observed = await readDurableFile(deps.fs, statePath);
			if (observed.status !== "present" || observed.raw !== before.raw) {
				return migrationFailure(
					"migration_activation_conflict",
					"verified migration state changed before candidate adoption.",
				);
			}
			const adopted = await writeMigrationStateIfUnchanged(
				deps,
				{
					...standing.state,
					phase: "verified",
					staged_generation: input.candidate.generation_id,
					last_apply_verified_noop: staged.verified_noop,
					activation_state: standing.state.activation_state,
				},
				before.raw,
			);
			if (!adopted.ok) return adopted;
			return {
				ok: true,
				state: adopted.state,
				closure,
				verified_noop: staged.verified_noop,
			};
		},
	);
}

/**
 * Activate a complete verified corpus generation through the activation owner.
 *
 * Migration retains phase-state loading while the generation owner performs
 * closure validation and the fenced authority transaction.
 *
 * @param deps - Admitted migration-store dependencies
 * @param input - Optional explicit immediate-prior generation for pre-effect rollback
 * @returns Activated migration state, or one typed refusal
 *
 * @example
 * ```typescript
 * const result = await activateBrowserUseMigration(deps, {})
 * ```
 */
export async function activateBrowserUseMigration(
	deps: RetentionDeps,
	input: { generationId?: string },
): Promise<
	{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure
> {
	return await withMigrationOwnerLock(
		deps,
		`migration-activate-${input.generationId ?? "staged"}`,
		async () => await activateBrowserUseMigrationUnderLock(deps, input),
	);
}

async function activateBrowserUseMigrationUnderLock(
	deps: RetentionDeps,
	input: { generationId?: string },
): Promise<
	{ ok: true; state: BrowserUseMigrationState } | BrowserUseMigrationFailure
> {
	const standing = await readBrowserUseMigrationStatus(deps);
	if (!standing.ok) return standing;
	const activated = await activateBrowserUseGeneration(
		deps,
		input,
		standing.state,
	);
	if (!activated.ok) return activated;
	return await writeMigrationState(deps, {
		...standing.state,
		activation_state: "active",
	});
}
