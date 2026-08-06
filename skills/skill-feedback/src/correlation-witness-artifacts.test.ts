// fallow-ignore-file unused-file, code-duplication
// Bun test entrypoint with private artifact fixtures; package runner invokes this file without static imports.
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
import {
	readCorrelationRepairArtifacts,
	writeCorrelationDiagnosticArtifact,
} from "./correlation-witness-artifacts";
import type { SkillFeedbackRuntime } from "./skill-feedback-runner";

const cleanupPaths: string[] = [];
const GENERATED_TS = "2026-06-11T09:00:00.000Z";

afterEach(async () => {
	await Promise.all(cleanupPaths.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("correlation witness artifacts", () => {
	test("writes and reads repairable diagnostic artifacts", async () => {
		const root = await tempRoot();
		const runtime = stubRuntime(root);

		const write = await writeCorrelationDiagnosticArtifact(
			{
				skill: "create-skill",
				hookReportId: "hook_report",
				hookWrittenPath: ".skill-feedback/hook.json",
				skillRunId: "run-123",
				createdTs: GENERATED_TS,
				candidates: [
					{
						reportId: "closeout_report",
						writtenPath: ".skill-feedback/closeout.json",
						proofStatus: "attached",
					},
				],
			},
			runtime,
			root,
			["correlation_candidate_missing"],
		);

		expect(write).toEqual({ ok: true });
		const read = await readCorrelationRepairArtifacts({
			repoRoot: root,
			runtime,
			proofKey: { ok: false, diagnostics: ["trust_store_key_missing"] },
		});

		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.verifiedWitnesses).toEqual([]);
		expect(read.diagnostics).toHaveLength(1);
		expect(read.diagnostics[0]?.artifact).toMatchObject({
			schema_version: "1",
			kind: "correlation_diagnostic",
			skill: "create-skill",
			hook_report_id: "hook_report",
			diagnostics: ["correlation_candidate_missing"],
			repair_candidates: [
				{
					source: "correlation_finalizer",
					closeout_report_id: "closeout_report",
					skill_run_id: "run-123",
				},
			],
		});
	});
});

async function tempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "skill-feedback-artifacts-"));
	cleanupPaths.push(root);
	await mkdir(join(root, ".skill-feedback"), { recursive: true, mode: 0o700 });
	await chmod(join(root, ".skill-feedback"), 0o700);
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
