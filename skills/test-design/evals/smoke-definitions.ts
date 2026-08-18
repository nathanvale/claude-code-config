import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExpectedResult,
	JsonSchema,
	SmokeTestDefinition,
} from "../../../scripts/multi-agent-smoke-lib.ts";

/** Canonical pairwise factors shared by manifest validation and contract tests. @internal */
export const testDesignScenarioFactors = {
	artifacts: [
		"test",
		"fixture",
		"mock",
		"snapshot",
		"test-helper",
		"test-harness",
	],
	handbacks: [
		"tdd",
		"diagnosing-bugs",
		"ci-testbed",
		"cli-author",
		"test-runner",
		"improve-test-architecture",
	],
	profiles: [
		"process-and-cli",
		"browser-and-ui",
		"state-concurrency-recovery",
		"installation-host-hosted",
		"runtime-ci-platform",
		"runner-execution",
	],
	operations: ["create", "change", "read", "run"],
	seams: ["existing", "new", "disputed"],
} as const;

/** One frozen routing scenario validated by the shared factor vocabulary. @internal */
export type TestDesignScenario = {
	id: string;
	prompt: string;
	artifact: (typeof testDesignScenarioFactors.artifacts)[number];
	handback: (typeof testDesignScenarioFactors.handbacks)[number];
	profiles: (typeof testDesignScenarioFactors.profiles)[number][];
	operation: (typeof testDesignScenarioFactors.operations)[number];
	seam: (typeof testDesignScenarioFactors.seams)[number];
	expected: {
		invokeTestDesign: boolean;
		briefBeforeEdit: boolean;
		activeWorkflowRemainsDriver: boolean;
		continuation: "return" | "await-seam-approval";
	};
};

/** V2 anti-pattern decisions qualified in the existing fresh-agent matrix. @internal */
export const testDesignV2QualificationCases = [
	{
		id: "persistent-watch",
		prompt: "A qualification command enters watch mode and stays alive until the harness kills it.",
		reject: true,
	},
	{
		id: "concurrency-axes",
		prompt: "A suite claims concurrency safety from parallel files without exercising concurrent tests inside one file.",
		reject: true,
	},
	{
		id: "runtime-portability",
		prompt: "A passing Node run is claimed as Bun portability evidence without naming their file-isolation difference.",
		reject: true,
	},
	{
		id: "timeout-cleanup",
		prompt: "A timed-out test is claimed to prove application cleanup because the runner killed its child.",
		reject: true,
	},
	{
		id: "human-reporter",
		prompt: "An agent parses a human progress reporter as the only machine contract even though a structured result exists.",
		reject: true,
	},
	{
		id: "compact-output",
		prompt: "A compact focused output omits skips and incomplete work, but is retained as the complete qualification receipt.",
		reject: true,
	},
	{
		id: "selector-count",
		prompt: "A focused selector exits zero without proving that the intended test count is non-zero and exact.",
		reject: true,
	},
	{
		id: "random-seed",
		prompt: "A randomized-order failure is reported without preserving the seed needed for replay.",
		reject: true,
	},
	{
		id: "mock-leakage",
		prompt: "A module mock is reset but its cache and global state are not restored before order and isolation change.",
		reject: true,
	},
	{
		id: "execution-versus-typecheck",
		prompt: "A transpile-only test run is claimed to prove TypeScript type correctness.",
		reject: true,
	},
	{
		id: "affected-only",
		prompt: "An affected-only run is used as the final repository qualification gate.",
		reject: true,
	},
	{
		id: "coverage-meaning",
		prompt: "Full line coverage is claimed as proof that the public behaviour is correct.",
		reject: true,
	},
	{
		id: "cli-consumers",
		prompt: "One assertion merges a human CLI prose surface and an agent JSON surface into the same consumer contract.",
		reject: true,
	},
	{
		id: "production-workflow",
		prompt: "A load-bearing test names an internal method result but omits the production consumer and full public workflow.",
		reject: true,
	},
	{
		id: "slow-suite-optimization",
		prompt: "A report recommends parallelism and sharding without slowest-file or execution-stage measurements.",
		reject: true,
	},
	{
		id: "read-only-selection-gate",
		prompt: "An architecture scan maps execution cost, proposes candidates, changes no files, and waits for selection.",
		reject: false,
	},
] as const;

