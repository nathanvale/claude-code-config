#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * What patterns are actually shared between chrome-devtools and agent-browser,
 * which shared patterns deserve machinery, and which facts stay adapter-local?
 *
 * Run:
 * bun skills/browser-use/src/prototype-browser-adapter-pattern-atlas/prototype.ts
 * bun skills/browser-use/src/prototype-browser-adapter-pattern-atlas/prototype.ts --auto
 *
 * Notes:
 * skills/browser-use/src/prototype-browser-adapter-pattern-atlas/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type AdapterId = "chrome-devtools" | "agent-browser";
type ScenarioId =
	| "healthy-shared-pattern"
	| "map-prose-drift"
	| "over-dry-command"
	| "missing-second-adapter-fact";
type PatternStage =
	| "entry_proof"
	| "dependency_check"
	| "binding_proof"
	| "action_probe"
	| "warning_scan"
	| "map_handoff";
type DryVerdict =
	| "shared_machinery"
	| "adapter_local"
	| "prototype_only"
	| "not_enough_evidence";
type DriftKind =
	| "none"
	| "action_synonym"
	| "missing_fact"
	| "overfit_shared_command";

type AdapterFacts = {
	adapter_id: AdapterId;
	dependency_surface: string;
	command_shape: string;
	binding_signal: string;
	action_probe: string;
	weak_signal: string;
	risk_signal: string;
	local_repair: string;
};

type StagePattern = {
	stage: PatternStage;
	question: string;
	shared_shape: string;
	chrome_fact: string;
	agent_fact: string;
	drift: DriftKind;
};

type Scenario = {
	id: ScenarioId;
	label: string;
	description: string;
	adapters: Record<AdapterId, AdapterFacts>;
	stage_patterns: StagePattern[];
	map_actions: Record<AdapterId, Record<string, string>>;
	forced_shared_command?: string;
};

type StageAnalysis = StagePattern & {
	verdict: DryVerdict;
	reason: string;
};

type PrototypeState = {
	throwaway: true;
	question: string;
	scenario: ScenarioId;
	label: string;
	last_action: string;
	stage_analysis: StageAnalysis[];
	shared_machinery: string[];
	adapter_local: string[];
	drift_risks: string[];
	next_safe_action: string;
};

const question =
	"What is the DRY boundary across Chrome DevTools and Agent Browser adapters?";

const baseAdapters: Record<AdapterId, AdapterFacts> = {
	"chrome-devtools": {
		adapter_id: "chrome-devtools",
		dependency_surface: "mcporter command vector",
		command_shape: "mcporter list-pages against verified CDP endpoint",
		binding_signal: "config binding matches verified endpoint",
		action_probe: "list_pages returns pages",
		weak_signal: "list_pages returns zero pages",
		risk_signal: "Chrome for Testing or auto-launch hint in config",
		local_repair: "set mcporter command or update MCP config",
	},
	"agent-browser": {
		adapter_id: "agent-browser",
		dependency_surface: "agent-browser adapter session",
		command_shape: "agent-browser get-cdp-url for current session",
		binding_signal: "session CDP URL matches verified endpoint",
		action_probe: "tab list returns current tabs",
		weak_signal: "tab list returns zero tabs",
		risk_signal: "adapter wants to launch its own browser",
		local_repair: "pin adapter to verified Warm Chrome session",
	},
};

