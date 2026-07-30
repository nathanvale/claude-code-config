import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	readdirSync,
	readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shippedCatalogDigest } from "./browser-use-catalog-digest";
import { buildBrowserUseCorpusGeneration } from "./browser-use-corpus-generation-builder";
import { importBrowserUseCorpus } from "./browser-use-corpus-import";
import { composeBrowserUseCorpusMigration } from "./browser-use-corpus-migration-composition";
import { censusBundledMonashSmstCorpus } from "./browser-use-monash-smst-census";
import {
	composeMonashSmstSourceSnapshot,
	mergeMonashSmstCensusIntoCorpus,
} from "./browser-use-monash-smst-integration";
import { runForTest } from "./browser-use";
import {
	adoptBrowserUseGenerationCandidate,
	activateBrowserUseMigration,
	applyBrowserUseMigration,
	CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
	inventoryBrowserUseMigration,
	planBrowserUseMigration,
	verifyBrowserUseMigration,
} from "./browser-use-migration";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import {
	sourceSnapshotPath,
	writeSourceSnapshot,
} from "./browser-use-retention";
import { shippedRunbooksRoot } from "./browser-use-runbook";
import {
	encodeDurableRecord,
	parseDurableRecord,
} from "./browser-use-schemas";
import {
	readDurableFile,
	writeDurableFile,
} from "./browser-use-store";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

const disposables: Array<{ dispose(): void }> = [];
const fixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"full-root-corpus",
);

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function sourceBytes(root: string): readonly (readonly [string, string])[] {
	const rows: Array<readonly [string, string]> = [];
	const walk = (directory: string, prefix: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
			(left, right) => left.name.localeCompare(right.name),
		)) {
			const path = join(directory, entry.name);
			const relativePath =
				prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(path, relativePath);
			} else {
				rows.push([
					relativePath,
					createHash("sha256").update(readFileSync(path)).digest("hex"),
				]);
			}
		}
	};
	walk(root, "");
	return rows;
}

