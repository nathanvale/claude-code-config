import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const repositoryRoot = resolve(import.meta.dir, "../..");
const hookSource = join(repositoryRoot, "scripts/hooks/pre-commit");

interface HookFixture {
	root: string;
	repository: string;
	checkScript: string;
	callLog: string;
	checkLog: string;
}

function createFixture(): HookFixture {
	const root = mkdtempSync(join(tmpdir(), "pre-commit-hook-"));
	const repository = join(root, "repository");
	const checkScript = join(repository, "scripts/agent-instructions.sh");
	const callLog = join(root, "calls.log");
	const checkLog = join(root, "check.log");
	mkdirSync(dirname(checkScript), { recursive: true });
	writeFileSync(
		checkScript,
`#!/bin/bash
printf '%s\\n' "$@" >> "$HOOK_TEST_CALL_LOG"
printf 'staged=%s\\n' "\${AGENT_INSTRUCTIONS_CHECK_STAGED:-}" >> "$HOOK_TEST_CALL_LOG"
echo "FAIL: fixture health failure"
echo "fixture diagnostic" >&2
exit "$HOOK_TEST_STATUS"
`,
	);
	chmodSync(checkScript, 0o755);
	const initialized = spawnSync("git", ["-C", repository, "init", "--quiet"], { encoding: "utf8" });
	if (initialized.status !== 0) throw new Error(initialized.stderr);
	return { root, repository, checkScript, callLog, checkLog };
}

function runHook(fixture: HookFixture, status: number): { exitCode: number; stdout: string; stderr: string } {
	const result = spawnSync("bash", [hookSource], {
		cwd: fixture.repository,
		env: {
			...process.env,
			HOOK_TEST_CALL_LOG: fixture.callLog,
			HOOK_TEST_STATUS: String(status),
			PROMPT_DRIFT_CHECK_LOG: fixture.checkLog,
		},
		encoding: "utf8",
	});
	return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function withFixture(body: (fixture: HookFixture) => void): void {
	const fixture = createFixture();
	try {
		body(fixture);
	} finally {
		rmSync(fixture.root, { recursive: true, force: true });
	}
}

describe("pre-commit instruction health adapter", () => {
	test("delegates exactly once to staged health, captures logs, and allows success", () => {
		withFixture((fixture) => {
			const result = runHook(fixture, 0);
			expect(result.exitCode).toBe(0);
			expect(readFileSync(fixture.callLog, "utf8")).toBe("check\nstaged=1\n");
			expect(readFileSync(fixture.checkLog, "utf8")).toContain("fixture diagnostic");
			expect(result.stdout).toBe("");
		});
	});

	test("keeps the shared hook compatible with a pre-staged-mode worktree script", () => {
		withFixture((fixture) => {
			writeFileSync(fixture.checkScript, `#!/bin/bash
printf 'staged=%s\\n' "\${AGENT_INSTRUCTIONS_CHECK_STAGED:-}" >> "$HOOK_TEST_CALL_LOG"
[[ "$#" -eq 1 && "$1" == "check" ]] || exit 2
exit 0
`);
			chmodSync(fixture.checkScript, 0o755);
			expect(runHook(fixture, 0).exitCode).toBe(0);
			expect(readFileSync(fixture.callLog, "utf8")).toBe("staged=1\n");
		});
	});

	for (const status of [1, 42, 127, 143]) {
		test(`blocks health exit ${status} with one repair message`, () => {
			withFixture((fixture) => {
				if (status === 127) unlinkSync(fixture.checkScript);
				const result = runHook(fixture, status);
				expect(result.exitCode).toBe(1);
				expect(result.stdout.match(/Instruction health check failed - commit blocked\./gu)).toHaveLength(1);
				expect(result.stdout).toContain(`Exit code: ${status}`);
				expect(result.stdout).toContain("Fix the reported instruction health issue, then retry the commit.");
				expect(result.stdout).toContain("bash scripts/agent-instructions.sh check --staged");
			});
		});
	}

	test("allows only exit 137 with the retained visible warning", () => {
		withFixture((fixture) => {
			const result = runHook(fixture, 137);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Instruction health check was killed by SIGKILL - commit allowed.");
			expect(result.stdout).toContain("bash scripts/agent-instructions.sh check --staged");
			expect(result.stdout).not.toContain("commit blocked");
		});
	});

	test("contains no staged scanner, broad inventory, or path globs", () => {
		const source = readFileSync(hookSource, "utf8");
		expect(source).toMatch(/AGENT_INSTRUCTIONS_CHECK_STAGED=1 bash "\$\{CHECK_SCRIPT\}" check/u);
		expect(source).not.toContain("PROMPT_SYSTEM_PATHS");
		expect(source).not.toMatch(/git\s+diff\s+--cached/u);
		for (const broadPath of ["rules/", "context/", "docs/adr/", "skills/"]) {
			expect(source).not.toContain(broadPath);
		}
	});
});
