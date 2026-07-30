import { describe, expect, test } from "bun:test";
import {
	buildBrowserUseCorpusGeneration,
	type BrowserUseCorpusGenerationActionInput,
} from "./browser-use-corpus-generation-builder";
import {
	composeBrowserUseCorpusMigration,
	type BrowserUseCorpusMigrationCompositionInput,
} from "./browser-use-corpus-migration-composition";
import type { BrowserUseMigrationState } from "./browser-use-migration-model";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import {
	actionAssetDigest,
	ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
} from "./browser-use-runbook-actions";

const canonicalTargets = [
	"fasttrack/fill-week",
	"oncore/fill-timesheet",
	"oncore/timesheet-diagnose",
	"xero/extract-bankstatementsplus",
	"xero/post-banktransaction",
	"xero/reconcile-batch",
] as const;

function state(): BrowserUseMigrationState {
	return {
		contract: "browser-use.migration-status",
		schema_version: "2",
		phase: "verified",
		snapshot_id: "snapshot-production",
		snapshot_digest: "a".repeat(64),
		source_root_identity: "b".repeat(64),
		source_entry_count: canonicalTargets.length,
		disposition_count: canonicalTargets.length,
		dispositions: canonicalTargets.map((canonicalTargetId, index) => ({
			source_relative_path: `definitions/${canonicalTargetId}.json`,
			source_content_hash: `${index + 1}`.repeat(64),
			artifact_class: "formal-playbook",
			formal_flow_id: canonicalTargetId,
			canonical_target_id: canonicalTargetId,
			disposition: "provenance-only",
			reason: "definition provenance",
			transform_version: "browser-use-corpus-v1",
			logical_destination_id: null,
			expected_hash: null,
		})),
		corpus_census: {
			formal_artifacts: 6,
			target_flows: 6,
			scripts: 0,
			auth_narratives: 0,
			login_capabilities: 0,
			domain_script_actions: 0,
		},
		canonical_targets: canonicalTargets.map((canonical_target_id) => ({
			canonical_target_id,
			source_relative_paths: [`definitions/${canonical_target_id}.json`],
		})),
		staged_generation: "legacy-staged",
		last_apply_verified_noop: false,
		activation_state: "unchanged",
	};
}

