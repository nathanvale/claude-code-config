import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import {
	type BrowserUseImportCandidate,
	screenImportCandidate,
} from "./browser-use-auth-bindings";
import { CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH } from "./browser-use-generation-activation";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import {
	actionAssetDigest,
	actionAssetIsSecretFree,
	type BrowserUseReviewedActionRecord,
	parseReviewedActionRecord,
} from "./browser-use-runbook-actions";
import {
	type BrowserUseRunbook,
	validateRunbook,
} from "./browser-use-runbook-model";
import type { StageGenerationFile } from "./browser-use-retention";
import {
	type BrowserUseCorpusGenerationCandidatePayload,
	encodeDurableRecord,
	findRedactionViolations,
} from "./browser-use-schemas";

/** Filesystem seam used to retain verified safe knowledge without ambient I/O. */
export type BrowserUseCorpusGenerationBuilderDeps = {
	fs: BrowserUsePlatformFs;
};

/** One exact runbook definition and its caller-owned activation proof. */
export type BrowserUseCorpusGenerationTargetInput = {
	canonicalTargetId: string;
	runbook: BrowserUseRunbook;
	activation: "active" | "inactive";
	inactiveReason: string | null;
	proofs: readonly {
		proofRef: string;
		payload: unknown;
	}[];
};

/** One exact reviewed-action asset supplied by the action-registry owner. */
export type BrowserUseCorpusGenerationActionInput = {
	record: BrowserUseReviewedActionRecord;
	assetBytes: string;
};

/** One caller-selected auth route. The builder serializes but never selects it. */
export type BrowserUseCorpusGenerationAuthRouteInput = {
	authContextRef: string;
	candidateId: string;
};

/** Complete deterministic inputs for one migration-bound generation candidate. */
export type BrowserUseCorpusGenerationBuildInput = {
	state: BrowserUseMigrationState;
	sourceRoot: string;
	generationId: string;
	shippedCatalogDigest: string;
	targets: readonly BrowserUseCorpusGenerationTargetInput[];
	actions: readonly BrowserUseCorpusGenerationActionInput[];
	authCandidates: readonly BrowserUseImportCandidate[];
	authRoutes: readonly BrowserUseCorpusGenerationAuthRouteInput[];
};

/** Exact payload and immutable file closure accepted by generation adoption. */
export type BrowserUseCorpusGenerationBuild = {
	candidate: BrowserUseCorpusGenerationCandidatePayload;
	files: readonly StageGenerationFile[];
};

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LEDGER_PROOF_REF = "corpus-disposition-ledger";
const LEDGER_PROOF_PATH = "proofs/corpus-ledger.json";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function safeRelativePath(value: string): boolean {
	return (
		value !== "" &&
		!isAbsolute(value) &&
		!value.includes("\\") &&
		!value.includes("\0") &&
		value.split("/").every((segment) => segment !== "" && segment !== "..")
	);
}

function assertRedacted(value: unknown, label: string): void {
	const violations = findRedactionViolations(value);
	if (violations.length > 0) {
		throw new Error(
			`${label} contains redaction-unsafe data at ${violations[0]?.path ?? "unknown"}.`,
		);
	}
}

function assertBuildInput(input: BrowserUseCorpusGenerationBuildInput): void {
	if (
		input.state.phase !== "verified" ||
		input.state.snapshot_id === null ||
		input.state.snapshot_digest === null
	) {
		throw new Error("Corpus generation requires one verified migration state.");
	}
	if (!isAbsolute(input.sourceRoot)) {
		throw new Error("Corpus generation requires an absolute source root.");
	}
	if (!SAFE_SEGMENT.test(input.generationId)) {
		throw new Error("Corpus generation requires a safe generation id.");
	}
	if (!SHA256.test(input.shippedCatalogDigest)) {
		throw new Error("Corpus generation requires an exact shipped catalog digest.");
	}
	const expectedTargets = input.state.canonical_targets
		.map((target) => target.canonical_target_id)
		.sort();
	const suppliedTargets = input.targets
		.map((target) => target.canonicalTargetId)
		.sort();
	if (
		new Set(expectedTargets).size !== expectedTargets.length ||
		new Set(suppliedTargets).size !== suppliedTargets.length ||
		JSON.stringify(expectedTargets) !== JSON.stringify(suppliedTargets)
	) {
		throw new Error(
			"Corpus generation requires exactly one definition for every verified canonical target.",
		);
	}
}