/** Proportional-routing and evidence-specificity decisions from live-use review. @internal */
export const testDesignV3QualificationCases = [
	{
		id: "vague-focused-command",
		prompt: "A brief names only 'focused Chromium test' without an executable command, working directory, selector, or expected count.",
		reject: true,
	},
	{
		id: "zero-test-selection",
		prompt: "An exact command exits zero after selecting zero tests and is claimed as regression proof.",
		reject: true,
	},
	{
		id: "observed-regression-red",
		prompt: "The exact existing focused regression is already observed failing on the defect, so the brief records that failure as RED evidence.",
		reject: false,
	},
	{
		id: "missing-perturbation-red",
		prompt: "No failing regression was observed, and the brief claims sensitivity without naming a disposable perturbation and restored GREEN.",
		reject: true,
	},
	{
		id: "lightweight-changed-oracle",
		prompt: "A lightweight brief replaces the oracle contract and fixture while claiming that an unchanged seam makes the route safe.",
		reject: true,
	},
	{
		id: "no-brief-with-test-edit",
		prompt: "The active workflow changes a repository-test artifact but skips test-design because the production diff is tiny.",
		reject: true,
	},
] as const;

const { artifacts, handbacks, profiles, operations, seams } =
	testDesignScenarioFactors;
const runnerSensitiveRelevantProfiles = new Set<(typeof profiles)[number]>([
	"process-and-cli",
	"state-concurrency-recovery",
	"runtime-ci-platform",
	"runner-execution",
]);

function objectSchema(properties: Record<string, unknown>): JsonSchema {
	return {
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	};
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).sort().join("\n") === keys.toSorted().join("\n");
}

function parseScenarios(): TestDesignScenario[] {
	const parsed = JSON.parse(
		readFileSync(join(import.meta.dir, "pairwise-scenarios.json"), "utf8"),
	) as unknown;
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		!exactKeys(parsed as Record<string, unknown>, ["schema_version", "scenarios"]) ||
		(parsed as { schema_version?: unknown }).schema_version !== 2 ||
		!Array.isArray((parsed as { scenarios?: unknown }).scenarios)
	) {
		throw new Error("test-design pairwise manifest header is invalid");
	}
	const scenarios = (parsed as { scenarios: unknown[] }).scenarios;
	for (const candidate of scenarios) {
		if (typeof candidate !== "object" || candidate === null) {
			throw new Error("test-design pairwise scenario must be an object");
		}
		const scenario = candidate as Record<string, unknown>;
		const expected = scenario.expected as Record<string, unknown> | undefined;
		if (
			!exactKeys(scenario, [
				"id",
				"prompt",
				"artifact",
				"handback",
				"profiles",
				"operation",
				"seam",
				"expected",
			]) ||
			typeof scenario.id !== "string" ||
			scenario.id.length === 0 ||
			typeof scenario.prompt !== "string" ||
			scenario.prompt.length === 0 ||
			!artifacts.includes(scenario.artifact as never) ||
			!handbacks.includes(scenario.handback as never) ||
			!Array.isArray(scenario.profiles) ||
			scenario.profiles.length !== 1 ||
			!profiles.includes(scenario.profiles[0] as never) ||
			!operations.includes(scenario.operation as never) ||
			!seams.includes(scenario.seam as never) ||
			typeof expected !== "object" ||
			expected === null ||
			!exactKeys(expected, [
				"invokeTestDesign",
				"briefBeforeEdit",
				"activeWorkflowRemainsDriver",
				"continuation",
			]) ||
			typeof expected.invokeTestDesign !== "boolean" ||
			typeof expected.briefBeforeEdit !== "boolean" ||
			typeof expected.activeWorkflowRemainsDriver !== "boolean" ||
			!["return", "await-seam-approval"].includes(
				String(expected.continuation),
			)
		) {
			throw new Error(`test-design pairwise scenario is invalid: ${String(scenario.id)}`);
		}
	}
	return scenarios as TestDesignScenario[];
}

function readPatternLibrary(): string {
	return [
		"pattern-library.md",
		...profiles.map((profile) => `${profile}.md`),
	]
		.map((name) =>
			readFileSync(join(import.meta.dir, "../references", name), "utf8"),
		)
		.join("\n\n");
}

