import {
	chmod,
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type { CloseoutReceipt, Receipt } from "./command-contract";
import {
	finalizeSkillFeedbackCorrelationWitness,
	type FinalizeCorrelationWitnessResult,
} from "./correlation-witness-workflow";
import type { WriterProofKeyRead } from "./inbox-read-model";
import {
	closeoutSkillFeedbackReceipt,
	recordSkillFeedbackReceipt,
	type SkillFeedbackRuntime,
} from "./skill-feedback-runner";

const cleanupPaths: string[] = [];
const GENERATED_TS = "2026-06-11T09:00:00.000Z";

const BASE_RECEIPT: Receipt = {
	skill: "create-skill",
	goal: "Repair the skill route.",
	outcome: "confirmed",
	friction: "Clean run.",
	explanation: "No extra explanation.",
	skill_version: "create-skill@0.1.0",
	git_sha: "1234567890abcdef1234567890abcdef12345678",
	model: "gpt-5-codex",
	usage: {
		input_tokens: 100,
		output_tokens: 30,
		cache_read_tokens: 12,
	},
	generated_ts: GENERATED_TS,
};

const BASE_CLOSEOUT: CloseoutReceipt = {
	skill: "create-skill",
	outcome: "confirmed",
	goal: "Repair the skill route.",
	friction: {
		category: "none",
		note: "Clean closeout.",
	},
	verification_burden: {
		level: "light",
		note: "Focused verification only.",
	},
	touched_surfaces: [{ type: "path", value: "skills/create-skill/SKILL.md" }],
	observations: [],
};

afterEach(async () => {
	await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("skill-feedback correlation witness workflow", () => {
	test("finalizes one verified hook and closeout pair", async () => {
		const root = await tempRoot();
		const runtime = stubRuntime(root);
		const capture = await recordSkillFeedbackReceipt(BASE_RECEIPT, {
			runtime,
			internalTelemetry: {
				model: "claude-opus-4-8",
				detectionId: "session:workflow-finalize",
				captureMetadata: { capture_runtime: "claude_stop" },
			},
			runId: "workflow-record",
		});
		const hookData = parseEnvelope(capture.stdout).data as {
			report_id: string;
			skill_run_id: string;
		};
		const closeout = await closeoutSkillFeedbackReceipt(BASE_CLOSEOUT, {
			runtime,
			runId: "workflow-closeout",
		});
		const closeoutData = parseEnvelope(closeout.stdout).data as {
			report_id: string;
			written_path: string;
			proof_status: string;
		};

		const result = await finalizeSkillFeedbackCorrelationWitness(
			{
				skill: BASE_RECEIPT.skill,
				hookReportId: hookData.report_id,
				skillRunId: hookData.skill_run_id,
				createdTs: GENERATED_TS,
				candidates: [
					{
						reportId: closeoutData.report_id,
						writtenPath: closeoutData.written_path,
						proofStatus: closeoutData.proof_status,
					},
				],
			},
			{ runtime, readWriterProofKey },
		);

		expect(result.status).toBe("written");
		const written = result as Extract<
			FinalizeCorrelationWitnessResult,
			{ status: "written" }
		>;
		const witness = JSON.parse(
			await readFile(join(root, written.witnessPath), "utf-8"),
		) as Record<string, unknown>;
		expect(witness).toMatchObject({
			schema_version: "1",
			witness_id: written.witnessId,
			hook_report_id: hookData.report_id,
			closeout_report_id: closeoutData.report_id,
			skill_run_id: hookData.skill_run_id,
		});
	});
});

async function tempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "skill-feedback-workflow-"));
	cleanupPaths.push(root);
	return root;
}

function stubRuntime(root: string): SkillFeedbackRuntime {
	return {
		repoRoot: () => root,
		resolveReadTarget: async () => ({
			ok: true,
			explicit: false,
			seedPath: root,
			repoRoot: root,
			inboxPath: join(root, ".skill-feedback"),
		}),
		readGitSha: async () => "1234567890abcdef1234567890abcdef12345678",
		readSkillVersion: async () => "create-skill@0.1.0",
		readStdinTelemetry: async () => ({}),
		readStdinText: async () => "",
		checkIgnored: async () => 0,
		mkdirPrivate: async (path, mode) => {
			await mkdir(path, { recursive: true, mode });
			await chmod(path, mode);
		},
		writePrivateFile: async (path, content, mode) => {
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			await writeFile(path, content, { mode });
			await chmod(path, mode);
		},
		removeFile: (path) => unlink(path),
		lstatPath: (path) => lstat(path),
		realpathPath: (path) => realpath(path),
		readText: (path) => readFile(path, "utf-8"),
		nowIso: () => GENERATED_TS,
	};
}

async function readWriterProofKey(
	repoRoot: string,
	runtime: SkillFeedbackRuntime,
): Promise<WriterProofKeyRead> {
	const raw = (
		await runtime.readText(join(repoRoot, ".skill-feedback", ".trust", "key"))
	).trim();
	return /^[0-9a-f]{64}$/.test(raw)
		? { ok: true, key: Buffer.from(raw, "hex"), diagnostics: [] }
		: { ok: false, diagnostics: ["trust_store_key_unusable"] };
}

function parseEnvelope(stdout: string): { data: unknown } {
	return JSON.parse(stdout) as { data: unknown };
}