async function buildKnowledgeFiles(
	deps: BrowserUseCorpusGenerationBuilderDeps,
	input: BrowserUseCorpusGenerationBuildInput,
): Promise<{
	refs: NonNullable<
		BrowserUseCorpusGenerationCandidatePayload["knowledge"]
	>["files"];
	files: StageGenerationFile[];
}> {
	const refs: Array<{
		source_relative_path: string;
		path: string;
		digest: string;
	}> = [];
	const files: StageGenerationFile[] = [];
	for (const disposition of [...input.state.dispositions].sort((left, right) =>
		left.source_relative_path.localeCompare(right.source_relative_path),
	)) {
		if (disposition.disposition !== "stage") continue;
		if (!safeRelativePath(disposition.source_relative_path)) {
			throw new Error("Staged knowledge has an unsafe source-relative path.");
		}
		const absolute = join(input.sourceRoot, disposition.source_relative_path);
		const stat = await deps.fs.lstat(absolute);
		if (
			stat?.kind !== "file" ||
			(await deps.fs.hashFile(absolute)) !== disposition.source_content_hash
		) {
			throw new Error("Staged knowledge does not match verified source bytes.");
		}
		const contents = await deps.fs.readTextFile(absolute);
		if (sha256(contents) !== disposition.source_content_hash) {
			throw new Error("Staged knowledge is not exact UTF-8 source content.");
		}
		assertRedacted(contents, "Staged knowledge");
		const path = `knowledge/${disposition.source_relative_path}`;
		refs.push({
			source_relative_path: disposition.source_relative_path,
			path,
			digest: disposition.source_content_hash,
		});
		files.push({ relPath: path, contents });
	}
	return { refs, files };
}

/**
 * Compose one exact migration-bound generation candidate without selecting authority.
 *
 * Active closure remains caller-owned: exact runbooks, reviewed action records,
 * auth candidates, routes, and proofs enter through explicit inputs. The
 * builder only verifies, canonicalizes, hashes, and binds them. Legacy entries
 * marked `stage` become safe knowledge; every other disposition appears only
 * in the redacted corpus ledger.
 *
 * @param deps - Injected filesystem used only for verified staged knowledge
 * @param input - Verified state plus caller-owned generation authority
 * @returns Candidate payload and sorted exact file closure for adoption
 * @throws {Error} When state, closure, provenance, hashes, or redaction fail
 *
 * @example
 * ```typescript
 * const bundle = await buildBrowserUseCorpusGeneration({ fs }, input)
 * await adoptBrowserUseGenerationCandidate(deps, bundle)
 * ```
 */
