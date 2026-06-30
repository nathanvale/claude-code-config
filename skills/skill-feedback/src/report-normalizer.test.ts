// fallow-ignore-file unused-file, code-duplication
// Bun test entrypoint with persisted report fixtures; package runner invokes this file without static imports.
import { describe, expect, test } from "bun:test";
import {
	SKILL_FEEDBACK_COST_STATUS,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type Receipt,
	buildSoftwareLearningReport,
	createWriterProof,
	parseCloseoutReceipt,
	parseReceipt,
	verifyWriterProof,
} from "./command-contract";
import { normalizeReport } from "./report-normalizer";

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

function usableReport(raw: unknown) {
	const parsed = parseReceipt(raw);
	if (parsed.kind !== "ok" && parsed.kind !== "degraded") {
		throw new Error(`Receipt was not usable: ${parsed.kind}`);
	}
	return buildSoftwareLearningReport(parsed);
}

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

describe("skill-feedback report normalizer", () => {
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

	test("normalizes v0 reports into the review model", () => {
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
		expect(normalized.report.cost.status).toBe(
			SKILL_FEEDBACK_COST_STATUS.UNAVAILABLE,
		);
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
			schema_version: "1",
			report_id: "report_v1_1",
			untrusted_evidence: true,
			generated_ts: COMPLETE_RECEIPT.generated_ts,
			evidence_source: "driver_closeout",
			correlation_status: "linked",
			skill_run_id: "run-explicit-1",
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

	test("normalizes schema 2 closeout report with legacy report-card skill-run id as evidence-only", () => {
		const normalized = normalizeReport(
			schema2Report({
				evidence_source: "driver_closeout",
				capture_runtime: undefined,
				skill_identity_provenance: undefined,
				skill_run_id: undefined,
				skill_run_id_provenance: undefined,
				report_card: {
					...COMPLETE_CLOSEOUT,
					skill_run_id: "legacy-closeout-run",
				},
			}),
		);

		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		expect(normalized.report.evidence_source).toBe("driver_closeout");
		expect(normalized.report.skill_run_id).toBeUndefined();
		expect(normalized.report.skill_run_id_provenance).toBeUndefined();
		expect(normalized.report.skill).toBe(COMPLETE_CLOSEOUT.skill);
	});

	test("normalizes capture provenance fields and rejects invalid values", () => {
		const parsed = parseCloseoutReceipt(COMPLETE_CLOSEOUT);
		if (parsed.kind !== "ok") throw new Error("expected ok closeout");
		const baseReport = {
			schema_version: "1",
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
			schema_version: "1",
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

	test("preserves schema 2 run provenance only after valid writer proof", () => {
		const unsigned = schema2Report();
		const unsignedNormalized = normalizeReport(unsigned);

		expect(unsignedNormalized.kind).toBe("ok");
		if (unsignedNormalized.kind !== "ok") {
			throw new Error("expected normalized unsigned report");
		}
		expect(unsignedNormalized.report.skill_run_id).toBe("run-runtime-1");
		expect(unsignedNormalized.report.skill_run_id_provenance).toBeUndefined();

		const signed = {
			...unsigned,
			writer_proof: createWriterProof(unsigned, WRITER_PROOF_KEY, "ab".repeat(16)),
		};
		const proof = verifyWriterProof(signed, WRITER_PROOF_KEY);
		const normalized = normalizeReport(signed, proof);

		expect(proof).toEqual({ verified: true, diagnostics: [] });
		expect(normalized.kind).toBe("ok");
		if (normalized.kind !== "ok") throw new Error("expected normalized report");
		expect(normalized.report.skill_run_id_provenance).toBe("runtime_owned");
		expect(normalized.report.writer_proof_verified).toBe(true);
	});

	test("valid writer proof preserves only Claude Stop runtime-owned provenance", () => {
		const correlationOwnedHook = schema2Report({
			skill_run_id_provenance: "correlation_owned",
			correlation_status: "linked",
		});
		const signedCorrelationOwnedHook = {
			...correlationOwnedHook,
			writer_proof: createWriterProof(
				correlationOwnedHook,
				WRITER_PROOF_KEY,
				"ac".repeat(16),
			),
		};
		const normalizedCorrelationOwnedHook = normalizeReport(
			signedCorrelationOwnedHook,
			verifyWriterProof(signedCorrelationOwnedHook, WRITER_PROOF_KEY),
		);

		expect(normalizedCorrelationOwnedHook.kind).toBe("ok");
		if (normalizedCorrelationOwnedHook.kind !== "ok") {
			throw new Error("expected signed hook report to normalize");
		}
		expect(
			normalizedCorrelationOwnedHook.report.skill_run_id_provenance,
		).toBeUndefined();
		expect(normalizedCorrelationOwnedHook.report.writer_proof_verified).toBe(true);

		const {
			capture_runtime: _captureRuntime,
			skill_identity_provenance: _skillIdentityProvenance,
			...driverCloseout
		} = schema2Report({
			evidence_source: "driver_closeout",
			skill_run_id_provenance: "correlation_owned",
			correlation_status: "linked",
		});
		const signedDriverCloseout = {
			...driverCloseout,
			writer_proof: createWriterProof(
				driverCloseout,
				WRITER_PROOF_KEY,
				"ad".repeat(16),
			),
		};
		const normalizedDriverCloseout = normalizeReport(
			signedDriverCloseout,
			verifyWriterProof(signedDriverCloseout, WRITER_PROOF_KEY),
		);

		expect(normalizedDriverCloseout.kind).toBe("ok");
		if (normalizedDriverCloseout.kind !== "ok") {
			throw new Error("expected signed closeout report to normalize");
		}
		expect(normalizedDriverCloseout.report.skill_run_id_provenance).toBeUndefined();
		expect(normalizedDriverCloseout.report.writer_proof_verified).toBe(true);
	});

	test("downgrades copied or wrong-scope writer proof to evidence-only", () => {
		const report = schema2Report();
		const signed = {
			...report,
			writer_proof: createWriterProof(report, WRITER_PROOF_KEY, "cd".repeat(16)),
		};
		const tampered = {
			...signed,
			report_card: {
				...(signed.report_card as Record<string, unknown>),
				goal: "Tampered goal.",
			},
		};
		const tamperedProof = verifyWriterProof(tampered, WRITER_PROOF_KEY);
		const tamperedNormalized = normalizeReport(tampered, tamperedProof);

		expect(tamperedProof.verified).toBe(false);
		expect(tamperedProof.diagnostics).toContain(
			"writer_proof_content_digest_mismatch",
		);
		expect(tamperedNormalized.kind).toBe("ok");
		if (tamperedNormalized.kind !== "ok") {
			throw new Error("expected tampered report to stay readable");
		}
		expect(tamperedNormalized.report.skill_run_id_provenance).toBeUndefined();

		const wrongScope = {
			...signed,
			writer_proof: {
				...signed.writer_proof,
				signed_fields: signed.writer_proof.signed_fields.filter(
					(field) => field !== "skill_run_id_provenance",
				),
			},
		};
		expect(verifyWriterProof(wrongScope, WRITER_PROOF_KEY)).toMatchObject({
			verified: false,
			diagnostics: ["writer_proof_signed_fields_mismatch"],
		});
	});

	test("normalization rejects unsupported schema 2 dispatch versions", () => {
		expect(normalizeReport({ ...schema2Report(), schema_version: "3" })).toEqual({
			kind: "invalid",
			path: "schema_version",
			reason: "unsupported",
		});
	});

	test("normalization rejects malformed schema 2 persisted fields", () => {
		const cases: Array<{
			name: string;
			overrides: Record<string, unknown>;
			path: string;
			reason: string;
		}> = [
			{
				name: "unknown field",
				overrides: { unexpected: "field" },
				path: "unexpected",
				reason: "unknown_field",
			},
			{
				name: "report id",
				overrides: { report_id: 7 },
				path: "report_id",
				reason: "expected_string",
			},
			{
				name: "untrusted marker",
				overrides: { untrusted_evidence: false },
				path: "untrusted_evidence",
				reason: "expected_true",
			},
			{
				name: "generated timestamp",
				overrides: { generated_ts: 7 },
				path: "generated_ts",
				reason: "expected_string",
			},
			{
				name: "skill",
				overrides: { skill: 7 },
				path: "skill",
				reason: "expected_string",
			},
			{
				name: "evidence source",
				overrides: { evidence_source: "transcript" },
				path: "evidence_source",
				reason: "invalid_evidence_source",
			},
			{
				name: "correlation status",
				overrides: { correlation_status: "maybe" },
				path: "correlation_status",
				reason: "invalid_correlation_status",
			},
			{
				name: "skill run id",
				overrides: { skill_run_id: 7 },
				path: "skill_run_id",
				reason: "expected_string",
			},
			{
				name: "skill run provenance without id",
				overrides: {
					skill_run_id: undefined,
					skill_run_id_provenance: "runtime_owned",
				},
				path: "skill_run_id_provenance",
				reason: "missing_skill_run_id",
			},
			{
				name: "report card",
				overrides: {
					report_card: { ...COMPLETE_CLOSEOUT, friction: 7 },
				},
				path: "report_card.friction",
				reason: "expected_object",
			},
			{
				name: "evidence gaps",
				overrides: {
					evidence_gaps: [
						{ code: "cost_unavailable", path: 7, message: "Cost missing." },
					],
				},
				path: "evidence_gaps[0].path",
				reason: "expected_string",
			},
		];

		for (const testCase of cases) {
			expect(normalizeReport(schema2Report(testCase.overrides))).toMatchObject({
				kind: "invalid",
				path: testCase.path,
				reason: testCase.reason,
			});
		}
	});
});
