#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * Which Browser Adapter recovery modules earn production depth, and which
 * collapse back into shallow helper noise when deleted?
 *
 * Run:
 * bun skills/browser-use/src/prototype-browser-adapter-deletion-test/prototype.ts
 * bun skills/browser-use/src/prototype-browser-adapter-deletion-test/prototype.ts --auto
 *
 * Notes:
 * skills/browser-use/src/prototype-browser-adapter-deletion-test/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type CandidateId =
	| "RecoveryCatalogue"
	| "AdapterProofSpec"
	| "ProjectionEngine"
	| "MapAuthoringHelper"
	| "ExplanationRenderer"
	| "ReplayOutcomeEngine";
type Caller =
	| "Browser Adapter Proof"
	| "Browser Adapter Map checker"
	| "Map Authoring Workbench"
	| "Browser Adapter Router"
	| "CLI plain output"
	| "Smoke tests";
type Verdict =
	| "strong_production_candidate"
	| "worth_exploring"
	| "prototype_only"
	| "merge_into_parent";
type ScenarioKey =
	| "all_modules_present"
	| "delete_recovery_catalogue"
	| "delete_adapter_proof_spec"
	| "delete_projection_engine"
	| "delete_map_authoring_helper"
	| "delete_explanation_renderer"
	| "delete_replay_outcome_engine";

type CandidateModule = {
	id: CandidateId;
	interface_facts: string[];
	implementation_hides: string[];
	callers: Caller[];
	owned_vocabulary: string[];
	test_surface: string[];
};

type DeletionImpact = {
	module: CandidateId;
	deleted: boolean;
	complexity_reappears_in: Caller[];
	duplicated_facts: string[];
	lost_leverage: string[];
	lost_locality: string[];
	shallow_warning: string | null;
	depth_score: number;
	verdict: Verdict;
};

type PrototypeState = {
	throwaway: true;
	question: string;
	last_action: string;
	scenario: ScenarioKey;
	deleted_modules: CandidateId[];
	impacts: DeletionImpact[];
	top_recommendation: {
		extract_first: CandidateId | null;
		reason: string;
	};
	architecture_summary: {
		real_seams: string[];
		shallow_helpers: CandidateId[];
		deep_modules: CandidateId[];
	};
};

type Scenario = {
	key: ScenarioKey;
	label: string;
	deleted_modules: CandidateId[];
};

const question =
	"Which module deletion causes complexity to reappear across callers?";
const modules: Record<CandidateId, CandidateModule> = {
	RecoveryCatalogue: {
		id: "RecoveryCatalogue",
		interface_facts: [
			"diagnostic code",
			"canonical recovery action",
			"map section",
			"warning vs blocking behavior",
		],
		implementation_hides: [
			"code/action consistency",
			"section placement",
			"warning-only semantics",
			"no adapter fallback meaning",
		],
		callers: [
			"Browser Adapter Proof",
			"Browser Adapter Map checker",
			"Map Authoring Workbench",
			"CLI plain output",
		],
		owned_vocabulary: [
			"adapter_config_stale",
			"adapter_dependency_missing",
			"adapter_signal_weak",
			"use_verified_browser_adapter",
		],
		test_surface: [
			"catalog entry emits canonical action",
			"all emitted codes have map sections",
		],
	},
	AdapterProofSpec: {
		id: "AdapterProofSpec",
		interface_facts: [
			"adapter id",
			"proof probes",
			"emitted diagnostics",
			"command slots",
		],
		implementation_hides: [
			"chrome-devtools vs agent-browser proof differences",
			"adapter-local dependency surfaces",
			"adapter-local weak signal probes",
		],
		callers: [
			"Browser Adapter Proof",
			"Browser Adapter Map checker",
			"Map Authoring Workbench",
			"Smoke tests",
		],
		owned_vocabulary: [
			"chrome-devtools",
			"agent-browser",
			"binding probe",
			"weak signal probe",
		],
		test_surface: [
			"adapter emitted diagnostics are catalogued",
			"adapter proof probes exist before map authoring",
		],
	},
	ProjectionEngine: {
		id: "ProjectionEngine",
		interface_facts: [
			"consumer name",
			"contract shape",
			"projection output keys",
		],
		implementation_hides: [
			"map validation expected keys",
			"authoring skeleton keys",
			"Router proof evidence shape",
		],
		callers: [
			"Browser Adapter Map checker",
			"Map Authoring Workbench",
			"Browser Adapter Router",
		],
		owned_vocabulary: ["projection", "consumer output", "derived keys"],
		test_surface: [
			"same contract produces checker and authoring output",
			"Router projection excludes repair commands",
		],
	},
	MapAuthoringHelper: {
		id: "MapAuthoringHelper",
		interface_facts: [
			"adapter spec",
			"draft markdown skeleton",
			"TODO command slots",
		],
		implementation_hides: [
			"markdown section ordering",
			"draft command TODOs",
			"authoring suggestions",
		],
		callers: ["Map Authoring Workbench"],
		owned_vocabulary: ["draft_with_todos", "blocked_on_spec", "ready_to_draft"],
		test_surface: ["draft map includes required sections"],
	},
	ExplanationRenderer: {
		id: "ExplanationRenderer",
		interface_facts: [
			"proof outcome",
			"surface",
			"message",
			"consistency review",
		],
		implementation_hides: [
			"plain CLI summary",
			"Router summary",
			"operator-choice wording",
			"code/action consistency",
		],
		callers: [
			"Browser Adapter Proof",
			"Browser Adapter Router",
			"CLI plain output",
		],
		owned_vocabulary: ["clear", "muddy", "drift"],
		test_surface: [
			"each surface names the same action",
			"Router output excludes command details",
		],
	},
	ReplayOutcomeEngine: {
		id: "ReplayOutcomeEngine",
		interface_facts: [
			"proof result",
			"map entry",
			"recovery outcome",
			"retry budget",
		],
		implementation_hides: [
			"convergent repair loop",
			"human handoff stop",
			"unchanged recovery budget stop",
		],
		callers: ["Smoke tests"],
		owned_vocabulary: ["changed", "unchanged", "human_handoff", "continued"],
		test_surface: ["failure loops stop or converge"],
	},
};

