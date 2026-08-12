import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	testDesignScenarioFactors,
	type TestDesignScenario,
} from "../evals/smoke-definitions.ts";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const testDesignPath = resolve(import.meta.dir, "../SKILL.md");
const improveTestArchitecturePath = resolve(
	import.meta.dir,
	"../../improve-test-architecture/SKILL.md",
);
const patternLibraryPath = resolve(
	import.meta.dir,
	"../references/pattern-library.md",
);
const reportReferencePath = resolve(
	import.meta.dir,
	"../../improve-test-architecture/references/html-report.md",
);
const scenarioMatrixPath = resolve(
	import.meta.dir,
	"../evals/pairwise-scenarios.json",
);

const startupRule =
	"Before creating or changing a repository-test artifact, invoke `test-design` and complete its Test Design Brief. Then return to the current workflow.";

const {
	artifacts: artifactTypes,
	handbacks,
	profiles,
	operations,
	seams,
} = testDesignScenarioFactors;
const profilePaths = Object.fromEntries(
	profiles.map((profile) => [
		profile,
		resolve(import.meta.dir, `../references/${profile}.md`),
	]),
) as Record<(typeof profiles)[number], string>;

function requiredText(path: string): string {
	if (!existsSync(path)) throw new Error(`required source missing: ${path}`);
	return readFileSync(path, "utf8");
}

function parseSkill(path: string): {
	frontmatterSource: string;
	frontmatter: Record<string, unknown>;
	body: string;
} {
	const source = requiredText(path);
	const match = source.match(
		/^---\r?\n(?<frontmatter>[\s\S]*?)\r?\n---\s*(?:\r?\n|$)(?<body>[\s\S]*)$/u,
	);
	if (!match?.groups) throw new Error(`SKILL.md frontmatter missing: ${path}`);
	return {
		frontmatterSource: match.groups.frontmatter,
		frontmatter: Bun.YAML.parse(match.groups.frontmatter) as Record<
			string,
			unknown
		>,
		body: match.groups.body,
	};
}

function parseScenarios(): TestDesignScenario[] {
	const parsed = JSON.parse(requiredText(scenarioMatrixPath)) as {
		schema_version: number;
		scenarios: TestDesignScenario[];
	};
	expect(parsed.schema_version).toBe(2);
	return parsed.scenarios;
}

