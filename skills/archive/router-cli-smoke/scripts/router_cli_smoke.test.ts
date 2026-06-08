import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function runSmokeArtifact(
	suite: "core" | "hints",
): Promise<Record<string, unknown>> {
	const dir = await mkdtemp(join(tmpdir(), "router-secret-token-smoke-"));
	cleanupPaths.push(dir);
	const outDir = join(dir, "secret-token-artifacts");
	const artifactPrefix =
		suite === "core"
			? "router-cli-smoke-responses-100-"
			: "router-cli-hints-observability-recovery-100-";
	const result = spawnSync(
		"node",
		[
			"skills/router-cli-smoke/scripts/router_cli_smoke.mjs",
			"--suite",
			suite,
			"--out-dir",
			outDir,
			"--timestamp",
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
			timeout: 120000,
			killSignal: "SIGKILL",
		},
	);

	expect(result.error).toBeUndefined();
	expect(result.status).toBe(0);
	const files = await readdir(outDir);
	const artifactFile = files.find((file) => file.startsWith(artifactPrefix));
	expect(artifactFile).toBeDefined();
	const artifact = await readFile(join(outDir, artifactFile ?? ""), "utf8");
	return JSON.parse(artifact) as Record<string, unknown>;
}

describe("router CLI smoke artifact", () => {
	test("persists the artifact schema metadata and response records", async () => {
		const artifact = await runSmokeArtifact("core");
		const responses = artifact.responses as Record<string, Record<string, unknown>>;
		const routeSuccess = Object.values(responses).find(
			(response) =>
				response.case_kind === "coverage" &&
				response.input_source === "file" &&
				response.expected_status === "ok" &&
				response.output_format === "json" &&
				Array.isArray(response.command) &&
				response.command.includes("route"),
		);

		expect(artifact).toMatchObject({
			schema_version: "1",
			cwd: ".",
			suite: "core",
			suite_focus: "core_route_report_status_cli_smoke",
			evaluation_date: "2026-06-10",
			summary: { total: 100, pass: 100, fail: 0 },
		});
		expect(artifact.temp_fixture_dir).toMatch(/^\[redacted-path:[0-9a-f]{12}\]$/);
		expect(artifact.script).not.toMatch(/^\//);
		expect(typeof artifact.artifact_id).toBe("string");
		expect(typeof artifact.parent_run_id).toBe("string");
		expect(typeof artifact.generated_at).toBe("string");
		expect(Array.isArray(artifact.generator_command)).toBe(true);
		expect(artifact.runtime).toMatchObject({
			platform: process.platform,
			arch: process.arch,
		});
		expect(typeof (artifact.runtime as { node?: unknown }).node).toBe("string");
		expect(typeof (artifact.runtime as { bun?: unknown }).bun).toBe("string");
		expect(typeof artifact.script_sha256).toBe("string");
		expect(routeSuccess).toBeDefined();
		expect(responses.report_verify_rejected).toMatchObject({
			expected_exit_code: 2,
			exit_code: 2,
			parse_status: "parsed",
			passed: true,
			parsed_stdout: {
				status: "error",
				error: { code: "usage_error", message: "unknown option: --verify" },
			},
		});
		expect(responses.route_ignores_implicit_latest_files).toMatchObject({
			expected_exit_code: 20,
			exit_code: 20,
			parse_status: "parsed",
			passed: true,
			parsed_stdout: {
				status: "error",
				error: { code: "route_evidence_invalid" },
			},
		});
		expect(routeSuccess?.stdout_bytes).toBe(
			Buffer.byteLength(String(routeSuccess?.stdout), "utf8"),
		);
		expect(routeSuccess?.stderr_bytes).toBe(
			Buffer.byteLength(String(routeSuccess?.stderr), "utf8"),
		);
		expect(routeSuccess).toMatchObject({
			case_kind: "coverage",
			case_intent: "expected_cli_success",
			input_source: "file",
			expected_exit_code: 0,
			expected_status: "ok",
			exit_code: 0,
			output_format: "json",
			parse_status: "parsed",
			stdout_bytes: expect.any(Number),
			stderr_bytes: expect.any(Number),
			passed: true,
		});
		expect(Array.isArray(routeSuccess.command)).toBe(true);
		expect(typeof routeSuccess.command_sha256).toBe("string");
		expect(Array.isArray(routeSuccess.assertions)).toBe(true);
		expect(routeSuccess.parsed_stdout).toMatchObject({ status: "ok" });
	}, 15000);

	test("persists redacted commands and hashed captured inputs", async () => {
		const hintsArtifact = await runSmokeArtifact("hints");
		const hintsResponses = hintsArtifact.responses as Record<
			string,
			Record<string, unknown>
		>;
		const generatorCommand = hintsArtifact.generator_command as string[];
		const envRecord = hintsResponses.obs_bad_env_json_recovery.env as Record<
			string,
			Record<string, unknown>
		>;
		const sensitiveFlagRecord = hintsResponses.usage_redacts_sensitive_flag;
		const redactedPathRecord = hintsResponses.obs_missing_file_redacted;

		expect(generatorCommand).toContain("[redacted]");
		expect(generatorCommand.join(" ")).not.toContain("secret-token-artifacts");
		expect(envRecord.BROWSER_USE_ROUTER_ENVELOPE_JSON).toMatchObject({
			sha256: expect.any(String),
			bytes: expect.any(Number),
		});
		expect(
			JSON.stringify(envRecord.BROWSER_USE_ROUTER_ENVELOPE_JSON),
		).not.toContain("smoke-envelope-run");
		expect(sensitiveFlagRecord.command).toContain("[redacted]");
		expect(JSON.stringify(sensitiveFlagRecord)).not.toContain(
			"/Users/example/secret",
		);
		expect(sensitiveFlagRecord.parsed_stdout).toMatchObject({
			error: { message: "unknown option: [redacted]" },
		});
		expect(redactedPathRecord.command).toContain("[redacted]");
		expect(JSON.stringify(redactedPathRecord)).not.toContain(
			"/Users/example/private.json",
		);
	}, 15000);
});
