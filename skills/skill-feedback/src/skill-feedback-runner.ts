#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	type CliRuntimeSuccessEnvelope,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import {
	SKILL_FEEDBACK_CONTRACT_ID,
	SKILL_FEEDBACK_OUTCOMES,
	SKILL_FEEDBACK_SCHEMA_VERSION,
	type Receipt,
	type SkillFeedbackOutcome,
	type SoftwareLearningReport,
	buildSoftwareLearningReport,
	parseReceipt,
	skillFeedbackContracts,
} from "./command-contract";
import { redactSoftwareLearningReport } from "./redaction";

const RUNTIME_FAILURE_EXIT_CODE = 1;
const USAGE_EXIT_CODE = 2;
const INBOX_DIR = ".skill-feedback";

export type SkillFeedbackProcessResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	reportPath?: string;
};

export type SkillFeedbackRuntime = {
	repoRoot: () => string;
	readGitSha: () => Promise<string>;
	readSkillVersion: (skill: string) => Promise<string>;
	checkIgnored: (repoRoot: string, relativePath: string) => Promise<number>;
	mkdirPrivate: (path: string, mode: number) => Promise<void>;
	writePrivateFile: (path: string, content: string, mode: number) => Promise<void>;
	readText: (path: string) => Promise<string>;
};

export function createDefaultSkillFeedbackRuntime(
	overrides: Partial<SkillFeedbackRuntime> = {},
): SkillFeedbackRuntime {
	return {
		repoRoot: () => process.cwd(),
		readGitSha: async () => {
			const result = await runProcess(["git", "rev-parse", "HEAD"], process.cwd());
			return result.exitCode === 0 ? result.stdout.trim() : "";
		},
		readSkillVersion: async (skill) => skillVersionFromPackage(skill),
		checkIgnored: async (repoRoot, relativePath) => {
			const result = await runProcess(
				["git", "-C", repoRoot, "check-ignore", "--quiet", relativePath],
				repoRoot,
			);
			return result.exitCode;
		},
		mkdirPrivate: async (path, mode) => {
			await mkdir(path, { recursive: true, mode });
			await chmod(path, mode);
		},
		writePrivateFile: async (path, content, mode) => {
			const handle = await open(path, "wx", mode);
			try {
				await handle.writeFile(content, "utf-8");
			} finally {
				await handle.close();
			}
		},
		readText: (path) => readFile(path, "utf-8"),
		...overrides,
	};
}

export async function recordSkillFeedbackReceipt(
	rawReceipt: unknown,
	options: {
		runtime?: SkillFeedbackRuntime;
		runId?: string;
	} = {},
): Promise<SkillFeedbackProcessResult> {
	const runtime = options.runtime ?? createDefaultSkillFeedbackRuntime();
	const runId = options.runId ?? "skill-feedback-record";
	const repoRoot = resolve(runtime.repoRoot());

	const prepared = await prepareReceipt(rawReceipt, runtime);
	if (!prepared.ok) {
		const namesField =
			prepared.code === "unknown_receipt_field" ||
			prepared.code === "invalid_receipt_field";
		return errorResult(runId, USAGE_EXIT_CODE, prepared.code, prepared.message, {
			recoverability: "change_input",
			hint: namesField
				? prepared.message
				: "Fix the receipt shape and rerun skill-feedback record.",
		});
	}

	if (!isStrictIsoTimestamp(prepared.fields.generated_ts)) {
		return errorResult(
			runId,
			USAGE_EXIT_CODE,
			"invalid_generated_ts",
			"Receipt generated_ts must be a strict ISO timestamp.",
			{
				recoverability: "change_input",
				hint: "Pass generated_ts as an ISO string ending in Z.",
			},
		);
	}

	const parsed = parseReceipt(prepared.fields);
	if (parsed.kind !== "ok" && parsed.kind !== "degraded") {
		return errorResult(
			runId,
			USAGE_EXIT_CODE,
			"invalid_receipt",
			"Receipt did not match the skill-feedback schema.",
			{
				recoverability: "change_input",
				hint: "Remove unknown fields and correct field types.",
			},
		);
	}

	const report = buildSoftwareLearningReport(parsed);
	const redacted = redactSoftwareLearningReport(report).value;
	const ignoreStatus = await runtime.checkIgnored(repoRoot, `${INBOX_DIR}/`);
	if (ignoreStatus !== 0) {
		return errorResult(
			runId,
			RUNTIME_FAILURE_EXIT_CODE,
			"gitignore_gate_refused",
			"Skill-feedback inbox is not ignored by git.",
			{
				recoverability: "repair_state",
				hint: "Add .skill-feedback/ to the repo gitignore, then rerun.",
			},
		);
	}

	const inboxPath = join(repoRoot, INBOX_DIR);
	await runtime.mkdirPrivate(inboxPath, 0o700);
	const reportPath = join(inboxPath, reportFileName(redacted));
	await runtime.writePrivateFile(
		reportPath,
		`${JSON.stringify(redacted, null, "\t")}\n`,
		0o600,
	);

	const envelope = createCliRuntimeSuccessEnvelope({
		run_id: runId,
		data: redacted,
	}) satisfies CliRuntimeSuccessEnvelope<SoftwareLearningReport>;
	return {
		exitCode: 0,
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: "",
		reportPath,
	};
}

