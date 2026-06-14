import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	createCliRuntimeSuccessEnvelope,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	AGENT_AUTHORED_STRING_PATHS,
	NARRATED_FIELDS,
	RECEIPT_FIELDS,
	SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
	SKILL_FEEDBACK_CONTRACT_ID,
	SKILL_FEEDBACK_COST_STATUS,
	SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_OUTCOMES,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type HealthResultData,
	type Receipt,
	type ReviewResultData,
	type SkillFeedbackCommand,
	buildSoftwareLearningReport,
	normalizeReport,
	parseCloseoutReceipt,
	parseHealthResultData,
	parsePurgeResultData,
	parseReviewResultData,
	parseReceipt,
	skillFeedbackContracts,
	type SkillFeedbackPurgeResultData,
} from "./command-contract";

const COMPLETE_RECEIPT = {
	skill: "create-skill",
	goal: "Repair the skill authoring route.",
	outcome: "confirmed",
	friction: "The owner path was split across two references.",
	explanation: "U2 schema proof.",
	skill_version: "0.1.0",
	git_sha: "8b6f425",
	model: "claude-sonnet-4-20250514",
	usage: {
		input_tokens: 120,
		output_tokens: 34,
		cache_read_tokens: 5,
	},
	generated_ts: "2026-06-11T08:00:00.000Z",
} as const satisfies Receipt;

function usableReport(raw: unknown) {
	const parsed = parseReceipt(raw);
	if (parsed.kind !== "ok" && parsed.kind !== "degraded") {
		throw new Error(`Receipt was not usable: ${parsed.kind}`);
	}
	return buildSoftwareLearningReport(parsed);
}

function discoveryTree() {
	return projectCommandDiscoveryTree(
		Object.entries(skillFeedbackContracts) as Array<
			[
				SkillFeedbackCommand,
				(typeof skillFeedbackContracts)[SkillFeedbackCommand],
			]
		>,
	);
}

const MINIMAL_REVIEW_RESULT_V2 = {
	contract: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	schema_version: SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
	coverage: {
		total_reports: 2,
		closeout_count: 1,
		capture_only_count: 1,
		unlinked_count: 1,
		evidence_gap_count: 0,
		closeout_rate: 0.5,
		low_coverage: false,
	},
	inbox_health: {
		primary_count: 2,
		low_signal_count: 1,
		low_signal_newest_generated_ts: "2026-06-13T00:00:00.000Z",
		low_signal_reason_ids: ["unknown_skill_codex_stop"],
		skipped_unsafe_count: 0,
		invalid_count: 0,
	},
	open_items: [],
	open_actions: [
		{
			action_key: "open-report-1",
			open_reason: "owner_path_observation",
			target: { type: "path", value: "skills/create-skill/SKILL.md" },
			next_safe_action: "Open the owner path and verify report evidence.",
			evidence_refs: ["report_1"],
		},
	],
	no_action: { rationale: "No higher-signal review action is available." },
	retention: { report_count: 2 },
	review_units: [
		{
			review_unit_key: "report:report_1",
			report_ids: ["report_1"],
			trusted_run: false,
		},
		{
			review_unit_key: "report:report_2",
			report_ids: ["report_2"],
			trusted_run: true,
			trusted_skill_run_id: "skill-run-2",
		},
	],
	ledger_entries: [
		{
			ledger_entry_key: "ledger:path:skills/create-skill/SKILL.md",
			review_unit_keys: ["report:report_1"],
			ledger_anchor_key: "path:skills/create-skill/SKILL.md",
			anchor_strength: "strong_path",
			attempted_targets: [
				{ type: "path", value: "skills/create-skill/SKILL.md" },
			],
			owner_paths: ["skills/create-skill/SKILL.md"],
			evidence_tier: "driver_declared",
			source_mix: ["driver_closeout"],
			capture_runtime_mix: [],
			allowed_claims: ["repeated_anchor"],
			resolution_state: "open",
			verification_burden: {
				level: "moderate",
				note: "Needs owner path check.",
			},
			next_safe_action: "Open the referenced owner path and verify evidence.",
		},
		{
			ledger_entry_key: "ledger:weak:report_2",
			review_unit_keys: ["report:report_2"],
			anchor_strength: "weak",
			weak_anchor_reason: "label_only",
			attempted_targets: [{ type: "label", value: "skill authoring docs" }],
			owner_paths: [],
			evidence_tier: "runtime_observed",
			source_mix: ["hook_capture"],
			capture_runtime_mix: ["codex_stop"],
			allowed_claims: [],
			resolution_state: "no_action",
			verification_burden: { level: "unknown" },
			next_safe_action: "Wait for a repo-contained path before grouping.",
		},
	],
	anchor_miss_telemetry: [
		{
			weak_anchor_reason: "label_only",
			count: 1,
			attempted_targets: [{ type: "label", value: "skill authoring docs" }],
		},
	],
	claim_readiness: {
		runtime_capture: {
			status: "evidence_only",
			reason_ids: ["codex_stop_turn_without_identity"],
			evidence_refs: ["report_2"],
		},
		trusted_skill_identity: {
			status: "blocked",
			reason_ids: ["missing_engine_owned_identity"],
			evidence_refs: [],
		},
		daily_pilot: {
			status: "blocked",
			reason_ids: ["pilot_gate_not_accepted"],
			evidence_refs: [],
		},
	},
} as const satisfies ReviewResultData;

