import { describe, expect, test } from "bun:test";
import {
	censusBundledMonashSmstCorpus,
	censusMonashSmstCorpus,
} from "./browser-use-monash-smst-census";
import { composeMonashSmstInactiveTargets } from "./browser-use-monash-smst-composition";
import { validateRunbook } from "./browser-use-runbook-model";

const EXPECTED_CANDIDATES = [
	{
		candidate_id: "context7-confluence-create-library",
		canonical_target_id: "context7-confluence/create-library",
		disposition: "import-inactive",
	},
	{
		candidate_id: "fasttrack-export-timesheet-history",
		canonical_target_id: "fasttrack/export-timesheet-history",
		disposition: "import-inactive",
	},
	{
		candidate_id: "fasttrack-fill-submit-timesheet",
		canonical_target_id: "fasttrack/fill-week",
		disposition: "merge-existing-target",
	},
	{
		candidate_id: "fasttrack-inspect-rejected-timesheets",
		canonical_target_id: "fasttrack/inspect-rejected-timesheets",
		disposition: "import-inactive",
	},
	{
		candidate_id: "fasttrack-list-available-timesheets",
		canonical_target_id: "fasttrack/list-available-timesheets",
		disposition: "import-inactive",
	},
	{
		candidate_id: "fasttrack-list-incomplete-timesheets",
		canonical_target_id: "fasttrack/list-incomplete-timesheets",
		disposition: "import-inactive",
	},
	{
		candidate_id: "fasttrack-list-submitted-timesheets",
		canonical_target_id: "fasttrack/list-submitted-timesheets",
		disposition: "import-inactive",
	},
	{
		candidate_id: "monash-ess-audit",
		canonical_target_id: "monash-ess/audit-portal",
		disposition: "import-inactive",
	},
	{
		candidate_id: "monash-identity-audit",
		canonical_target_id: "monash-identity/audit-portal",
		disposition: "import-inactive",
	},
	{
		candidate_id: "monash-mspace-audit",
		canonical_target_id: "monash-mspace/audit-portal",
		disposition: "import-inactive",
	},
	{
		candidate_id: "monash-mydevelopment-audit",
		canonical_target_id: "monash-mydevelopment/audit-portal",
		disposition: "import-inactive",
	},
	{
		candidate_id: "monash-myservices-audit",
		canonical_target_id: "monash-myservices/audit-portal",
		disposition: "import-inactive",
	},
	{
		candidate_id: "monash-staff-portal-audit",
		canonical_target_id: "monash-staff-portal/audit-portal",
		disposition: "import-inactive",
	},
	{
		candidate_id: "monash-zoom-audit",
		canonical_target_id: "monash-zoom/audit-portal",
		disposition: "import-inactive",
	},
	{
		candidate_id: "npm-setup-publishing",
		canonical_target_id: "npm/setup-publishing",
		disposition: "import-inactive",
	},
	{
		candidate_id: "zoom-extract-transcript",
		canonical_target_id: "zoom/extract-transcript",
		disposition: "import-inactive",
	},
] as const;

