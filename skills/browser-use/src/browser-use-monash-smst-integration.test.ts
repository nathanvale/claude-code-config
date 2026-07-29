import { afterAll, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildBrowserUseCorpusGeneration,
	type BrowserUseCorpusGenerationBuildInput,
} from "./browser-use-corpus-generation-builder";
import { importBrowserUseCorpus } from "./browser-use-corpus-import";
import { composeBrowserUseCorpusMigration } from "./browser-use-corpus-migration-composition";
import { censusBundledMonashSmstCorpus } from "./browser-use-monash-smst-census";
import { mergeMonashSmstCensusIntoCorpus } from "./browser-use-monash-smst-integration";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
	type BrowserUsePlatformFs,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import { findRedactionViolations } from "./browser-use-schemas";

const disposables: Array<{ dispose(): void }> = [];
const fixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"full-root-corpus",
);
const BASE_TARGETS = [
	"fasttrack/fill-week",
	"oncore/fill-timesheet",
	"xero/extract-bankstatementsplus",
	"xero/post-banktransaction",
	"xero/reconcile-batch",
] as const;

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function inactiveRunbook(
	canonicalTargetId: string,
	summary?: string,
): BrowserUseRunbook {
	const [serviceId, flowId] = canonicalTargetId.split("/");
	if (serviceId === undefined || flowId === undefined) {
		throw new Error("fixture target invalid");
	}
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: serviceId,
		flow_id: flowId,
		flow_name: flowId,
		version: "1",
		summary: summary ?? `Preserved ${canonicalTargetId}.`,
		allowed_origins: [`https://${serviceId}.example.test`],
		inputs: [],
		steps: [{ kind: "snapshot", interactive: false }],
	};
}

function baseState(): BrowserUseMigrationState {
	return {
		contract: "browser-use.migration-status",
		schema_version: "2",
		phase: "verified",
		snapshot_id: "snapshot-base",
		snapshot_digest: "a".repeat(64),
		source_root_identity: "b".repeat(64),
		source_entry_count: BASE_TARGETS.length,
		disposition_count: BASE_TARGETS.length,
		dispositions: BASE_TARGETS.map((canonicalTargetId, index) => ({
			source_relative_path: `definitions/${canonicalTargetId}.json`,
			source_content_hash: `${index + 1}`.repeat(64),
			artifact_class: "formal-playbook",
			formal_flow_id: canonicalTargetId,
			canonical_target_id: canonicalTargetId,
			disposition: "provenance-only",
			reason: "base corpus definition",
			transform_version: "base-v1",
			logical_destination_id: null,
			expected_hash: null,
		})),
		corpus_census: {
			formal_artifacts: 5,
			target_flows: 5,
			scripts: 0,
			auth_narratives: 0,
			login_capabilities: 0,
			domain_script_actions: 0,
		},
		canonical_targets: BASE_TARGETS.map((canonical_target_id) => ({
			canonical_target_id,
			source_relative_paths: [`definitions/${canonical_target_id}.json`],
		})),
		target_provenance: [],
		staged_generation: "base-staged",
		last_apply_verified_noop: false,
		activation_state: "unchanged",
	};
}

function baseInput(): BrowserUseCorpusGenerationBuildInput {
	return {
		state: baseState(),
		sourceRoot: "/captured/browser-automation",
		generationId: "corpus-base",
		shippedCatalogDigest: "c".repeat(64),
		targets: BASE_TARGETS.map((canonicalTargetId) => ({
			canonicalTargetId,
			runbook: inactiveRunbook(
				canonicalTargetId,
				canonicalTargetId === "fasttrack/fill-week"
					? "Existing FastTrack definition remains authoritative."
					: undefined,
			),
			activation: "inactive",
			inactiveReason: "Base target remains inactive.",
			proofs: [
				{
					proofRef: `base-${canonicalTargetId.replaceAll("/", "-")}`,
					payload: { status: "base-definition", redacted: true },
				},
			],
		})),
		actions: [],
		authCandidates: [],
		authRoutes: [],
	};
}

function noExternalSourceFs(): BrowserUsePlatformFs {
	const forbidden = (): never => {
		throw new Error("external source access is forbidden");
	};
	return {
		lstat: async () => forbidden(),
		realpath: async () => forbidden(),
		readTextFile: async () => forbidden(),
		hashFile: async () => forbidden(),
		readDirectory: async () => forbidden(),
		async mkdir() {},
		async chmod() {},
		async writeFileDurable() {},
		async writeFile() {},
		async rename() {},
		async linkFileNoReplace() {},
		async unlink() {},
		async syncDirectory() {},
		async createExclusive() {},
		async copyFileDurable() {},
	};
}