function emptyFs(): BrowserUsePlatformFs {
	return {
		async lstat() {
			return undefined;
		},
		async realpath(path) {
			return path;
		},
		async readTextFile() {
			throw new Error("missing");
		},
		async hashFile() {
			throw new Error("missing");
		},
		async readDirectory() {
			return [];
		},
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

function input(): BrowserUseCorpusMigrationCompositionInput {
	return {
		state: state(),
		sourceRoot: "/legacy",
		generationId: "corpus-production",
		shippedCatalogDigest: "c".repeat(64),
		actions: [],
		authCandidates: [],
		authRoutes: [],
	};
}

describe("composeBrowserUseCorpusMigration", () => {
	test("migrates Monash login sources into proposed auth candidates", async () => {
		const compositionInput = input();
		compositionInput.authCandidates = undefined;
		compositionInput.state.dispositions = [
			...compositionInput.state.dispositions,
			{
				source_relative_path:
					"domains/monash-edu/runbook-okta-login.md",
				source_content_hash: "f".repeat(64),
				artifact_class: "auth-narrative",
				formal_flow_id: null,
				canonical_target_id: null,
				disposition: "provenance-only",
				reason: "authentication candidate provenance",
				transform_version: "browser-use-corpus-v1",
				logical_destination_id: null,
				expected_hash: null,
			},
		];

		const composed = await composeBrowserUseCorpusMigration(
			{ fs: emptyFs() },
			compositionInput,
		);

		expect(composed.authCandidates).toEqual([
			expect.objectContaining({
				candidate_id: "auth-candidate-monash-okta",
				service_id: "monash-okta",
				auth_context: "interactive-login",
				proposed_origins: ["https://monashuni.okta.com"],
				hint_item_id: null,
				legacy_vault_name: null,
			}),
		]);
		expect(composed.authRoutes).toEqual([]);
	});

	test("preserves every known definition but defaults the exact catalog inactive", async () => {
		const first = await composeBrowserUseCorpusMigration(
			{ fs: emptyFs() },
			input(),
		);
		const second = await composeBrowserUseCorpusMigration(
			{ fs: emptyFs() },
			input(),
		);

		expect(second).toEqual(first);
		expect(first.targets.map((target) => target.canonicalTargetId)).toEqual([
			...canonicalTargets,
		]);
		expect(first.targets.every((target) => target.activation === "inactive")).toBe(
			true,
		);
		expect(
			first.targets
				.filter((target) => target.canonicalTargetId.startsWith("xero/"))
				.every((target) => target.runbook.service_id === "xero"),
		).toBe(true);
		const diagnosis = first.targets.find(
			(target) => target.canonicalTargetId === "oncore/timesheet-diagnose",
		);
		expect(JSON.stringify(diagnosis?.proofs[0]?.payload)).toContain(
			actionAssetDigest(ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES),
		);
		expect(first.actions.map((action) => action.record.action_id)).toEqual([
			"xero-capture-bankstatements",
			"xero-request-bankstatements",
		]);
		expect(
			first.actions.every(
				(action) =>
					action.record.promotion_receipt.disposition === "invalidated",
			),
		).toBe(true);
		expect(first.authRoutes).toEqual([]);
	});

	test("activates diagnosis only from an exact approved action and caller auth route", async () => {
		const compositionInput = input();
		const digest = actionAssetDigest(ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES);
		const exactAction: BrowserUseCorpusGenerationActionInput = {
			assetBytes: ONCORE_TIMESHEET_DIAGNOSIS_ACTION_BYTES,
			record: {
				action_id: "oncore-diagnose-timesheet",
				asset_id: digest,
				expected_digest: digest,
				allowed_origin: "https://iteraterecruitment.oncoreservices.com",
				effect_class: "read",
				containment: "read-only-observation",
				input_schema: {
					kind: "object",
					fields: {
						timesheet_id: {
							required: true,
							schema: {
								kind: "string",
								max_length: 128,
								pattern: "^[A-Za-z0-9._:-]+$",
							},
						},
					},
				},
				result_schema: {
					kind: "object",
					fields: {
						timesheet_match: {
							required: true,
							schema: { kind: "boolean" },
						},
						row_count: { required: true, schema: { kind: "number" } },
						state: {
							required: true,
							schema: {
								kind: "enum",
								values: ["approved", "submitted", "editable", "read-only"],
							},
						},
						submit_available: {
							required: true,
							schema: { kind: "boolean" },
						},
					},
				},
				result_sensitivity: "low",
				source_provenance:
					"domains/iteraterecruitment-oncoreservices/domain-script-actions/diagnose-grid-state.js",
				promotion_receipt: {
					approved_digest: digest,
					disposition: "approved",
					approved_origin:
						"https://iteraterecruitment.oncoreservices.com",
					approved_effect: "read",
					approver_ref: "operator-review",
				},
			},
		};
		compositionInput.actions = [exactAction];
		compositionInput.authCandidates = [
			{
				candidate_id: "auth-candidate-oncore",
				auth_context: "interactive-login",
				service_id: "oncore",
				legacy_context_prose: "delegated login shape",
				hint_item_id: null,
				proposed_origins: [
					"https://iteraterecruitment.oncoreservices.com",
				],
				legacy_vault_name: null,
				provenance: "legacy-auth-pointer",
			},
		];
		compositionInput.authRoutes = [
			{
				authContextRef: "oncore-session",
				candidateId: "auth-candidate-oncore",
			},
		];

		const composed = await composeBrowserUseCorpusMigration(
			{ fs: emptyFs() },
			compositionInput,
		);

		expect(
			composed.targets.find(
				(target) =>
					target.canonicalTargetId === "oncore/timesheet-diagnose",
			)?.activation,
		).toBe("active");
		expect(
			composed.targets
				.filter(
					(target) =>
						target.canonicalTargetId !== "oncore/timesheet-diagnose",
				)
				.every((target) => target.activation === "inactive"),
		).toBe(true);
		expect(composed.actions.map((action) => action.record.action_id)).toEqual([
			"oncore-diagnose-timesheet",
			"xero-capture-bankstatements",
			"xero-request-bankstatements",
		]);
		expect(composed.actions[0]).toEqual(exactAction);
		await expect(
			buildBrowserUseCorpusGeneration({ fs: emptyFs() }, composed),
		).resolves.toMatchObject({
			candidate: {
				canonical_targets: expect.arrayContaining([
					expect.objectContaining({
						canonical_target_id: "oncore/timesheet-diagnose",
						activation: "active",
					}),
				]),
			},
		});
	});

	test("keeps Oncore fill inactive when auth exists because its proven split cadence is not representable", async () => {
		const compositionInput = input();
		compositionInput.authCandidates = [
			{
				candidate_id: "auth-candidate-oncore",
				auth_context: "interactive-login",
				service_id: "oncore",
				legacy_context_prose: "delegated login shape",
				hint_item_id: null,
				proposed_origins: [
					"https://iteraterecruitment.oncoreservices.com",
				],
				legacy_vault_name: null,
				provenance: "legacy-auth-pointer",
			},
		];
		compositionInput.authRoutes = [
			{
				authContextRef: "oncore-session",
				candidateId: "auth-candidate-oncore",
			},
		];

		const composed = await composeBrowserUseCorpusMigration(
			{ fs: emptyFs() },
			compositionInput,
		);
		const fill = composed.targets.find(
			(target) => target.canonicalTargetId === "oncore/fill-timesheet",
		);

		expect(fill?.activation).toBe("inactive");
		expect(fill?.inactiveReason).toContain(
			"open-entry, wait, fill-entry, wait",
		);
		expect(fill?.runbook.steps).toEqual([
			{ kind: "snapshot", interactive: false },
		]);
	});
});
