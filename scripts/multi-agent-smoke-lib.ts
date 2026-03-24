import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type HarnessName = "claude" | "codex";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_TIMEOUT_MS_BY_HARNESS: Record<HarnessName, number> = {
	claude: DEFAULT_TIMEOUT_MS,
	codex: 60_000,
};
export const DEFAULT_WARN_AFTER_MS_BY_HARNESS: Record<HarnessName, number> = {
	claude: 15_000,
	codex: 30_000,
};
export type SmokeTestId =
	| "boundary"
	| "code-quality"
	| "git-workflow"
	| "harness-tools-claude"
	| "harness-tools-codex"
	| "memory-os"
	| "propagation"
	| "tool-routing";

type JsonPrimitive = boolean | number | string | null;
type JsonSchema = {
	type: "object";
	properties: Record<string, unknown>;
	required: string[];
	additionalProperties: boolean;
};

type ExpectedResult = Record<string, JsonPrimitive>;

export type SmokeTestDefinition = {
	id: SmokeTestId;
	title: string;
	schema: JsonSchema;
	prompt: string;
	expectations: Record<HarnessName, ExpectedResult>;
};

export type AssertionResult = {
	key: string;
	expected: JsonPrimitive;
	actual: JsonPrimitive | undefined;
	ok: boolean;
};

export type RunResult = {
	harness: HarnessName;
	test: SmokeTestId;
	status: "dry_run" | "error" | "failed" | "passed" | "timeout";
	latencyStatus: "ok" | "slow" | "timeout";
	ok: boolean;
	command: string[];
	output?: Record<string, JsonPrimitive>;
	assertions: AssertionResult[];
	stdout: string;
	stderr: string;
	exitCode: number;
	durationMs: number;
	warnAfterMs: number;
	timeoutMs: number;
	warning?: string;
	error?: string;
};

type HarnessAdapter = {
	buildCommand: (input: {
		prompt: string;
		schemaPath: string;
		outputPath: string;
		cwd: string;
	}) => string[];
	parseOutput: (
		stdout: string,
		outputPath: string,
	) => Promise<Record<string, JsonPrimitive>>;
};

const CODEX_SMOKE_DISABLED_MCP_SERVERS = [
	"context7",
	"qmd",
	"notebooklm-mcp",
	"x-api",
	"firecrawl",
	"chrome-devtools",
	"bun-runner",
	"biome-runner",
	"tsc-runner",
] as const;

function buildCodexSmokeConfigOverrides(): string[] {
	return CODEX_SMOKE_DISABLED_MCP_SERVERS.flatMap((serverName) => [
		"-c",
		`mcp_servers.${serverName}.enabled=false`,
	]);
}

const HEADLESS_PROMPT_GUARDRAILS = [
	"Return only a JSON object matching the provided schema.",
	"Do not wrap the JSON in markdown.",
	"Do not run tools or shell commands.",
	"Do not make code changes.",
	"Answer from your current instructions for this repo and harness.",
].join(" ");

function createObjectSchema(
	properties: Record<string, unknown>,
	required: string[],
): JsonSchema {
	return {
		type: "object",
		properties,
		required,
		additionalProperties: false,
	};
}

function withGuardrails(prompt: string): string {
	return `${prompt}\n\nRules: ${HEADLESS_PROMPT_GUARDRAILS}`;
}