describe("Monash SMST corpus integration", () => {
	test("deduplicates FastTrack and builds one exact 20-target inactive candidate without external source access", async () => {
		const censusResult = censusBundledMonashSmstCorpus();
		expect(censusResult.ok).toBe(true);
		if (!censusResult.ok) throw new Error(censusResult.message);

		const merged = mergeMonashSmstCensusIntoCorpus(
			baseInput(),
			censusResult.census,
		);
		const built = await buildBrowserUseCorpusGeneration(
			{ fs: noExternalSourceFs() },
			merged,
		);

		expect(merged.targets).toHaveLength(20);
		expect(merged.state.source_entry_count).toBe(25);
		expect(merged.state.disposition_count).toBe(25);
		const monashDispositions = merged.state.dispositions.filter((row) =>
			row.source_relative_path.startsWith("monash-smst/"),
		);
		expect(monashDispositions).toHaveLength(20);
		expect(
			merged.state.dispositions.some((row) =>
				row.source_relative_path.startsWith(".claude/"),
			),
		).toBe(false);
		expect(
			merged.state.canonical_targets
				.flatMap((target) => target.source_relative_paths)
				.filter((path) => path.includes(".claude/"))
				.every((path) => path.startsWith("monash-smst/")),
		).toBe(true);
		expect(
			merged.state.target_provenance
				?.filter((row) => row.source_flow_id.startsWith("monash-"))
				.every((row) =>
					row.source_relative_path.startsWith("monash-smst/"),
				),
		).toBe(true);
		expect(
			merged.targets.filter(
				(target) => target.canonicalTargetId === "fasttrack/fill-week",
			),
		).toHaveLength(1);
		expect(
			merged.targets.find(
				(target) => target.canonicalTargetId === "fasttrack/fill-week",
			)?.runbook.summary,
		).toBe("Existing FastTrack definition remains authoritative.");
		expect(
			merged.state.canonical_targets.find(
				(target) => target.canonical_target_id === "fasttrack/fill-week",
			)?.source_relative_paths,
		).toEqual(
			[
				"definitions/fasttrack/fill-week.json",
				...(censusResult.census.candidates
					.find(
						(candidate) =>
							candidate.canonical_target_id === "fasttrack/fill-week",
					)
					?.source_relative_paths.map((path) => `monash-smst/${path}`) ?? []),
			].sort(),
		);
		expect(
			built.candidate.canonical_targets.every(
				(target) =>
					target.activation === "inactive" &&
					typeof target.inactive_reason === "string",
			),
		).toBe(true);
		expect(built.candidate.canonical_targets).toHaveLength(20);
		expect(
			JSON.stringify({ census: censusResult.census, built }).includes(
				"/Users/",
			),
		).toBe(false);
		expect(
			findRedactionViolations(censusResult.census),
		).toEqual([]);
		expect(built.files.every((file) => file.contents !== undefined)).toBe(true);
		expect(
			built.files.flatMap((file) =>
				findRedactionViolations(file.contents ?? ""),
			),
		).toEqual([]);
	});

	test("projects the exact 20-target inactive census through the real corpus importer and production composition", async () => {
		const censusResult = censusBundledMonashSmstCorpus();
		expect(censusResult.ok).toBe(true);
		if (!censusResult.ok) throw new Error(censusResult.message);
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);

		const imported = await importBrowserUseCorpus(
			{
				fs,
				paths: opened.paths,
				clock: () => 1_774_848_000_000,
			},
			fixtureRoot,
		);
		expect(imported.ok).toBe(true);
		if (!imported.ok) throw new Error(imported.code);
		expect(imported.generation.canonical_target_count).toBe(5);

		const productionBase = await composeBrowserUseCorpusMigration(
			{ fs },
			{
				state: imported.state,
				sourceRoot: fixtureRoot,
				generationId: `${imported.generation.generation_id}-u14-proof`,
				shippedCatalogDigest: imported.generation.shipped_catalog_digest,
			},
		);
		const merged = mergeMonashSmstCensusIntoCorpus(
			productionBase,
			censusResult.census,
		);
		const built = await buildBrowserUseCorpusGeneration({ fs }, merged);

		expect(
			built.candidate.canonical_targets.map(
				(target) => target.canonical_target_id,
			),
		).toEqual(
			[...new Set(merged.targets.map((target) => target.canonicalTargetId))].sort(),
		);
		expect(built.candidate.canonical_targets).toHaveLength(20);
		expect(
			built.candidate.canonical_targets.every(
				(target) => target.activation === "inactive",
			),
		).toBe(true);
		expect(
			merged.state.dispositions.filter((row) =>
				row.source_relative_path.startsWith("monash-smst/"),
			),
		).toHaveLength(20);
		expect(
			merged.state.canonical_targets
				.flatMap((target) => target.source_relative_paths)
				.filter((path) => path.includes(".claude/"))
				.every((path) => path.startsWith("monash-smst/")),
		).toBe(true);
	});
});