describe("importBrowserUseCorpus", () => {
	test("public import, activate, and run reach every migrated target", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		const imported = await runForTest(
			["migration", "import", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(imported.exitCode).toBe(0);
		const importData = parseJson(imported.stdout).data as {
			contract: string;
			generation_id: string;
			source_entry_count: number;
			canonical_target_count: number;
			auth_candidate_count: number;
			auth_route_count: number;
		};
		expect(importData).toMatchObject({
			contract: "browser-use.corpus-import",
			source_entry_count: 31,
			canonical_target_count: 20,
			auth_candidate_count: 0,
			auth_route_count: 0,
		});
		expect(importData.generation_id).toMatch(/^corpus-snapshot-/);
		const status = parseJson(
			(
				await runForTest(["migration", "status", "--json"], runtime)
			).stdout,
		).data as {
			canonical_targets: Array<{ canonical_target_id: string }>;
		};

		const activated = await runForTest(
			[
				"migration",
				"activate",
				"--generation",
				importData.generation_id,
				"--json",
			],
			runtime,
		);
		expect(activated.exitCode).toBe(0);

		for (const target of status.canonical_targets) {
			const [service, flow] = target.canonical_target_id.split("/");
			const run = await runForTest(
				["runbook", "run", "--service", service, "--flow", flow, "--json"],
				runtime,
			);
			expect(run.exitCode).toBe(20);
			expect(parseJson(run.stdout).error).toMatchObject({
				code: "runbook_inactive",
			});
		}
	});

	test("imports a real-shaped corpus end to end, preserves source bytes, and converges on rerun", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const deps = {
			fs,
			paths: opened.paths,
			clock: () => 1_774_848_000_000,
		};
		const before = sourceBytes(fixtureRoot);
		const monash = censusBundledMonashSmstCorpus();
		expect(monash.ok).toBe(true);
		if (!monash.ok) throw new Error(monash.code);

		const first = await importBrowserUseCorpus(deps, fixtureRoot);
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error(first.code);
		expect(first.state.phase).toBe("verified");
		expect(first.state.activation_state).toBe("unchanged");
		expect(first.generation).toMatchObject({
			source_entry_count: before.length + monash.census.source_artifact_count,
			canonical_target_count: first.state.canonical_targets.length,
			active_target_count: 0,
			inactive_target_count: first.state.canonical_targets.length,
			auth_candidate_count: 0,
			auth_route_count: 0,
			verified_noop: false,
		});
		expect(first.generation.canonical_target_count).toBe(20);
		expect(first.generation.file_count).toBeGreaterThan(
			first.generation.canonical_target_count,
		);
		expect(first.generation.shipped_catalog_digest).toMatch(/^[0-9a-f]{64}$/);
		expect(first.next_action).toEqual({
			action_id: "activate_staged_generation",
			generation_id: first.generation.generation_id,
		});
		const snapshot = await readDurableFile(
			fs,
			sourceSnapshotPath(
				opened.paths,
				first.generation.source_snapshot_id,
			),
		);
		expect(snapshot.status).toBe("present");
		if (snapshot.status !== "present") throw new Error("snapshot missing");
		const parsedSnapshot = parseDurableRecord(
			snapshot.raw,
			"source-snapshot",
		);
		expect(parsedSnapshot.ok).toBe(true);
		if (!parsedSnapshot.ok) throw new Error(parsedSnapshot.message);
		expect(
			createHash("sha256")
				.update(JSON.stringify(parsedSnapshot.payload.entries))
				.digest("hex"),
		).toBe(first.generation.source_snapshot_digest);
		expect(parsedSnapshot.payload.entries).toHaveLength(
			before.length + monash.census.source_artifact_count,
		);
		const receiptHashes = new Map(
			monash.census.source_dispositions.map((source) => [
				`monash-smst/${source.source_relative_path}`,
				source.source_content_hash,
			]),
		);
		const monashEntries = parsedSnapshot.payload.entries.filter((entry) =>
			entry.relative_path.startsWith("monash-smst/"),
		);
		expect(monashEntries).toHaveLength(
			monash.census.source_artifact_count,
		);
		expect(
			monashEntries.every(
				(entry) =>
					entry.size === 0 &&
					entry.mode === 0 &&
					receiptHashes.get(entry.relative_path) === entry.content_hash,
			),
		).toBe(true);
		expect(sourceBytes(fixtureRoot)).toEqual(before);

		const second = await importBrowserUseCorpus(deps, fixtureRoot);
		expect(second.ok).toBe(true);
		if (!second.ok) throw new Error(second.code);
		expect(second.generation.generation_id).toBe(
			first.generation.generation_id,
		);
		expect(second.generation.source_snapshot_digest).toBe(
			first.generation.source_snapshot_digest,
		);
		expect(second.generation.verified_noop).toBe(true);
		expect(second.state.activation_state).toBe("unchanged");
		expect(sourceBytes(fixtureRoot)).toEqual(before);

		expect(
			(await activateBrowserUseMigration(deps, {})).ok,
		).toBe(true);
		const afterActivation = await importBrowserUseCorpus(
			deps,
			fixtureRoot,
		);
		expect(afterActivation.ok).toBe(true);
		if (!afterActivation.ok) throw new Error(afterActivation.code);
		expect(afterActivation.generation.generation_id).toBe(
			first.generation.generation_id,
		);
		expect(afterActivation.generation.verified_noop).toBe(true);
		expect(afterActivation.state.activation_state).toBe("active");
	});

	test("refuses append-only state extensions that change base authority", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const deps = {
			fs,
			paths: opened.paths,
			clock: () => 1_774_848_000_000,
		};
		for (const result of [
			await inventoryBrowserUseMigration(deps, fixtureRoot),
			await planBrowserUseMigration(deps, fixtureRoot),
			await applyBrowserUseMigration(deps, fixtureRoot),
		]) {
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.message);
		}
		const verified = await verifyBrowserUseMigration(deps, fixtureRoot);
		expect(verified.ok).toBe(true);
		if (!verified.ok) throw new Error(verified.message);
		const base = verified.state;
		const census = censusBundledMonashSmstCorpus();
		expect(census.ok).toBe(true);
		if (!census.ok) throw new Error(census.message);
		if (base.snapshot_id === null) {
			throw new Error("verified fixture lacks snapshot identity");
		}
		const baseSnapshotRead = await readDurableFile(
			fs,
			sourceSnapshotPath(opened.paths, base.snapshot_id),
		);
		if (baseSnapshotRead.status !== "present") {
			throw new Error("verified base snapshot missing");
		}
		const baseSnapshot = parseDurableRecord(
			baseSnapshotRead.raw,
			"source-snapshot",
		);
		if (!baseSnapshot.ok) throw new Error(baseSnapshot.message);
		const compositeSnapshot = composeMonashSmstSourceSnapshot(
			base,
			baseSnapshot.payload,
			census.census,
		);
		expect(
			(await writeSourceSnapshot(deps, compositeSnapshot)).ok,
		).toBe(true);
		const composition = await composeBrowserUseCorpusMigration(
			{ fs },
			{
				state: base,
				sourceRoot: fixtureRoot,
				generationId: "corpus-extension-refusal",
				shippedCatalogDigest: await shippedCatalogDigest(
					shippedRunbooksRoot(),
					fs,
				),
			},
		);
		const complete = mergeMonashSmstCensusIntoCorpus(
			composition,
			census.census,
			compositeSnapshot,
		);
		const generation = await buildBrowserUseCorpusGeneration(
			{ fs },
			complete,
		);
		const baseTarget = base.canonical_targets[0];
		const baseCensus = base.corpus_census;
		const completeCensus = complete.state.corpus_census;
		if (
			baseTarget === undefined ||
			baseCensus === null ||
			completeCensus === null
		) {
			throw new Error("verified fixture lacks base authority");
		}
		const changedDisposition: BrowserUseMigrationState = {
			...complete.state,
			dispositions: complete.state.dispositions.map((row) =>
				row.source_relative_path === base.dispositions[0]?.source_relative_path
					? { ...row, reason: "changed base authority" }
					: row,
			),
		};
		const changedAppendedDisposition: BrowserUseMigrationState = {
			...complete.state,
			dispositions: complete.state.dispositions.map((row) =>
				row.source_relative_path.startsWith("monash-smst/")
					? { ...row, source_content_hash: "0".repeat(64) }
					: row,
			),
		};
		const removedTarget: BrowserUseMigrationState = {
			...complete.state,
			canonical_targets: complete.state.canonical_targets.filter(
				(target) =>
					target.canonical_target_id !==
					baseTarget.canonical_target_id,
			),
		};
		const reducedCensus: BrowserUseMigrationState = {
			...complete.state,
			corpus_census: {
				...completeCensus,
				formal_artifacts: baseCensus.formal_artifacts - 1,
			},
		};
		const changedActivation: BrowserUseMigrationState = {
			...complete.state,
			activation_state: "active",
		};
		const changedStagedGeneration: BrowserUseMigrationState = {
			...complete.state,
			staged_generation: "changed-base-generation",
		};
		const changedDestinationFields: BrowserUseMigrationState = {
			...complete.state,
			dispositions: complete.state.dispositions.map((row) =>
				row.source_relative_path.startsWith("monash-smst/")
					? {
							...row,
							logical_destination_id: "forged-destination",
							expected_hash: "1".repeat(64),
						}
					: row,
			),
		};
		const duplicatedProvenance: BrowserUseMigrationState = {
			...complete.state,
			target_provenance: [
				...(complete.state.target_provenance ?? []),
				complete.state.target_provenance?.[0] as NonNullable<
					BrowserUseMigrationState["target_provenance"]
				>[number],
			],
		};
		const appendedProvenance = (
			complete.state.target_provenance ?? []
		).find((row) =>
			row.source_relative_path.startsWith("monash-smst/"),
		);
		const wrongTarget = complete.state.canonical_targets.find(
			(target) =>
				target.canonical_target_id !==
					appendedProvenance?.canonical_target_id &&
				!target.source_relative_paths.includes(
					appendedProvenance?.source_relative_path ?? "",
				),
		);
		if (
			appendedProvenance === undefined ||
			wrongTarget === undefined
		) {
			throw new Error("combined fixture lacks adversarial provenance");
		}
		const misboundProvenance: BrowserUseMigrationState = {
			...complete.state,
			target_provenance: (
				complete.state.target_provenance ?? []
			).map((row) =>
				row === appendedProvenance
					? {
							...row,
							canonical_target_id:
								wrongTarget.canonical_target_id,
						}
					: row,
			),
		};
		const baseTargetIds = new Set(
			base.canonical_targets.map(
				(target) => target.canonical_target_id,
			),
		);
		const uncoveredProvenance = (
			complete.state.target_provenance ?? []
		).find(
			(row) =>
				row.canonical_target_id !== null &&
				!baseTargetIds.has(row.canonical_target_id),
		);
		if (uncoveredProvenance === undefined) {
			throw new Error("combined fixture lacks appended target provenance");
		}
		const uncoveredTarget: BrowserUseMigrationState = {
			...complete.state,
			target_provenance: (
				complete.state.target_provenance ?? []
			).filter((row) => row !== uncoveredProvenance),
			corpus_census: {
				...completeCensus,
				target_flows: completeCensus.target_flows - 1,
			},
		};
		const inflatedCensus: BrowserUseMigrationState = {
			...complete.state,
			corpus_census: {
				...completeCensus,
				formal_artifacts: completeCensus.formal_artifacts + 1,
			},
		};
		const changedSnapshotDigest = "f".repeat(64);
		const changedSnapshotIdentity: BrowserUseMigrationState = {
			...complete.state,
			snapshot_id: `snapshot-${changedSnapshotDigest.slice(0, 16)}`,
			snapshot_digest: changedSnapshotDigest,
			source_root_identity: "e".repeat(64),
		};

		for (const extension of [
			changedDisposition,
			changedAppendedDisposition,
			removedTarget,
			reducedCensus,
			changedActivation,
			changedStagedGeneration,
			changedDestinationFields,
			duplicatedProvenance,
			inflatedCensus,
			changedSnapshotIdentity,
		]) {
			expect(
				await adoptBrowserUseGenerationCandidate(deps, {
					...generation,
					verifiedStateExtension: extension,
				}),
			).toMatchObject({
				ok: false,
				code: "migration_manifest_incomplete",
			});
		}

		for (const [index, extension] of [
			misboundProvenance,
			uncoveredTarget,
			inflatedCensus,
		].entries()) {
			const selfConsistentGeneration =
				await buildBrowserUseCorpusGeneration(
					{ fs },
					{
						...complete,
						state: extension,
						generationId: `corpus-extension-semantic-refusal-${index}`,
					},
				);
			expect(
				await adoptBrowserUseGenerationCandidate(deps, {
					...selfConsistentGeneration,
					verifiedStateExtension: extension,
				}),
			).toMatchObject({
				ok: false,
				code: "migration_manifest_incomplete",
			});
		}

		const baseEntryIndex = compositeSnapshot.entries.findIndex(
			(entry) => !entry.relative_path.startsWith("monash-smst/"),
		);
		if (baseEntryIndex < 0) throw new Error("base entry missing");
		const changedEntries = compositeSnapshot.entries.map((entry, index) =>
			index === baseEntryIndex
				? { ...entry, size: entry.size + 1 }
				: entry,
		);
		const changedEntriesDigest = createHash("sha256")
			.update(JSON.stringify(changedEntries))
			.digest("hex");
		const changedMetadataSnapshot = {
			...compositeSnapshot,
			snapshot_id: `snapshot-${changedEntriesDigest.slice(0, 16)}`,
			snapshot_digest: changedEntriesDigest,
			entries: changedEntries,
		};
		expect(
			(await writeSourceSnapshot(deps, changedMetadataSnapshot)).ok,
		).toBe(true);
		const changedMetadataComplete = mergeMonashSmstCensusIntoCorpus(
			{
				...composition,
				generationId: "corpus-extension-base-metadata-refusal",
			},
			census.census,
			changedMetadataSnapshot,
		);
		const changedMetadataGeneration =
			await buildBrowserUseCorpusGeneration(
				{ fs },
				changedMetadataComplete,
			);
		expect(
			await adoptBrowserUseGenerationCandidate(deps, {
				...changedMetadataGeneration,
				verifiedStateExtension: changedMetadataComplete.state,
			}),
		).toMatchObject({
			ok: false,
			code: "migration_manifest_incomplete",
		});

		const mismatchedCandidate = {
			...generation.candidate,
			proofs: [...generation.candidate.proofs].reverse(),
		};
		const mismatchedFiles = generation.files.map((file) =>
			file.relPath === CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH
				? {
						relPath: file.relPath,
						contents: encodeDurableRecord(
							"corpus-generation-candidate",
							mismatchedCandidate,
						),
					}
				: file,
		);
		expect(
			await adoptBrowserUseGenerationCandidate(deps, {
				candidate: generation.candidate,
				files: mismatchedFiles,
				verifiedStateExtension: complete.state,
			}),
		).toMatchObject({
			ok: false,
			code: "migration_generation_corrupt",
		});
	});

	test("refuses a same-digest composite snapshot with different retained entries", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const deps = {
			fs,
			paths: opened.paths,
			clock: () => 1_774_848_000_000,
		};
		for (const result of [
			await inventoryBrowserUseMigration(deps, fixtureRoot),
			await planBrowserUseMigration(deps, fixtureRoot),
			await applyBrowserUseMigration(deps, fixtureRoot),
		]) {
			if (!result.ok) throw new Error(result.message);
		}
		const verified = await verifyBrowserUseMigration(deps, fixtureRoot);
		if (!verified.ok || verified.state.snapshot_id === null) {
			throw new Error("verified fixture lacks source snapshot");
		}
		const baseRead = await readDurableFile(
			fs,
			sourceSnapshotPath(
				opened.paths,
				verified.state.snapshot_id,
			),
		);
		if (baseRead.status !== "present") {
			throw new Error("verified base snapshot missing");
		}
		const baseSnapshot = parseDurableRecord(
			baseRead.raw,
			"source-snapshot",
		);
		if (!baseSnapshot.ok) throw new Error(baseSnapshot.message);
		const census = censusBundledMonashSmstCorpus();
		if (!census.ok) throw new Error(census.message);
		const expected = composeMonashSmstSourceSnapshot(
			verified.state,
			baseSnapshot.payload,
			census.census,
		);
		const firstEntry = expected.entries[0];
		if (firstEntry === undefined) throw new Error("composite snapshot empty");
		const forged = {
			...expected,
			entries: [
				{ ...firstEntry, size: firstEntry.size + 1 },
				...expected.entries.slice(1),
			],
		};
		const seeded = await writeDurableFile(fs, {
			path: sourceSnapshotPath(
				opened.paths,
				expected.snapshot_id,
			),
			contents: encodeDurableRecord("source-snapshot", forged),
		});
		expect(seeded.ok).toBe(true);

		expect(await importBrowserUseCorpus(deps, fixtureRoot)).toMatchObject({
			ok: false,
			code: "migration_generation_corrupt",
			message: "composite source snapshot differs after publication.",
		});
	});

	test("classifies an unreadable retained composite snapshot as corrupt evidence", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const deps = {
			fs,
			paths: opened.paths,
			clock: () => 1_774_848_000_000,
		};
		for (const result of [
			await inventoryBrowserUseMigration(deps, fixtureRoot),
			await planBrowserUseMigration(deps, fixtureRoot),
			await applyBrowserUseMigration(deps, fixtureRoot),
		]) {
			if (!result.ok) throw new Error(result.message);
		}
		const verified = await verifyBrowserUseMigration(deps, fixtureRoot);
		if (!verified.ok || verified.state.snapshot_id === null) {
			throw new Error("verified fixture lacks source snapshot");
		}
		const baseRead = await readDurableFile(
			fs,
			sourceSnapshotPath(
				opened.paths,
				verified.state.snapshot_id,
			),
		);
		if (baseRead.status !== "present") {
			throw new Error("verified base snapshot missing");
		}
		const baseSnapshot = parseDurableRecord(
			baseRead.raw,
			"source-snapshot",
		);
		if (!baseSnapshot.ok) throw new Error(baseSnapshot.message);
		const census = censusBundledMonashSmstCorpus();
		if (!census.ok) throw new Error(census.message);
		const expected = composeMonashSmstSourceSnapshot(
			verified.state,
			baseSnapshot.payload,
			census.census,
		);
		await fs.writeFileDurable(
			sourceSnapshotPath(opened.paths, expected.snapshot_id),
			"not a durable record\n",
			0o600,
		);

		expect(await importBrowserUseCorpus(deps, fixtureRoot)).toMatchObject({
			ok: false,
			code: "migration_generation_corrupt",
		});
	});

	test("refuses a relative source before touching migration state", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);

		const result = await importBrowserUseCorpus(
			{ fs, paths: opened.paths, clock: () => 1_774_848_000_000 },
			"legacy/browser-automation",
		);

		expect(result).toEqual({
			ok: false,
			code: "migration_source_invalid",
			message: "migration source must be an absolute path.",
		});
	});
});