export const SMOKE_TESTS: readonly SmokeTestDefinition[] = [
	{
		id: "boundary",
		title: "Boundary alignment",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				usesContext7ForLibraryDocs: { type: "boolean" },
				autoAppliesClaudeOnlyRules: { type: "boolean" },
				sharedBehaviorOnlyInRulesReachesBothHarnesses: { type: "boolean" },
				assumesClaudeOnlyToolsLikeKitOrAtuin: { type: "boolean" },
				commitsDirectlyToMain: { type: "boolean" },
			},
			[
				"whoAmI",
				"usesContext7ForLibraryDocs",
				"autoAppliesClaudeOnlyRules",
				"sharedBehaviorOnlyInRulesReachesBothHarnesses",
				"assumesClaudeOnlyToolsLikeKitOrAtuin",
				"commitsDirectlyToMain",
			],
		),
		prompt: withGuardrails(`Boundary smoke test.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- usesContext7ForLibraryDocs: true if your instructions say to use Context7 for library/framework/API questions
- autoAppliesClaudeOnlyRules: true if this harness automatically inherits Claude-only rules
- sharedBehaviorOnlyInRulesReachesBothHarnesses: true only if putting shared behavior in rules/ alone is enough for both harnesses
- assumesClaudeOnlyToolsLikeKitOrAtuin: true if you should assume Claude-only tools like Kit or Atuin are available to you
- commitsDirectlyToMain: true only if you should commit directly to main when asked`),
		expectations: {
			claude: {
				whoAmI: "claude",
				usesContext7ForLibraryDocs: true,
				autoAppliesClaudeOnlyRules: true,
				sharedBehaviorOnlyInRulesReachesBothHarnesses: false,
				assumesClaudeOnlyToolsLikeKitOrAtuin: true,
				commitsDirectlyToMain: false,
			},
			codex: {
				whoAmI: "codex",
				usesContext7ForLibraryDocs: true,
				autoAppliesClaudeOnlyRules: false,
				sharedBehaviorOnlyInRulesReachesBothHarnesses: false,
				assumesClaudeOnlyToolsLikeKitOrAtuin: false,
				commitsDirectlyToMain: false,
			},
		},
	},
	{
		id: "git-workflow",
		title: "Git workflow safety",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				createsFeatureBranchBeforeCommitOnMain: { type: "boolean" },
				stagesSpecificFilesOnly: { type: "boolean" },
				usesGitAddAll: { type: "boolean" },
				usesConventionalCommitFormat: { type: "boolean" },
				usesHeredocForMultilineCommit: { type: "boolean" },
				includesClaudeCoauthorFooter: { type: "boolean" },
				allowsForcePushOrHardReset: { type: "boolean" },
			},
			[
				"whoAmI",
				"createsFeatureBranchBeforeCommitOnMain",
				"stagesSpecificFilesOnly",
				"usesGitAddAll",
				"usesConventionalCommitFormat",
				"usesHeredocForMultilineCommit",
				"includesClaudeCoauthorFooter",
				"allowsForcePushOrHardReset",
			],
		),
		prompt: withGuardrails(`Git workflow smoke test.

Scenario: Nathan asks you to commit src/auth.ts, src/auth.test.ts, and README.md while you are currently on main.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- createsFeatureBranchBeforeCommitOnMain: true if you would branch first instead of committing on main
- stagesSpecificFilesOnly: true if you would stage only the named files
- usesGitAddAll: true if you would use git add . or git add -A here
- usesConventionalCommitFormat: true if you would use type(scope): subject
- usesHeredocForMultilineCommit: true if you would use a HEREDOC for a multiline commit
- includesClaudeCoauthorFooter: true if your commit policy here includes Co-Authored-By: Claude <noreply@anthropic.com>
- allowsForcePushOrHardReset: true only if force push or hard reset would be acceptable here`),
		expectations: {
			claude: {
				whoAmI: "claude",
				createsFeatureBranchBeforeCommitOnMain: true,
				stagesSpecificFilesOnly: true,
				usesGitAddAll: false,
				usesConventionalCommitFormat: true,
				usesHeredocForMultilineCommit: true,
				includesClaudeCoauthorFooter: true,
				allowsForcePushOrHardReset: false,
			},
			codex: {
				whoAmI: "codex",
				createsFeatureBranchBeforeCommitOnMain: true,
				stagesSpecificFilesOnly: true,
				usesGitAddAll: false,
				usesConventionalCommitFormat: true,
				usesHeredocForMultilineCommit: true,
				includesClaudeCoauthorFooter: false,
				allowsForcePushOrHardReset: false,
			},
		},
	},
	{
		id: "memory-os",
		title: "Memory OS guidance",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				prefersQmdForBroadRecall: { type: "boolean" },
				prefersNotebookLmForCuratedSynthesis: { type: "boolean" },
				reposOwnOperationalTruth: { type: "boolean" },
				mySecondBrainOwnsPromotedSynthesis: { type: "boolean" },
				usesStableMemoryGovernancePath: { type: "boolean" },
			},
			[
				"whoAmI",
				"prefersQmdForBroadRecall",
				"prefersNotebookLmForCuratedSynthesis",
				"reposOwnOperationalTruth",
				"mySecondBrainOwnsPromotedSynthesis",
				"usesStableMemoryGovernancePath",
			],
		),
		prompt: withGuardrails(`Memory OS smoke test.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- prefersQmdForBroadRecall: true if broad federated recall should prefer QMD
- prefersNotebookLmForCuratedSynthesis: true if curated synthesis should prefer NotebookLM
- reposOwnOperationalTruth: true if repos own operational truth
- mySecondBrainOwnsPromotedSynthesis: true if my-second-brain owns promoted durable synthesis
- usesStableMemoryGovernancePath: true if the stable shared governance path is ~/.config/memory/AGENTS.md`),
		expectations: {
			claude: {
				whoAmI: "claude",
				prefersQmdForBroadRecall: true,
				prefersNotebookLmForCuratedSynthesis: true,
				reposOwnOperationalTruth: true,
				mySecondBrainOwnsPromotedSynthesis: true,
				usesStableMemoryGovernancePath: true,
			},
			codex: {
				whoAmI: "codex",
				prefersQmdForBroadRecall: true,
				prefersNotebookLmForCuratedSynthesis: true,
				reposOwnOperationalTruth: true,
				mySecondBrainOwnsPromotedSynthesis: true,
				usesStableMemoryGovernancePath: true,
			},
		},
	},
	{
		id: "propagation",
		title: "Prompt propagation model",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				sharedFragmentsReachBothAfterRerender: { type: "boolean" },
				rulesOnlyChangeReachesCodex: { type: "boolean" },
				claudeOnlyFragmentsReachCodex: { type: "boolean" },
				codexOnlyFragmentsReachClaude: { type: "boolean" },
				codexNeedsRerenderAfterSharedFragmentChange: { type: "boolean" },
			},
			[
				"whoAmI",
				"sharedFragmentsReachBothAfterRerender",
				"rulesOnlyChangeReachesCodex",
				"claudeOnlyFragmentsReachCodex",
				"codexOnlyFragmentsReachClaude",
				"codexNeedsRerenderAfterSharedFragmentChange",
			],
		),
		prompt: withGuardrails(`Prompt propagation smoke test.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- sharedFragmentsReachBothAfterRerender: true if a change in prompt-fragments/shared/ should reach both harnesses after rerendering
- rulesOnlyChangeReachesCodex: true only if a rules/-only change automatically reaches Codex
- claudeOnlyFragmentsReachCodex: true only if prompt-fragments/claude/ automatically reach Codex
- codexOnlyFragmentsReachClaude: true only if prompt-fragments/codex/ automatically reach Claude
- codexNeedsRerenderAfterSharedFragmentChange: true if Codex needs rerendering after prompt-fragments/shared/ changes`),
		expectations: {
			claude: {
				whoAmI: "claude",
				sharedFragmentsReachBothAfterRerender: true,
				rulesOnlyChangeReachesCodex: false,
				claudeOnlyFragmentsReachCodex: false,
				codexOnlyFragmentsReachClaude: false,
				codexNeedsRerenderAfterSharedFragmentChange: true,
			},
			codex: {
				whoAmI: "codex",
				sharedFragmentsReachBothAfterRerender: true,
				rulesOnlyChangeReachesCodex: false,
				claudeOnlyFragmentsReachCodex: false,
				codexOnlyFragmentsReachClaude: false,
				codexNeedsRerenderAfterSharedFragmentChange: true,
			},
		},
	},
	{
		id: "tool-routing",
		title: "Tool routing conventions",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				mcpToolsUseJsonFormat: { type: "boolean" },
				prefersBunxOverNpx: { type: "boolean" },
				usesRunnerMcpForTests: { type: "boolean" },
				neverRunsBunTestViaBash: { type: "boolean" },
			},
			[
				"whoAmI",
				"mcpToolsUseJsonFormat",
				"prefersBunxOverNpx",
				"usesRunnerMcpForTests",
				"neverRunsBunTestViaBash",
			],
		),
		prompt: withGuardrails(`Tool routing smoke test.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- mcpToolsUseJsonFormat: true if MCP tool calls should always use response_format "json"
- prefersBunxOverNpx: true if bunx is preferred over npx for package execution
- usesRunnerMcpForTests: true if tests should be run via runner MCP tools, not Bash
- neverRunsBunTestViaBash: true if running bun test via Bash is never acceptable`),
		expectations: {
			claude: {
				whoAmI: "claude",
				mcpToolsUseJsonFormat: true,
				prefersBunxOverNpx: true,
				usesRunnerMcpForTests: true,
				neverRunsBunTestViaBash: true,
			},
			codex: {
				whoAmI: "codex",
				mcpToolsUseJsonFormat: true,
				prefersBunxOverNpx: true,
				usesRunnerMcpForTests: true,
				neverRunsBunTestViaBash: true,
			},
		},
	},
	{
		id: "code-quality",
		title: "Code quality tool selection",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				suiteLevelTestingUsesBunRunTests: { type: "boolean" },
				singleFileTestingUsesBunTestFile: { type: "boolean" },
				lintCheckIsReadOnly: { type: "boolean" },
				typeCheckUseTscCheck: { type: "boolean" },
				exitCode2IsBlockingError: { type: "boolean" },
			},
			[
				"whoAmI",
				"suiteLevelTestingUsesBunRunTests",
				"singleFileTestingUsesBunTestFile",
				"lintCheckIsReadOnly",
				"typeCheckUseTscCheck",
				"exitCode2IsBlockingError",
			],
		),
		prompt: withGuardrails(`Code quality tool selection smoke test.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- suiteLevelTestingUsesBunRunTests: true if suite-level test runs use bun_runTests MCP tool
- singleFileTestingUsesBunTestFile: true if single-file testing uses bun_testFile MCP tool
- lintCheckIsReadOnly: true if biome_lintCheck is a read-only diagnostic (does not modify files)
- typeCheckUseTscCheck: true if type checking uses the tsc_check MCP tool
- exitCode2IsBlockingError: true if exit code 2 from runner MCP tools means a blocking error`),
		expectations: {
			claude: {
				whoAmI: "claude",
				suiteLevelTestingUsesBunRunTests: true,
				singleFileTestingUsesBunTestFile: true,
				lintCheckIsReadOnly: true,
				typeCheckUseTscCheck: true,
				exitCode2IsBlockingError: true,
			},
			codex: {
				whoAmI: "codex",
				suiteLevelTestingUsesBunRunTests: true,
				singleFileTestingUsesBunTestFile: true,
				lintCheckIsReadOnly: true,
				typeCheckUseTscCheck: true,
				exitCode2IsBlockingError: true,
			},
		},
	},
	{
		id: "harness-tools-claude",
		title: "Claude-specific tool awareness",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				knowsKitPlugin: { type: "boolean" },
				knowsAtuinMcp: { type: "boolean" },
				knowsSkillsInSkillsDir: { type: "boolean" },
				usesParaBrainForObsidian: { type: "boolean" },
				usesNewsroomForCommunityDiscussions: { type: "boolean" },
			},
			[
				"whoAmI",
				"knowsKitPlugin",
				"knowsAtuinMcp",
				"knowsSkillsInSkillsDir",
				"usesParaBrainForObsidian",
				"usesNewsroomForCommunityDiscussions",
			],
		),
		prompt: withGuardrails(`Claude-specific tool awareness smoke test.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- knowsKitPlugin: true if you know about the Kit plugin for search
- knowsAtuinMcp: true if you know about the Atuin MCP for shell history
- knowsSkillsInSkillsDir: true if skills live in skills/name/SKILL.md
- usesParaBrainForObsidian: true if Obsidian vault content is accessed via /para-brain:* commands
- usesNewsroomForCommunityDiscussions: true if /newsroom:investigate is used for community discussions`),
		expectations: {
			claude: {
				whoAmI: "claude",
				knowsKitPlugin: true,
				knowsAtuinMcp: true,
				knowsSkillsInSkillsDir: true,
				usesParaBrainForObsidian: true,
				usesNewsroomForCommunityDiscussions: true,
			},
			codex: {
				whoAmI: "codex",
				knowsKitPlugin: false,
				knowsAtuinMcp: false,
				knowsSkillsInSkillsDir: false,
				usesParaBrainForObsidian: false,
				usesNewsroomForCommunityDiscussions: false,
			},
		},
	},
	{
		id: "harness-tools-codex",
		title: "Codex-specific tool awareness",
		schema: createObjectSchema(
			{
				whoAmI: { type: "string", enum: ["claude", "codex"] },
				usesApplyPatchForEdits: { type: "boolean" },
				usesRgForGrep: { type: "boolean" },
				usesCurlForWeb: { type: "boolean" },
				skillsUseHomeAgentsSkills: { type: "boolean" },
				customAgentsLiveInDotCodexAgents: { type: "boolean" },
				codexRulesAreExecutionPolicy: { type: "boolean" },
			},
			[
				"whoAmI",
				"usesApplyPatchForEdits",
				"usesRgForGrep",
				"usesCurlForWeb",
				"skillsUseHomeAgentsSkills",
				"customAgentsLiveInDotCodexAgents",
				"codexRulesAreExecutionPolicy",
			],
		),
		prompt: withGuardrails(`Codex-specific tool awareness smoke test.

Return a JSON object with these meanings:
- whoAmI: "claude" or "codex"
- usesApplyPatchForEdits: true if apply_patch is used for file edits
- usesRgForGrep: true if rg is used for grep/search operations
- usesCurlForWeb: true if curl is used for web requests
- skillsUseHomeAgentsSkills: true if user-level Codex skills are discovered from $HOME/.agents/skills
- customAgentsLiveInDotCodexAgents: true if custom Codex agents live under .codex/agents/ or ~/.codex/agents/
- codexRulesAreExecutionPolicy: true if Codex .rules files govern command execution policy rather than behavioral prompt guidance`),
		expectations: {
			claude: {
				whoAmI: "claude",
				usesApplyPatchForEdits: false,
				usesRgForGrep: false,
				usesCurlForWeb: false,
				skillsUseHomeAgentsSkills: false,
				customAgentsLiveInDotCodexAgents: false,
				codexRulesAreExecutionPolicy: false,
			},
			codex: {
				whoAmI: "codex",
				usesApplyPatchForEdits: true,
				usesRgForGrep: true,
				usesCurlForWeb: true,
				skillsUseHomeAgentsSkills: true,
				customAgentsLiveInDotCodexAgents: true,
				codexRulesAreExecutionPolicy: true,
			},
		},
	},
] as const;