function reviewResultV2Fixture(): ReviewResultData {
	return structuredClone(MINIMAL_REVIEW_RESULT_V2);
}

const MINIMAL_HEALTH_RESULT = {
	contract: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
	schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
	inbox_status: "populated",
	counts: {
		primary: 2,
		low_signal: 1,
		invalid: 0,
		skipped_unsafe: 0,
		unlinked_primary: 1,
	},
	newest: {
		primary_generated_ts: "2026-06-13T00:00:00.000Z",
		low_signal_generated_ts: "2026-06-12T00:00:00.000Z",
	},
	warnings: [
		{
			reason_id: "unlinked_primary_reports",
			summary: "Primary reports lack trusted skill-run correlation.",
		},
	],
	claim_readiness: {
		runtime_capture: {
			status: "evidence_only",
			reason_ids: ["hook_approval_state_not_machine_observable"],
		},
		trusted_skill_identity: {
			status: "blocked",
			reason_ids: ["missing_engine_owned_identity"],
		},
		daily_pilot: {
			status: "blocked",
			reason_ids: ["pilot_gate_not_accepted"],
		},
	},
	correlation: {
		status: "partially_linked",
		linked_primary_count: 1,
		unlinked_primary_count: 1,
	},
	next_action: {
		action_id: "run-review",
		summary: "Run review for claim-safe ledger detail.",
	},
} as const satisfies HealthResultData;

function healthResultFixture(): HealthResultData {
	return structuredClone(MINIMAL_HEALTH_RESULT);
}

const MINIMAL_PURGE_RESULT = {
	contract: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
	schema_version: SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
	mode: "preview",
	lane: "all",
	retention: {
		kind: "older_than",
		older_than: "14d",
		cutoff_ts: "2026-05-30T00:00:00.000Z",
	},
	scanned_count: 2,
	candidate_count: 1,
	deleted_count: 0,
	skipped_unsafe_count: 0,
	invalid_count: 0,
	candidate_paths: [".skill-feedback/old.json"],
	deleted_paths: [],
	skipped_paths: [],
	invalid_paths: [],
} as const satisfies SkillFeedbackPurgeResultData;