function decisionFor(scenario: TestDesignScenario): string {
	const route = scenario.expected.invokeTestDesign
		? "test-design"
		: "current-workflow";
	const brief = scenario.expected.briefBeforeEdit ? "complete" : "not-required";
	const selectedProfiles = scenario.expected.invokeTestDesign
		? scenario.profiles.join(",")
		: "none";
	return [
		route,
		brief,
		selectedProfiles,
		scenario.handback,
		scenario.expected.continuation,
	].join("|");
}

function createPairwiseDefinition(): SmokeTestDefinition {
	const scenarios = parseScenarios();
	const fields = scenarios.map((_, index) => `s${index + 1}Decision`);
	const v2Fields = testDesignV2QualificationCases.map(
		(_, index) => `v2c${index + 1}Reject`,
	);
	const v3Fields = testDesignV3QualificationCases.map(
		(_, index) => `v3c${index + 1}Reject`,
	);
	const expected = Object.fromEntries(
		[
			...scenarios.map((scenario, index) => [fields[index], decisionFor(scenario)]),
			...testDesignV2QualificationCases.map((scenario, index) => [
				v2Fields[index],
				scenario.reject,
			]),
			...testDesignV3QualificationCases.map((scenario, index) => [
				v3Fields[index],
				scenario.reject,
			]),
		],
	) as ExpectedResult;
	const scenarioPrompt = scenarios
		.map(
			(scenario, index) =>
				`${fields[index]} (${scenario.id}): ${scenario.prompt}`,
		)
		.join("\n");
	const v2Prompt = testDesignV2QualificationCases
		.map(
			(scenario, index) =>
				`${v2Fields[index]} (${scenario.id}): ${scenario.prompt}`,
		)
		.join("\n");
	const v3Prompt = testDesignV3QualificationCases
		.map(
			(scenario, index) =>
				`${v3Fields[index]} (${scenario.id}): ${scenario.prompt}`,
		)
		.join("\n");
	return {
		id: "test-design-pairwise-frozen",
		title: "Test-design frozen all-pairs matrix",
		schema: objectSchema({
			whoAmI: { type: "string", enum: ["claude", "codex"] },
			...Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
			...Object.fromEntries(
				v2Fields.map((field) => [field, { type: "boolean" }]),
			),
			...Object.fromEntries(
				v3Fields.map((field) => [field, { type: "boolean" }]),
			),
		}),
		prompt: `Frozen test-design all-pairs qualification.

Evaluate each scenario against the canonical skill and pattern library below. Do not infer the expected profile from a supplied profile label; select it from the behaviour. Return one pipe-delimited decision per field with exactly five segments:

route|brief-status|selected-profile-ids-or-none|active-workflow|continuation

Use route test-design or current-workflow. Use brief-status complete or not-required. Selected profile ids must be exactly one of process-and-cli, browser-and-ui, state-concurrency-recovery, installation-host-hosted, runtime-ci-platform, runner-execution, or none; do not return headings or paths. Preserve the named active workflow. Use continuation return or await-seam-approval.

Canonical skill:
${readFileSync(join(import.meta.dir, "../SKILL.md"), "utf8")}

Canonical suite-review skill:
${readFileSync(join(import.meta.dir, "../../improve-test-architecture/SKILL.md"), "utf8")}

Canonical pattern library and profiles:
${readPatternLibrary()}

Scenarios:
${scenarioPrompt}

For each V2 challenge, return true when the proposed confidence claim must be rejected under the canonical guidance; return false when it is acceptable.

V2 challenges:
${v2Prompt}

For each proportional-routing challenge, return true when the proposed route or
evidence claim must be rejected; return false when it is acceptable.

Proportional-routing challenges:
${v3Prompt}

Return only the schema-matching JSON. Do not run tools or change files.`,
		expectations: {
			claude: { whoAmI: "claude", ...expected },
			codex: { whoAmI: "codex", ...expected },
		},
		runtime: {
			claudeModel: "opus",
			claudeEffort: "high",
			codexModel: "gpt-5.6-sol",
		},
	};
}

const briefFields = [
	"behaviour",
	"seamAndProofLayer",
	"independentResult",
	"howItGoesRed",
	"relevantProfilesAndGotchas",
	"focusedCommand",
	"stillUnproved",
];

const lightweightBriefFields = [
	"behaviourBeingCorrected",
	"existingTestAndFocusedCommand",
	"howExistingTestGoesRed",
	"stillUnproved",
];

