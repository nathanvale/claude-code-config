import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	buildSmokeCommand,
	DEFAULT_TIMEOUT_MS,
	DEFAULT_TIMEOUT_MS_BY_HARNESS,
	DEFAULT_WARN_AFTER_MS_BY_HARNESS,
	describeSmokeFailure,
	createProfileQualificationChallenge,
	evaluateOutput,
	evaluateRuntimeTrace,
	getDefaultTimeoutMs,
	getDefaultWarnAfterMs,
	getSmokeTest,
	runSmokeTest,
	SMOKE_TESTS,
} from "./multi-agent-smoke-lib.ts";

const repositoryRoot = resolve(import.meta.dir, "..");

describe("multi-agent smoke library", () => {
	test("includes the prompt-boundary and operator smoke matrix", () => {
		const taskSmokeIds = [
			"rules-claude-only",
			"context-files-claude-only",
			"context-index-shared",
			"tool-map-codex-only",
			"heal-skill-claude-only",
			"coauthor-claude-only",
			"memory-os-shared",
			"agents-md-not-editable",
			"code-quality-shared",
			"newsroom-claude-only",
			"workflow-trigger",
			"router-classification",
			"workflow-rule-claude-only",
			"contract-auditor-router-skill",
			"smoke-runner-executes",
			"heal-skill-reachable",
			"test-design-mutation-route",
			"test-design-run-only-negative",
			"test-design-pairwise-frozen",
		] as const;

		expect(SMOKE_TESTS).toHaveLength(27);
		for (const testId of taskSmokeIds) {
			expect(SMOKE_TESTS.map((smokeTest) => smokeTest.id)).toContain(testId);
			expect(getSmokeTest(testId).expectations.claude.whoAmI).toBe("claude");
			expect(getSmokeTest(testId).expectations.codex.whoAmI).toBe("codex");
		}
	});

	test("frozen pairwise probe rejects every independently corrupted decision", () => {
		const definition = getSmokeTest("test-design-pairwise-frozen");
		const expected = definition.expectations.codex;
		for (const field of Object.keys(expected).filter((key) => key !== "whoAmI")) {
			const assertions = evaluateOutput(definition, "codex", {
				...expected,
				[field]: `${expected[field]}-wrong`,
			});
			expect(assertions.filter((assertion) => !assertion.ok)).toHaveLength(1);
			expect(assertions.find((assertion) => assertion.key === field)?.ok).toBe(
				false,
			);
		}
	});

	test("frozen pairwise probe rejects a corrupted profile-segment decision", () => {
		const definition = getSmokeTest("test-design-pairwise-frozen");
		const expected = definition.expectations.claude;
		const firstScenario = Object.keys(expected).find((key) => key.startsWith("s1"));
		expect(firstScenario).toBeDefined();
		if (!firstScenario) return;
		const assertions = evaluateOutput(definition, "claude", {
			...expected,
			[firstScenario]: `${expected[firstScenario]}|all-profiles`,
		});
		expect(assertions.find((item) => item.key === firstScenario)?.ok).toBe(false);
	});

	test("test-design canaries distinguish mutation from run-only work", () => {
		expect(
			getSmokeTest("test-design-mutation-route").runtime?.challengeField,
		).toBe("qualificationChallenge");
		for (const harness of ["claude", "codex"] as const) {
			expect(
				evaluateOutput(getSmokeTest("test-design-mutation-route"), harness, {
					whoAmI: harness,
					selectedProfiles: "process-and-cli",
					activeWorkflow: "implementation",
				}),
			).toSatisfy((assertions) => assertions.every((assertion) => assertion.ok));

			expect(
				evaluateOutput(getSmokeTest("test-design-run-only-negative"), harness, {
					whoAmI: harness,
					invokesTestDesign: false,
					briefEmitted: false,
					activeWorkflow: "test-runner",
				}),
			).toSatisfy((assertions) => assertions.every((assertion) => assertion.ok));
		}
	});

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

	test("context-routing probe fails an answer that blesses direct vault writes", () => {
		// Negative control against probe theater: an agent claiming direct vault
		// writes are fine must fail the routing probe on both harnesses. A full
		// fixture-backed live blocked-manager scenario is deferred to U9
		// qualification.
		const testDef = getSmokeTest("context-routing");
		for (const harness of ["claude", "codex"] as const) {
			const assertions = evaluateOutput(testDef, harness, {
				whoAmI: harness,
				codeReposOwnImplementationTruth: true,
				codeRepoWritesUseWorktrees: true,
				configuredVaultOwnsDurableKnowledge: true,
				contextAdvisorOwnsPlacementRouting: true,
				usesStableContextPath: true,
				vaultWritesRouteThroughVaultGitSkill: false,
			});
			const mismatch = assertions.find(
				(assertion) => assertion.key === "vaultWritesRouteThroughVaultGitSkill",
			);
			expect(mismatch?.ok).toBe(false);
			expect(mismatch?.expected).toBe(true);
			expect(mismatch?.actual).toBe(false);
			expect(assertions.every((assertion) => assertion.ok)).toBe(false);
		}
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

		const { command: claudeCommand, cleanup: cleanupClaude } =
			buildSmokeCommand({
				testId: "boundary",
				harness: "claude",
				cwd,
			});
		const { command: codexCommand, cleanup: cleanupCodex } = buildSmokeCommand({
			testId: "boundary",
			harness: "codex",
			cwd,
		});
		try {
			expect(claudeCommand).toContain("--");
			expect(claudeCommand[0]).toBe("claude");
			expect(claudeCommand).not.toContain("--effort");

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
		} finally {
			cleanupClaude();
			cleanupCodex();
		}
	});

	test("test-design mutation commands use projected skills and scoped models", () => {
		const { command: claudeCommand, cleanup: cleanupClaude } = buildSmokeCommand({
			testId: "test-design-mutation-route",
			harness: "claude",
			cwd: repositoryRoot,
		});
		const { command: codexCommand, cleanup: cleanupCodex } = buildSmokeCommand({
			testId: "test-design-mutation-route",
			harness: "codex",
			cwd: repositoryRoot,
		});
		try {
			expect(claudeCommand[claudeCommand.indexOf("--model") + 1]).toBe("opus");
			expect(claudeCommand[claudeCommand.indexOf("--output-format") + 1]).toBe(
				"stream-json",
			);
			expect(claudeCommand).toContain("--verbose");
			expect(claudeCommand[claudeCommand.indexOf("--effort") + 1]).toBe("high");
			expect(claudeCommand[claudeCommand.indexOf("--tools") + 1]).toBe(
				"Skill,Read",
			);
			expect(
				claudeCommand[claudeCommand.indexOf("--setting-sources") + 1],
			).toBe("project");
			expect(codexCommand[codexCommand.indexOf("--model") + 1]).toBe(
				"gpt-5.6-sol",
			);
			expect(codexCommand).toContain("--json");
			const project = codexCommand[codexCommand.indexOf("-C") + 1];
			expect(existsSync(`${project}/.agents/skills/test-design/SKILL.md`)).toBe(
				true,
			);
			expect(existsSync(`${project}/.claude/skills/test-design/SKILL.md`)).toBe(
				true,
			);
		} finally {
			cleanupClaude();
			cleanupCodex();
		}
	});

	test("requires traced skill invocation and only the selected profile read", () => {
		const traceProof = getSmokeTest("test-design-mutation-route").runtime
			?.traceProof;
		expect(traceProof).toBeDefined();
		if (!traceProof) return;
		const project = "/tmp/test-design-trace";
		const challenge = "skill-challenge";
		const selectedProfileChallenge = createProfileQualificationChallenge(
			challenge,
			traceProof.profileRelativePath,
		);
		const claudeTrace = [
			{
				type: "assistant",
				message: {
					content: [
						{
							type: "tool_use",
							id: "skill-call",
							name: "Skill",
							input: { skill: "test-design" },
						},
					],
				},
			},
			{
				type: "assistant",
				message: {
					content: [
						{
							type: "tool_use",
							id: "profile-read",
							name: "Read",
							input: {
								file_path: `${project}/.claude/skills/test-design/references/process-and-cli.md`,
							},
						},
					],
				},
			},
			{
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "skill-call",
							is_error: false,
						},
						{
							type: "tool_result",
							tool_use_id: "profile-read",
							is_error: false,
						},
					],
				},
			},
		]
			.map((event) => JSON.stringify(event))
			.join("\n");
		expect(
			evaluateRuntimeTrace({
				harness: "claude",
				stdout: claudeTrace,
				challenge,
				traceProof,
			}).every((assertion) => assertion.ok),
		).toBe(true);

		const directReadOnly = claudeTrace.replace('"name":"Skill"', '"name":"Read"');
		expect(
			evaluateRuntimeTrace({
				harness: "claude",
				stdout: directReadOnly,
				challenge,
				traceProof,
			}).find((assertion) => assertion.key === "trace:skill-invoked")?.ok,
		).toBe(false);
		const failedSkillResult = claudeTrace.replace(
			'"tool_use_id":"skill-call","is_error":false',
			'"tool_use_id":"skill-call","is_error":true',
		);
		expect(
			evaluateRuntimeTrace({
				harness: "claude",
				stdout: failedSkillResult,
				challenge,
				traceProof,
			}).find((assertion) => assertion.key === "trace:skill-invoked")?.ok,
		).toBe(false);
		const irrelevantRead = [
			claudeTrace,
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{
							type: "tool_use",
							id: "irrelevant-read",
							name: "Read",
							input: {
								file_path: `${project}/.claude/skills/test-design/references/browser-and-ui.md`,
							},
						},
					],
				},
			}),
			JSON.stringify({
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "irrelevant-read",
							is_error: false,
						},
					],
				},
			}),
		].join("\n");
		expect(
			evaluateRuntimeTrace({
				harness: "claude",
				stdout: irrelevantRead,
				challenge,
				traceProof,
			}).find(
				(assertion) => assertion.key === "trace:irrelevant-profile-not-read",
			)?.ok,
		).toBe(false);

		const codexTrace = [challenge, selectedProfileChallenge].map((output, index) =>
			JSON.stringify({
				type: "item.completed",
				item: {
					id: `item_${index}`,
					type: "command_execution",
					command: "sed -n '1,220p' projected-file",
					aggregated_output: output,
					exit_code: 0,
					status: "completed",
				},
			}),
		).join("\n");
		expect(
			evaluateRuntimeTrace({
				harness: "codex",
				stdout: codexTrace,
				challenge,
				traceProof,
			}).every((assertion) => assertion.ok),
		).toBe(true);
		const forbiddenProfileRelativePath =
			traceProof.forbiddenProfileRelativePaths[0];
		expect(forbiddenProfileRelativePath).toBeDefined();
		if (!forbiddenProfileRelativePath) {
			throw new Error("Expected at least one forbidden profile path");
		}
		const forbiddenChallenge = createProfileQualificationChallenge(
			challenge,
			forbiddenProfileRelativePath,
		);
		const codexWithIrrelevantRead = `${codexTrace}\n${JSON.stringify({
			type: "item.completed",
			item: {
				id: "item_forbidden",
				type: "command_execution",
				command: "sed -n '1,220p' projected-file",
				aggregated_output: forbiddenChallenge,
				exit_code: 0,
				status: "completed",
			},
		})}`;
		expect(
			evaluateRuntimeTrace({
				harness: "codex",
				stdout: codexWithIrrelevantRead,
				challenge,
				traceProof,
			}).find(
				(assertion) => assertion.key === "trace:irrelevant-profile-not-read",
			)?.ok,
		).toBe(false);
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
		const schemaPath = result.command[result.command.indexOf("--output-schema") + 1];
		const commandCwd = result.command[result.command.indexOf("-C") + 1];
		expect(existsSync(schemaPath)).toBe(false);
		expect(existsSync(commandCwd)).toBe(false);
	});

	test("missing-skill negative uses the bounded unavailable prompt", async () => {
		const result = await runSmokeTest({
			testId: "test-design-mutation-route",
			harness: "codex",
			cwd: process.cwd(),
			dryRun: true,
			omitProjectSkills: true,
		});
		expect(result.command.at(-1)).toContain("Missing-skill negative control");
		expect(result.command.at(-1)).toContain("exactly once");
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
