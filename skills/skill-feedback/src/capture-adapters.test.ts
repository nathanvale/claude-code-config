import { describe, expect, test } from "bun:test";
import { RECEIPT_FIELDS, type Receipt } from "./command-contract";
import {
	ClaudeOtelAdapter,
	CodexJsonAdapter,
	type CaptureResult,
	type SkillFeedbackRuntime,
	assertHarnessId,
	selectAdapter,
} from "./capture-adapters";

const GENERATED_TS = "2026-06-11T08:30:00.000Z";

const runtime: SkillFeedbackRuntime = {
	readGitSha: async () => "b5f95be",
	readSkillVersion: async (skill) => `${skill}@0.1.0`,
};

function expectReceipt(result: CaptureResult): Receipt {
	expect(result.kind).toBe("receipt");
	if (result.kind !== "receipt") {
		throw new Error("expected complete receipt");
	}
	return result.receipt;
}

function receiptShape(receipt: Receipt): string[] {
	return Object.keys(receipt).sort();
}

describe("skill-feedback capture adapters", () => {
	test("Claude OTel spans normalize to a complete flat Receipt", async () => {
		const adapter = new ClaudeOtelAdapter(runtime);
		const result = await adapter.capture({
			spans: [
				{
					name: "claude_code.interaction",
					attributes: {
						"skill.name": "create-skill",
						"skill_feedback.goal": "Repair the skill route.",
						"skill_feedback.friction": "The owner path was split.",
						"skill_feedback.explanation": "Fixture explanation.",
						"skill_feedback.generated_ts": GENERATED_TS,
						success: true,
					},
					children: [
						{
							name: "claude_code.llm_request",
							attributes: {
								model: "claude-sonnet-4-20250514",
								input_tokens: 100,
								output_tokens: 30,
								cache_read_tokens: 12,
							},
						},
					],
				},
			],
		});

		const receipt = expectReceipt(result);
		expect(receipt).toEqual({
			skill: "create-skill",
			goal: "Repair the skill route.",
			outcome: "confirmed",
			friction: "The owner path was split.",
			explanation: "Fixture explanation.",
			skill_version: "create-skill@0.1.0",
			git_sha: "b5f95be",
			model: "claude-sonnet-4-20250514",
			usage: {
				input_tokens: 100,
				output_tokens: 30,
				cache_read_tokens: 12,
			},
			generated_ts: GENERATED_TS,
		});
		expect(receiptShape(receipt)).toEqual([...RECEIPT_FIELDS].sort());
	});

	test("Codex JSON turn.completed events normalize to the same Receipt shape", async () => {
		const adapter = new CodexJsonAdapter(runtime);
		const result = await adapter.capture({
			skill: "create-skill",
			goal: "Repair the skill route.",
			friction: "The owner path was split.",
			explanation: "Fixture explanation.",
			generated_ts: GENERATED_TS,
			events: [
				{
					type: "turn.completed",
					model: "gpt-5-codex",
					usage: {
						input_tokens: 100,
						cached_input_tokens: 12,
						output_tokens: 24,
						reasoning_output_tokens: 6,
					},
				},
			],
		});

		const receipt = expectReceipt(result);
		expect(receipt.outcome).toBe("confirmed");
		expect(receipt.model).toBe("gpt-5-codex");
		expect(receipt.usage).toEqual({
			input_tokens: 100,
			output_tokens: 30,
			cache_read_tokens: 12,
		});
		expect(receiptShape(receipt)).toEqual([...RECEIPT_FIELDS].sort());
	});

	test("Codex JSON turn.failed events map to a failed outcome", async () => {
		const adapter = new CodexJsonAdapter(runtime);
		const result = await adapter.capture({
			skill: "create-skill",
			goal: "Repair the skill route.",
			friction: "The run failed before the final check.",
			generated_ts: GENERATED_TS,
			events: [
				{
					type: "turn.failed",
					model: "gpt-5-codex",
					usage: {
						input_tokens: 80,
						cached_input_tokens: 10,
						output_tokens: 8,
						reasoning_output_tokens: 2,
					},
				},
			],
		});

		const receipt = expectReceipt(result);
		expect(receipt.outcome).toBe("failed");
		expect(receipt.usage.output_tokens).toBe(10);
	});

	test("Claude OTel missing token attrs returns degraded capture", async () => {
		const adapter = new ClaudeOtelAdapter(runtime);
		const result = await adapter.capture({
			spans: [
				{
					name: "claude_code.interaction",
					attributes: {
						skill: "create-skill",
						goal: "Repair the skill route.",
						friction: "No token usage was emitted.",
						generated_ts: GENERATED_TS,
						success: true,
					},
					children: [
						{
							name: "claude_code.llm_request",
							attributes: {
								model: "claude-sonnet-4-20250514",
							},
						},
					],
				},
			],
		});

		expect(result.kind).toBe("degraded");
		if (result.kind !== "degraded") {
			throw new Error("expected degraded capture");
		}
		expect(result.degraded).toContainEqual(
			expect.objectContaining({
				field: "usage",
				code: "missing-usage",
				harness: "claude-otel",
			}),
		);
	});

	test("Codex JSON truncated event streams return degraded capture", async () => {
		const adapter = new CodexJsonAdapter(runtime);
		const result = await adapter.capture({
			skill: "create-skill",
			goal: "Repair the skill route.",
			friction: "The event stream was truncated.",
			generated_ts: GENERATED_TS,
			events: [],
		});

		expect(result.kind).toBe("degraded");
		if (result.kind !== "degraded") {
			throw new Error("expected degraded capture");
		}
		expect(result.degraded.map((reason) => reason.field)).toEqual(
			expect.arrayContaining(["outcome", "usage", "model"]),
		);
	});

	test("selectAdapter routes known harnesses and rejects unknown harnesses", () => {
		expect(selectAdapter("claude-otel", runtime)).toBeInstanceOf(
			ClaudeOtelAdapter,
		);
		expect(selectAdapter("codex-json", runtime)).toBeInstanceOf(
			CodexJsonAdapter,
		);
		expect(() => assertHarnessId("unknown")).toThrow(
			/Unknown skill-feedback harness/,
		);
	});
});
