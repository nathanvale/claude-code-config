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
	SKILL_FEEDBACK_REVIEW_CONTRACT_ID,
	SKILL_FEEDBACK_OUTCOMES,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type Receipt,
	type SkillFeedbackCommand,
	buildSoftwareLearningReport,
	normalizeReport,
	parseCloseoutReceipt,
	parseReceipt,
	skillFeedbackContracts,
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

describe("skill-feedback U2 command contract", () => {
	test("declares valid facade-backed record, closeout, and review commands", () => {
		const result = parseCommandFacadeContract(skillFeedbackContracts, {
			path: "skills/skill-feedback/src/command-contract.ts",
			writeImplyingMutations: new Set(["capture", "closeout"]),
		});

		expect(result.ok).toBe(true);
		expect(Object.keys(skillFeedbackContracts)).toEqual([
			"record",
			"closeout",
			"review",
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
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		});
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