const scenarios: Record<ScenarioId, Scenario> = {
	"healthy-shared-pattern": {
		id: "healthy-shared-pattern",
		label: "healthy shared pattern",
		description:
			"Both adapters share lifecycle stages and recoverability names, but keep commands local.",
		adapters: baseAdapters,
		stage_patterns: [
			stage("entry_proof", "Can we reuse the Warm Chrome handoff?", "verified endpoint plus run id", "same", "same", "none"),
			stage("dependency_check", "Can we share dependency recovery?", "dependency exists or configure dependency", "mcporter command vector", "agent-browser session bridge", "none"),
			stage("binding_proof", "Can we share binding recovery?", "adapter binding must match verified endpoint", "selected config binding", "session CDP URL", "none"),
			stage("action_probe", "Can we share action proof?", "adapter performs a harmless read action", "list_pages", "tab list", "none"),
			stage("warning_scan", "Can warnings share severity?", "warning does not block handoff unless risk is unsafe", "empty pages warning", "empty tabs warning", "none"),
			stage("map_handoff", "Can maps share recoverability keys?", "code -> action -> section", "same action ids", "same action ids", "none"),
		],
		map_actions: {
			"chrome-devtools": {
				adapter_dependency_missing: "configure_adapter_dependency",
				adapter_binding_mismatch: "update_adapter_config",
				adapter_signal_weak: "warning_only",
			},
			"agent-browser": {
				adapter_dependency_missing: "configure_adapter_dependency",
				adapter_binding_mismatch: "update_adapter_config",
				adapter_signal_weak: "warning_only",
			},
		},
	},
	"map-prose-drift": {
		id: "map-prose-drift",
		label: "map prose drift",
		description:
			"One map invents a local action synonym while the proof still emits the canonical diagnostic.",
		adapters: baseAdapters,
		stage_patterns: [
			stage("dependency_check", "Does canonical action naming hold?", "dependency exists or configure dependency", "configure_adapter_dependency", "install_agent_browser", "action_synonym"),
			stage("map_handoff", "Does map prose keep the same code/action pair?", "code -> action -> section", "canonical action", "local synonym", "action_synonym"),
		],
		map_actions: {
			"chrome-devtools": {
				adapter_dependency_missing: "configure_adapter_dependency",
			},
			"agent-browser": {
				adapter_dependency_missing: "install_agent_browser",
			},
		},
	},
	"over-dry-command": {
		id: "over-dry-command",
		label: "over-DRY adapter command",
		description:
			"A shared command helper tries to own adapter command syntax and immediately overfits.",
		adapters: baseAdapters,
		stage_patterns: [
			stage("dependency_check", "Can one helper create every command?", "runAdapterListPages(adapter)", "mcporter list-pages", "agent-browser tab list", "overfit_shared_command"),
			stage("action_probe", "Can one parser understand every read action?", "parse pages-like list", "MCP content text", "adapter session JSON", "overfit_shared_command"),
		],
		map_actions: {
			"chrome-devtools": {
				adapter_command_failed: "inspect_adapter_config",
			},
			"agent-browser": {
				adapter_command_failed: "inspect_adapter_config",
			},
		},
		forced_shared_command: "runAdapterListPages(adapter_id, endpoint)",
	},
	"missing-second-adapter-fact": {
		id: "missing-second-adapter-fact",
		label: "missing second-adapter fact",
		description:
			"Agent Browser has a named adapter slot, but the proof facts are still guessed.",
		adapters: {
			...baseAdapters,
			"agent-browser": {
				...baseAdapters["agent-browser"],
				command_shape: "unknown",
				binding_signal: "unknown",
				action_probe: "unknown",
			},
		},
		stage_patterns: [
			stage("binding_proof", "Can we model binding before knowing the signal?", "adapter binding must match verified endpoint", "selected config binding", "unknown", "missing_fact"),
			stage("action_probe", "Can we model a probe before knowing the output?", "adapter performs a harmless read action", "list_pages output", "unknown", "missing_fact"),
			stage("map_handoff", "Can map validation know emitted diagnostics?", "adapter emits declared diagnostics", "known emitted codes", "guessed emitted codes", "missing_fact"),
		],
		map_actions: {
			"chrome-devtools": {
				adapter_binding_mismatch: "update_adapter_config",
				adapter_output_unparsable: "inspect_adapter_config",
			},
			"agent-browser": {
				adapter_binding_mismatch: "update_adapter_config",
			},
		},
	},
};

function stage(
	stageName: PatternStage,
	questionText: string,
	sharedShape: string,
	chromeFact: string,
	agentFact: string,
	drift: DriftKind,
): StagePattern {
	return {
		stage: stageName,
		question: questionText,
		shared_shape: sharedShape,
		chrome_fact: chromeFact,
		agent_fact: agentFact,
		drift,
	};
}

function analyzeScenario(
	scenario: Scenario,
	lastAction = "loaded scenario",
): PrototypeState {
	const stageAnalysis = scenario.stage_patterns.map(analyzeStage);
	const sharedMachinery = uniqueSorted(
		stageAnalysis
			.filter((item) => item.verdict === "shared_machinery")
			.map((item) => `${item.stage}: ${item.shared_shape}`),
	);
	const adapterLocal = uniqueSorted([
		...Object.values(scenario.adapters).map(
			(adapter) =>
				`${adapter.adapter_id}: ${adapter.command_shape}; ${adapter.local_repair}`,
		),
		...stageAnalysis
			.filter((item) => item.verdict === "adapter_local")
			.map((item) => `${item.stage}: ${item.reason}`),
	]);
	const driftRisks = uniqueSorted([
		...stageAnalysis
			.filter((item) => item.drift !== "none")
			.map((item) => `${item.stage}: ${item.drift}`),
		...findActionDrift(scenario),
	]);

	return {
		throwaway: true,
		question,
		scenario: scenario.id,
		label: scenario.label,
		last_action: lastAction,
		stage_analysis: stageAnalysis,
		shared_machinery: sharedMachinery,
		adapter_local: adapterLocal,
		drift_risks: driftRisks,
		next_safe_action: nextSafeAction(stageAnalysis, driftRisks),
	};
}

function analyzeStage(pattern: StagePattern): StageAnalysis {
	if (pattern.drift === "missing_fact") {
		return {
			...pattern,
			verdict: "not_enough_evidence",
			reason: "second adapter fact is not real yet",
		};
	}
	if (pattern.drift === "overfit_shared_command") {
		return {
			...pattern,
			verdict: "adapter_local",
			reason: "shared helper would branch on adapter-specific command syntax",
		};
	}
	if (pattern.drift === "action_synonym") {
		return {
			...pattern,
			verdict: "shared_machinery",
			reason: "canonical code/action pair prevents map prose synonyms",
		};
	}
	if (pattern.chrome_fact === "same" && pattern.agent_fact === "same") {
		return {
			...pattern,
			verdict: "shared_machinery",
			reason: "both adapters use the exact same fact",
		};
	}
	if (pattern.stage === "map_handoff" || pattern.stage === "warning_scan") {
		return {
			...pattern,
			verdict: "shared_machinery",
			reason: "shared shape is stable while local proof facts vary",
		};
	}
	return {
		...pattern,
		verdict: "adapter_local",
		reason: "stage name is shared, but evidence and commands are local",
	};
}