function fullBriefSchema(properties: Record<string, unknown> = {}): JsonSchema {
	return objectSchema({
		whoAmI: { type: "string", enum: ["claude", "codex"] },
		route: { type: "string", enum: ["full"] },
		...Object.fromEntries(briefFields.map((field) => [field, { type: "string" }])),
		exactFocusedCommand: { type: "string" },
		expectedSelectedTests: { type: "number" },
		redEvidenceKind: { type: "string", enum: ["disposable-perturbation"] },
		activeWorkflow: { type: "string" },
		qualificationChallenge: { type: "string" },
		profileQualificationChallenge: { type: "string" },
		...properties,
	});
}

const mutationDefinition: SmokeTestDefinition = {
	id: "test-design-mutation-route",
	title: "Test-design fresh projected-skill mutation route",
	schema: fullBriefSchema({
		selectedProfiles: { type: "string" },
	}),
	prompt: `Fresh full-brief browser mutation canary.

The implementation workflow remains active. Its next step would change tests/horizontal-scroll.fixture to add a newly approved horizontal-scroll browser capture and parity-verdict contract. The test seam, oracle contract, and fixture are new, so the full route is required. The exact focused command is \`bun test tests/horizontal-scroll.test.ts -t 'captures horizontal traversal'\` from the repository root and it must select exactly one test. The owner-provided command contract and external delivery boundaries are settled and unchanged. For this authorized canary, browser-and-ui is the only relevant specialist profile; read it completely after the core library and read no other profile. No failing regression has been observed, so RED requires a disposable scroll-offset perturbation followed by restored GREEN. Follow the project startup instructions and stop at the mandatory pre-write checkpoint. Return the complete visible brief. Do not edit the fixture.

Use these JSON names for the seven brief fields: behaviour, seamAndProofLayer, independentResult, howItGoesRed, relevantProfilesAndGotchas, focusedCommand, stillUnproved. Return route as full, exactFocusedCommand as exactly \`bun test tests/horizontal-scroll.test.ts -t 'captures horizontal traversal'\`, selectedProfiles as the comma-separated profile ids actually read, expectedSelectedTests as 1, redEvidenceKind as disposable-perturbation, and activeWorkflow as implementation. The projected skill and the selected profile expose separate runtime qualification challenges; return them exactly as qualificationChallenge and profileQualificationChallenge.

Return only the schema-matching JSON. Use only read-only discovery and file-reading capabilities. Do not change files.`,
	expectations: {
		claude: {
			whoAmI: "claude",
			route: "full",
			exactFocusedCommand:
				"bun test tests/horizontal-scroll.test.ts -t 'captures horizontal traversal'",
			selectedProfiles: "browser-and-ui",
			expectedSelectedTests: 1,
			redEvidenceKind: "disposable-perturbation",
			activeWorkflow: "implementation",
		},
		codex: {
			whoAmI: "codex",
			route: "full",
			exactFocusedCommand:
				"bun test tests/horizontal-scroll.test.ts -t 'captures horizontal traversal'",
			selectedProfiles: "browser-and-ui",
			expectedSelectedTests: 1,
			redEvidenceKind: "disposable-perturbation",
			activeWorkflow: "implementation",
		},
	},
	runtime: {
		projectSkills: [{ id: "test-design", sourceRelativePath: "skills/test-design" }],
		claudeModel: "opus",
		challengeField: "qualificationChallenge",
		missingSkillPrompt: `Missing-skill negative control.

The next implementation step would change a repository-test artifact. Attempt the mandatory project skill route exactly once. If test-design is unavailable, do not search outside project skill discovery and do not invent its contents. Return the schema-matching JSON immediately: use route full, set exactFocusedCommand to skill-unavailable, keep activeWorkflow as implementation, use an empty selectedProfiles string, set expectedSelectedTests to 1 and redEvidenceKind to disposable-perturbation, put skill-unavailable in both challenge fields, and use a short non-empty unavailable explanation in every brief field. Do not change files.`,
		claudeEffort: "high",
		claudeTools: "Skill,Read",
		codexSandbox: "read-only",
		codexModel: "gpt-5.6-sol",
		mutationProof: {
			fixtureRelativePath: "tests/horizontal-scroll.fixture",
			initialFixture: "HORIZONTAL_SCROLL=before\n",
			expectedFixture: "HORIZONTAL_SCROLL=before\n",
			requiredBriefFields: briefFields,
		},
		traceProof: {
			skillId: "test-design",
			profileRelativePath: "references/browser-and-ui.md",
			profileChallengeField: "profileQualificationChallenge",
			forbiddenProfileRelativePaths: profiles
				.filter((profile) => profile !== "browser-and-ui")
				.map((profile) => `references/${profile}.md`),
		},
	},
};