describe("skill-feedback U2 command contract", () => {
	test("declares valid facade-backed record, closeout, review, health, and purge commands", () => {
		const result = parseCommandFacadeContract(skillFeedbackContracts, {
			path: "skills/skill-feedback/src/command-contract.ts",
			writeImplyingMutations: new Set(["capture", "closeout", "purge"]),
		});

		expect(result.ok).toBe(true);
		expect(Object.keys(skillFeedbackContracts)).toEqual([
			"record",
			"closeout",
			"review",
			"health",
			"purge",
		]);
		expect(discoveryTree().commands.record?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		});
		expect(discoveryTree().commands.closeout?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_CLOSEOUT_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		});
		expect(discoveryTree().commands.review?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
		});
		expect(discoveryTree().commands.health?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
		});
		expect(discoveryTree().commands.purge?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
		});
		expect(skillFeedbackContracts.purge.sideEffects).toEqual(["write"]);
		expect(skillFeedbackContracts.purge.executionModes).toEqual([
			"dry_run",
			"normal",
		]);
	});

	test("record flags expose narrated inputs but closeout reads receipt stdin", () => {
		const flags = Object.keys(skillFeedbackContracts.record.flags).sort();

		expect(flags).toEqual([
			"--explanation",
			"--friction",
			"--generated-ts",
			"--goal",
			"--outcome",
			"--skill",
		]);
		expect(flags).not.toContain("--model");
		expect(flags).not.toContain("--git-sha");
		expect(flags).not.toContain("--skill-version");
		for (const reserved of CLI_DIAGNOSTIC_FLAGS) {
			expect(flags).not.toContain(reserved);
		}

		expect(Object.keys(skillFeedbackContracts.closeout.flags)).toEqual([]);
		expect(skillFeedbackContracts.closeout.usage).toEqual([
			"closeout < receipt.json",
		]);
	});

	test("review flags expose plain output and explicit repo targeting", () => {
		expect(Object.keys(skillFeedbackContracts.review.flags).sort()).toEqual([
			"--plain",
			"--repo",
		]);
		expect(skillFeedbackContracts.review.usage).toEqual([
			"review [--plain] [--repo <path>]",
		]);
	});

	test("health flags mirror review as read-only JSON/plain output", () => {
		expect(Object.keys(skillFeedbackContracts.health.flags).sort()).toEqual([
			"--plain",
			"--repo",
		]);
		expect(skillFeedbackContracts.health.usage).toEqual([
			"health [--plain] [--repo <path>]",
		]);
		expect(skillFeedbackContracts.health.sideEffects).toEqual(["read"]);
		expect(skillFeedbackContracts.health.outputModes).toEqual(["json", "plain"]);
	});

	test("parses a complete flat receipt into the full report field set", () => {
		const parsed = parseReceipt(COMPLETE_RECEIPT);
		expect(parsed.kind).toBe("ok");

		const report = usableReport(COMPLETE_RECEIPT);
		expect(report).toEqual({
			evaluation_name: "skill-feedback",
			untrusted_evidence: true,
			generated_ts: COMPLETE_RECEIPT.generated_ts,
			skill: COMPLETE_RECEIPT.skill,
			skill_version: COMPLETE_RECEIPT.skill_version,
			git_sha: COMPLETE_RECEIPT.git_sha,
			model: COMPLETE_RECEIPT.model,
			outcome: COMPLETE_RECEIPT.outcome,
			goal: COMPLETE_RECEIPT.goal,
			friction: COMPLETE_RECEIPT.friction,
			explanation: COMPLETE_RECEIPT.explanation,
			usage: COMPLETE_RECEIPT.usage,
			degraded: false,
			gaps: [],
			redactions: 0,
		});
	});

	test("parses a weak receipt as degraded with explicit gaps", () => {
		const parsed = parseReceipt({
			skill: "fallow",
			goal: "Run changed-code evidence.",
			outcome: "ambiguous",
		});

		expect(parsed.kind).toBe("degraded");
		if (parsed.kind !== "degraded") {
			throw new Error("expected degraded receipt");
		}
		expect(parsed.gaps).toEqual([
			"friction",
			"skill_version",
			"git_sha",
			"model",
			"usage",
			"generated_ts",
		]);

		const report = buildSoftwareLearningReport(parsed);
		expect(report.degraded).toBe(true);
		expect(report.gaps).toContain("friction");
		expect(report.untrusted_evidence).toBe(true);
	});

	test("rejects unknown receipt fields instead of silently storing them", () => {
		expect(parseReceipt({ ...COMPLETE_RECEIPT, extra: "leak" })).toEqual({
			kind: "unknown-field",
			field: "extra",
		});
		expect(
			parseReceipt({
				...COMPLETE_RECEIPT,
				usage: {
					...COMPLETE_RECEIPT.usage,
					prompt_tokens: 999,
				},
			}),
		).toEqual({
			kind: "invalid",
			field: "usage",
			reason: "expected { input_tokens, output_tokens, cache_read_tokens }",
		});
	});

	test("uses passed-in timestamps deterministically", async () => {
		const first = usableReport(COMPLETE_RECEIPT);
		const second = usableReport(structuredClone(COMPLETE_RECEIPT));
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));

		const moduleUrl = new URL("./command-contract.ts", import.meta.url).href;
		const script = `
			import { buildSoftwareLearningReport, parseReceipt } from ${JSON.stringify(moduleUrl)};
			const parsed = parseReceipt(${JSON.stringify(COMPLETE_RECEIPT)});
			if (parsed.kind !== "ok" && parsed.kind !== "degraded") {
				throw new Error(parsed.kind);
			}
			console.log(JSON.stringify(buildSoftwareLearningReport(parsed)));
		`;
		const child = Bun.spawn([process.execPath, "--eval", script], {
			stderr: "pipe",
			stdout: "pipe",
		});
		const stdout = await new Response(child.stdout).text();
		const stderr = await new Response(child.stderr).text();
		expect(await child.exited).toBe(0);
		expect(stderr).toBe("");
		expect(stdout.trim()).toBe(JSON.stringify(first));
	});

	test("carries the untrusted evidence marker on every report", () => {
		expect(usableReport(COMPLETE_RECEIPT).untrusted_evidence).toBe(true);
		expect(
			usableReport({
				skill: "fallow",
				goal: "Audit changed code.",
				outcome: "failed",
			}).untrusted_evidence,
		).toBe(true);
	});

	test("keeps the outcome enum inside envelope data", () => {
		const report = usableReport(COMPLETE_RECEIPT);
		const envelope = createCliRuntimeSuccessEnvelope({
			run_id: "skill-feedback-u2",
			data: report,
		});

		expect(SKILL_FEEDBACK_OUTCOMES).toEqual([
			"confirmed",
			"failed",
			"ambiguous",
		]);
		expect(envelope.data.outcome).toBe("confirmed");
		expect("outcome" in envelope).toBe(false);
		expect("error" in envelope).toBe(false);
	});

	test("keeps NARRATED_FIELDS as the single trust-boundary constant", () => {
		expect(NARRATED_FIELDS).toEqual(["goal", "friction", "explanation"]);
		expect(NARRATED_FIELDS.every((field) => RECEIPT_FIELDS.includes(field))).toBe(
			true,
		);
	});

	test("normalizes v0 null explanation as absent", () => {
		const normalized = normalizeReport({
			...usableReport(COMPLETE_RECEIPT),
			explanation: null,
		});

		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		expect(normalized.report.source_schema_version).toBe("v0");
		expect(normalized.report.evidence_source).toBe("hook_capture");
		expect(normalized.report.goal).toBe(COMPLETE_RECEIPT.goal);
	});
});

