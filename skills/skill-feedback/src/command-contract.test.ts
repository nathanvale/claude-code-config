// fallow-ignore-file unused-file, code-duplication, complexity
// Bun test entrypoint with contract fixture literals; package runner invokes this file without static imports.
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
	SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
	SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION,
	SKILL_FEEDBACK_CORRELATION_WITNESS_SCHEMA_VERSION,
	SKILL_FEEDBACK_CONTRACT_ID,
	SKILL_FEEDBACK_DECISION_READINESS_SURFACES,
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
	type SkillFeedbackCorrelateResultData,
	buildSoftwareLearningReport,
	correlationWitnessRelativePath,
	createCorrelationWitness,
	createWriterProof,
	deriveWriterOwnedSkillRunId,
	isSafeCorrelationWitnessFileName,
	parseCloseoutReceipt,
	parseCorrelateResultData,
	parseHealthResultData,
	parsePurgeResultData,
	parseReviewResultData,
	parseReceipt,
	skillFeedbackContracts,
	type SkillFeedbackPurgeResultData,
	verifyCorrelationWitness,
	verifyWriterProof,
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
	inbox_status: "populated",
	counts: {
		primary: 2,
		low_signal: 1,
		invalid: 0,
		skipped_unsafe: 0,
		unlinked_primary: 1,
	},
	warnings: [
		{
			reason_id: "unlinked_primary_reports",
			summary: "Primary reports lack trusted skill-run correlation.",
		},
	],
	next_action: {
		action_id: "run-review",
		summary: "Run review for claim-safe ledger detail.",
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
			proof_diagnostics: [],
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
			proof_diagnostics: [],
			resolution_state: "no_action",
			verification_burden: { level: "unknown" },
			next_safe_action: "Wait for a repo-contained path before grouping.",
		},
	],
	engineering_signals: [
		{
			signal_key: "signal:create-skill",
			reason: "repeated_anchor",
			owner_path: "skills/create-skill/SKILL.md",
			evidence_refs: ["report:report_1"],
			evidence_tier: "driver_declared",
			source_mix: ["driver_closeout"],
			allowed_claims: ["repeated_anchor"],
			next_safe_action: "Open the referenced owner path and verify evidence.",
		},
	],
	anchor_miss_telemetry: [
		{
			weak_anchor_reason: "label_only",
			count: 1,
			attempted_targets: [{ type: "label", value: "skill authoring docs" }],
		},
	],
	proof_health: {
		verified_count: 0,
		evidence_only_count: 2,
		replay_diagnostics_count: 0,
		diagnostics: [],
	},
	correlation_witnesses: {
		verified_count: 0,
		blocked_count: 0,
		orphan_count: 0,
		diagnostics: [],
	},
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
			status: "ready",
			reason_ids: [
				"decision_44_claude_supported",
				"claude_stop_skill_detected",
			],
			evidence_refs: ["report_1"],
		},
		claude_daily_pilot: {
			status: "ready",
			reason_ids: [
				"decision_44_claude_supported",
				"claude_stop_skill_detected",
			],
			evidence_refs: ["report_1"],
		},
		codex_trusted_skill_identity: {
			status: "blocked",
			reason_ids: ["missing_engine_owned_identity"],
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
	proof_health: {
		verified_count: 0,
		evidence_only_count: 2,
		replay_diagnostics_count: 0,
		diagnostics: [],
	},
	correlation_witnesses: {
		verified_count: 0,
		blocked_count: 0,
		orphan_count: 0,
		diagnostics: [],
	},
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
			status: "ready",
			reason_ids: [
				"decision_44_claude_supported",
				"claude_stop_skill_detected",
			],
		},
		claude_daily_pilot: {
			status: "ready",
			reason_ids: [
				"decision_44_claude_supported",
				"claude_stop_skill_detected",
			],
		},
		codex_trusted_skill_identity: {
			status: "blocked",
			reason_ids: ["missing_engine_owned_identity"],
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

const MINIMAL_CORRELATE_RESULT = {
	contract: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
	schema_version: SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION,
	mode: "preview",
	counts: {
		diagnostic_count: 1,
		candidate_count: 1,
		repairable_count: 1,
		ambiguous_count: 0,
		invalid_count: 0,
		already_linked_count: 0,
		insufficient_evidence_count: 0,
		written_count: 0,
		blocked_count: 0,
		failed_count: 0,
	},
	candidates: [
		{
			candidate_key: "hook:report_hook_1",
			class: "repairable",
			hook_report_ref: "report:report_hook_1",
			closeout_report_refs: ["report:report_closeout_1"],
			reason_ids: ["repairable_candidate"],
		},
	],
	next_action: {
		action_id: "execute_repair",
		summary: "Run correlate --execute to write validated private witnesses.",
		side_effects: ["write"],
	},
} as const satisfies SkillFeedbackCorrelateResultData;

describe("skill-feedback U2 command contract", () => {
	test("declares valid facade-backed record, closeout, dashboard, review, health, purge, and correlate commands", () => {
		const result = parseCommandFacadeContract(skillFeedbackContracts, {
			path: "skills/skill-feedback/src/command-contract.ts",
			writeImplyingMutations: new Set([
				"capture",
				"closeout",
				"purge",
				"correlate",
			]),
		});

		expect(result.ok).toBe(true);
		expect(Object.keys(skillFeedbackContracts)).toEqual([
			"record",
			"closeout",
			"dashboard",
			"review",
			"health",
			"purge",
			"correlate",
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
		expect(SKILL_FEEDBACK_REVIEW_RESULT_SCHEMA_VERSION).toBe("8");
		expect(SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION).toBe("4");
		expect(discoveryTree().commands.dashboard).toMatchObject({
			json: false,
			output_modes: ["plain"],
		});
		expect(discoveryTree().commands.dashboard?.result_contract).toBeUndefined();
		expect(discoveryTree().commands.health?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_HEALTH_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_HEALTH_RESULT_SCHEMA_VERSION,
		});
		expect(discoveryTree().commands.purge?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_PURGE_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_PURGE_RESULT_SCHEMA_VERSION,
		});
		expect(discoveryTree().commands.correlate?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_CORRELATE_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION,
		});
		expect(skillFeedbackContracts.purge.sideEffects).toEqual(["write"]);
		expect(skillFeedbackContracts.purge.executionModes).toEqual([
			"dry_run",
			"normal",
		]);
		expect(skillFeedbackContracts.correlate.sideEffects).toEqual(["write"]);
		expect(skillFeedbackContracts.correlate.executionModes).toEqual([
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

	for (const [command, usage] of [
		["review", "review [--plain] [--repo <path>]"],
		["health", "health [--plain] [--repo <path>]"],
	] as const) {
		test(`${command} flags expose read-only JSON/plain repo targeting`, () => {
			const contract = skillFeedbackContracts[command];
			expect(Object.keys(contract.flags).sort()).toEqual(["--plain", "--repo"]);
			expect(contract.usage).toEqual([usage]);
			expect(contract.sideEffects).toEqual(["read"]);
			expect(contract.outputModes).toEqual(["json", "plain"]);
		});
	}

	test("dashboard exposes a read-only plain front door with repo targeting", () => {
		const contract = skillFeedbackContracts.dashboard;

		expect(contract.usage).toEqual(["dashboard [--repo <path>]"]);
		expect(Object.keys(contract.flags)).toEqual(["--repo"]);
		expect(contract.sideEffects).toEqual(["read"]);
		expect(contract.outputModes).toEqual(["plain"]);
		expect(contract.json).toBe(false);
		expect(contract.resultContract).toBeUndefined();
	});

	test("correlate flags expose preview and execute without trust-bearing inputs", () => {
		const flags = Object.keys(skillFeedbackContracts.correlate.flags).sort();

		expect(flags).toEqual(["--execute", "--plain", "--repo"]);
		expect(skillFeedbackContracts.correlate.usage).toEqual([
			"correlate [--plain] [--repo <path>] [--execute]",
		]);
		expect(skillFeedbackContracts.correlate.outputModes).toEqual([
			"json",
			"plain",
		]);
		for (const reserved of [
			"--hook-report-id",
			"--closeout-report-id",
			"--witness-id",
			"--skill-run-id",
			"--proof-status",
			"--trust",
		]) {
			expect(flags).not.toContain(reserved);
		}
	});

	test("declares plain decision readiness surfaces from result contracts", () => {
		expect(SKILL_FEEDBACK_DECISION_READINESS_SURFACES).toEqual([
			{ key: "runtime_capture", label: "runtime capture" },
			{ key: "claude_daily_pilot", label: "Claude daily pilot" },
			{
				key: "codex_trusted_skill_identity",
				label: "Codex Trusted skill identity",
			},
		]);
		for (const surface of SKILL_FEEDBACK_DECISION_READINESS_SURFACES) {
			expect(surface.key in healthResultFixture().claim_readiness).toBe(true);
			expect(surface.key in reviewResultV2Fixture().claim_readiness).toBe(true);
		}
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
		expect(parsed.data.claim_readiness.claude_daily_pilot.status).toBe("ready");
		expect(
			parsed.data.claim_readiness.codex_trusted_skill_identity.status,
		).toBe("blocked");
		expect(parsed.data.next_action.action_id).toBe("run-review");
	});

	test("accepts optional health read-target diagnostics", () => {
		const parsed = parseHealthResultData({
			...healthResultFixture(),
			read_target: {
				explicit: true,
				repo_root: "/repo",
				inbox_path: "/repo/.skill-feedback",
				target_path: "/repo/package",
			},
		});

		expect(parsed).toMatchObject({ kind: "ok" });
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
			{
				name: "bad health read-target field",
				mutate: (data) => {
					data.read_target = {
						explicit: true,
						repo_root: "/repo",
						inbox_path: "/repo/.skill-feedback",
						git_exit_code: 128,
					};
				},
				path: "read_target.git_exit_code",
				reason: "unknown_field",
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

	test("validates correlate result output at the contract boundary", () => {
		const parsed = parseCorrelateResultData(MINIMAL_CORRELATE_RESULT);

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected valid correlate result");
		expect(parsed.data.contract).toBe(SKILL_FEEDBACK_CORRELATE_CONTRACT_ID);
		expect(parsed.data.schema_version).toBe(
			SKILL_FEEDBACK_CORRELATE_RESULT_SCHEMA_VERSION,
		);
		expect(parsed.data.next_action.action_id).toBe("execute_repair");
	});

	test("rejects invalid correlate result classes and public trust fields", () => {
		expect(
			parseCorrelateResultData({
				...MINIMAL_CORRELATE_RESULT,
				candidates: [
					{
						...MINIMAL_CORRELATE_RESULT.candidates[0],
						class: "trusted",
					},
				],
			}),
		).toMatchObject({
			kind: "invalid",
			path: "candidates[0].class",
			reason: "invalid_candidate_class",
		});
		expect(
			parseCorrelateResultData({
				...MINIMAL_CORRELATE_RESULT,
				witness_id: "witness_public_input",
			}),
		).toMatchObject({
			kind: "invalid",
			path: "witness_id",
			reason: "unknown_field",
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
		expect(parsed.data.engineering_signals).toHaveLength(1);
		expect(parsed.data.anchor_miss_telemetry).toHaveLength(1);
		expect(parsed.data.open_actions).toHaveLength(1);
		expect(parsed.data.inbox_status).toBe("populated");
		expect(parsed.data.counts).toMatchObject({
			primary: 2,
			low_signal: 1,
			unlinked_primary: 1,
		});
		expect(parsed.data.warnings.map((warning) => warning.reason_id)).toEqual([
			"unlinked_primary_reports",
		]);
		expect(parsed.data.next_action.action_id).toBe("run-review");
		expect(parsed.data.claim_readiness.runtime_capture.status).toBe(
			"evidence_only",
		);
		expect(parsed.data.claim_readiness.claude_daily_pilot.status).toBe("ready");
		expect(
			parsed.data.claim_readiness.codex_trusted_skill_identity.status,
		).toBe("blocked");
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

	test("rejects malformed review health projection fields", () => {
		const cases: Array<{
			name: string;
			mutate: (data: Record<string, any>) => void;
			path: string;
			reason: string;
		}> = [
			{
				name: "invalid inbox status",
				mutate: (data) => {
					data.inbox_status = "trusted";
				},
				path: "inbox_status",
				reason: "invalid",
			},
			{
				name: "non-numeric count",
				mutate: (data) => {
					data.counts.primary = "two";
				},
				path: "counts.primary",
				reason: "expected_number",
			},
			{
				name: "invalid warning reason",
				mutate: (data) => {
					data.warnings[0].reason_id = "mystery_warning";
				},
				path: "warnings[0].reason_id",
				reason: "invalid_warning_reason",
			},
			{
				name: "invalid next action",
				mutate: (data) => {
					data.next_action.action_id = "delete-reports";
				},
				path: "next_action.action_id",
				reason: "invalid_action_id",
			},
		];

		for (const scenario of cases) {
			const data = structuredClone(reviewResultV2Fixture()) as Record<string, any>;
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
				name: "engineering signal reason",
				mutate: (data) => {
					data.engineering_signals[0].reason = "mystery_signal";
				},
				path: "engineering_signals[0].reason",
			},
			{
				name: "engineering signal source",
				mutate: (data) => {
					data.engineering_signals[0].source_mix[0] = "manual_note";
				},
				path: "engineering_signals[0].source_mix[0]",
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

	test("rejects malformed engineering signal shape", () => {
		const cases: Array<{
			name: string;
			mutate: (data: Record<string, any>) => void;
			path: string;
			reason: string;
		}> = [
			{
				name: "missing signal array",
				mutate: (data) => {
					delete data.engineering_signals;
				},
				path: "engineering_signals",
				reason: "expected_array",
			},
			{
				name: "non-array signal field",
				mutate: (data) => {
					data.engineering_signals = {};
				},
				path: "engineering_signals",
				reason: "expected_array",
			},
			{
				name: "unsafe owner path",
				mutate: (data) => {
					data.engineering_signals[0].owner_path = "../outside";
				},
				path: "engineering_signals[0].owner_path",
				reason: "invalid_owner_path",
			},
			{
				name: "unknown signal field",
				mutate: (data) => {
					data.engineering_signals[0].severity = "high";
				},
				path: "engineering_signals[0].severity",
				reason: "unknown_field",
			},
			{
				name: "malformed evidence refs",
				mutate: (data) => {
					data.engineering_signals[0].evidence_refs = ["report:ok", 42];
				},
				path: "engineering_signals[0].evidence_refs[1]",
				reason: "expected_string",
			},
		];

		for (const scenario of cases) {
			const data = reviewResultV2Fixture() as Record<string, any>;
			scenario.mutate(data);

			expect(parseReviewResultData(data), scenario.name).toMatchObject({
				kind: "invalid",
				path: scenario.path,
				reason: scenario.reason,
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
			engineering_signals: [],
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
	} as const;
	const WRITER_PROOF_KEY = Buffer.from("11".repeat(32), "hex");

	function schema2Report(overrides: Record<string, unknown> = {}) {
		return {
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
			report_id: "report_v2_proof",
			untrusted_evidence: true,
			generated_ts: COMPLETE_RECEIPT.generated_ts,
			evidence_source: "hook_capture",
			capture_runtime: "claude_stop",
			skill_identity_provenance: {
				source: "claude_transcript_skill_tool_result",
				trusted: true,
				field: "toolUseResult.commandName",
				reason: "claude_transcript_detection",
			},
			correlation_status: "unlinked",
			skill: COMPLETE_CLOSEOUT.skill,
			skill_run_id: "run-runtime-1",
			skill_run_id_provenance: "runtime_owned",
			runtime: {
				git_sha: COMPLETE_RECEIPT.git_sha,
				skill_version: COMPLETE_RECEIPT.skill_version,
				model: COMPLETE_RECEIPT.model,
			},
			report_card: COMPLETE_CLOSEOUT,
			evidence_gaps: [],
			redactions: 0,
			...overrides,
		};
	}

	test("validates a complete closeout receipt with optional lanes", () => {
		const parsed = parseCloseoutReceipt(COMPLETE_CLOSEOUT);

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		expect(parsed.receipt.touched_surfaces).toHaveLength(2);
		expect(parsed.receipt.observations).toHaveLength(1);
		expect(parsed.evidence_gaps).toEqual([]);
	});

	test("rejects public closeout run id and correlation authority fields", () => {
		for (const field of [
			"skill_run_id",
			"skill_run_id_provenance",
			"correlation_owned",
			"witness_id",
		]) {
			expect(
				parseCloseoutReceipt({
					...COMPLETE_CLOSEOUT,
					[field]: "driver-authored authority",
				}),
			).toMatchObject({
				kind: "invalid",
				path: field,
				reason: "unknown_field",
			});
		}
	});

	test("accepts legacy closeout skill-run id only for persisted report-card reads", () => {
		const parsed = parseCloseoutReceipt(
			{
				...COMPLETE_CLOSEOUT,
				skill_run_id: "legacy-run-id",
			},
			{ allowLegacySkillRunId: true },
		);

		expect(parsed.kind).toBe("ok");
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		expect("skill_run_id" in parsed.receipt).toBe(false);
		expect(parsed.receipt).toMatchObject(COMPLETE_CLOSEOUT);
	});

	test("rejects malformed legacy closeout skill-run id in persisted report-card reads", () => {
		expect(
			parseCloseoutReceipt(
				{
					...COMPLETE_CLOSEOUT,
					skill_run_id: 7,
				},
				{ allowLegacySkillRunId: true },
			),
		).toMatchObject({
			kind: "invalid",
			path: "skill_run_id",
			reason: "expected_string",
		});
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

	test("rejects invalid writer proof nonces before signing", () => {
		const report = schema2Report();

		expect(() =>
			createWriterProof(report, WRITER_PROOF_KEY, "not-a-hex-nonce"),
		).toThrow("writer proof nonce must be 32-char lowercase hex");
		expect(() =>
			createWriterProof(report, WRITER_PROOF_KEY, "AA".repeat(16)),
		).toThrow("writer proof nonce must be 32-char lowercase hex");
		expect(() =>
			createWriterProof(report, WRITER_PROOF_KEY, "ab".repeat(16)),
		).not.toThrow();
	});

	test("creates and verifies stable correlation witness proof", () => {
		const witness = createCorrelationWitness(
			{
				skill: "create-skill",
				runtime_source: "claude_stop",
				hook_report_id: "hook_1111111111111111",
				closeout_report_id: "closeout_2222222222222222",
				skill_run_id: "run-trusted",
				created_ts: "2026-06-25T00:00:00.000Z",
			},
			WRITER_PROOF_KEY,
			"ef".repeat(16),
		);

		expect(witness.schema_version).toBe(
			SKILL_FEEDBACK_CORRELATION_WITNESS_SCHEMA_VERSION,
		);
		expect(witness.witness_id).toMatch(/^witness_[0-9a-f]{16}$/);
		expect(witness.correlation_proof).toMatchObject({
			algorithm: "hmac-sha256",
			nonce: "ef".repeat(16),
			signed_fields: [
				"schema_version",
				"witness_id",
				"skill",
				"runtime_source",
				"hook_report_id",
				"closeout_report_id",
				"skill_run_id",
				"created_ts",
				"correlation_proof.nonce",
			],
		});
		expect(verifyCorrelationWitness(witness, WRITER_PROOF_KEY)).toEqual({
			verified: true,
			diagnostics: [],
			witness,
		});
	});

	test("correlation witness proof rejects tampered link fields", () => {
		const witness = createCorrelationWitness(
			{
				skill: "create-skill",
				runtime_source: "claude_stop",
				hook_report_id: "hook_original",
				closeout_report_id: "closeout_original",
				skill_run_id: "run-trusted",
				created_ts: "2026-06-25T00:00:00.000Z",
			},
			WRITER_PROOF_KEY,
			"fa".repeat(16),
		);

		for (const tampered of [
			{ ...witness, hook_report_id: "hook_other" },
			{ ...witness, closeout_report_id: "closeout_other" },
			{ ...witness, skill: "fallow" },
		]) {
			const verified = verifyCorrelationWitness(tampered, WRITER_PROOF_KEY);
			expect(verified.verified).toBe(false);
			expect(verified.diagnostics).toContain(
				"correlation_witness_signature_mismatch",
			);
		}
	});

	test("correlation witness schema and path rules fail closed", () => {
		const witness = createCorrelationWitness(
			{
				skill: "create-skill",
				runtime_source: "claude_stop",
				hook_report_id: "hook_1111111111111111",
				closeout_report_id: "closeout_2222222222222222",
				skill_run_id: "run-trusted",
				created_ts: "2026-06-25T00:00:00.000Z",
			},
			WRITER_PROOF_KEY,
			"fb".repeat(16),
		);

		expect(
			verifyCorrelationWitness(
				{ ...witness, schema_version: "999" },
				WRITER_PROOF_KEY,
			),
		).toEqual({
			verified: false,
			diagnostics: ["correlation_witness_schema_unsupported"],
		});
		expect(isSafeCorrelationWitnessFileName(`${witness.witness_id}.json`)).toBe(
			true,
		);
		expect(isSafeCorrelationWitnessFileName("../witness_bad.json")).toBe(false);
		expect(isSafeCorrelationWitnessFileName(`${witness.witness_id}.json.tmp`)).toBe(
			false,
		);
		expect(correlationWitnessRelativePath(witness.witness_id)).toBe(
			`.correlation/${witness.witness_id}.json`,
		);
		expect(() => correlationWitnessRelativePath("../bad")).toThrow(
			"invalid correlation witness id",
		);
	});

	test("writer proof covers every persisted schema 2 report field", () => {
		const report = schema2Report();
		const signed = {
			...report,
			writer_proof: createWriterProof(report, WRITER_PROOF_KEY, "9a".repeat(16)),
		};
		const mutations: Array<[string, Record<string, unknown>]> = [
			["schema_version", { ...signed, schema_version: "3" }],
			["report_id", { ...signed, report_id: "report_v2_other" }],
			["untrusted_evidence", { ...signed, untrusted_evidence: false }],
			[
				"generated_ts",
				{ ...signed, generated_ts: "2026-06-11T08:01:00.000Z" },
			],
			["evidence_source", { ...signed, evidence_source: "driver_closeout" }],
			["capture_runtime", { ...signed, capture_runtime: "codex_stop" }],
			[
				"skill_identity_provenance",
				{
					...signed,
					skill_identity_provenance: {
						...(signed.skill_identity_provenance as Record<string, unknown>),
						field: "other.field",
					},
				},
			],
			["correlation_status", { ...signed, correlation_status: "linked" }],
			["skill_run_id", { ...signed, skill_run_id: "run-runtime-2" }],
			[
				"skill_run_id_provenance",
				{ ...signed, skill_run_id_provenance: "correlation_owned" },
			],
			["skill", { ...signed, skill: "fallow" }],
			["runtime", { ...signed, runtime: { ...signed.runtime, model: "other" } }],
			[
				"report_card",
				{
					...signed,
					report_card: { ...signed.report_card, goal: "Tampered goal." },
				},
			],
			[
				"evidence_gaps",
				{
					...signed,
					evidence_gaps: [
						{
							code: "cost_unavailable",
							field: "cost",
							message: "tampered",
						},
					],
				},
			],
			["redactions", { ...signed, redactions: 1 }],
		];

		for (const [field, mutated] of mutations) {
			const proof = verifyWriterProof(mutated, WRITER_PROOF_KEY);
			expect({ field, verified: proof.verified }).toEqual({
				field,
				verified: false,
			});
		}
	});

	test("writer proof rejects unsupported algorithms and mismatched signatures", () => {
		const report = schema2Report();
		const signed = {
			...report,
			writer_proof: createWriterProof(report, WRITER_PROOF_KEY, "56".repeat(16)),
		};

		expect(
			verifyWriterProof(
				{
					...signed,
					writer_proof: { ...signed.writer_proof, algorithm: "ed25519" },
				},
				WRITER_PROOF_KEY,
			),
		).toMatchObject({
			verified: false,
			diagnostics: ["writer_proof_algorithm_unsupported"],
		});
		expect(
			verifyWriterProof(
				{
					...signed,
					writer_proof: { ...signed.writer_proof, signature: "00".repeat(32) },
				},
				WRITER_PROOF_KEY,
			),
		).toMatchObject({
			verified: false,
			diagnostics: ["writer_proof_signature_mismatch"],
		});
	});

	test("writer-owned skill run ids are deterministic and purpose separated", () => {
		const key = Buffer.from("22".repeat(32), "hex");

		expect(deriveWriterOwnedSkillRunId(key, "detection-1")).toBe(
			deriveWriterOwnedSkillRunId(key, "detection-1"),
		);
		expect(deriveWriterOwnedSkillRunId(key, "detection-1")).not.toBe(
			deriveWriterOwnedSkillRunId(key, "detection-2"),
		);
		expect(deriveWriterOwnedSkillRunId(key, "detection-1")).toMatch(
			/^[0-9a-f]{64}$/,
		);
	});

	test("canonical writer proof payload rejects non-json inputs", () => {
		expect(() =>
			createWriterProof(
				schema2Report({ runtime: { model: Number.NaN } }),
				WRITER_PROOF_KEY,
				"ef".repeat(16),
			),
		).toThrow();
		const sparse = [] as unknown[];
		sparse[1] = { code: "cost_unavailable" };
		expect(() =>
			createWriterProof(
				schema2Report({ evidence_gaps: sparse }),
				WRITER_PROOF_KEY,
				"12".repeat(16),
			),
		).toThrow();
		expect(() =>
			createWriterProof(
				schema2Report({
					runtime: { toJSON: () => ({ model: "spoofed" }) },
				}),
				WRITER_PROOF_KEY,
				"34".repeat(16),
			),
		).toThrow();
	});

	test("public receipts cannot self-assert signed trust-bearing fields", () => {
		expect(
			parseReceipt({
				...COMPLETE_RECEIPT,
				skill_run_id_provenance: "runtime_owned",
			}),
		).toMatchObject({ kind: "unknown-field", field: "skill_run_id_provenance" });
		expect(
			parseCloseoutReceipt({
				...COMPLETE_CLOSEOUT,
				skill_run_id_provenance: "runtime_owned",
			}),
		).toMatchObject({
			kind: "invalid",
			path: "skill_run_id_provenance",
			reason: "unknown_field",
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