function findActionDrift(scenario: Scenario): string[] {
	const canonicalActions = new Set([
		"configure_adapter_dependency",
		"update_adapter_config",
		"inspect_adapter_config",
		"change_adapter_input",
		"use_verified_browser_adapter",
		"warning_only",
	]);
	const drift: string[] = [];
	for (const [adapterId, actions] of Object.entries(scenario.map_actions)) {
		for (const [code, action] of Object.entries(actions)) {
			if (!canonicalActions.has(action)) {
				drift.push(`${adapterId}: ${code} uses noncanonical ${action}`);
			}
		}
	}
	if (scenario.forced_shared_command) {
		drift.push(`forced shared command: ${scenario.forced_shared_command}`);
	}
	return drift;
}

function nextSafeAction(
	stageAnalysis: StageAnalysis[],
	driftRisks: readonly string[],
): string {
	if (
		stageAnalysis.some((item) => item.verdict === "not_enough_evidence")
	) {
		return "prototype agent-browser proof facts before production AdapterProofSpec";
	}
	if (driftRisks.some((risk) => risk.includes("noncanonical"))) {
		return "keep canonical action vocabulary shared and map prose local";
	}
	if (driftRisks.some((risk) => risk.includes("forced shared command"))) {
		return "share stage names and recovery actions, not adapter command builders";
	}
	return "write down shared lifecycle stages, then wait for real second-adapter facts";
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

const bold = (value: string) => `\x1b[1m${value}\x1b[0m`;
const dim = (value: string) => `\x1b[2m${value}\x1b[0m`;

function render(state: PrototypeState): void {
	console.clear();
	console.log(bold("Browser Adapter Pattern Atlas"));
	console.log(dim("PROTOTYPE - throwaway. No production model implied."));
	console.log("");
	console.log(`${bold("question")} ${state.question}`);
	console.log(`${bold("scenario")} ${state.scenario} (${state.label})`);
	console.log(`${bold("last")} ${state.last_action}`);
	console.log("");
	console.log(bold("stage analysis"));
	for (const item of state.stage_analysis) {
		console.log(
			`- ${item.stage}: ${item.verdict} | ${item.reason} | drift=${item.drift}`,
		);
	}
	console.log("");
	console.log(bold("shared machinery candidates"));
	for (const item of state.shared_machinery) console.log(`- ${item}`);
	if (state.shared_machinery.length === 0) console.log("- none");
	console.log("");
	console.log(bold("adapter-local facts"));
	for (const item of state.adapter_local) console.log(`- ${item}`);
	if (state.adapter_local.length === 0) console.log("- none");
	console.log("");
	console.log(bold("drift risks"));
	for (const item of state.drift_risks) console.log(`- ${item}`);
	if (state.drift_risks.length === 0) console.log("- none");
	console.log("");
	console.log(`${bold("next safe action")} ${state.next_safe_action}`);
	console.log("");
	console.log(
		`${bold("1")} healthy  ${bold("2")} prose drift  ${bold("3")} over-DRY  ${bold("4")} missing fact  ${bold("a")} analyze  ${bold("n")} next  ${bold("q")} quit`,
	);
}

const scenarioOrder: ScenarioId[] = [
	"healthy-shared-pattern",
	"map-prose-drift",
	"over-dry-command",
	"missing-second-adapter-fact",
];

function nextScenarioId(current: ScenarioId): ScenarioId {
	const index = scenarioOrder.indexOf(current);
	return scenarioOrder[(index + 1) % scenarioOrder.length];
}

function scenarioFromKey(input: string, current: ScenarioId): ScenarioId {
	if (input === "1") return "healthy-shared-pattern";
	if (input === "2") return "map-prose-drift";
	if (input === "3") return "over-dry-command";
	if (input === "4") return "missing-second-adapter-fact";
	if (input === "n") return nextScenarioId(current);
	return current;
}

async function runInteractive(): Promise<void> {
	let scenarioId: ScenarioId = "healthy-shared-pattern";
	let state = analyzeScenario(scenarios[scenarioId]);
	render(state);

	const terminal = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	while (true) {
		const input = (await terminal.question("> ")).trim();
		if (input === "q") break;
		scenarioId = scenarioFromKey(input, scenarioId);
		const label = input === "a" ? "reanalyzed current scenario" : `pressed ${input}`;
		state = analyzeScenario(scenarios[scenarioId], label);
		render(state);
	}

	terminal.close();
}

function runAuto(): void {
	for (const id of scenarioOrder) {
		const state = analyzeScenario(scenarios[id], "auto");
		console.log(JSON.stringify(state, null, 2));
		console.log("");
	}
}

if (process.argv.includes("--auto")) {
	runAuto();
} else {
	await runInteractive();
}

