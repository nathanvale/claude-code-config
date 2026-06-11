import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	createCliRuntimeSuccessEnvelope,
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	NARRATED_FIELDS,
	RECEIPT_FIELDS,
	SKILL_FEEDBACK_CONTRACT_ID,
	SKILL_FEEDBACK_OUTCOMES,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type Receipt,
	type SkillFeedbackCommand,
	buildSoftwareLearningReport,
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
	test("declares a valid facade-backed record command", () => {
		const result = parseCommandFacadeContract(skillFeedbackContracts, {
			path: "skills/skill-feedback/src/command-contract.ts",
			writeImplyingMutations: new Set(["capture"]),
		});

		expect(result.ok).toBe(true);
		expect(Object.keys(skillFeedbackContracts)).toEqual(["record"]);
		expect(discoveryTree().commands.record?.result_contract).toMatchObject({
			id: SKILL_FEEDBACK_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		});
	});

	test("record flags expose narrated inputs but not engine-read telemetry", () => {
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
