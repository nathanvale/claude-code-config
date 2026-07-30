import { isAbsolute } from "node:path";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import {
	buildBrowserUseCorpusGeneration,
} from "./browser-use-corpus-generation-builder";
import {
	composeBrowserUseCorpusMigration,
	type BrowserUseCorpusMigrationCompositionInput,
} from "./browser-use-corpus-migration-composition";
import { censusBundledMonashSmstCorpus } from "./browser-use-monash-smst-census";
import {
	composeImportedMonashSmstCorpusMigration,
	composeMonashSmstSourceSnapshot,
	mergeMonashSmstCensusIntoCorpus,
} from "./browser-use-monash-smst-integration";
import type {
	BrowserUseMigrationFailure,
	BrowserUseMigrationState,
} from "./browser-use-migration-model";
import {
	adoptBrowserUseGenerationCandidate,
	applyBrowserUseMigration,
	browserUseSourceSnapshotMatchesMigrationState,
	inventoryBrowserUseMigration,
	planBrowserUseMigration,
	verifyBrowserUseMigration,
} from "./browser-use-migration";
import { shippedRunbooksRoot } from "./browser-use-runbook";
import {
	sourceSnapshotPath,
	type RetentionDeps,
	writeSourceSnapshot,
} from "./browser-use-retention";
import {
	parseDurableRecord,
	type BrowserUseSourceSnapshotPayload,
} from "./browser-use-schemas";
import { readDurableFile } from "./browser-use-store";

/** Complete inactive generation import, leaving authority selection explicit. */
export type BrowserUseCorpusImportSuccess = {
	ok: true;
	state: BrowserUseMigrationState;
	generation: {
		generation_id: string;
		source_snapshot_id: string;
		source_snapshot_digest: string;
		source_entry_count: number;
		canonical_target_count: number;
		active_target_count: number;
		inactive_target_count: number;
		auth_candidate_count: number;
		auth_route_count: number;
		file_count: number;
		shipped_catalog_digest: string;
		verified_noop: boolean;
	};
	activation_state: "unchanged";
	next_action: {
		action_id: "activate_staged_generation";
		generation_id: string;
	};
};

export type BrowserUseCorpusImportResult =
	| BrowserUseCorpusImportSuccess
	| BrowserUseMigrationFailure;

/**
 * Recompose one imported combined state for selective target graduation.
 *
 * This keeps every bundled Monash target and proof in the next generation.
 */
export async function composeImportedBrowserUseCorpusMigration(
	deps: RetentionDeps,
	input: BrowserUseCorpusMigrationCompositionInput,
) {
	const census = censusBundledMonashSmstCorpus();
	if (!census.ok || input.state.snapshot_id === null) {
		throw new Error(
			"Imported corpus recomposition requires the exact bundled census and snapshot.",
		);
	}
	const read = await readDurableFile(
		deps.fs,
		sourceSnapshotPath(deps.paths, input.state.snapshot_id),
	);
	if (read.status !== "present") {
		throw new Error(
			"Imported corpus recomposition requires its retained source snapshot.",
		);
	}
	const snapshot = parseDurableRecord(read.raw, "source-snapshot");
	if (!snapshot.ok) {
		throw new Error(
			"Imported corpus recomposition source snapshot is corrupt.",
		);
	}
	if (
		!browserUseSourceSnapshotMatchesMigrationState(
			input.state,
			snapshot.payload,
		)
	) {
		throw new Error(
			"Imported corpus recomposition source snapshot does not match standing state.",
		);
	}
	return await composeImportedMonashSmstCorpusMigration(
		{ fs: deps.fs },
		input,
		census.census,
		snapshot.payload,
	);
}

function generationFailure(message: string): BrowserUseMigrationFailure {
	return {
		ok: false,
		code: "migration_generation_corrupt",
		message,
	};
}

async function publishCompositeSourceSnapshot(
	deps: RetentionDeps,
	baseState: BrowserUseMigrationState,
	monash: Extract<
		ReturnType<typeof censusBundledMonashSmstCorpus>,
		{ ok: true }
	>["census"],
): Promise<
	| { ok: true; snapshot: BrowserUseSourceSnapshotPayload }
	| BrowserUseMigrationFailure