const HARNESS_ADAPTERS: Record<HarnessName, HarnessAdapter> = {
	claude: {
		buildCommand: ({ prompt, schemaPath }) => [
			"claude",
			"-p",
			"--output-format",
			"json",
			"--json-schema",
			readFileSync(schemaPath, "utf8"),
			"--no-session-persistence",
			"--tools",
			"",
			"--",
			prompt,
		],
		parseOutput: async (stdout) => {
			const parsed = JSON.parse(stdout) as {
				result?: unknown;
				structured_output?: unknown;
			};
			const candidate = parsed.structured_output ?? parsed.result ?? parsed;
			if (typeof candidate === "string") {
				return JSON.parse(candidate) as Record<string, JsonPrimitive>;
			}
			return candidate as Record<string, JsonPrimitive>;
		},
	},
	codex: {
		buildCommand: ({ prompt, schemaPath, outputPath, cwd }) => [
			"codex",
			...buildCodexSmokeConfigOverrides(),
			"-a",
			"never",
			"exec",
			"--sandbox",
			"read-only",
			"--ephemeral",
			"--color",
			"never",
			"--output-schema",
			schemaPath,
			"-o",
			outputPath,
			"-C",
			cwd,
			prompt,
		],
		parseOutput: async (_stdout, outputPath) => {
			const text = readFileSync(outputPath, "utf8");
			return JSON.parse(text) as Record<string, JsonPrimitive>;
		},
	},
};