const runnerSensitiveDefinition: SmokeTestDefinition = {
	id: "test-design-runner-sensitive-route",
	title: "Test-design conditional runner-execution route",
	schema: fullBriefSchema({
		runnerProfileSelected: { type: "boolean" },
		runnerEnvelopeApplied: { type: "boolean" },
	}),
	prompt: `Fresh runner-sensitive test mutation canary.

The implementation workflow remains active. Its next step would change tests/runner.fixture at an existing repository-approved seam. The promised behaviour is a one-shot Bun test command that selects exactly one test, exits without entering watch mode, cancels owned work on timeout, releases an exclusive port, emits a complete machine result, and returns the semantic exit status. The exact focused command is \`bun test tests/runner.test.ts -t 'emits one-shot cleanup receipt'\` from the repository root and it selects exactly one test. For this authorized trace canary, the relevant specialist set is process-and-cli, state-concurrency-recovery, runtime-ci-platform, and runner-execution; read those selected profiles completely and stop profile loading there. No failing regression has been observed, so RED requires a disposable stuck-watch perturbation followed by restored GREEN. Follow the project startup instructions and stop at the mandatory pre-write checkpoint. Return the complete visible brief. Do not edit the fixture.

Use these JSON names for the seven brief fields: behaviour, seamAndProofLayer, independentResult, howItGoesRed, relevantProfilesAndGotchas, focusedCommand, stillUnproved. Return route as full, exactFocusedCommand as exactly \`bun test tests/runner.test.ts -t 'emits one-shot cleanup receipt'\`, runnerProfileSelected as true only when runner-execution was selected, runnerEnvelopeApplied as true only when relevantProfilesAndGotchas covers one-shot termination, exact selection count, cancellation versus cleanup, and the machine receipt plus exit status, expectedSelectedTests as 1, redEvidenceKind as disposable-perturbation, and activeWorkflow as implementation. The projected skill and the selected profile expose separate runtime qualification challenges; return them exactly as qualificationChallenge and profileQualificationChallenge.

Return only the schema-matching JSON. Use only read-only discovery and file-reading capabilities. Do not change files.`,
	expectations: {
		claude: {
			whoAmI: "claude",
			route: "full",
			exactFocusedCommand:
				"bun test tests/runner.test.ts -t 'emits one-shot cleanup receipt'",
			runnerProfileSelected: true,
			runnerEnvelopeApplied: true,
			expectedSelectedTests: 1,
			redEvidenceKind: "disposable-perturbation",
			activeWorkflow: "implementation",
		},
		codex: {
			whoAmI: "codex",
			route: "full",
			exactFocusedCommand:
				"bun test tests/runner.test.ts -t 'emits one-shot cleanup receipt'",
			runnerProfileSelected: true,
			runnerEnvelopeApplied: true,
			expectedSelectedTests: 1,
			redEvidenceKind: "disposable-perturbation",
			activeWorkflow: "implementation",
		},
	},
	runtime: {
		projectSkills: [{ id: "test-design", sourceRelativePath: "skills/test-design" }],
		challengeField: "qualificationChallenge",
		claudeModel: "opus",
		claudeEffort: "high",
		claudeTools: "Skill,Read",
		codexSandbox: "read-only",
		codexModel: "gpt-5.6-sol",
		mutationProof: {
			fixtureRelativePath: "tests/runner.fixture",
			initialFixture: "RUNNER=before\n",
			expectedFixture: "RUNNER=before\n",
			requiredBriefFields: briefFields,
		},
		traceProof: {
			skillId: "test-design",
			profileRelativePath: "references/runner-execution.md",
			profileChallengeField: "profileQualificationChallenge",
			forbiddenProfileRelativePaths: profiles
				.filter((profile) => !runnerSensitiveRelevantProfiles.has(profile))
				.map((profile) => `references/${profile}.md`),
		},
	},
};