describe("skill-feedback U1 review result v2 contract", () => {
	test("validates health result output at the contract boundary", () => {
		const parsed = parseHealthResultData(healthResultFixture());

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected valid health result");
		expect(parsed.data.contract).toBe(SKILL_FEEDBACK_HEALTH_CONTRACT_ID);
		expect(parsed.data.schema_version).toBe(
			SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
		);
		expect(parsed.data.inbox_status).toBe("populated");
		expect(parsed.data.next_action.action_id).toBe("run-review");
	});

	test("rejects malformed health result fields and enums", () => {
		const cases: Array<{
			name: string;
			mutate: (data: Record<string, any>) => void;
			path: string;
			reason: string;
		}> = [
			{
				name: "unknown top-level field",
				mutate: (data) => {
					data.repo_root = "/repo";
				},
				path: "repo_root",
				reason: "unknown_field",
			},
			{
				name: "invalid inbox status",
				mutate: (data) => {
					data.inbox_status = "stale";
				},
				path: "inbox_status",
				reason: "invalid",
			},
			{
				name: "bad warning reason",
				mutate: (data) => {
					data.warnings[0].reason_id = "mystery_warning";
				},
				path: "warnings[0].reason_id",
				reason: "invalid_warning_reason",
			},
			{
				name: "bad readiness status",
				mutate: (data) => {
					data.claim_readiness.runtime_capture.status = "waiting";
				},
				path: "claim_readiness.runtime_capture.status",
				reason: "invalid_readiness_status",
			},
			{
				name: "bad next action",
				mutate: (data) => {
					data.next_action.action_id = "delete-now";
				},
				path: "next_action.action_id",
				reason: "invalid_action_id",
			},
		];

		for (const scenario of cases) {
			const data = healthResultFixture() as Record<string, any>;
			scenario.mutate(data);

			expect(parseHealthResultData(data), scenario.name).toMatchObject({
				kind: "invalid",
				path: scenario.path,
				reason: scenario.reason,
			});
		}
	});

	test("validates purge result output at the contract boundary", () => {
		const parsed = parsePurgeResultData(MINIMAL_PURGE_RESULT);

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected valid purge result");
		expect(parsed.data.contract).toBe(SKILL_FEEDBACK_PURGE_CONTRACT_ID);
		expect(parsed.data.schema_version).toBe(
			SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
		);
		expect(parsed.data.candidate_paths).toEqual([".skill-feedback/old.json"]);
	});

	test("rejects invalid purge result retention variants", () => {
		expect(
			parsePurgeResultData({
				...MINIMAL_PURGE_RESULT,
				retention: { kind: "older_than", older_than: "14d" },
			}),
		).toMatchObject({
			kind: "invalid",
			path: "retention.cutoff_ts",
			reason: "expected_string",
		});
		expect(
			parsePurgeResultData({
				...MINIMAL_PURGE_RESULT,
				retention: { kind: "everything" },
			}),
		).toMatchObject({
			kind: "invalid",
			path: "retention.kind",
			reason: "invalid",
		});
	});

	test("validates minimal v2 review output and keeps claims entry-local", () => {
		const parsed = parseReviewResultData(reviewResultV2Fixture());

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected valid review result");
		expect(parsed.data.schema_version).toBe(
			SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION,
		);
		expect(parsed.data.review_units).toHaveLength(2);
		expect(parsed.data.ledger_entries).toHaveLength(2);
		expect(parsed.data.anchor_miss_telemetry).toHaveLength(1);
		expect(parsed.data.open_actions).toHaveLength(1);
		expect(parsed.data.claim_readiness.runtime_capture.status).toBe(
			"evidence_only",
		);
		expect("allowed_claims" in parsed.data).toBe(false);
		expect("capture_readiness" in parsed.data).toBe(false);
	});

	test("accepts optional review read-target diagnostics", () => {
		const data = {
			...reviewResultV2Fixture(),
			read_target: {
				explicit: true,
				repo_root: "/repo",
				inbox_path: "/repo/.skill-feedback",
				target_path: "/repo/package",
			},
		} satisfies ReviewResultData;

		expect(parseReviewResultData(data)).toMatchObject({ kind: "ok" });
		expect(
			parseReviewResultData({
				...reviewResultV2Fixture(),
				read_target: {
					explicit: false,
					repo_root: "/repo",
					inbox_path: "/repo/.skill-feedback",
				},
			}),
		).toMatchObject({ kind: "ok" });
	});

	test("rejects malformed review read-target diagnostics", () => {
		const cases: Array<{
			name: string;
			mutate: (data: Record<string, any>) => void;
			path: string;
			reason: string;
		}> = [
			{
				name: "unknown read-target field",
				mutate: (data) => {
					data.read_target.extra = true;
				},
				path: "read_target.extra",
				reason: "unknown_field",
			},
			{
				name: "non-boolean explicit marker",
				mutate: (data) => {
					data.read_target.explicit = "true";
				},
				path: "read_target.explicit",
				reason: "expected_boolean",
			},
			{
				name: "non-string repo root",
				mutate: (data) => {
					data.read_target.repo_root = 42;
				},
				path: "read_target.repo_root",
				reason: "expected_string",
			},
			{
				name: "non-string optional target path",
				mutate: (data) => {
					data.read_target.target_path = false;
				},
				path: "read_target.target_path",
				reason: "expected_string",
			},
		];

		for (const scenario of cases) {
			const data = structuredClone(reviewResultV2Fixture()) as Record<string, any>;
			data.read_target = {
				explicit: true,
				repo_root: "/repo",
				inbox_path: "/repo/.skill-feedback",
				target_path: "/repo/package",
			};
			scenario.mutate(data);

			expect(parseReviewResultData(data), scenario.name).toMatchObject({
				kind: "invalid",
				path: scenario.path,
				reason: scenario.reason,
			});
		}
	});

	test("rejects unknown v2 enum values", () => {
		const cases: Array<{
			name: string;
			mutate: (data: Record<string, any>) => void;
			path: string;
		}> = [
			{
				name: "evidence tier",
				mutate: (data) => {
					data.ledger_entries[0].evidence_tier = "maybe_runtime";
				},
				path: "ledger_entries[0].evidence_tier",
			},
			{
				name: "allowed claim",
				mutate: (data) => {
					data.ledger_entries[0].allowed_claims[0] = "strong_claim";
				},
				path: "ledger_entries[0].allowed_claims[0]",
			},
			{
				name: "readiness status",
				mutate: (data) => {
					data.claim_readiness.runtime_capture.status = "waiting";
				},
				path: "claim_readiness.runtime_capture.status",
			},
			{
				name: "anchor strength",
				mutate: (data) => {
					data.ledger_entries[0].anchor_strength = "strong_label";
				},
				path: "ledger_entries[0].anchor_strength",
			},
			{
				name: "weak-anchor reason",
				mutate: (data) => {
					data.ledger_entries[1].weak_anchor_reason = "fuzzy";
				},
				path: "ledger_entries[1].weak_anchor_reason",
			},
		];

		for (const { name, mutate, path } of cases) {
			const data = reviewResultV2Fixture() as Record<string, any>;
			mutate(data);
			expect(parseReviewResultData(data), name).toMatchObject({
				kind: "invalid",
				path,
			});
		}
	});

	test("enforces strong and weak ledger anchor boundaries", () => {
		const missingStrongKey = reviewResultV2Fixture() as Record<string, any>;
		delete missingStrongKey.ledger_entries[0].ledger_anchor_key;
		expect(parseReviewResultData(missingStrongKey)).toMatchObject({
			kind: "invalid",
			path: "ledger_entries[0].ledger_anchor_key",
			reason: "required_for_strong_path",
		});

		const mergeableWeakKey = reviewResultV2Fixture() as Record<string, any>;
		mergeableWeakKey.ledger_entries[1].ledger_anchor_key = "path:unsafe";
		expect(parseReviewResultData(mergeableWeakKey)).toMatchObject({
			kind: "invalid",
			path: "ledger_entries[1].ledger_anchor_key",
			reason: "forbidden_for_weak_anchor",
		});
	});

	test("rejects top-level global claims and v1 capture readiness", () => {
		const globalClaims = reviewResultV2Fixture() as Record<string, any>;
		globalClaims.allowed_claims = ["corroborated"];
		expect(parseReviewResultData(globalClaims)).toMatchObject({
			kind: "invalid",
			path: "allowed_claims",
			reason: "unknown_field",
		});

		const v1Readiness = reviewResultV2Fixture() as Record<string, any>;
		v1Readiness.capture_readiness = { implementation_status: "ready" };
		expect(parseReviewResultData(v1Readiness)).toMatchObject({
			kind: "invalid",
			path: "capture_readiness",
			reason: "unknown_field",
		});
	});

	test("accepts an optional pilot_checkpoint and rejects malformed fields", () => {
		const validCheckpoint = {
			started_at: "2026-06-01T00:00:00.000Z",
			age_days: 12,
			actionable_feedback_numerator: 3,
			material_closeout_denominator: 5,
			density: 0.6,
			next_action: "Keep filing material closeouts.",
		};

		const withCheckpoint = {
			...reviewResultV2Fixture(),
			pilot_checkpoint: validCheckpoint,
		} satisfies ReviewResultData;
		expect(parseReviewResultData(withCheckpoint)).toMatchObject({ kind: "ok" });

		const cases: Array<{
			name: string;
			mutate: (checkpoint: Record<string, any>) => void;
			path: string;
			reason: string;
		}> = [
			{
				name: "unknown field",
				mutate: (checkpoint) => {
					checkpoint.unexpected = true;
				},
				path: "pilot_checkpoint.unexpected",
				reason: "unknown_field",
			},
			{
				name: "non-string started_at",
				mutate: (checkpoint) => {
					checkpoint.started_at = 20260601;
				},
				path: "pilot_checkpoint.started_at",
				reason: "expected_string",
			},
			{
				name: "non-finite density",
				mutate: (checkpoint) => {
					checkpoint.density = Number.POSITIVE_INFINITY;
				},
				path: "pilot_checkpoint.density",
				reason: "expected_number",
			},
			{
				name: "non-string next_action",
				mutate: (checkpoint) => {
					checkpoint.next_action = null;
				},
				path: "pilot_checkpoint.next_action",
				reason: "expected_string",
			},
		];

		for (const { name, mutate, path, reason } of cases) {
			const checkpoint = structuredClone(validCheckpoint) as Record<string, any>;
			mutate(checkpoint);
			const data = {
				...reviewResultV2Fixture(),
				pilot_checkpoint: checkpoint,
			} as Record<string, any>;
			expect(parseReviewResultData(data), name).toMatchObject({
				kind: "invalid",
				path,
				reason,
			});
		}
	});

	test("validates no-ledger v2 review output with coverage and no-action data", () => {
		const data = {
			...reviewResultV2Fixture(),
			open_actions: [],
			review_units: [],
			ledger_entries: [],
			anchor_miss_telemetry: [],
			no_action: { rationale: "No high-signal report exists." },
		} satisfies ReviewResultData;

		expect(parseReviewResultData(data)).toMatchObject({ kind: "ok" });
	});

	test("requires stable evidence refs on open items", () => {
		const data = reviewResultV2Fixture() as Record<string, any>;
		data.open_items = [
			{
				open_reason: "owner_path_observation",
				severity: "action",
				evidence: "Owner path needs inspection.",
				evidence_refs: ["report:report_1"],
				target: { type: "path", value: "skills/create-skill/SKILL.md" },
				next_action: "Inspect the owner path.",
			},
		];
		expect(parseReviewResultData(data).kind).toBe("ok");

		delete data.open_items[0].evidence_refs;
		expect(parseReviewResultData(data)).toMatchObject({
			kind: "invalid",
			path: "open_items[0].evidence_refs",
		});
	});
});

