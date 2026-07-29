import { isAbsolute, join, normalize, sep } from "node:path";
import { constants as fsConstants } from "node:fs";
import {
	open as fsOpen,
	realpath as fsRealpath,
} from "node:fs/promises";
import {
	CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
} from "./browser-use-generation-activation";
import type { BrowserUseMigrationFailure } from "./browser-use-migration-model";
import { adoptBrowserUseGenerationCandidate } from "./browser-use-migration";
import { actionAssetIsSecretFree } from "./browser-use-runbook-actions";
import type {
	RetentionDeps,
	StageGenerationFile,
} from "./browser-use-retention";
import {
	type BrowserUseCorpusGenerationCandidatePayload,
	findRedactionViolations,
	parseDurableRecord,
} from "./browser-use-schemas";

/**
 * Admission ceilings for one user-controlled source bundle.
 *
 * Checked from `lstat` before every file read, then checked again against the
 * decoded UTF-8 byte count before staging.
 */
export const BROWSER_USE_GENERATION_SOURCE_LIMITS = {
	max_files: 2_048,
	max_file_bytes: 1_048_576,
	max_total_bytes: 16_777_216,
} as const;

/**
 * Stable producer failures for JSON callers.
 *
 * Source paths and file contents never appear in these classifications.
 */
export type BrowserUseGenerationProducerErrorCode =
	| "generation_source_invalid"
	| "generation_candidate_missing"
	| "generation_candidate_invalid"
	| "generation_stage_failed"
	| "generation_staged_copy_corrupt"
	| "generation_closure_invalid";

/** Redacted failure detail returned by the producer boundary. */
export type BrowserUseGenerationProducerError = {
	code: BrowserUseGenerationProducerErrorCode;
	message: string;
};

/** Counts that let callers inspect candidate closure without reading source bytes. */
export type BrowserUseGenerationClosureSummary = {
	canonical_target_count: number;
	active_target_count: number;
	action_count: number;
	auth_candidate_count: number;
	auth_route_count: number;
	proof_count: number;
};

/** Immutable generation identity needed by activation and audit. */
export type BrowserUseProducedGenerationIdentity = {
	generation_id: string;
	generation_content_hash: string;
	candidate_manifest_digest: string;
};

/** Successful non-interactive staging result. */
export type BrowserUseGenerationProducerSuccess = {
	ok: true;
	identity: BrowserUseProducedGenerationIdentity;
	closure: BrowserUseGenerationClosureSummary;
	verified_noop: boolean;
	next_safe_action: {
		id: "activate_staged_generation";
		command: "migration";
		args: readonly ["activate", "--generation", string, "--json"];
	};
};

/** Failed staging result with one repair-oriented continuation. */
export type BrowserUseGenerationProducerFailure = {
	ok: false;
	error: BrowserUseGenerationProducerError;
	next_safe_action: {
		id:
			| "repair_generation_source"
			| "choose_new_generation_id"
			| "inspect_generation_store";
		summary: string;
	};
};

/** Total JSON-first producer result. */
export type BrowserUseGenerationProducerResult =
	| BrowserUseGenerationProducerSuccess
	| BrowserUseGenerationProducerFailure;

type SourceCollection =
	| { ok: true; files: readonly StageGenerationFile[] }
	| { ok: false; failure: BrowserUseGenerationProducerFailure };

type PrivateSourceFileRead =
	| {
			ok: true;
			contents: string;
			size: number;
			dev: number;
			uid: number;
			mode: number;
			canonicalPath: string;
	  }
	| { ok: false };

function failure(
	code: BrowserUseGenerationProducerErrorCode,
	message: string,
	next:
		| "repair_generation_source"
		| "choose_new_generation_id"
		| "inspect_generation_store",
	summary: string,
): BrowserUseGenerationProducerFailure {
	return {
		ok: false,
		error: { code, message },
		next_safe_action: { id: next, summary },
	};
}