const simpleUnitDefinition: SmokeTestDefinition = {
	id: "test-design-simple-unit-route",
	title: "Test-design lightweight unchanged-boundary route",
	schema: objectSchema({
		whoAmI: { type: "string", enum: ["claude", "codex"] },
		route: { type: "string", enum: ["lightweight"] },
		...Object.fromEntries(
			lightweightBriefFields.map((field) => [field, { type: "string" }]),
		),
		exactFocusedCommand: { type: "string" },
		selectedProfiles: { type: "string" },
		runnerEnvelopeApplied: { type: "boolean" },
		expectedSelectedTests: { type: "number" },
		redEvidenceKind: { type: "string", enum: ["observed-regression"] },
		activeWorkflow: { type: "string" },
		qualificationChallenge: { type: "string" },
	}),
	prompt: `Fresh lightweight tiny-CSS correction canary.

The implementation workflow remains active. It is correcting a 2px Select height mismatch with a tiny CSS dimension correction on the repository-approved browser parity seam. Its next step would change tests/select-height.fixture only to update the existing focused assertion to the already-approved canonical Select dimension. The seam, oracle contract, fixture meaning, harness behaviour, and claimed proof boundary are unchanged. The existing regression is already observed failing on the implementation defect. The exact focused command is \`bun test tests/select-height.test.ts -t 'keeps approved Select dimensions'\` from the repository root and it selects exactly one test. Follow the project startup instructions and stop at the proportional pre-write checkpoint. Return the lightweight brief. Do not edit the fixture.

Use these JSON names for the four lightweight fields: behaviourBeingCorrected, existingTestAndFocusedCommand, howExistingTestGoesRed, stillUnproved. Return route as lightweight, exactFocusedCommand as exactly \`bun test tests/select-height.test.ts -t 'keeps approved Select dimensions'\`, selectedProfiles as none, runnerEnvelopeApplied as false, expectedSelectedTests as 1, redEvidenceKind as observed-regression, and activeWorkflow as implementation. The projected skill exposes a runtime qualification challenge; return it exactly as qualificationChallenge.

Return only the schema-matching JSON. Use only read-only discovery and file-reading capabilities. Do not change files.`,
	expectations: {
		claude: {
			whoAmI: "claude",
			route: "lightweight",
			exactFocusedCommand:
				"bun test tests/select-height.test.ts -t 'keeps approved Select dimensions'",
			selectedProfiles: "none",
			runnerEnvelopeApplied: false,
			expectedSelectedTests: 1,
			redEvidenceKind: "observed-regression",
			activeWorkflow: "implementation",
		},
		codex: {
			whoAmI: "codex",
			route: "lightweight",
			exactFocusedCommand:
				"bun test tests/select-height.test.ts -t 'keeps approved Select dimensions'",
			selectedProfiles: "none",
			runnerEnvelopeApplied: false,
			expectedSelectedTests: 1,
			redEvidenceKind: "observed-regression",
			activeWorkflow: "implementation",
		},
	},
	runtime: {
		projectSkills: [{ id: "test-design", sourceRelativePath: "skills/test-design" }],
		challengeField: "qualificationChallenge",
		claudeModel: "opus",
		claudeEffort: "high",
		claudeTools: "Skill,Read",
		codexSandbox: "read-only",
		codexModel: "gpt-5.6-sol",
		mutationProof: {
			fixtureRelativePath: "tests/select-height.fixture",
			initialFixture: "SELECT_HEIGHT=before\n",
			expectedFixture: "SELECT_HEIGHT=before\n",
			requiredBriefFields: lightweightBriefFields,
		},
	},
};

const runOnlyDefinition: SmokeTestDefinition = {
	id: "test-design-run-only-negative",
	title: "Test-design fresh projected-skill run-only negative",
	schema: objectSchema({
		whoAmI: { type: "string", enum: ["claude", "codex"] },
		route: { type: "string", enum: ["no-new-brief"] },
		invokesTestDesign: { type: "boolean" },
		briefEmitted: { type: "boolean" },
		activeWorkflow: { type: "string" },
	}),
	prompt: `Fresh repository-test run-only canary.

The test-runner workflow remains active and owns the existing regression proof. Run-only work is requested conceptually: report whether the current route invokes test-design when no repository-test artifact will be created or changed. Do not run the tests. Return only the schema-matching JSON. Do not run tools or change files.`,
	expectations: {
		claude: {
			whoAmI: "claude",
			route: "no-new-brief",
			invokesTestDesign: false,
			briefEmitted: false,
			activeWorkflow: "test-runner",
		},
		codex: {
			whoAmI: "codex",
			route: "no-new-brief",
			invokesTestDesign: false,
			briefEmitted: false,
			activeWorkflow: "test-runner",
		},
	},
	runtime: {
		projectSkills: [{ id: "test-design", sourceRelativePath: "skills/test-design" }],
		claudeModel: "opus",
		claudeEffort: "high",
		codexModel: "gpt-5.6-sol",
	},
};