describe("Monash SMST workflow census", () => {
	test("AE16 names exactly 16 candidates and gives every candidate one explicit disposition", () => {
		const result = censusBundledMonashSmstCorpus();

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.census.candidate_count).toBe(16);
		expect(
			result.census.candidates.map(
				({ candidate_id, canonical_target_id, disposition }) => ({
					candidate_id,
					canonical_target_id,
					disposition,
				}),
			),
		).toEqual([...EXPECTED_CANDIDATES]);
		expect(result.census.category_counts).toEqual({
			"context7-confluence": 1,
			"fasttrack-timesheet": 6,
			"monash-portal-audit": 7,
			"npm-publishing": 1,
			"zoom-transcript": 1,
		});
	});

	test("binds the selected dirty-worktree source closure and dispositions every source artifact", () => {
		const result = censusBundledMonashSmstCorpus();

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);
		expect(result.census).toMatchObject({
			source_repository: "monash-smst",
			source_revision: "119e4e48a4b980fd5d880d0f2f214e9bd842623a",
			source_worktree_state: "dirty",
			source_artifact_count: 20,
			source_disposition_count: 20,
			source_disposition_counts: {
				"action-candidate": 4,
				"candidate-source": 5,
				"supporting-knowledge": 11,
			},
			discovery_counts: {
				agent: 1,
				playbook: 2,
				"runbook-document": 1,
				script: 4,
				skill: 4,
				supporting: 8,
			},
		});
		expect(
			Object.values(result.census.discovery_counts).every(
				(count) => count > 0,
			),
		).toBe(true);
		expect(
			result.census.source_dispositions.filter(
				(row) => row.tracking_state === "untracked",
			),
		).toEqual([
			expect.objectContaining({
				source_relative_path:
					"docs/runbooks/context7-add-confluence-library.md",
			}),
		]);
	});

	test("reports provenance drift without changing the captured classification", () => {
		const bundled = censusBundledMonashSmstCorpus();
		expect(bundled.ok).toBe(true);
		if (!bundled.ok) throw new Error(bundled.message);
		const drifted = structuredClone(bundled.source_fixture);
		drifted.artifacts[0] = {
			...drifted.artifacts[0],
			source_content_hash: "0".repeat(64),
		};

		const result = censusMonashSmstCorpus(
			bundled.source_receipt,
			drifted,
			bundled.candidate_fixture,
		);

		expect(result).toEqual({
			ok: false,
			code: "monash_smst_source_drift",
			message:
				"Monash SMST source closure differs from the captured receipt; recensus before import.",
		});
		expect(bundled.census.candidate_count).toBe(16);
	});

	test("fails closed without echo for unknown secret fields and secret-shaped prose", () => {
		const bundled = censusBundledMonashSmstCorpus();
		expect(bundled.ok).toBe(true);
		if (!bundled.ok) throw new Error(bundled.message);
		const secret = "op://vault/item/password";

		const hostileReceipt = structuredClone(bundled.source_receipt);
		(hostileReceipt as unknown as Record<string, unknown>).token = secret;
		const hostileSource = structuredClone(bundled.source_fixture);
		(
			hostileSource.artifacts[0] as unknown as Record<string, unknown>
		).password = secret;
		const hostileCandidate = structuredClone(bundled.candidate_fixture);
		(
			hostileCandidate.candidates[0] as unknown as Record<string, unknown>
		).secret = secret;
		const hostileGroup = structuredClone(bundled.candidate_fixture);
		(hostileGroup.source_groups as Record<string, readonly string[]>).extra = [
			hostileGroup.source_groups["fasttrack-timesheet"]?.[0] ?? "missing",
		];
		const hostileProse = {
			...structuredClone(bundled.candidate_fixture),
			candidates: bundled.candidate_fixture.candidates.map(
				(candidate, index) =>
					index === 0
						? { ...candidate, outcome: `Retrieve ${secret}.` }
						: candidate,
			),
		};

		const results = [
			censusMonashSmstCorpus(
				hostileReceipt,
				bundled.source_fixture,
				bundled.candidate_fixture,
			),
			censusMonashSmstCorpus(
				bundled.source_receipt,
				hostileSource,
				bundled.candidate_fixture,
			),
			censusMonashSmstCorpus(
				bundled.source_receipt,
				bundled.source_fixture,
				hostileCandidate,
			),
			censusMonashSmstCorpus(
				bundled.source_receipt,
				bundled.source_fixture,
				hostileGroup,
			),
			censusMonashSmstCorpus(
				bundled.source_receipt,
				bundled.source_fixture,
				hostileProse,
			),
		];

		expect(
			results.every(
				(result) =>
					!result.ok &&
					result.code === "monash_smst_receipt_invalid" &&
					!JSON.stringify(result).includes(secret),
			),
		).toBe(true);
	});

	test("composes one valid inactive definition per canonical target with the FastTrack overlap merged", () => {
		const result = censusBundledMonashSmstCorpus();
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.message);

		const targets = composeMonashSmstInactiveTargets(result.census);

		expect(targets).toHaveLength(16);
		expect(new Set(targets.map((target) => target.canonicalTargetId)).size).toBe(
			16,
		);
		expect(
			targets.find(
				(target) => target.canonicalTargetId === "fasttrack/fill-week",
			)?.proofs,
		).toEqual([
			expect.objectContaining({
				payload: expect.objectContaining({
					disposition: "merge-existing-target",
					source_worktree_state: "dirty",
				}),
			}),
		]);
		expect(
			targets.every(
				(target) =>
					target.activation === "inactive" &&
					target.inactiveReason !== null &&
					validateRunbook(target.runbook).length === 0,
			),
		).toBe(true);
	});
});