describe("skill-feedback U1 report-card v1 contract", () => {
	const COMPLETE_CLOSEOUT = {
		skill: "create-skill",
		outcome: "confirmed",
		goal: "Repair the skill authoring route.",
		friction: {
			category: "missing_context",
			note: "The owner path was split across two references.",
		},
		verification_burden: {
			level: "moderate",
			note: "Had to inspect the rendered skill and the owner runbook.",
		},
		touched_surfaces: [
			{ type: "path", value: "skills/create-skill/SKILL.md" },
			{ type: "label", value: "skill authoring runbook" },
		],
		observations: [
			{
				kind: "missing_context",
				target: {
					type: "path",
					value:
						"skills/create-skill/references/skill-design-decision-runbook.md",
				},
				summary: "The driver needed the runbook before editing the skill.",
				evidence_basis: "driver_observed",
			},
		],
		skill_run_id: "run-explicit-1",
	} as const;

	test("validates a complete closeout receipt with optional lanes", () => {
		const parsed = parseCloseoutReceipt(COMPLETE_CLOSEOUT);

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		expect(parsed.receipt.touched_surfaces).toHaveLength(2);
		expect(parsed.receipt.observations).toHaveLength(1);
		expect(parsed.evidence_gaps).toEqual([]);
	});

	test("missing closeout core fields become typed evidence gaps", () => {
		const parsed = parseCloseoutReceipt({
			skill: "fallow",
			outcome: "ambiguous",
		});

		expect(parsed.kind).toBe("degraded");
		if (parsed.kind !== "degraded") throw new Error("expected degraded closeout");
		expect(parsed.evidence_gaps.map((gap) => gap.code)).toEqual([
			"missing_goal",
			"missing_friction",
			"missing_verification_burden",
		]);
	});

	test("omitted optional observations and touched surfaces do not create gaps", () => {
		const parsed = parseCloseoutReceipt({
			skill: "fallow",
			outcome: "confirmed",
			goal: "Run changed-code evidence.",
			friction: { category: "none", note: "Clean run." },
			verification_burden: { level: "light", note: "Focused test pass." },
		});

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		expect(parsed.receipt.touched_surfaces).toEqual([]);
		expect(parsed.receipt.observations).toEqual([]);
		expect(parsed.evidence_gaps).toEqual([]);
	});

	test("rejects capped lanes and driver-authored authority fields", () => {
		const tooManyTouched = parseCloseoutReceipt({
			...COMPLETE_CLOSEOUT,
			touched_surfaces: [
				{ type: "label", value: "one" },
				{ type: "label", value: "two" },
				{ type: "label", value: "three" },
				{ type: "label", value: "four" },
				{ type: "label", value: "five" },
				{ type: "label", value: "six" },
			],
		});
		expect(tooManyTouched).toMatchObject({
			kind: "invalid",
			path: "touched_surfaces",
			reason: "max_5",
		});

		const tooManyObservations = parseCloseoutReceipt({
			...COMPLETE_CLOSEOUT,
			observations: [0, 1, 2, 3].map((index) => ({
				kind: "other",
				summary: `Observation ${index}`,
				evidence_basis: "driver_observed",
			})),
		});
		expect(tooManyObservations).toMatchObject({
			kind: "invalid",
			path: "observations",
			reason: "max_3",
		});

		for (const field of [
			"confidence",
			"severity",
			"next_action",
			"repair_instruction",
		]) {
			const parsed = parseCloseoutReceipt({
				...COMPLETE_CLOSEOUT,
				observations: [
					{
						...COMPLETE_CLOSEOUT.observations[0],
						[field]: "driver-authored authority",
					},
				],
			});
			expect(parsed).toMatchObject({
				kind: "invalid",
				path: `observations[0].${field}`,
				reason: "not_allowed",
			});
		}
	});

	test("rejects unsafe owner paths and unknown v1 fields", () => {
		for (const value of [
			"/tmp/skill.md",
			"../skill.md",
			"skills/../skill.md",
		]) {
			expect(
				parseCloseoutReceipt({
					...COMPLETE_CLOSEOUT,
					observations: [
						{
							...COMPLETE_CLOSEOUT.observations[0],
							target: { type: "path", value },
						},
					],
				}),
			).toMatchObject({
				kind: "invalid",
				path: "observations[0].target.value",
				reason: "invalid_owner_path",
			});
		}

		expect(
			parseCloseoutReceipt({
				...COMPLETE_CLOSEOUT,
				unknown: "field",
			}),
		).toMatchObject({
			kind: "invalid",
			path: "unknown",
			reason: "unknown_field",
		});
	});

	test("normalizes v0 reports into the v1 review model", () => {
		const v0 = usableReport({
			...COMPLETE_RECEIPT,
			friction: "Hook captured no transcript payload.",
		});
		const normalized = normalizeReport(v0);

		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		expect(normalized.report.source_schema_version).toBe("v0");
		expect(normalized.report.schema_version).toBe(SKILL_FEEDBACK_SCHEMA_VERSION);
		expect(normalized.report.evidence_source).toBe("hook_capture");
		expect(normalized.report.correlation_status).toBe("unlinked");
		expect(normalized.report.cost.status).toBe(SKILL_FEEDBACK_COST_STATUS.UNAVAILABLE);
		expect(normalized.report.evidence_gaps.map((gap) => gap.code)).toContain(
			"cost_unavailable",
		);
		expect(normalized.report.friction).toBeUndefined();
	});

	test("normalizes missing v0 usage as unavailable cost without zero telemetry", () => {
		const { usage: _usage, ...missingUsageReceipt } = COMPLETE_RECEIPT;
		const v0 = usableReport(missingUsageReceipt);
		const normalized = normalizeReport(v0);

		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		const costGaps = normalized.report.evidence_gaps.filter(
			(gap) => gap.code === "cost_unavailable",
		);
		expect(costGaps).toHaveLength(1);
		expect(normalized.report.runtime.usage).toBeUndefined();
	});

	test("normalizes v1 reports without treating optional lanes as gaps", () => {
		const parsed = parseCloseoutReceipt(COMPLETE_CLOSEOUT);
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		const normalized = normalizeReport({
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			report_id: "report_v1_1",
			untrusted_evidence: true,
			generated_ts: COMPLETE_RECEIPT.generated_ts,
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: COMPLETE_CLOSEOUT.skill_run_id,
			runtime: {
				git_sha: COMPLETE_RECEIPT.git_sha,
				skill_version: COMPLETE_RECEIPT.skill_version,
				model: COMPLETE_RECEIPT.model,
			},
			report_card: parsed.receipt,
			evidence_gaps: parsed.evidence_gaps,
		});

		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		expect(normalized.report.source_schema_version).toBe("v1");
		expect(normalized.report.report_id).toBe("report_v1_1");
		expect(normalized.report.touched_surfaces).toHaveLength(2);
		expect(normalized.report.observations).toHaveLength(1);
		expect(normalized.report.evidence_gaps).not.toContain("observations");
	});

	test("normalizes capture provenance fields and rejects invalid values", () => {
		const parsed = parseCloseoutReceipt(COMPLETE_CLOSEOUT);
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		const baseReport = {
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			report_id: "report_v1_capture",
			untrusted_evidence: true,
			generated_ts: COMPLETE_RECEIPT.generated_ts,
			evidence_source: "hook_capture",
			correlation_status: "unlinked",
			runtime: {
				git_sha: COMPLETE_RECEIPT.git_sha,
				skill_version: COMPLETE_RECEIPT.skill_version,
				model: COMPLETE_RECEIPT.model,
			},
			report_card: parsed.receipt,
			evidence_gaps: parsed.evidence_gaps,
		};

		const normalized = normalizeReport({
			...baseReport,
			capture_runtime: "codex_stop",
			skill_identity_provenance: {
				source: "none",
				trusted: false,
				reason: "codex_stop_payload_has_no_trusted_skill_identity",
			},
		});

		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		expect(normalized.report.capture_runtime).toBe("codex_stop");
		expect(normalized.report.skill_identity_provenance).toMatchObject({
			source: "none",
			trusted: false,
		});

		expect(
			normalizeReport({ ...baseReport, capture_runtime: "not-a-runtime" }),
		).toMatchObject({
			kind: "invalid",
			path: "capture_runtime",
			reason: "invalid",
		});
		expect(
			normalizeReport({
				...baseReport,
				skill_identity_provenance: { source: "none", trusted: "yes" },
			}),
		).toMatchObject({
			kind: "invalid",
			path: "skill_identity_provenance",
			reason: "invalid",
		});
	});

	test("normalizes skill-run provenance as evidence-only and rejects invalid trust labels", () => {
		const parsed = parseCloseoutReceipt(COMPLETE_CLOSEOUT);
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		const baseReport = {
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			report_id: "report_v1_run_provenance",
			untrusted_evidence: true,
			generated_ts: COMPLETE_RECEIPT.generated_ts,
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: "run-trusted-1",
			runtime: {
				git_sha: COMPLETE_RECEIPT.git_sha,
				skill_version: COMPLETE_RECEIPT.skill_version,
				model: COMPLETE_RECEIPT.model,
			},
			report_card: parsed.receipt,
			evidence_gaps: parsed.evidence_gaps,
		};

		const normalized = normalizeReport({
			...baseReport,
			skill_run_id_provenance: "correlation_owned",
		});

		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		expect(normalized.report.skill_run_id).toBe("run-trusted-1");
		expect(normalized.report.skill_run_id_provenance).toBeUndefined();

		const runtimeOwned = normalizeReport({
			...baseReport,
			skill_run_id_provenance: "runtime_owned",
		});

		expect(runtimeOwned.kind).toBe("ok");
		if (runtimeOwned.kind !== "ok") throw new Error("expected normalized report");
		expect(runtimeOwned.report.skill_run_id).toBe("run-trusted-1");
		expect(runtimeOwned.report.skill_run_id_provenance).toBeUndefined();

		expect(
			normalizeReport({
				...baseReport,
				skill_run_id_provenance: "assistant_claimed",
			}),
		).toMatchObject({
			kind: "invalid",
			path: "skill_run_id_provenance",
			reason: "invalid",
		});
	});

	test("names every v1 agent-authored string path for redaction ownership", () => {
		expect(AGENT_AUTHORED_STRING_PATHS).toEqual([
			"goal",
			"friction",
			"explanation",
			"report_card.goal",
			"report_card.friction.note",
			"report_card.verification_burden.note",
			"report_card.touched_surfaces[].value",
			"report_card.observations[].target.value",
			"report_card.observations[].summary",
		]);
	});
});