const scenarios: Scenario[] = [
	{
		key: "all_modules_present",
		label: "all modules present",
		deleted_modules: [],
	},
	{
		key: "delete_recovery_catalogue",
		label: "delete RecoveryCatalogue",
		deleted_modules: ["RecoveryCatalogue"],
	},
	{
		key: "delete_adapter_proof_spec",
		label: "delete AdapterProofSpec",
		deleted_modules: ["AdapterProofSpec"],
	},
	{
		key: "delete_projection_engine",
		label: "delete ProjectionEngine",
		deleted_modules: ["ProjectionEngine"],
	},
	{
		key: "delete_map_authoring_helper",
		label: "delete MapAuthoringHelper",
		deleted_modules: ["MapAuthoringHelper"],
	},
	{
		key: "delete_explanation_renderer",
		label: "delete ExplanationRenderer",
		deleted_modules: ["ExplanationRenderer"],
	},
	{
		key: "delete_replay_outcome_engine",
		label: "delete ReplayOutcomeEngine",
		deleted_modules: ["ReplayOutcomeEngine"],
	},
];

function buildState(scenario: Scenario): PrototypeState {
	const impacts = Object.values(modules).map((candidate) =>
		evaluateDeletion(candidate, scenario.deleted_modules),
	);
	const deepModules = impacts
		.filter((impact) => impact.verdict === "strong_production_candidate")
		.map((impact) => impact.module);
	const shallowHelpers = impacts
		.filter((impact) => impact.verdict === "prototype_only")
		.map((impact) => impact.module);
	const first = rankForExtraction(impacts)[0] ?? null;
	return {
		throwaway: true,
		question,
		last_action: scenario.label,
		scenario: scenario.key,
		deleted_modules: scenario.deleted_modules,
		impacts,
		top_recommendation: {
			extract_first: first?.module ?? null,
			reason: first
				? `${first.module} keeps ${first.complexity_reappears_in.length} callers from duplicating ${first.duplicated_facts.length} facts.`
				: "No production extraction recommended from this scenario.",
		},
		architecture_summary: {
			real_seams: [
				"Browser Adapter Proof -> Browser Adapter Map",
				"Browser Adapter Proof -> Browser Adapter Router",
				"chrome-devtools and agent-browser at the Browser Adapter seam",
			],
			shallow_helpers: shallowHelpers,
			deep_modules: deepModules,
		},
	};
}

function evaluateDeletion(
	candidate: CandidateModule,
	deletedModules: CandidateId[],
): DeletionImpact {
	const deleted = deletedModules.includes(candidate.id);
	const complexityReappearsIn = deleted ? candidate.callers : [];
	const duplicatedFacts = deleted
		? [
				...candidate.interface_facts,
				...candidate.owned_vocabulary.slice(0, 3),
			]
		: [];
	const lostLeverage = deleted
		? candidate.implementation_hides.map(
				(behavior) => `${behavior} moves to callers`,
			)
		: [];
	const lostLocality = deleted
		? candidate.callers.map((caller) => `${caller} must know ${candidate.id}`)
		: [];
	const depthScore = scoreDepth(candidate, deleted);
	const verdict = verdictFor(candidate, depthScore);
	return {
		module: candidate.id,
		deleted,
		complexity_reappears_in: complexityReappearsIn,
		duplicated_facts: duplicatedFacts,
		lost_leverage: lostLeverage,
		lost_locality: lostLocality,
		shallow_warning: shallowWarning(candidate, depthScore),
		depth_score: depthScore,
		verdict,
	};
}

