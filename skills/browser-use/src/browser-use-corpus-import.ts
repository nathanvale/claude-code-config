import { isAbsolute } from "node:path";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import {
	buildBrowserUseCorpusGeneration,
} from "./browser-use-corpus-generation-builder";
import {
	composeBrowserUseCorpusMigration,
} from "./browser-use-corpus-migration-composition";
import type {
	BrowserUseMigrationFailure,
	BrowserUseMigrationState,
} from "./browser-use-migration-model";
import {
	adoptBrowserUseGenerationCandidate,
	applyBrowserUseMigration,
	inventoryBrowserUseMigration,
	planBrowserUseMigration,
	verifyBrowserUseMigration,
} from "./browser-use-migration";
import { shippedRunbooksRoot } from "./browser-use-runbook";
import type { RetentionDeps } from "./browser-use-retention";

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

function generationFailure(message: string): BrowserUseMigrationFailure {
	return {
		ok: false,
		code: "migration_generation_corrupt",
		message,
	};
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
		const generation = await buildBrowserUseCorpusGeneration(
			{ fs: deps.fs },
			composition,
		);
		const adopted = await adoptBrowserUseGenerationCandidate(deps, generation);
		if (!adopted.ok) return adopted;

		const activeTargetCount = generation.candidate.canonical_targets.filter(
			(target) => target.activation === "active",
		).length;
		return {
			ok: true,
			state: adopted.state,
			generation: {
				generation_id: generation.candidate.generation_id,
				source_snapshot_id: snapshotId,
				source_snapshot_digest: snapshotDigest,
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