/** Resolve a smoke test definition by id, or throw when the id is unknown. */
export function getSmokeTest(testId: SmokeTestId): SmokeTestDefinition {
	const match = SMOKE_TESTS.find((test) => test.id === testId);
	if (!match) {
		throw new Error(`Unknown smoke test: ${testId}`);
	}
	return match;
}

/** Evaluate a structured smoke-test response against the expected values for one harness. */
export function evaluateOutput(
	test: SmokeTestDefinition,
	harness: HarnessName,
	output: Record<string, JsonPrimitive>,
): AssertionResult[] {
	const expected = test.expectations[harness];
	return Object.entries(expected).map(([key, value]) => ({
		key,
		expected: value,
		actual: output[key],
		ok: output[key] === value,
	}));
}

/** Return the exact headless CLI command the harness would execute for one test/harness pair. */
export function buildSmokeCommand(input: {
	testId: SmokeTestId;
	harness: HarnessName;
	cwd: string;
}): string[] {
	const test = getSmokeTest(input.testId);
	const tempRoot = mkdtempSync(
		join(tmpdir(), `multi-agent-smoke-${input.harness}-`),
	);
	const schemaPath = join(tempRoot, `${test.id}.schema.json`);
	const outputPath = join(tempRoot, `${test.id}.output.json`);
	writeFileSync(schemaPath, JSON.stringify(test.schema, null, 2));

	try {
		return HARNESS_ADAPTERS[input.harness].buildCommand({
			prompt: test.prompt,
			schemaPath,
			outputPath,
			cwd: input.cwd,
		});
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

/** Return the default bounded timeout for one harness. */
export function getDefaultTimeoutMs(harness: HarnessName): number {
	return DEFAULT_TIMEOUT_MS_BY_HARNESS[harness];
}

/** Return the default slow-run warning threshold for one harness. */
export function getDefaultWarnAfterMs(harness: HarnessName): number {
	return DEFAULT_WARN_AFTER_MS_BY_HARNESS[harness];
}

function parseClaudeExecJson(
	stdout: string,
): { is_error?: boolean; result?: string } | null {
	try {
		return JSON.parse(stdout) as { is_error?: boolean; result?: string };
	} catch {
		return null;
	}
}

/** Derive a more actionable smoke failure summary from harness-specific output. */
export function describeSmokeFailure(input: {
	harness: HarnessName;
	exitCode: number;
	stdout: string;
	stderr: string;
}): string {
	const trimmedStdout = input.stdout.trim();
	const trimmedStderr = input.stderr.trim();

	if (input.harness === "claude") {
		const parsed = parseClaudeExecJson(trimmedStdout);
		if (parsed?.is_error && parsed.result?.includes("Not logged in")) {
			return "Claude CLI is not logged in; run /login and retry the smoke test";
		}
	}

	if (input.harness === "codex") {
		if (
			trimmedStderr.includes("failed to lookup address information") ||
			trimmedStderr.includes("error sending request for url") ||
			trimmedStderr.includes("stream disconnected before completion")
		) {
			return "Codex transport failed before completion; retry when network/DNS access to chatgpt.com is available";
		}
	}

	return `Command exited with status ${input.exitCode}`;
}

/** Execute one smoke test against one harness in headless mode and return structured assertions. */
export async function runSmokeTest(input: {
	testId: SmokeTestId;
	harness: HarnessName;
	cwd: string;
	dryRun?: boolean;
	warnAfterMs?: number;
	timeoutMs?: number;
}): Promise<RunResult> {
	const test = getSmokeTest(input.testId);
	const timeoutMs = input.timeoutMs ?? getDefaultTimeoutMs(input.harness);
	const warnAfterMs = Math.min(
		input.warnAfterMs ?? getDefaultWarnAfterMs(input.harness),
		timeoutMs,
	);
	const tempRoot = mkdtempSync(
		join(tmpdir(), `multi-agent-smoke-${input.harness}-`),
	);
	const schemaPath = join(tempRoot, `${test.id}.schema.json`);
	const outputPath = join(tempRoot, `${test.id}.output.json`);
	writeFileSync(schemaPath, JSON.stringify(test.schema, null, 2));

	const adapter = HARNESS_ADAPTERS[input.harness];
	const command = adapter.buildCommand({
		prompt: test.prompt,
		schemaPath,
		outputPath,
		cwd: input.cwd,
	});

	if (input.dryRun) {
		rmSync(tempRoot, { recursive: true, force: true });
		return {
			harness: input.harness,
			test: test.id,
			status: "dry_run",
			latencyStatus: "ok",
			ok: true,
			command,
			assertions: [],
			stdout: "",
			stderr: "",
			exitCode: 0,
			durationMs: 0,
			warnAfterMs,
			timeoutMs,
		};
	}

	const startedAt = performance.now();
	const proc = Bun.spawn({
		cmd: command,
		cwd: input.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdoutPromise = proc.stdout.text();
	const stderrPromise = proc.stderr.text();
	let didTimeout = false;
	const timeoutId = setTimeout(() => {
		didTimeout = true;
		proc.kill();
	}, timeoutMs);

	const exitCode = await proc.exited;
	clearTimeout(timeoutId);
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	const durationMs = Math.round(performance.now() - startedAt);

	try {
		if (didTimeout) {
			return {
				harness: input.harness,
				test: test.id,
				status: "timeout",
				latencyStatus: "timeout",
				ok: false,
				command,
				assertions: [],
				stdout,
				stderr,
				exitCode,
				durationMs,
				warnAfterMs,
				timeoutMs,
				error: `Command timed out after ${timeoutMs}ms`,
			};
		}

		const latencyStatus = durationMs >= warnAfterMs ? "slow" : "ok";
		const warning =
			latencyStatus === "slow"
				? `Command completed slowly after ${durationMs}ms (warn threshold ${warnAfterMs}ms)`
				: undefined;

		if (exitCode !== 0) {
			return {
				harness: input.harness,
				test: test.id,
				status: "error",
				latencyStatus,
				ok: false,
				command,
				assertions: [],
				stdout,
				stderr,
				exitCode,
				durationMs,
				warnAfterMs,
				timeoutMs,
				warning,
				error: describeSmokeFailure({
					harness: input.harness,
					exitCode,
					stdout,
					stderr,
				}),
			};
		}

		const output = await adapter.parseOutput(stdout, outputPath);
		const assertions = evaluateOutput(test, input.harness, output);
		return {
			harness: input.harness,
			test: test.id,
			status: assertions.every((result) => result.ok) ? "passed" : "failed",
			latencyStatus,
			ok: assertions.every((result) => result.ok),
			command,
			output,
			assertions,
			stdout,
			stderr,
			exitCode,
			durationMs,
			warnAfterMs,
			timeoutMs,
			warning,
		};
	} catch (error) {
		const latencyStatus = durationMs >= warnAfterMs ? "slow" : "ok";
		const warning =
			latencyStatus === "slow"
				? `Command completed slowly after ${durationMs}ms (warn threshold ${warnAfterMs}ms)`
				: undefined;
		return {
			harness: input.harness,
			test: test.id,
			status: "error",
			latencyStatus,
			ok: false,
			command,
			assertions: [],
			stdout,
			stderr,
			exitCode,
			durationMs,
			warnAfterMs,
			timeoutMs,
			warning,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}