function scoreDepth(candidate: CandidateModule, deleted: boolean): number {
	const callerScore = candidate.callers.length * 2;
	const behaviorScore = candidate.implementation_hides.length;
	const vocabularyScore = Math.min(candidate.owned_vocabulary.length, 4);
	const interfacePenalty = Math.max(0, candidate.interface_facts.length - 4);
	const deletionBonus = deleted ? candidate.callers.length : 0;
	return callerScore + behaviorScore + vocabularyScore + deletionBonus - interfacePenalty;
}

function verdictFor(candidate: CandidateModule, depthScore: number): Verdict {
	if (candidate.id === "MapAuthoringHelper") return "prototype_only";
	if (candidate.id === "ReplayOutcomeEngine") return "prototype_only";
	if (candidate.id === "ProjectionEngine") return "worth_exploring";
	if (candidate.id === "ExplanationRenderer") {
		return depthScore >= 12 ? "worth_exploring" : "merge_into_parent";
	}
	if (depthScore >= 14) return "strong_production_candidate";
	if (depthScore >= 10) return "worth_exploring";
	return "merge_into_parent";
}

function shallowWarning(
	candidate: CandidateModule,
	depthScore: number,
): string | null {
	if (candidate.callers.length <= 1) {
		return "One caller only; seam may still be hypothetical.";
	}
	if (depthScore < 10) {
		return "Interface may be nearly as complex as implementation.";
	}
	return null;
}

function rankForExtraction(impacts: DeletionImpact[]): DeletionImpact[] {
	return impacts
		.filter((impact) => impact.verdict === "strong_production_candidate")
		.sort((left, right) => {
			if (right.depth_score !== left.depth_score) {
				return right.depth_score - left.depth_score;
			}
			return (
				right.complexity_reappears_in.length -
				left.complexity_reappears_in.length
			);
		});
}

function renderState(state: PrototypeState, options: { clear: boolean }): void {
	if (options.clear) console.clear();
	console.log(bold("Browser Adapter deletion test prototype"));
	console.log(dim("PROTOTYPE - throwaway; inspect NOTES.md before deleting."));
	console.log("");
	console.log(bold("Current State"));
	console.log(JSON.stringify(state, null, 2));
	console.log("");
	console.log(bold("Shortcuts"));
	console.log(
		[
			...scenarios.map((scenario, index) => `[${index + 1}] ${scenario.label}`),
			"[a] auto-run",
			"[q] quit",
		].join("  "),
	);
}

function bold(value: string): string {
	return `\x1b[1m${value}\x1b[0m`;
}

function dim(value: string): string {
	return `\x1b[2m${value}\x1b[0m`;
}

async function runInteractive(): Promise<void> {
	let state = buildState(scenarios[0]);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	renderState(state, { clear: true });
	for (;;) {
		const answer = (await rl.question("> ")).trim().toLowerCase();
		if (answer === "q" || answer === "quit" || answer === "exit") break;
		if (answer === "a" || answer === "auto") {
			runAuto();
			renderState(state, { clear: false });
			continue;
		}
		const scenario = scenarioForInput(answer);
		if (scenario) state = buildState(scenario);
		renderState(state, { clear: true });
	}
	rl.close();
}

function runAuto(keys: readonly string[] = scenarios.map((scenario) => scenario.key)): void {
	for (const key of keys) {
		const scenario = scenarios.find((item) => item.key === key);
		if (!scenario) {
			console.error(`Unknown scenario: ${key}`);
			process.exitCode = 2;
			continue;
		}
		renderState(buildState(scenario), { clear: false });
		console.log("");
	}
}

function scenarioForInput(input: string): Scenario | undefined {
	if (/^[1-9]$/.test(input)) return scenarios[Number(input) - 1];
	return scenarios.find(
		(scenario) => scenario.key === input || scenario.label === input,
	);
}

const args = Bun.argv.slice(2);
if (args.includes("--auto")) {
	runAuto();
} else if (args.includes("--scenario")) {
	const scenarioIndex = args.indexOf("--scenario");
	const key = args[scenarioIndex + 1];
	runAuto(key ? [key] : []);
} else if (process.stdin.isTTY) {
	await runInteractive();
} else {
	runAuto();
}