> {
	if (
		baseState.snapshot_id === null ||
		baseState.snapshot_digest === null ||
		baseState.source_root_identity === null
	) {
		return generationFailure(
			"verified base corpus lacks one exact source identity.",
		);
	}
	const standing = await readDurableFile(
		deps.fs,
		sourceSnapshotPath(deps.paths, baseState.snapshot_id),
	);
	if (standing.status !== "present") {
		return generationFailure(
			"base source snapshot is missing before Monash composition.",
		);
	}
	const parsed = parseDurableRecord(standing.raw, "source-snapshot");
	if (!parsed.ok) {
		return generationFailure(
			"base source snapshot is corrupt before Monash composition.",
		);
	}
	let snapshot: BrowserUseSourceSnapshotPayload;
	try {
		snapshot = composeMonashSmstSourceSnapshot(
			baseState,
			parsed.payload,
			monash,
		);
	} catch {
		return generationFailure(
			"base source snapshot does not match verified migration authority.",
		);
	}
	const published = await writeSourceSnapshot(deps, snapshot);
	if (!published.ok) {
		return {
			ok: false,
			code:
				published.code === "retention_collision"
					? "retention_collision"
					: published.code === "store_record_corrupt"
						? "migration_generation_corrupt"
					: published.code === "store_lock_contended"
						? "store_lock_contended"
						: "store_flush_failed",
			message: published.message,
		};
	}
	const committed = await readDurableFile(
		deps.fs,
		sourceSnapshotPath(deps.paths, snapshot.snapshot_id),
	);
	if (committed.status !== "present") {
		return generationFailure(
			"composite source snapshot is missing after publication.",
		);
	}
	const parsedCommitted = parseDurableRecord(
		committed.raw,
		"source-snapshot",
	);
	if (
		!parsedCommitted.ok ||
		JSON.stringify(parsedCommitted.payload) !== JSON.stringify(snapshot)
	) {
		return generationFailure(
			"composite source snapshot differs after publication.",
		);
	}
	return { ok: true, snapshot };
}

/**
 * Import one complete legacy corpus into a verified inactive generation.
 *
 * Inventory, disposition planning, byte-faithful staging, verification,
 * composition, and candidate adoption execute as one call. Activation remains
 * a separate operator authority transaction.
 */
export async function importBrowserUseCorpus(
	deps: RetentionDeps,
	sourceRoot: string,
): Promise<BrowserUseCorpusImportResult> {
	if (!isAbsolute(sourceRoot)) {
		return {
			ok: false,
			code: "migration_source_invalid",
			message: "migration source must be an absolute path.",
		};
	}

	const inventoried = await inventoryBrowserUseMigration(deps, sourceRoot);
	if (!inventoried.ok) return inventoried;
	const planned = await planBrowserUseMigration(deps, sourceRoot);
	if (!planned.ok) return planned;
	const applied = await applyBrowserUseMigration(deps, sourceRoot);
	if (!applied.ok) return applied;
	const verified = await verifyBrowserUseMigration(deps, sourceRoot);
	if (!verified.ok) return verified;

	const snapshotId = verified.state.snapshot_id;
	const snapshotDigest = verified.state.snapshot_digest;
	if (snapshotId === null || snapshotDigest === null) {
		return generationFailure(
			"verified migration did not retain one exact source snapshot.",
		);
	}

	try {
		const catalogDigest = await shippedCatalogDigest(
			shippedRunbooksRoot(),
			deps.fs,
		);
		const generationId = `corpus-${snapshotId}`;
		const composition = await composeBrowserUseCorpusMigration(
			{ fs: deps.fs },
			{
				state: verified.state,
				sourceRoot,
				generationId,
				shippedCatalogDigest: catalogDigest,
			},
		);
		const monash = censusBundledMonashSmstCorpus();
		if (!monash.ok) {
			return generationFailure(
				"bundled Monash SMST corpus failed integrity validation.",
			);
		}
		const compositeSnapshot = await publishCompositeSourceSnapshot(
			deps,
			verified.state,
			monash.census,
		);
		if (!compositeSnapshot.ok) return compositeSnapshot;
		const completeComposition = mergeMonashSmstCensusIntoCorpus(
			composition,
			monash.census,
			compositeSnapshot.snapshot,
		);
		const generation = await buildBrowserUseCorpusGeneration(
			{ fs: deps.fs },
			completeComposition,
		);
		const adopted = await adoptBrowserUseGenerationCandidate(deps, {
			...generation,
			verifiedStateExtension: completeComposition.state,
		});
		if (!adopted.ok) return adopted;

		const activeTargetCount = generation.candidate.canonical_targets.filter(
			(target) => target.activation === "active",
		).length;
		return {
			ok: true,
			state: adopted.state,
			generation: {
				generation_id: generation.candidate.generation_id,
				source_snapshot_id: generation.candidate.source_snapshot.snapshot_id,
				source_snapshot_digest:
					generation.candidate.source_snapshot.snapshot_digest,
				source_entry_count: adopted.state.source_entry_count,
				canonical_target_count:
					generation.candidate.canonical_targets.length,
				active_target_count: activeTargetCount,
				inactive_target_count:
					generation.candidate.canonical_targets.length -
					activeTargetCount,
				auth_candidate_count: generation.candidate.auth.candidates.length,
				auth_route_count: generation.candidate.auth.routes.length,
				file_count: generation.files.length,
				shipped_catalog_digest: catalogDigest,
				verified_noop: adopted.verified_noop,
			},
			activation_state: "unchanged",
			next_action: {
				action_id: "activate_staged_generation",
				generation_id: generation.candidate.generation_id,
			},
		};
	} catch {
		return generationFailure(
			"verified corpus could not be composed into one complete generation.",
		);
	}
}