function safeEntryName(value: string): boolean {
	return (
		value !== "" &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0")
	);
}

function staysWithinRoot(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}

const SOURCE_READ_CHUNK_BYTES = 64 * 1024;
const SECRET_TEXT_PATTERNS: readonly RegExp[] = [
	/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
	/\bOP_SERVICE_ACCOUNT_TOKEN\s*=/i,
	/\b(?:password|passwd|token|secret|cookie|authorization|client_secret|aws_secret_access_key|aws_access_key_id|api[_-]?key|private_key)\s*[:=]\s*\S+/i,
	/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
	/\beyJ[A-Za-z0-9_-]{9,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
	/\bop:\/\/\S+/i,
	/\bwss?:\/\/\S+/i,
	/\botpauth:\/\/\S+/i,
	/\b[A-Z2-7]{32,}\b/i,
	/--(?:password|passwd|passphrase|secret|token|api[-_]?key|credential|auth|cookie|session)(?:=|\b)/i,
	/(?:^|[\s('"`])(?:~\/|\/)(?!\/)\S+/,
];

function stagedFileIsRedacted(file: StageGenerationFile): boolean {
	if (file.contents === undefined) return false;
	const contents = file.contents;
	if (
		file.relPath.startsWith("actions/assets/") &&
		file.relPath.endsWith(".js")
	) {
		return actionAssetIsSecretFree(contents);
	}
	if (SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(contents))) {
		return false;
	}
	if (findRedactionViolations(contents).length > 0) return false;
	if (!file.relPath.endsWith(".json")) return true;
	try {
		const parsed = JSON.parse(contents) as unknown;
		if (file.relPath !== CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH) {
			return findRedactionViolations(parsed).length === 0;
		}
		const record =
			parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: undefined;
		const payload =
			record?.payload !== null &&
			typeof record?.payload === "object" &&
			!Array.isArray(record.payload)
				? (record.payload as Record<string, unknown>)
				: undefined;
		return (
			findRedactionViolations(parsed, { skipPaths: ["payload.auth"] })
				.length === 0 &&
			findRedactionViolations(payload?.auth).length === 0
		);
	} catch {
		return false;
	}
}

function samePrivateFileIdentity(
	left: {
		dev: number;
		ino: number;
		uid: number;
		mode: number;
		size: number;
		nlink: number;
	},
	right: {
		dev: number;
		ino: number;
		uid: number;
		mode: number;
		size: number;
		nlink: number;
	},
): boolean {
	return (
		left.dev === right.dev &&
		left.ino === right.ino &&
		left.uid === right.uid &&
		(left.mode & 0o777) === (right.mode & 0o777) &&
		left.size === right.size &&
		left.nlink === right.nlink
	);
}

async function readPrivateSourceFile(
	path: string,
	expectedUid: number | undefined,
): Promise<PrivateSourceFileRead> {
	let handle: Awaited<ReturnType<typeof fsOpen>> | undefined;
	try {
		handle = await fsOpen(
			path,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		);
		const before = await handle.stat();
		if (
			!before.isFile() ||
			(expectedUid !== undefined && before.uid !== expectedUid) ||
			(before.mode & 0o077) !== 0 ||
			before.nlink !== 1 ||
			before.size > BROWSER_USE_GENERATION_SOURCE_LIMITS.max_file_bytes
		) {
			return { ok: false };
		}
		const chunks: Buffer[] = [];
		let total = 0;
		while (total <= BROWSER_USE_GENERATION_SOURCE_LIMITS.max_file_bytes) {
			const remaining =
				BROWSER_USE_GENERATION_SOURCE_LIMITS.max_file_bytes + 1 - total;
			const chunk = Buffer.allocUnsafe(
				Math.min(SOURCE_READ_CHUNK_BYTES, remaining),
			);
			const read = await handle.read(chunk, 0, chunk.length, null);
			if (read.bytesRead === 0) break;
			chunks.push(chunk.subarray(0, read.bytesRead));
			total += read.bytesRead;
		}
		const after = await handle.stat();
		if (
			total > BROWSER_USE_GENERATION_SOURCE_LIMITS.max_file_bytes ||
			before.size !== total ||
			after.size !== total ||
			!samePrivateFileIdentity(before, after)
		) {
			return { ok: false };
		}
		const bytes = Buffer.concat(chunks, total);
		let contents: string;
		try {
			contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return { ok: false };
		}
		return {
			ok: true,
			contents,
			size: total,
			dev: after.dev,
			uid: after.uid,
			mode: after.mode & 0o777,
			canonicalPath: normalize(await fsRealpath(path)),
		};
	} catch {
		return { ok: false };
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function collectSourceFiles(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<SourceCollection> {
	if (!isAbsolute(sourceRoot)) {
		return {
			ok: false,
			failure: failure(
				"generation_source_invalid",
				"generation source must be an absolute private directory.",
				"repair_generation_source",
				"Provide an absolute source directory with no symlinks.",
			),
		};
	}
	const root = normalize(sourceRoot);
	try {
		const rootStat = await deps.fs.lstat(root);
		const canonicalRoot = await deps.fs.realpath(root);
		if (
			rootStat?.kind !== "directory" ||
			canonicalRoot === undefined ||
			canonicalRoot !== root ||
			(process.getuid?.() !== undefined &&
				rootStat.uid !== process.getuid?.()) ||
			(rootStat.mode & 0o077) !== 0
		) {
			return {
				ok: false,
				failure: failure(
					"generation_source_invalid",
					"generation source must be a real directory with no symlink boundary.",
					"repair_generation_source",
					"Replace symlinks with a private real directory.",
				),
			};
		}
		const files: StageGenerationFile[] = [];
		let admittedBytes = 0;
		const expectedUid = process.getuid?.();
		const walk = async (directory: string, prefix: string): Promise<boolean> => {
			for (const entry of [...(await deps.fs.readDirectory(directory))].sort()) {
				if (!safeEntryName(entry)) return false;
				const path = join(directory, entry);
				const relativePath = prefix === "" ? entry : `${prefix}/${entry}`;
				const stat = await deps.fs.lstat(path);
				const canonical = await deps.fs.realpath(path);
				if (
					stat === undefined ||
					stat.kind === "symlink" ||
					canonical === undefined ||
					canonical !== normalize(path) ||
					!staysWithinRoot(canonical, canonicalRoot) ||
					stat.dev !== rootStat.dev ||
					(expectedUid !== undefined && stat.uid !== expectedUid) ||
					(stat.mode & 0o077) !== 0
				) {
					return false;
				}
				if (stat.kind === "directory") {
					if (!(await walk(path, relativePath))) return false;
					continue;
				}
				if (stat.kind !== "file") return false;
				if (files.length >= BROWSER_USE_GENERATION_SOURCE_LIMITS.max_files) {
					return false;
				}
				const captured = await readPrivateSourceFile(path, expectedUid);
				const [afterStat, afterCanonical] = await Promise.all([
					deps.fs.lstat(path),
					deps.fs.realpath(path),
				]);
				if (
					!captured.ok ||
					afterStat?.kind !== "file" ||
					afterCanonical !== canonical ||
					captured.canonicalPath !== canonical ||
					captured.dev !== stat.dev ||
					captured.dev !== afterStat.dev ||
					captured.uid !== stat.uid ||
					captured.uid !== afterStat.uid ||
					captured.mode !== stat.mode ||
					captured.mode !== afterStat.mode ||
					captured.size !== stat.size ||
					captured.size !== afterStat.size ||
					admittedBytes + captured.size >
						BROWSER_USE_GENERATION_SOURCE_LIMITS.max_total_bytes
				) {
					return false;
				}
				admittedBytes += captured.size;
				files.push({ relPath: relativePath, contents: captured.contents });
			}
			return true;
		};
		if (!(await walk(root, "")) || files.length === 0) {
			return {
				ok: false,
				failure: failure(
					"generation_source_invalid",
					"generation source contains a symlink, path escape, or unsupported entry.",
					"repair_generation_source",
					"Replace unsafe entries with regular files and directories.",
				),
			};
		}
		return { ok: true, files };
	} catch {
		return {
			ok: false,
			failure: failure(
				"generation_source_invalid",
				"generation source is missing or unreadable.",
				"repair_generation_source",
				"Restore a readable private source directory.",
			),
		};
	}
}

function producerClosureFailure(
	refusal: BrowserUseMigrationFailure,
): BrowserUseGenerationProducerFailure {
	switch (refusal.code) {
		case "migration_collision":
		case "retention_collision":
			return failure(
				"generation_stage_failed",
				"generation identity is already bound to different immutable bytes.",
				"choose_new_generation_id",
				"Choose a new generation id for changed bytes.",
			);
		case "store_lock_contended":
		case "store_flush_failed":
			return failure(
				"generation_stage_failed",
				"generation adoption could not acquire or flush migration authority.",
				"inspect_generation_store",
				"Inspect migration status, then retry generation adoption.",
			);
		case "migration_generation_missing":
		case "migration_generation_corrupt":
			return failure(
				"generation_staged_copy_corrupt",
				"staged generation does not match its immutable generation record.",
				"inspect_generation_store",
				"Inspect the generation store before retrying.",
			);
		case "migration_candidate_missing":
			return failure(
				"generation_candidate_missing",
				"staged generation has no readable candidate manifest.",
				"choose_new_generation_id",
				"Repair the source bundle and stage it under a new generation id.",
			);
		case "migration_candidate_corrupt":
			return failure(
				"generation_candidate_invalid",
				"staged candidate manifest is invalid or names another generation.",
				"choose_new_generation_id",
				"Repair the candidate manifest and stage it under a new generation id.",
			);
		case "migration_manifest_incomplete":
		case "migration_shipped_catalog_drift":
			return failure(
				"generation_closure_invalid",
				"staged candidate closure is incomplete or invalid.",
				"choose_new_generation_id",
				"Repair the complete candidate bundle and stage a new generation.",
			);
		case "migration_activation_conflict":
			return failure(
				"generation_closure_invalid",
				"verified migration state changed before generation adoption.",
				"inspect_generation_store",
				"Inspect current migration status before retrying generation.",
			);
		default:
			return failure(
				"generation_closure_invalid",
				"staged candidate closure could not be verified.",
				"inspect_generation_store",
				"Inspect the generation store before retrying.",
			);
	}
}

function referencedCandidatePaths(
	candidate: BrowserUseCorpusGenerationCandidatePayload,
): ReadonlySet<string> {
	return new Set([
		CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
		candidate.action_registry.registry_path,
		...candidate.canonical_targets.map((target) => target.runbook_path),
		...candidate.action_registry.actions.flatMap((action) => [
			action.record_path,
			action.asset_path,
		]),
		...candidate.auth.candidates.map((authCandidate) => authCandidate.path),
		...candidate.auth.routes.map((route) => route.path),
		...candidate.proofs.map((proof) => proof.path),
		...(candidate.knowledge?.files.map((file) => file.path) ?? []),
	]);
}

function sourceMatchesCandidateClosure(
	files: readonly StageGenerationFile[],
	candidate: BrowserUseCorpusGenerationCandidatePayload,
): boolean {
	const referenced = referencedCandidatePaths(candidate);
	const sourcePaths = new Set(files.map((file) => file.relPath));
	return (
		sourcePaths.size === files.length &&
		sourcePaths.size === referenced.size &&
		[...referenced].every((path) => sourcePaths.has(path))
	);
}

/**
 * Stage one activation-ready source bundle into immutable generation storage.
 *
 * Reads the mutable source into bounded text values, stages through the
 * retention owner, then re-reads and validates the committed generation copy.
 * Returned JSON omits source paths and all file contents.
 *
 * @param deps - Admitted filesystem, paths, and clock
 * @param input - Absolute source root and optional exact generation-id assertion
 * @returns Redacted staged identity and activation continuation, or typed repair
 * @throws Never; filesystem and malformed-input failures become typed results
 *
 * @example
 * ```typescript
 * const result = await produceBrowserUseGeneration(deps, {
 *   sourceRoot: "/private/staging/candidate",
 *   generationId: "generation-2026-07-29",
 * })
 * ```
 */
export async function produceBrowserUseGeneration(
	deps: RetentionDeps,
	input: { sourceRoot: string; generationId?: string },
): Promise<BrowserUseGenerationProducerResult> {
	const source = await collectSourceFiles(deps, input.sourceRoot);
	if (!source.ok) return source.failure;
	if (!source.files.every(stagedFileIsRedacted)) {
		return failure(
			"generation_source_invalid",
			"generation source contains material that fails durable redaction screening.",
			"repair_generation_source",
			"Remove secret-bearing or unredacted material before staging.",
		);
	}
	const sourceCandidate = source.files.find(
		(file) => file.relPath === CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
	);
	if (sourceCandidate === undefined || sourceCandidate.contents === undefined) {
		return failure(
			"generation_candidate_missing",
			"generation source has no candidate manifest.",
			"repair_generation_source",
			"Add a complete candidate manifest before staging.",
		);
	}
	const sourceParsed = parseDurableRecord(
		sourceCandidate.contents,
		"corpus-generation-candidate",
	);
	if (
		!sourceParsed.ok ||
		(input.generationId !== undefined &&
			sourceParsed.payload.generation_id !== input.generationId)
	) {
		return failure(
			"generation_candidate_invalid",
			"source candidate manifest is invalid or names another generation.",
			"repair_generation_source",
			"Repair the candidate manifest before staging.",
		);
	}
	const generationId = sourceParsed.payload.generation_id;
	if (!safeEntryName(generationId)) {
		return failure(
			"generation_candidate_invalid",
			"source candidate manifest names an unsafe generation.",
			"repair_generation_source",
			"Replace the candidate generation id with one safe path segment.",
		);
	}
	if (!sourceMatchesCandidateClosure(source.files, sourceParsed.payload)) {
		return failure(
			"generation_candidate_invalid",
			"generation source does not exactly match the candidate file closure.",
			"repair_generation_source",
			"Remove unreferenced files and provide every referenced candidate file.",
		);
	}
	let adopted: Awaited<
		ReturnType<typeof adoptBrowserUseGenerationCandidate>
	>;
	try {
		adopted = await adoptBrowserUseGenerationCandidate(deps, {
			candidate: sourceParsed.payload,
			files: source.files,
		});
	} catch {
		return failure(
			"generation_closure_invalid",
			"generation adoption could not be completed safely.",
			"inspect_generation_store",
			"Inspect the generation store before retrying.",
		);
	}
	if (!adopted.ok) return producerClosureFailure(adopted);
	const closure = adopted.closure;
	return {
		ok: true,
		identity: {
			generation_id: generationId,
			generation_content_hash: closure.generationContentHash,
			candidate_manifest_digest: closure.candidateDigest,
		},
		closure: {
			canonical_target_count: closure.candidate.canonical_targets.length,
			active_target_count: closure.candidate.canonical_targets.filter(
				(target) => target.activation === "active",
			).length,
			action_count: closure.candidate.action_registry.actions.length,
			auth_candidate_count: closure.candidate.auth.candidates.length,
			auth_route_count: closure.candidate.auth.routes.length,
			proof_count: closure.candidate.proofs.length,
		},
		verified_noop: adopted.verified_noop,
		next_safe_action: {
			id: "activate_staged_generation",
			command: "migration",
			args: [
				"activate",
				"--generation",
				generationId,
				"--json",
			],
		},
	};
}