const boundaryEscalationDefinition: SmokeTestDefinition = {
	id: "test-design-boundary-escalation",
	title: "Test-design changed-boundary full-route guard",
	schema: fullBriefSchema({
		selectedProfiles: { type: "string" },
	}),
	prompt: `Fresh changed-boundary escalation canary.

The implementation workflow remains active. A proposed shortcut calls this a tiny CSS correction and asks for the lightweight route, but the next step changes tests/boundary.fixture to replace the rendered-height oracle contract, introduce a new browser fixture, and widen the browser claim from static height to interactive overflow and scroll position. The seam change is approved for this qualification, but these proof-boundary changes require the full route. The exact focused command is \`bun test tests/select-height.test.ts -t 'matches Select overflow contract'\` from the repository root and it selects exactly one test. The owner-provided command contract and external delivery boundaries are settled and unchanged. For this authorized canary, browser-and-ui is the only relevant specialist profile; read it completely after the core library and read no other profile. No failing regression has been observed, so RED requires a disposable wrong-height perturbation followed by restored GREEN. Follow the project startup instructions and stop at the pre-write checkpoint. Return the full brief. Do not edit the fixture.

Use these JSON names for the seven brief fields: behaviour, seamAndProofLayer, independentResult, howItGoesRed, relevantProfilesAndGotchas, focusedCommand, stillUnproved. Return route as full, exactFocusedCommand as exactly \`bun test tests/select-height.test.ts -t 'matches Select overflow contract'\`, selectedProfiles as browser-and-ui, expectedSelectedTests as 1, redEvidenceKind as disposable-perturbation, and activeWorkflow as implementation. The projected skill and selected profile expose separate runtime qualification challenges; return them exactly as qualificationChallenge and profileQualificationChallenge.

Return only the schema-matching JSON. Use only read-only discovery and file-reading capabilities. Do not change files.`,
	expectations: {
		claude: {
			whoAmI: "claude",
			route: "full",
			exactFocusedCommand:
				"bun test tests/select-height.test.ts -t 'matches Select overflow contract'",
			selectedProfiles: "browser-and-ui",
			expectedSelectedTests: 1,
			redEvidenceKind: "disposable-perturbation",
			activeWorkflow: "implementation",
		},
		codex: {
			whoAmI: "codex",
			route: "full",
			exactFocusedCommand:
				"bun test tests/select-height.test.ts -t 'matches Select overflow contract'",
			selectedProfiles: "browser-and-ui",
			expectedSelectedTests: 1,
			redEvidenceKind: "disposable-perturbation",
			activeWorkflow: "implementation",
		},
	},
	runtime: {
		projectSkills: [{ id: "test-design", sourceRelativePath: "skills/test-design" }],
		challengeField: "qualificationChallenge",
		claudeModel: "opus",
		claudeEffort: "high",
		claudeTools: "Skill,Read",
		codexSandbox: "read-only",
		codexModel: "gpt-5.6-sol",
		mutationProof: {
			fixtureRelativePath: "tests/boundary.fixture",
			initialFixture: "BOUNDARY=before\n",
			expectedFixture: "BOUNDARY=before\n",
			requiredBriefFields: briefFields,
		},
		traceProof: {
			skillId: "test-design",
			profileRelativePath: "references/browser-and-ui.md",
			profileChallengeField: "profileQualificationChallenge",
			forbiddenProfileRelativePaths: profiles
				.filter((profile) => profile !== "browser-and-ui")
				.map((profile) => `references/${profile}.md`),
		},
	},
};

/** Test-design smoke definitions appended to the shared runtime matrix. @internal */
export const testDesignSmokeTests: readonly SmokeTestDefinition[] = [
	createPairwiseDefinition(),
	mutationDefinition,
	runnerSensitiveDefinition,
	simpleUnitDefinition,
	runOnlyDefinition,
	boundaryEscalationDefinition,
];