export async function buildBrowserUseCorpusGeneration(
	deps: BrowserUseCorpusGenerationBuilderDeps,
	input: BrowserUseCorpusGenerationBuildInput,
): Promise<BrowserUseCorpusGenerationBuild> {
	assertBuildInput(input);
	const files: StageGenerationFile[] = [];
	const knowledge = await buildKnowledgeFiles(deps, input);
	files.push(...knowledge.files);

	const ledgerPayload = {
		contract: "browser-use.corpus-disposition-ledger",
		schema_version: "1",
		snapshot_id: input.state.snapshot_id,
		snapshot_digest: input.state.snapshot_digest,
		dispositions: [...input.state.dispositions]
			.sort((left, right) =>
				left.source_relative_path.localeCompare(right.source_relative_path),
			)
			.map((disposition) => ({
				source_relative_path: disposition.source_relative_path,
				source_content_hash: disposition.source_content_hash,
				artifact_class: disposition.artifact_class,
				formal_flow_id: disposition.formal_flow_id,
				canonical_target_id: disposition.canonical_target_id,
				disposition: disposition.disposition,
				reason: disposition.reason,
				transform_version: disposition.transform_version,
			})),
	};
	assertRedacted(ledgerPayload, "Corpus ledger");
	const ledgerContents = json(ledgerPayload);
	files.push({ relPath: LEDGER_PROOF_PATH, contents: ledgerContents });

	const proofs: BrowserUseCorpusGenerationCandidatePayload["proofs"][number][] = [
		{
			proof_ref: LEDGER_PROOF_REF,
			path: LEDGER_PROOF_PATH,
			digest: sha256(ledgerContents),
		},
	];
	const targets: BrowserUseCorpusGenerationCandidatePayload["canonical_targets"][number][] =
		[];
	for (const target of [...input.targets].sort((left, right) =>
		left.canonicalTargetId.localeCompare(right.canonicalTargetId),
	)) {
		if (
			`${target.runbook.service_id}/${target.runbook.flow_id}` !==
				target.canonicalTargetId ||
			validateRunbook(target.runbook).length > 0
		) {
			throw new Error("A canonical target carries an invalid or mismatched runbook.");
		}
		if (
			(target.activation === "active" && target.inactiveReason !== null) ||
			(target.activation === "inactive" &&
				(typeof target.inactiveReason !== "string" ||
					target.inactiveReason.trim() === ""))
		) {
			throw new Error("A canonical target carries an invalid activation blocker.");
		}
		assertRedacted(target.runbook, "Runbook");
		const runbookContents = json(target.runbook);
		const targetSlug = target.canonicalTargetId.replace("/", "/");
		const runbookPath = `runbooks/${targetSlug}/runbook.json`;
		files.push({ relPath: runbookPath, contents: runbookContents });

		const targetProofRefs = [LEDGER_PROOF_REF];
		for (const proof of [...target.proofs].sort((left, right) =>
			left.proofRef.localeCompare(right.proofRef),
		)) {
			if (!SAFE_SEGMENT.test(proof.proofRef)) {
				throw new Error("Target proof reference is unsafe.");
			}
			assertRedacted(proof.payload, "Target proof");
			const proofContents = json(proof.payload);
			const proofPath = `proofs/${proof.proofRef}.json`;
			files.push({ relPath: proofPath, contents: proofContents });
			proofs.push({
				proof_ref: proof.proofRef,
				path: proofPath,
				digest: sha256(proofContents),
			});
			targetProofRefs.push(proof.proofRef);
		}
		const provenance = input.state.canonical_targets.find(
			(candidate) =>
				candidate.canonical_target_id === target.canonicalTargetId,
		);
		if (provenance === undefined || provenance.source_relative_paths.length === 0) {
			throw new Error("A canonical target lacks verified source provenance.");
		}
		targets.push({
			canonical_target_id: target.canonicalTargetId,
			activation: target.activation,
			runbook_path: runbookPath,
			runbook_digest: sha256(runbookContents),
			source_relative_paths: [...provenance.source_relative_paths].sort(),
			proof_refs: targetProofRefs.sort(),
			inactive_reason: target.inactiveReason,
		});
	}

	const actionRefs: BrowserUseCorpusGenerationCandidatePayload["action_registry"]["actions"][number][] =
		[];
	const actionRecords: BrowserUseReviewedActionRecord[] = [];
	for (const action of [...input.actions].sort((left, right) =>
		left.record.action_id.localeCompare(right.record.action_id),
	)) {
		const parsed = parseReviewedActionRecord(action.record);
		if (
			!parsed.ok ||
			actionAssetDigest(action.assetBytes) !== action.record.expected_digest
		) {
			throw new Error("Reviewed action record does not bind its exact asset bytes.");
		}
		assertRedacted(action.record, "Reviewed action record");
		if (!actionAssetIsSecretFree(action.assetBytes)) {
			throw new Error("Reviewed action asset contains secret-shaped material.");
		}
		const recordContents = json(action.record);
		const recordPath = `actions/records/${action.record.action_id}.json`;
		const assetPath = `actions/assets/${action.record.expected_digest}.js`;
		files.push(
			{ relPath: recordPath, contents: recordContents },
			{ relPath: assetPath, contents: action.assetBytes },
		);
		actionRecords.push(action.record);
		actionRefs.push({
			action_id: action.record.action_id,
			record_path: recordPath,
			record_digest: sha256(recordContents),
			asset_path: assetPath,
			asset_digest: action.record.expected_digest,
		});
	}
	const registryContents = json({ actions: actionRecords });
	const registryPath = "actions/registry.json";
	files.push({ relPath: registryPath, contents: registryContents });

	const authCandidateRefs: BrowserUseCorpusGenerationCandidatePayload["auth"]["candidates"][number][] =
		[];
	const admittedCandidateIds = new Set<string>();
	for (const candidate of [...input.authCandidates].sort((left, right) =>
		left.candidate_id.localeCompare(right.candidate_id),
	)) {
		const screened = screenImportCandidate(candidate);
		if (!screened.ok || screened.candidate.candidate_id !== candidate.candidate_id) {
			throw new Error("Auth candidate failed redacted candidate admission.");
		}
		if (admittedCandidateIds.has(candidate.candidate_id)) {
			throw new Error("Auth candidate ids must be distinct.");
		}
		admittedCandidateIds.add(candidate.candidate_id);
		const contents = json(screened.candidate);
		const path = `auth/candidates/${candidate.candidate_id}.json`;
		files.push({ relPath: path, contents });
		authCandidateRefs.push({
			candidate_id: candidate.candidate_id,
			path,
			digest: sha256(contents),
		});
	}

	const authRouteRefs: BrowserUseCorpusGenerationCandidatePayload["auth"]["routes"][number][] =
		[];
	for (const route of [...input.authRoutes].sort((left, right) =>
		left.authContextRef.localeCompare(right.authContextRef),
	)) {
		if (
			!SAFE_SEGMENT.test(route.authContextRef) ||
			!admittedCandidateIds.has(route.candidateId)
		) {
			throw new Error("Auth route does not bind one admitted caller candidate.");
		}
		const contents = json({
			auth_context_ref: route.authContextRef,
			candidate_id: route.candidateId,
			status: "active",
		});
		const path = `auth/routes/${route.authContextRef}.json`;
		files.push({ relPath: path, contents });
		authRouteRefs.push({
			auth_context_ref: route.authContextRef,
			candidate_id: route.candidateId,
			path,
			digest: sha256(contents),
		});
	}

	const candidate: BrowserUseCorpusGenerationCandidatePayload = {
		contract: "browser-use.corpus-generation-candidate",
		schema_version: "1",
		generation_id: input.generationId,
		source_snapshot: {
			snapshot_id: input.state.snapshot_id as string,
			snapshot_digest: input.state.snapshot_digest as string,
		},
		canonical_targets: targets,
		action_registry: {
			registry_path: registryPath,
			registry_digest: sha256(registryContents),
			actions: actionRefs,
		},
		auth: {
			candidates: authCandidateRefs,
			routes: authRouteRefs,
		},
		proofs: proofs.sort((left, right) =>
			left.proof_ref.localeCompare(right.proof_ref),
		),
		...(knowledge.refs.length === 0
			? {}
			: { knowledge: { files: knowledge.refs } }),
		shipped_catalog_digest: input.shippedCatalogDigest,
	};
	const { auth: _screenedAuth, ...candidateWithoutAuth } = candidate;
	assertRedacted(candidateWithoutAuth, "Generation candidate");
	files.push({
		relPath: CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
		contents: encodeDurableRecord("corpus-generation-candidate", candidate),
	});

	const sorted = files.sort((left, right) =>
		left.relPath.localeCompare(right.relPath),
	);
	if (new Set(sorted.map((file) => file.relPath)).size !== sorted.length) {
		throw new Error("Generation closure contains a duplicate file path.");
	}
	return { candidate, files: sorted };
}