async function prepareReceipt(
	rawReceipt: unknown,
	runtime: SkillFeedbackRuntime,
): Promise<
	| { ok: true; fields: Partial<Receipt> }
	| { ok: false; code: string; message: string }
> {
	if (
		typeof rawReceipt !== "object" ||
		rawReceipt === null ||
		Array.isArray(rawReceipt)
	) {
		return {
			ok: false,
			code: "invalid_receipt",
			message: "Receipt must be an object.",
		};
	}

	const fields = { ...(rawReceipt as Record<string, unknown>) } as Partial<Receipt>;
	const preflight = parseReceipt(fields);
	if (preflight.kind === "unknown-field") {
		return {
			ok: false,
			code: "unknown_receipt_field",
			message: `Receipt contains unknown field ${preflight.field}.`,
		};
	}
	if (preflight.kind === "invalid") {
		return {
			ok: false,
			code: "invalid_receipt_field",
			message: `Receipt field ${preflight.field} is invalid.`,
		};
	}

	if (!fields.git_sha) {
		fields.git_sha = await runtime.readGitSha();
	}
	if (fields.skill && !fields.skill_version) {
		fields.skill_version = await runtime.readSkillVersion(fields.skill);
	}
	return { ok: true, fields };
}

function errorResult(
	runId: string,
	exitCode: number,
	code: string,
	message: string,
	options: {
		recoverability: "change_input" | "repair_state";
		hint: string;
	},
): SkillFeedbackProcessResult {
	const envelope = createCliRuntimeErrorEnvelope({
		run_id: runId,
		process_exit_code: exitCode,
		error: {
			run_id: runId,
			code,
			message,
			exit_code: exitCode,
			severity: exitCode === USAGE_EXIT_CODE ? "error" : "fatal",
			recoverability: options.recoverability,
			retryable: false,
			failure_domain: "skill_feedback",
			hint: {
				summary: options.hint,
				action:
					options.recoverability === "repair_state"
						? "repair_state"
						: "change_input",
			},
		},
		data: {
			changed_state: "none",
			contract: SKILL_FEEDBACK_CONTRACT_ID,
			schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
		},
	});
	return { exitCode, stdout: `${JSON.stringify(envelope)}\n`, stderr: "" };
}

function isStrictIsoTimestamp(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
		new Date(value).toISOString() === value
	);
}

function reportFileName(report: SoftwareLearningReport): string {
	const ts = report.generated_ts.replace(/[:.]/g, "-");
	const skill = report.skill.replace(/[^a-zA-Z0-9._-]/g, "_") || "unknown-skill";
	const hash = createHash("sha256")
		.update(JSON.stringify(report))
		.digest("hex")
		.slice(0, 12);
	return `${ts}-${skill}-${hash}.json`;
}

async function skillVersionFromPackage(skill: string): Promise<string> {
	const packagePath = join(process.cwd(), "skills", skill, "package.json");
	try {
		const raw = await readFile(packagePath, "utf-8");
		const parsed = JSON.parse(raw) as { version?: unknown };
		return typeof parsed.version === "string" ? parsed.version : "unknown";
	} catch {
		return "unknown";
	}
}

async function runProcess(
	command: readonly string[],
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn([...command], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

export async function runSkillFeedbackCli(
	argv: readonly string[],
	options: { runtime?: SkillFeedbackRuntime; runId?: string } = {},
): Promise<number> {
	if (argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(renderCommandUsage(skillFeedbackContracts.record));
		return 0;
	}
	const receipt = parseRecordFlags(argv);
	if (!receipt.ok) {
		const result = errorResult(
			options.runId ?? "skill-feedback-record",
			USAGE_EXIT_CODE,
			"usage_error",
			receipt.message,
			{
				recoverability: "change_input",
				hint: "Run skill-feedback record --help and retry with valid flags.",
			},
		);
		process.stdout.write(result.stdout);
		return result.exitCode;
	}
	const result = await recordSkillFeedbackReceipt(receipt.receipt, options);
	process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	return result.exitCode;
}

function parseRecordFlags(
	argv: readonly string[],
):
	| { ok: true; receipt: Partial<Receipt> }
	| { ok: false; message: string } {
	const args = argv[0] === "record" ? argv.slice(1) : argv;
	const receipt: Partial<Receipt> = {};
	for (let index = 0; index < args.length; index += 1) {
		const flag = args[index];
		const value = args[index + 1];
		if (!flag?.startsWith("--")) {
			return { ok: false, message: "Expected a record flag." };
		}
		if (value === undefined || value.startsWith("--")) {
			return { ok: false, message: `${flag} requires a value.` };
		}
		index += 1;
		switch (flag) {
			case "--skill":
				receipt.skill = value;
				break;
			case "--goal":
				receipt.goal = value;
				break;
			case "--outcome":
				if (
					SKILL_FEEDBACK_OUTCOMES.includes(value as SkillFeedbackOutcome)
				) {
					receipt.outcome = value as SkillFeedbackOutcome;
					break;
				}
				return { ok: false, message: "--outcome is invalid." };
			case "--friction":
				receipt.friction = value;
				break;
			case "--explanation":
				receipt.explanation = value;
				break;
			case "--generated-ts":
				receipt.generated_ts = value;
				break;
			default:
				return { ok: false, message: `Unknown flag ${flag}.` };
		}
	}
	return { ok: true, receipt };
}

if (import.meta.main) {
	const exitCode = await runSkillFeedbackCli(Bun.argv.slice(2));
	process.exit(exitCode);
}
