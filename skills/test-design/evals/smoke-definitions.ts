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

const { artifacts, handbacks, profiles, operations, seams } =
	testDesignScenarioFactors;

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
	const expected = Object.fromEntries(
		scenarios.map((scenario, index) => [fields[index], decisionFor(scenario)]),
	) as ExpectedResult;
	const scenarioPrompt = scenarios
		.map(
			(scenario, index) =>
				`${fields[index]} (${scenario.id}): ${scenario.prompt}`,
		)
		.join("\n");
	return {
		id: "test-design-pairwise-frozen",
		title: "Test-design frozen all-pairs matrix",
		schema: objectSchema({
			whoAmI: { type: "string", enum: ["claude", "codex"] },
			...Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
		}),
		prompt: `Frozen test-design all-pairs qualification.

Evaluate each scenario against the canonical skill and pattern library below. Do not infer the expected profile from a supplied profile label; select it from the behaviour. Return one pipe-delimited decision per field with exactly five segments:

route|brief-status|selected-profile-ids-or-none|active-workflow|continuation

Use route test-design or current-workflow. Use brief-status complete or not-required. Selected profile ids must be exactly one of process-and-cli, browser-and-ui, state-concurrency-recovery, installation-host-hosted, runtime-ci-platform, or none; do not return headings or paths. Preserve the named active workflow. Use continuation return or await-seam-approval.

Canonical skill:
${readFileSync(join(import.meta.dir, "../SKILL.md"), "utf8")}

Canonical pattern library and profiles:
${readPatternLibrary()}

Scenarios:
${scenarioPrompt}

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

const mutationDefinition: SmokeTestDefinition = {
	id: "test-design-mutation-route",
	title: "Test-design fresh projected-skill mutation route",
	schema: objectSchema({
		whoAmI: { type: "string", enum: ["claude", "codex"] },
		...Object.fromEntries(briefFields.map((field) => [field, { type: "string" }])),
		selectedProfiles: { type: "string" },
		activeWorkflow: { type: "string" },
		qualificationChallenge: { type: "string" },
		profileQualificationChallenge: { type: "string" },
	}),
	prompt: `Fresh repository-test mutation canary.

The implementation workflow remains active. Its next step would change tests/ready.fixture at an existing repository-approved seam. The behaviour is only a public CLI process printing READY to stdout and exiting zero. Runtime, CI, operating-system, shell, browser, state, recovery, installation, live-host, and hosted compatibility are explicitly outside this canary's claim and already covered elsewhere. Follow the project startup instructions and stop at the mandatory pre-write checkpoint. Return the complete visible brief. Do not edit the fixture.

Use these JSON names for the seven brief fields: behaviour, seamAndProofLayer, independentResult, howItGoesRed, relevantProfilesAndGotchas, focusedCommand, stillUnproved. Return selectedProfiles as the comma-separated profile ids actually read. Return activeWorkflow as implementation. The projected skill and the selected profile expose separate runtime qualification challenges; return them exactly as qualificationChallenge and profileQualificationChallenge.

Return only the schema-matching JSON. Use only read-only discovery and file-reading capabilities. Do not change files.`,
	expectations: {
		claude: {
			whoAmI: "claude",
			selectedProfiles: "process-and-cli",
			activeWorkflow: "implementation",
		},
		codex: {
			whoAmI: "codex",
			selectedProfiles: "process-and-cli",
			activeWorkflow: "implementation",
		},
	},
	runtime: {
		projectSkills: [{ id: "test-design", sourceRelativePath: "skills/test-design" }],
		claudeModel: "opus",
		challengeField: "qualificationChallenge",
		missingSkillPrompt: `Missing-skill negative control.

The next implementation step would change a repository-test artifact. Attempt the mandatory project skill route exactly once. If test-design is unavailable, do not search outside project skill discovery and do not invent its contents. Return the schema-matching JSON immediately: keep activeWorkflow as implementation, use an empty selectedProfiles string, put skill-unavailable in both challenge fields, and use a short non-empty unavailable explanation in every brief field. Do not change files.`,
		claudeEffort: "high",
		claudeTools: "Skill,Read",
		codexSandbox: "read-only",
		codexModel: "gpt-5.6-sol",
		mutationProof: {
			fixtureRelativePath: "tests/ready.fixture",
			initialFixture: "READY=before\n",
			expectedFixture: "READY=before\n",
			requiredBriefFields: briefFields,
		},
		traceProof: {
			skillId: "test-design",
			profileRelativePath: "references/process-and-cli.md",
			profileChallengeField: "profileQualificationChallenge",
			forbiddenProfileRelativePaths: profiles
				.filter((profile) => profile !== "process-and-cli")
				.map((profile) => `references/${profile}.md`),
		},
	},
};

const runOnlyDefinition: SmokeTestDefinition = {
	id: "test-design-run-only-negative",
	title: "Test-design fresh projected-skill run-only negative",
	schema: objectSchema({
		whoAmI: { type: "string", enum: ["claude", "codex"] },
		invokesTestDesign: { type: "boolean" },
		briefEmitted: { type: "boolean" },
		activeWorkflow: { type: "string" },
	}),
	prompt: `Fresh repository-test run-only canary.

The test-runner workflow remains active. Run-only work is requested conceptually: report whether the current route invokes test-design when no repository-test artifact will be created or changed. Do not run the tests. Return only the schema-matching JSON. Do not run tools or change files.`,
	expectations: {
		claude: {
			whoAmI: "claude",
			invokesTestDesign: false,
			briefEmitted: false,
			activeWorkflow: "test-runner",
		},
		codex: {
			whoAmI: "codex",
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

/** Test-design smoke definitions appended to the shared runtime matrix. @internal */
export const testDesignSmokeTests: readonly SmokeTestDefinition[] = [
	createPairwiseDefinition(),
	mutationDefinition,
	runOnlyDefinition,
];
