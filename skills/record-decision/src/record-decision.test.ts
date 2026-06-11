import { describe, expect, test } from "bun:test";
import {
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";
import { recordDecisionContracts } from "./command-contract.ts";
import { runForTest, type RecordDecisionRuntime } from "./record-decision.ts";
import { parseDecisionInput, prepareDecisionRecord } from "./record-engine.ts";

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
const REPO_ROOT = "/repo";
const TARGET_LOG_RELATIVE =
	"docs/decisions/2026-06-11-001-agent-cli-evaluation-decision-log.md";
const TARGET_LOG_PATH = `${REPO_ROOT}/${TARGET_LOG_RELATIVE}`;
const VALID_TARGET_LOG = `---
title: Agent CLI Evaluation Decision Log
slug: agent-cli-evaluation
type: decision-log
status: in-progress
date: "2026-06-11"
timezone: Australia/Melbourne
owner: agent-cli-evaluation
source:
  - "2026-06-11 Codex session: agent CLI evaluation"
decision_metadata_format: fenced-yaml-per-decision
---

# Agent CLI Evaluation Decision Log

## Frame

- Evaluate CLI contracts.

## Notes

- Preserve accepted choices.

## Decision 1: Existing Decision

\`\`\`yaml
id: agent-cli-evaluation-001
status: accepted
decided_at: "2026-06-11"
decision: Existing decision
owner: agent-cli-evaluation
source:
  - existing source
\`\`\`

Decision:

- Existing decision.

Rationale:

- Existing rationale.

Consequences:

- Existing consequence.

Next:

- Existing next.

V2 Ideas:

- Existing v2.
`;

type TestRuntime = RecordDecisionRuntime & {
	files: Map<string, string>;
	writes: string[];
	renames: Array<{ from: string; to: string }>;
	removes: string[];
};

function runtimeFor(
	text: string,
	options: {
		targetLog?: string | undefined;
		cwd?: string;
		inputPath?: string;
		failRename?: boolean;
	} = {},
): TestRuntime {
	const files = new Map<string, string>([
		[`${REPO_ROOT}/${options.inputPath ?? "decision.md"}`, text],
	]);
	if (Object.hasOwn(options, "targetLog")) {
		if (options.targetLog !== undefined) {
			files.set(TARGET_LOG_PATH, options.targetLog);
		}
	} else {
		files.set(TARGET_LOG_PATH, VALID_TARGET_LOG);
	}
	const writes: string[] = [];
	const renames: Array<{ from: string; to: string }> = [];
	const removes: string[] = [];
	return {
		now: () => Date.parse("2026-06-11T00:00:00.000Z"),
		cwd: () => options.cwd ?? REPO_ROOT,
		repoRoot: () => REPO_ROOT,
		readTextFile: async (path) => {
			const file = files.get(path);
			if (file === undefined) throw new Error(`missing ${path}`);
			return file;
		},
		writeTextFile: async (path, content) => {
			writes.push(path);
			files.set(path, content);
		},
		renameFile: async (from, to) => {
			renames.push({ from, to });
			if (options.failRename) throw new Error("rename failed");
			const file = files.get(from);
			if (file === undefined) throw new Error(`missing ${from}`);
			files.set(to, file);
			files.delete(from);
		},
		removeFile: async (path) => {
			removes.push(path);
			files.delete(path);
		},
		files,
		writes,
		renames,
		removes,
	};
}

function parseEnvelope(result: { stdout: string }) {
	return JSON.parse(result.stdout);
}

function expectTargetLogUnavailable(result: { exitCode: number; stdout: string }) {
	expect(result.exitCode).toBe(2);
	const envelope = parseEnvelope(result);
	expect(envelope.error.code).toBe("target_log_unavailable");
	expect(envelope.data.changed_state).toBe("none");
	return envelope;
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

	test("rejects incompatible or unavailable target logs before rendering", () => {
		const parsed = parseDecisionInput(VALID_INPUT);
		const createAllowed = parseDecisionInput(
			VALID_INPUT.replace("allow_create: false", "allow_create: true"),
		);
		expect(() =>
			prepareDecisionRecord(createAllowed, { decidedAt: "2026-06-11" }),
		).toThrow("Creating new decision logs");
		expect(() =>
			prepareDecisionRecord(parsed, {
				decidedAt: "2026-06-11",
				existingLogText: "# Missing frontmatter\n",
			}),
		).toThrow("missing frontmatter");
		expect(() =>
			prepareDecisionRecord(parsed, {
				decidedAt: "2026-06-11",
				existingLogText: VALID_TARGET_LOG.replace("slug: agent-cli-evaluation\n", ""),
			}),
		).toThrow("missing slug");
		expect(() =>
			prepareDecisionRecord(
				parseDecisionInput(
					VALID_INPUT.replace(`log_path: ${TARGET_LOG_RELATIVE}`, "log_path: ../nope.md"),
				),
				{ decidedAt: "2026-06-11", existingLogText: VALID_TARGET_LOG },
			),
		).toThrow("repo-relative path");
	});

	test("prepares rendered replacement from the target log metadata", () => {
		const prepared = prepareDecisionRecord(parseDecisionInput(VALID_INPUT), {
			decidedAt: "2026-06-11",
			existingLogText: VALID_TARGET_LOG,
		});
		expect(prepared.target).toEqual({
			target_log: TARGET_LOG_RELATIVE,
			target_exists: true,
			log_slug: "agent-cli-evaluation",
			decision_number: 2,
			decision_id: "agent-cli-evaluation-002",
		});
		expect(prepared.rendered_entry).toContain(
			"## Decision 2: Require crispy edges",
		);
		expect(prepared.replacement_text).toContain("id: agent-cli-evaluation-002");
		expect(prepared.validation.checked).toContain("replacement_content");
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
			expect(envelope.data.target_log).toBe(TARGET_LOG_RELATIVE);
			expect(envelope.data.proposed_decision_id).toBe("agent-cli-evaluation-002");
			expect(envelope.data.proposed_decision_number).toBe(2);
			expect(envelope.data.planned_mutations).toHaveLength(1);
			expect(envelope.data.planned_mutations[0]).toEqual({
				kind: "append_decision",
				target_log: TARGET_LOG_RELATIVE,
				decision_id: "agent-cli-evaluation-002",
				decision_number: 2,
			});
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

	test("resolves repo-relative input paths when package scripts change cwd", async () => {
		const result = await runForTest(
			["--input", "skills/record-decision/examples/decision.md", "--json"],
			runtimeFor(VALID_INPUT, {
				cwd: `${REPO_ROOT}/skills/record-decision`,
				inputPath: "skills/record-decision/examples/decision.md",
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = parseEnvelope(result);
		expect(envelope.data.proposed_decision_id).toBe("agent-cli-evaluation-002");
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
				now: () => Date.parse("2026-06-11T00:00:00.000Z"),
				cwd: () => REPO_ROOT,
				repoRoot: () => REPO_ROOT,
				readTextFile: async () => {
					throw new Error("missing");
				},
				writeTextFile: async () => undefined,
				renameFile: async () => undefined,
				removeFile: async () => undefined,
			},
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("input_unreadable");
		expect(envelope.error.message).toContain("missing.md");
		expect(envelope.data.changed_state).toBe("none");
	});

	test("default allow_create false blocks missing generated target log", async () => {
		const runtime = runtimeFor(
			VALID_INPUT.replace(`log_path: ${TARGET_LOG_RELATIVE}\nallow_create: false\n`, ""),
			{ targetLog: undefined },
		);
		const result = await runForTest(
			["--input", "decision.md", "--json"],
			runtime,
		);
		expectTargetLogUnavailable(result);
		expect(runtime.writes).toHaveLength(0);
	});

	test("missing target log returns structured repair data", async () => {
		const runtime = runtimeFor(VALID_INPUT, { targetLog: "" });
		runtime.files.delete(TARGET_LOG_PATH);
		const result = await runForTest(
			["--input", "decision.md", "--json"],
			runtime,
		);
		expectTargetLogUnavailable(result);
	});

	test("execute appends the same decision id returned by dry-run", async () => {
		const runtime = runtimeFor(VALID_INPUT);
		const dryRun = await runForTest(
			["--input", "decision.md", "--json", "--run-id", "record-plan-test"],
			runtime,
		);
		const dryRunEnvelope = parseEnvelope(dryRun);
		expect(runtime.writes).toHaveLength(0);

		const execute = await runForTest(
			[
				"--input",
				"decision.md",
				"--execute",
				"--json",
				"--run-id",
				"record-execute-test",
			],
			runtime,
		);
		expect(execute.exitCode).toBe(0);
		const executeEnvelope = parseEnvelope(execute);
		expect(executeEnvelope.status).toBe("ok");
		expect(executeEnvelope.data.created_decision_id).toBe(
			dryRunEnvelope.data.proposed_decision_id,
		);
		expect(executeEnvelope.data.completed_mutations[0]).toEqual(
			dryRunEnvelope.data.planned_mutations[0],
		);
		expect(executeEnvelope.data.changed_state).toBe("written");
		expect(executeEnvelope.data.retry_safe).toBe(false);
		expect(runtime.renames).toHaveLength(1);
		expect(runtime.files.get(TARGET_LOG_PATH)).toContain(
			"## Decision 2: Require crispy edges",
		);
		expect(runtime.files.get(TARGET_LOG_PATH)).toContain(
			"id: agent-cli-evaluation-002",
		);
	});

	test("write failure leaves target log unchanged and removes temp file", async () => {
		const runtime = runtimeFor(VALID_INPUT, { failRename: true });
		const originalTarget = runtime.files.get(TARGET_LOG_PATH);
		const result = await runForTest(
			["--input", "decision.md", "--execute", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		const envelope = parseEnvelope(result);
		expect(envelope.error.code).toBe("write_failed");
		expect(envelope.error.recoverability).toBe("repair_state");
		expect(envelope.data.changed_state).toBe("none");
		expect(runtime.files.get(TARGET_LOG_PATH)).toBe(originalTarget);
		expect(runtime.removes).toHaveLength(1);
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
