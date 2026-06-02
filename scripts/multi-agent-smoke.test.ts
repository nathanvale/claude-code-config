import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
	buildSmokeCommand,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_TIMEOUT_MS_BY_HARNESS,
	DEFAULT_WARN_AFTER_MS_BY_HARNESS,
	describeSmokeFailure,
	evaluateOutput,
	getDefaultTimeoutMs,
	getDefaultWarnAfterMs,
	getSmokeTest,
	runSmokeTest,
} from "./multi-agent-smoke-lib.ts";

describe("multi-agent smoke library", () => {
	test("boundary expectations stay harness-specific where intended", () => {
		const testDef = getSmokeTest("boundary");

		const claudeAssertions = evaluateOutput(testDef, "claude", {
			whoAmI: "claude",
			usesContext7ForLibraryDocs: true,
			autoAppliesClaudeOnlyRules: true,
			sharedBehaviorOnlyInRulesReachesBothHarnesses: false,
			assumesClaudeOnlyToolsLikeKitOrAtuin: true,
			commitsDirectlyToMain: false,
		});
		expect(claudeAssertions.every((assertion) => assertion.ok)).toBe(true);

		const codexAssertions = evaluateOutput(testDef, "codex", {
			whoAmI: "codex",
			usesContext7ForLibraryDocs: true,
			autoAppliesClaudeOnlyRules: false,
			sharedBehaviorOnlyInRulesReachesBothHarnesses: false,
			assumesClaudeOnlyToolsLikeKitOrAtuin: false,
			commitsDirectlyToMain: false,
		});
		expect(codexAssertions.every((assertion) => assertion.ok)).toBe(true);
	});

	test("git workflow expectations preserve the Claude-only footer", () => {
		const testDef = getSmokeTest("git-workflow");

		const codexAssertions = evaluateOutput(testDef, "codex", {
			whoAmI: "codex",
			createsFeatureBranchBeforeCommitOnMain: true,
			stagesSpecificFilesOnly: true,
			usesGitAddAll: false,
			usesConventionalCommitFormat: true,
			usesHeredocForMultilineCommit: true,
			includesClaudeCoauthorFooter: false,
			allowsForcePushOrHardReset: false,
		});
		expect(codexAssertions.every((assertion) => assertion.ok)).toBe(true);
	});

	test("failed assertions report the mismatched key and value", () => {
		const testDef = getSmokeTest("propagation");
		const assertions = evaluateOutput(testDef, "codex", {
			whoAmI: "codex",
			canonicalStartupSourceIsAgentsMd: true,
			generatedPromptArtifactsAreSource: false,
			promptFragmentsAreActiveAuthoringPath: false,
			claudeRulesOnlyChangeReachesCodex: true,
			codexUserStartupCheckedAgainstAgentsMd: true,
		});

		const mismatch = assertions.find(
			(assertion) => assertion.key === "claudeRulesOnlyChangeReachesCodex",
		);
		expect(mismatch?.ok).toBe(false);
		expect(mismatch?.expected).toBe(false);
		expect(mismatch?.actual).toBe(true);
	});

	test("command builders encode the live CLI contract", () => {
		const cwd = "/tmp/repo";

		const claudeCommand = buildSmokeCommand({
			testId: "boundary",
			harness: "claude",
			cwd,
		});
		expect(claudeCommand).toContain("--");
		expect(claudeCommand[0]).toBe("claude");

		const codexCommand = buildSmokeCommand({
			testId: "boundary",
			harness: "codex",
			cwd,
		});
		expect(codexCommand.slice(0, 4)).toEqual([
			"codex",
			"exec",
			"--ignore-user-config",
			"--ignore-rules",
		]);
		expect(codexCommand).toContain("exec");
		expect(codexCommand).toContain("--ignore-user-config");
		expect(codexCommand).toContain("--ignore-rules");
		expect(codexCommand).toContain("--skip-git-repo-check");
		expect(codexCommand).toContain("--sandbox");

		const schemaIndex = codexCommand.indexOf("--output-schema") + 1;
		const cwdIndex = codexCommand.indexOf("-C") + 1;
		expect(existsSync(codexCommand[schemaIndex])).toBe(true);
		expect(existsSync(codexCommand[cwdIndex])).toBe(true);
	});

	test("dry-run smoke results include bounded execution metadata", async () => {
		const result = await runSmokeTest({
			testId: "boundary",
			harness: "codex",
			cwd: "/tmp/repo",
			dryRun: true,
			timeoutMs: 12_345,
		});

		expect(result.status).toBe("dry_run");
		expect(result.latencyStatus).toBe("ok");
		expect(result.ok).toBe(true);
		expect(result.warnAfterMs).toBe(12_345);
		expect(result.timeoutMs).toBe(12_345);
		expect(result.durationMs).toBe(0);
	});

	test("default timeout stays stable", () => {
		expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
		expect(DEFAULT_TIMEOUT_MS_BY_HARNESS).toEqual({
			claude: 30_000,
			codex: 60_000,
		});
		expect(DEFAULT_WARN_AFTER_MS_BY_HARNESS).toEqual({
			claude: 15_000,
			codex: 30_000,
		});
		expect(getDefaultTimeoutMs("claude")).toBe(30_000);
		expect(getDefaultTimeoutMs("codex")).toBe(60_000);
		expect(getDefaultWarnAfterMs("claude")).toBe(15_000);
		expect(getDefaultWarnAfterMs("codex")).toBe(30_000);
	});

	test("omitted thresholds use the harness defaults", async () => {
		const result = await runSmokeTest({
			testId: "boundary",
			harness: "codex",
			cwd: "/tmp/repo",
			dryRun: true,
		});

		expect(result.warnAfterMs).toBe(30_000);
		expect(result.timeoutMs).toBe(60_000);
	});

	test("classifies Claude auth failures with an actionable hint", () => {
		const error = describeSmokeFailure({
			harness: "claude",
			exitCode: 1,
			stdout:
				'{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}',
			stderr: "",
		});

		expect(error).toBe(
			"Claude CLI is not logged in; run /login and retry the smoke test",
		);
	});

	test("classifies Codex transport failures with an actionable hint", () => {
		const error = describeSmokeFailure({
			harness: "codex",
			exitCode: 1,
			stdout: "",
			stderr:
				"ERROR: stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
		});

		expect(error).toBe(
			"Codex transport failed before completion; retry when network/DNS access to chatgpt.com is available",
		);
	});
});
