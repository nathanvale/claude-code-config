import { join } from "node:path";
import type { StorybookDoctorRuntime } from "./storybook-doctor-runtime.ts";
import type {
	DeepEvidence,
	DeepResult,
	ReadinessFinding,
	ReadinessResult,
} from "./readiness-model.ts";
import { aggregateStatus, type CheckOptions, pickNextSafeAction, runCheck } from "./readiness-engine.ts";

const DEEP_OUTPUT_BUDGET_BYTES = 8_192;
const DOCTOR_TIMEOUT_MS = 30_000;
const TOKEN_LIKE_PATTERN =
	/(?:^|[\s=:])(?:sk-|ghp_|ghs_|npm_|xoxb-|xoxp-|AKIA)[A-Za-z0-9_\-/+=]{10,}/g;
const ENV_LIKE_PATTERN =
	/(?:^|[\s=:])(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*\s*=\s*\S+/gi;

export async function runDeep(
	runtime: StorybookDoctorRuntime,
	options: CheckOptions,
): Promise<DeepResult> {
	const checkResult = await runCheck(runtime, options);
	const deepEvidence = await collectDeepEvidence(runtime, checkResult);

	const findings: ReadinessFinding[] = [...checkResult.findings];
	if (checkResult.status !== "blocked") {
		applyDeepFindings(findings, deepEvidence);
	}

	const status = aggregateStatus(findings);

	const nextAction = pickNextSafeAction(findings);

	return {
		status,
		findings,
		next_safe_action: nextAction,
		target: checkResult.target,
		session: checkResult.session,
		deep: deepEvidence,
	};
}

async function collectDeepEvidence(
	runtime: StorybookDoctorRuntime,
	checkResult: ReadinessResult,
): Promise<DeepEvidence> {
	const localBinary = findLocalStorybookBinary(runtime, checkResult);
	if (checkResult.status === "blocked") {
		return {
			local_binary_found: localBinary !== null,
			doctor_exit_code: null,
			doctor_summary: [],
			truncated: false,
			redacted_count: 0,
		};
	}
	if (!localBinary) {
		return {
			local_binary_found: false,
			doctor_exit_code: null,
			doctor_summary: [],
			truncated: false,
			redacted_count: 0,
		};
	}

	try {
		const result = await runtime.execCommand(
			localBinary,
			["doctor", "--debug"],
			{
				cwd: checkResult.target.resolved_path,
				timeout: DOCTOR_TIMEOUT_MS,
			},
		);

		const combined = `${result.stdout}\n${result.stderr}`;
		const { lines, truncated, redactedCount } = sanitizeOutput(combined);

		return {
			local_binary_found: true,
			doctor_exit_code: result.exitCode,
			doctor_summary: lines,
			truncated,
			redacted_count: redactedCount,
		};
	} catch (error) {
		return {
			local_binary_found: true,
			doctor_exit_code: null,
			doctor_summary: ["Storybook doctor execution failed: " + (error instanceof Error ? error.message : "unknown error")],
			truncated: false,
			redacted_count: 0,
		};
	}
}

function findLocalStorybookBinary(
	runtime: StorybookDoctorRuntime,
	checkResult: ReadinessResult,
): string | null {
	const targetPath = checkResult.target.resolved_path;
	const candidates = [
		join(targetPath, "node_modules", ".bin", "storybook"),
		join(targetPath, "node_modules", ".bin", "sb"),
	];
	for (const candidate of candidates) {
		if (runtime.fileExists(candidate)) return candidate;
	}
	return null;
}

function applyDeepFindings(
	findings: ReadinessFinding[],
	evidence: DeepEvidence,
): void {
	if (!evidence.local_binary_found) {
		findings.push({
			id: "local_storybook_binary_missing",
			category: "local_tool_gap",
			severity: "degraded",
			message:
				"No local Storybook binary found in node_modules/.bin. Install storybook in the target project.",
		});
		return;
	}

	if (evidence.doctor_exit_code === null) {
		findings.push({
			id: "storybook_doctor_exec_failed",
			category: "doctor_finding",
			severity: "degraded",
			message: "Local Storybook doctor failed to execute (timeout or spawn error).",
			detail: evidence.doctor_summary.slice(0, 3).join("\n"),
		});
		return;
	}

	if (evidence.doctor_exit_code !== null && evidence.doctor_exit_code !== 0) {
		findings.push({
			id: "storybook_doctor_nonzero",
			category: "doctor_finding",
			severity: "degraded",
			message: `Local Storybook doctor exited with code ${evidence.doctor_exit_code}.`,
			detail: evidence.doctor_summary.slice(0, 5).join("\n"),
		});
	}

	if (evidence.doctor_exit_code === 0) {
		findings.push({
			id: "deep_local_doctor_ok",
			category: "deep_proof",
			severity: "ready",
			message: "Local Storybook doctor reports no issues.",
		});
	}

	if (evidence.truncated) {
		findings.push({
			id: "debug_output_truncated",
			category: "output_safety",
			severity: "ready",
			message: `Debug output truncated to ${DEEP_OUTPUT_BUDGET_BYTES} byte budget.`,
		});
	}
}

function sanitizeOutput(raw: string): {
	lines: string[];
	truncated: boolean;
	redactedCount: number;
} {
	let truncated = false;
	let text = raw;

	if (Buffer.byteLength(text) > DEEP_OUTPUT_BUDGET_BYTES) {
		const buf = Buffer.from(text);
		text = buf.subarray(0, DEEP_OUTPUT_BUDGET_BYTES).toString("utf8");
		truncated = true;
	}

	let redactedCount = 0;
	text = text.replace(TOKEN_LIKE_PATTERN, (match) => {
		redactedCount++;
		const prefix = match.match(/^[\s=:]/)?.[0] ?? "";
		return `${prefix}[REDACTED]`;
	});
	text = text.replace(ENV_LIKE_PATTERN, (match) => {
		redactedCount++;
		const eqIndex = match.indexOf("=");
		return `${match.slice(0, eqIndex + 1)}[REDACTED]`;
	});

	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	return { lines, truncated, redactedCount };
}