describe("agent-native testing skill contract", () => {
	test("uses the accepted invocation lanes and exact Startup Surface route", () => {
		const testDesign = parseSkill(testDesignPath);
		const improveTestArchitecture = parseSkill(improveTestArchitecturePath);

		expect(testDesign.frontmatter.name).toBe(basename(dirname(testDesignPath)));
		expect(testDesign.frontmatter.description).toBeTypeOf("string");
		expect(testDesign.frontmatterSource).toMatch(
			/^description:\s*(["']).*\1$/mu,
		);
		expect(testDesign.frontmatter["disable-model-invocation"]).toBeUndefined();

		expect(improveTestArchitecture.frontmatter.name).toBe(
			basename(dirname(improveTestArchitecturePath)),
		);
			expect(
				improveTestArchitecture.frontmatter["disable-model-invocation"],
			).toBe(true);
			expect(improveTestArchitecture.frontmatter.description).toBeTypeOf("string");
			expect(improveTestArchitecture.frontmatterSource).toMatch(
				/^description:\s*(["']).*\1$/mu,
			);
		expect(requiredText(resolve(repositoryRoot, "AGENTS.md"))).toContain(
			startupRule,
		);
	});

	test("wires a source-bound qualification gate before Startup Surface activation", () => {
		const qualification = requiredText(
			resolve(repositoryRoot, "skills/test-design/evals/qualification.ts"),
		);
		expect(qualification).toContain('"AGENTS.md"');
		expect(qualification).toContain(
			'"skills/test-design/evals/smoke-definitions.ts"',
		);
		const instructionHealth = requiredText(
			resolve(repositoryRoot, "scripts/agent-instructions.sh"),
		);
		expect(instructionHealth).toContain("check_test_design_qualification");
		expect(instructionHealth).toContain(
			"test-design Startup Surface route lacks current qualification",
		);
		const ci = requiredText(resolve(repositoryRoot, ".github/workflows/ci.yml"));
		expect(ci).toContain(
			"bun skills/test-design/evals/qualification.ts deterministic",
		);
		expect(ci).toContain("bun skills/test-design/evals/qualification.ts verify");
	});

	test("keeps one shared pattern library with the accepted core and profiles", () => {
		const testDesign = parseSkill(testDesignPath).body;
		const improveTestArchitecture = parseSkill(improveTestArchitecturePath).body;
		const library = requiredText(patternLibraryPath);

		expect(testDesign).toContain("references/pattern-library.md");
		expect(improveTestArchitecture).toContain(
			"skills/test-design/references/pattern-library.md",
		);

		expect(library).toContain("## Core Pattern Set");
		for (const profile of profiles) {
			expect(library).toContain(
				`skills/test-design/references/${profile}.md`,
			);
			expect(requiredText(profilePaths[profile])).toMatch(/^# /u);
		}
		expect(library).not.toContain("## Process and CLI");
		expect(library).not.toContain("## Browser and UI");

		for (const corePattern of [
			"Name the external behaviour",
			"Choose the seam and proof layer",
			"Use an independent expected result or observable",
			"Define how the test can go RED",
			"Use the smallest focused command",
			"State what the evidence does not prove",
		]) {
			expect(library).toContain(corePattern);
			expect(improveTestArchitecture).not.toContain(corePattern);
		}
	});

	test("requires a visible complete brief before edits and preserves workflow owners", () => {
		const testDesign = parseSkill(testDesignPath).body;
		for (const field of [
			"Behaviour:",
			"Seam and proof layer:",
			"Independent result:",
			"How it goes RED:",
			"Relevant profiles and gotchas:",
			"Focused command:",
			"Still unproved:",
		]) {
			expect(testDesign).toContain(field);
		}
		for (const owner of handbacks) expect(testDesign).toContain(`\`${owner}\``);
		expect(testDesign).toContain("active conversation");
		expect(testDesign).toContain("return to the current workflow");
		expect(testDesign).toContain("new, changed, or disputed seam");
		expect(testDesign).toContain("read only the selected profile references");
		expect(testDesign).not.toContain("Intended test observed by the focused command");
		expect(testDesign).not.toContain("RED mechanism proved");
		expect(testDesign).toContain("Brief visible and complete");
		expect(testDesign).toContain("Handback to the active workflow explicit");
	});

	test("keeps suite review read-only until selection and owns temporary visual output", () => {
		const improveTestArchitecture = parseSkill(improveTestArchitecturePath).body;
		const reportReference = requiredText(reportReferencePath);

		expect(improveTestArchitecture).toContain("three to five");
		expect(improveTestArchitecture).toContain("one recommendation");
		expect(improveTestArchitecture).toContain("change no tests");
		expect(improveTestArchitecture).toContain("Nathan selects");
		expect(improveTestArchitecture).toContain("references/html-report.md");
		expect(reportReference).toContain("operating-system temporary directory");
		expect(reportReference).toContain("self-contained HTML");
		expect(reportReference).toContain("absolute path");
		expect(reportReference).toContain("Create no repository or vault file");
	});

	test("freezes all valid factor pairs across artifacts, owners, profiles, operations, and seams", () => {
		const scenarios = parseScenarios();
		expect(scenarios).toHaveLength(36);
		expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(
			scenarios.length,
		);
		expect(new Set(scenarios.map((scenario) => scenario.artifact))).toEqual(
			new Set(artifactTypes),
		);
		expect(new Set(scenarios.map((scenario) => scenario.handback))).toEqual(
			new Set(handbacks),
		);
		expect(new Set(scenarios.flatMap((scenario) => scenario.profiles))).toEqual(
			new Set(profiles),
		);

			const factors = [
				["artifact", artifactTypes],
				["handback", handbacks],
				["profile", profiles],
				["operation", operations],
				["seam", seams],
			] as const;
			const factorValue = (
				scenario: TestDesignScenario,
				factor: (typeof factors)[number][0],
			) =>
				factor === "profile" ? scenario.profiles[0] : scenario[factor];
		for (let left = 0; left < factors.length; left += 1) {
			for (let right = left + 1; right < factors.length; right += 1) {
				const [leftName, leftValues] = factors[left];
				const [rightName, rightValues] = factors[right];
				const observed = new Set(
					scenarios.map(
						(scenario) =>
							`${factorValue(scenario, leftName)}::${factorValue(scenario, rightName)}`,
					),
				);
				for (const leftValue of leftValues) {
					for (const rightValue of rightValues) {
						expect(observed).toContain(`${leftValue}::${rightValue}`);
					}
				}
			}
		}

		const mutationScenarios = scenarios.filter((scenario) =>
			["create", "change"].includes(scenario.operation),
		);
		for (const scenario of mutationScenarios) {
			expect(scenario.prompt.length).toBeGreaterThan(20);
			expect(scenario.profiles).toHaveLength(1);
			expect(scenario.expected.invokeTestDesign).toBe(true);
			expect(scenario.expected.briefBeforeEdit).toBe(true);
			expect(scenario.expected.activeWorkflowRemainsDriver).toBe(true);
			if (scenario.seam === "existing") {
				expect(scenario.expected.continuation).toBe("return");
			} else {
				expect(scenario.expected.continuation).toBe("await-seam-approval");
			}
		}

			for (const operation of ["read", "run"] as const) {
				const negativeScenarios = scenarios.filter(
					(candidate) => candidate.operation === operation,
				);
				expect(negativeScenarios.length).toBeGreaterThan(0);
				for (const scenario of negativeScenarios) {
					expect(scenario.expected).toEqual({
						invokeTestDesign: false,
						briefBeforeEdit: false,
						activeWorkflowRemainsDriver: true,
						continuation: "return",
					});
				}
			}

		expect(scenarios.some((scenario) => scenario.seam === "new")).toBe(true);
		expect(scenarios.some((scenario) => scenario.seam === "disputed")).toBe(
			true,
		);
	});
});
