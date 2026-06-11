import { describe, expect, test } from "bun:test";
import {
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import { recordDecisionContracts } from "./command-contract.ts";
import { runForTest, type RecordDecisionRuntime } from "./record-decision.ts";
import { parseDecisionInput } from "./record-engine.ts";

const VALID_INPUT = `---
accepted: true
owner: agent-cli-evaluation
source:
  - docs/research/2026-06-11-agent-cli-seam-contract.md
  - "2026-06-11 Codex session: CLI seam contract grilling"
decision: Require crispy edges
log_path: docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md
allow_create: false
---

## Decision

- Toasties need a crisp edge check.

## Rationale

Crispy edges prove the grill worked.

## Consequences

Future toasties need edge checks.

## Next

Review the dry-run plan.

## V2 Ideas

- Add execute writes later.
`;

const UNACCEPTED_INPUT = VALID_INPUT.replace("accepted: true", "accepted: false");

function runtimeFor(text: string): RecordDecisionRuntime {
	return {
		now: () => 1_000,
		readTextFile: async () => text,
	};
}

function parseEnvelope(result: { stdout: string }) {
	return JSON.parse(result.stdout);
}

describe("record-decision command contract", () => {
	test("declares valid facade contracts", () => {
		const parsed = parseCommandFacadeContract(recordDecisionContracts, {
			path: "skills/record-decision/src/command-contract.ts",
			writeImplyingMutations: new Set(["write", "destructive"]),
		});
		expect(parsed.ok).toBe(true);
		expect(recordDecisionContracts.plan.flags).toHaveProperty("--input");
		expect(recordDecisionContracts.plan.flags).toHaveProperty("--json");
		expect(recordDecisionContracts.plan.flags).toHaveProperty("--execute");
	});

	test("help renders the plan flags advertised by the contract", async () => {
		const help = await runForTest(["--help"]);
		expect(help.exitCode).toBe(0);
		assertCommandHelpFlagSurface({
			command: "plan",
			contract: recordDecisionContracts.plan,
			help: help.stdout,
		});
	});
});

describe("record-decision discovery", () => {
	test("commands --json emits generated discovery metadata", async () => {
		const result = await runForTest(["commands", "--json"]);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.commands.plan.flags).toHaveProperty("--input");
		expect(envelope.data.commands.commands.usage).toContain(
			"record-decision commands --json",
		);
	});

	test("runtime discovery matches generated projection", async () => {
		const result = await runForTest(["commands", "--json"]);
		const envelope = parseEnvelope(result);
		const expected = projectCommandDiscoveryTree(
			[
				["plan", recordDecisionContracts.plan],
				["commands", recordDecisionContracts.commands],
			],
			{ includeFlagDescriptions: true },
		);
		expect(envelope.data).toEqual(expected);
	});

	test("requires json mode for discovery output", async () => {
		const result = await runForTest(["commands"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("requires --json");
	});
});

describe("record-decision dry-run planning", () => {
	test("parses inline sources and optional decision body", () => {
		const parsed = parseDecisionInput(
			VALID_INPUT.replace(
				/source:\n {2}- docs\/research\/2026-06-11-agent-cli-seam-contract.md\n {2}- "2026-06-11 Codex session: CLI seam contract grilling"/,
				'source: [docs/research/2026-06-11-agent-cli-seam-contract.md, "2026-06-11 Codex session: CLI seam contract grilling"]',
			),
		);
		expect(parsed.source).toEqual([
			{
				kind: "path",
				value: "docs/research/2026-06-11-agent-cli-seam-contract.md",
			},
			{
				kind: "label",
				value: "2026-06-11 Codex session: CLI seam contract grilling",
			},
		]);
		expect(parsed.decisionBody).toContain("Toasties need a crisp edge check");
		expect(parsed.sections["V2 Ideas"]).toContain("execute writes later");
	});

	test("rejects malformed decision input before planning", () => {
		expect(() => parseDecisionInput("## Rationale\nMissing frontmatter")).toThrow(
			"YAML frontmatter",
		);
		expect(() =>
			parseDecisionInput(VALID_INPUT.replace("owner: agent-cli-evaluation", "owner")),
		).toThrow("Unsupported frontmatter line");
		expect(() =>
			parseDecisionInput(VALID_INPUT.replace("owner: agent-cli-evaluation\n", "")),
		).toThrow("Frontmatter requires owner");
		expect(() =>
			parseDecisionInput(VALID_INPUT.replace("allow_create: false", "allow_create: nope")),
		).toThrow("allow_create");
	});

	test("plans a mutation without writing files", async () => {
		const result = await runForTest(
			["--input", "decision.md", "--json", "--run-id", "record-plan-test"],
			runtimeFor(VALID_INPUT),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("ok");
		expect(envelope.run_id).toBe("record-plan-test");
		expect(envelope.data.target_log).toBe(
			"docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md",
		);
		expect(envelope.data.planned_mutations).toHaveLength(1);
		expect(envelope.data.changed_state).toBe("none");
	});

	test("accepts inline input flag syntax", async () => {
		const result = await runForTest(
			["--input=decision.md", "--json"],
			runtimeFor(VALID_INPUT),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.changed_state).toBe("none");
	});

	test("accepted false returns structured repair data", async () => {
		const result = await runForTest(
			["--input", "decision.md", "--json", "--run-id", "record-fail-test"],
			runtimeFor(UNACCEPTED_INPUT),
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.status).toBe("error");
		expect(envelope.run_id).toBe("record-fail-test");
		expect(envelope.error.code).toBe("acceptance_required");
		expect(envelope.data.changed_state).toBe("none");
		expect(envelope.data.retry_safe).toBe(false);
		expect(envelope.data.next_safe_action).toContain("accepted: true");
	});

	test("missing required section returns structured repair data", async () => {
		const result = await runForTest(
			["--input", "decision.md", "--json", "--run-id", "record-section-test"],
			runtimeFor(VALID_INPUT.replace("## V2 Ideas", "## Future Ideas")),
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("invalid_input");
		expect(envelope.error.message).toContain("## V2 Ideas");
		expect(envelope.data.changed_state).toBe("none");
	});

	test("unreadable input returns structured repair data", async () => {
		const result = await runForTest(
			["--input", "missing.md", "--json", "--run-id", "record-read-test"],
			{
				now: () => 1_000,
				readTextFile: async () => {
					throw new Error("missing");
				},
			},
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("input_unreadable");
		expect(envelope.error.message).toContain("missing.md");
		expect(envelope.data.changed_state).toBe("none");
	});

	test("execute mode is explicitly deferred", async () => {
		const result = await runForTest([
			"--input",
			"decision.md",
			"--execute",
			"--json",
		]);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("execute_deferred");
		expect(envelope.data.changed_state).toBe("none");
	});

	test("planning requires json mode", async () => {
		const result = await runForTest(["--input", "decision.md"], runtimeFor(VALID_INPUT));
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("requires --json");
	});

	test("inline input flag requires a value", async () => {
		const result = await runForTest(["--input=", "--json"]);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.message).toContain("--input requires a value");
	});
});
