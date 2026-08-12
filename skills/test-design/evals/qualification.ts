#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	type HarnessName,
	runSmokeTest,
} from "../../../scripts/multi-agent-smoke-lib.ts";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const receiptPath = resolve(import.meta.dir, "qualification.json");

const QUALIFICATION_SOURCE_PATHS = [
	"AGENTS.md",
	".github/workflows/ci.yml",
	"scripts/agent-instructions.sh",
	"scripts/agent-instructions.test.ts",
	"scripts/hooks/pre-commit",
	"scripts/multi-agent-smoke-lib.ts",
	"scripts/multi-agent-smoke.test.ts",
	"scripts/multi-agent-smoke.ts",
	"skills/improve-test-architecture/SKILL.md",
	"skills/improve-test-architecture/references/html-report.md",
	"skills/test-design/SKILL.md",
	"skills/test-design/evals/pairwise-scenarios.json",
	"skills/test-design/evals/qualification.ts",
	"skills/test-design/evals/smoke-definitions.ts",
	"skills/test-design/references/browser-and-ui.md",
	"skills/test-design/references/installation-host-hosted.md",
	"skills/test-design/references/pattern-library.md",
	"skills/test-design/references/process-and-cli.md",
	"skills/test-design/references/runtime-ci-platform.md",
	"skills/test-design/references/state-concurrency-recovery.md",
	"skills/test-design/tests/skill-contract.test.ts",
] as const;

type QualificationReceipt = {
	schema_version: 1;
	generated_by: "skills/test-design/evals/qualification.ts";
	source_sha256: string;
	sources: string[];
	results: {
		deterministic: true;
		pairwise_claude_two_consecutive: true;
		pairwise_codex_two_consecutive: true;
		mutation_claude: true;
		mutation_codex: true;
		run_only_claude: true;
		run_only_codex: true;
		missing_skill_claude: true;
		missing_skill_codex: true;
	};
};

/**
 * Hash every source that can change the qualified Startup Surface behaviour.
 *
 * @param root - Repository root containing the registered qualification sources.
 * @returns Stable digest bound to source paths and contents.
 * @throws When a registered source is missing.
 * @internal
 */
export function qualificationSourceDigest(root = repositoryRoot): string {
	const hash = createHash("sha256");
	for (const path of QUALIFICATION_SOURCE_PATHS) {
		const absolute = resolve(root, path);
		if (!existsSync(absolute)) throw new Error(`qualification source missing: ${path}`);
		hash.update(path);
		hash.update("\0");
		hash.update(readFileSync(absolute));
		hash.update("\0");
	}
	return hash.digest("hex");
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).sort().join("\n") === keys.toSorted().join("\n");
}

function verifyReceipt(): { ok: boolean; reason: string } {
	if (!existsSync(receiptPath)) return { ok: false, reason: "qualification receipt missing" };
	let candidate: unknown;
	try {
		candidate = JSON.parse(readFileSync(receiptPath, "utf8"));
	} catch {
		return { ok: false, reason: "qualification receipt is not valid JSON" };
	}
	if (typeof candidate !== "object" || candidate === null) {
		return { ok: false, reason: "qualification receipt must be an object" };
	}
	const receipt = candidate as Record<string, unknown>;
	try {
		if (
			!exactKeys(receipt, [
				"schema_version",
				"generated_by",
				"source_sha256",
				"sources",
				"results",
			]) ||
			receipt.schema_version !== 1 ||
			receipt.generated_by !== "skills/test-design/evals/qualification.ts" ||
			receipt.source_sha256 !== qualificationSourceDigest() ||
			!Array.isArray(receipt.sources) ||
			receipt.sources.join("\n") !== QUALIFICATION_SOURCE_PATHS.join("\n") ||
			typeof receipt.results !== "object" ||
			receipt.results === null
		) {
			return { ok: false, reason: "qualification receipt does not match current sources" };
		}
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : "qualification source check failed",
		};
	}
	const resultKeys = [
		"deterministic",
		"pairwise_claude_two_consecutive",
		"pairwise_codex_two_consecutive",
		"mutation_claude",
		"mutation_codex",
		"run_only_claude",
		"run_only_codex",
		"missing_skill_claude",
		"missing_skill_codex",
	];
	const results = receipt.results as Record<string, unknown>;
	if (!exactKeys(results, resultKeys) || resultKeys.some((key) => results[key] !== true)) {
		return { ok: false, reason: "qualification receipt has incomplete results" };
	}
	return { ok: true, reason: "qualification receipt matches current sources" };
}

async function deterministic(): Promise<void> {
	const proc = Bun.spawn({
		cmd: [
			resolve(repositoryRoot, "skills/test-runner/src/test-runner.sh"),
			"run",
			"--",
			"skills/test-design/tests/skill-contract.test.ts",
			"scripts/multi-agent-smoke.test.ts",
			"scripts/agent-instructions.test.ts",
		],
		cwd: repositoryRoot,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await proc.exited) !== 0) throw new Error("deterministic qualification failed");
}

async function requirePass(testId: Parameters<typeof runSmokeTest>[0]["testId"], harness: HarnessName): Promise<void> {
	const result = await runSmokeTest({
		testId,
		harness,
		cwd: repositoryRoot,
		timeoutMs: 120_000,
		warnAfterMs: 60_000,
	});
	if (!result.ok) {
		const failed = result.assertions.filter((item) => !item.ok).map((item) => item.key);
		throw new Error(`${harness}:${testId} failed (${result.error ?? failed.join(", ")})`);
	}
}

async function requireMissingSkillRed(harness: HarnessName): Promise<void> {
	const result = await runSmokeTest({
		testId: "test-design-mutation-route",
		harness,
		cwd: repositoryRoot,
		timeoutMs: 180_000,
		warnAfterMs: 120_000,
		omitProjectSkills: true,
	});
	if (result.ok || !result.assertions.some((item) => item.key === "qualificationChallenge" && !item.ok)) {
		throw new Error(`${harness}: missing-skill negative control did not go RED`);
	}
}

async function qualify(): Promise<void> {
	await deterministic();
	for (const harness of ["claude", "codex"] as const) {
		for (let repetition = 0; repetition < 2; repetition += 1) {
			await requirePass("test-design-pairwise-frozen", harness);
		}
		await requirePass("test-design-mutation-route", harness);
		await requirePass("test-design-run-only-negative", harness);
		await requireMissingSkillRed(harness);
	}
	const receipt: QualificationReceipt = {
		schema_version: 1,
		generated_by: "skills/test-design/evals/qualification.ts",
		source_sha256: qualificationSourceDigest(),
		sources: [...QUALIFICATION_SOURCE_PATHS],
		results: {
			deterministic: true,
			pairwise_claude_two_consecutive: true,
			pairwise_codex_two_consecutive: true,
			mutation_claude: true,
			mutation_codex: true,
			run_only_claude: true,
			run_only_codex: true,
			missing_skill_claude: true,
			missing_skill_codex: true,
		},
	};
	writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

async function main(): Promise<void> {
	const command = Bun.argv[2] ?? "verify";
	const json = Bun.argv.includes("--json");
	if (!["deterministic", "verify", "qualify"].includes(command)) {
		throw new Error(`unknown qualification command: ${command}`);
	}
	if (command === "deterministic") {
		await deterministic();
		return;
	}
	if (command === "qualify") {
		await qualify();
	}
	const result = verifyReceipt();
	if (json) console.log(JSON.stringify(result));
	else console.log(result.reason);
	if (!result.ok) process.exitCode = 1;
}

if (import.meta.main) await main();
