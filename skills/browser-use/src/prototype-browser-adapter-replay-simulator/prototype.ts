#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * When Browser Adapter Proof fails, does Browser Adapter Map recovery converge
 * to a verified adapter handoff, warning-only success, or a clean stop?
 *
 * Run:
 * bun skills/browser-use/src/prototype-browser-adapter-replay-simulator/prototype.ts
 * bun skills/browser-use/src/prototype-browser-adapter-replay-simulator/prototype.ts --auto
 *
 * Notes:
 * skills/browser-use/src/prototype-browser-adapter-replay-simulator/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type AdapterId = "chrome-devtools" | "agent-browser";
type DiagnosticCode =
	| "adapter_auto_launch_risk"
	| "adapter_binding_ambiguous"
	| "adapter_config_stale"
	| "adapter_dependency_missing"
	| "adapter_signal_weak";
type ContinuationAction =
	| "configure_adapter_dependency"
	| "inspect_adapter_config"
	| "update_adapter_config"
	| "use_verified_browser_adapter";
type LoopPhase =
	| "needs_proof"
	| "needs_map"
	| "needs_recovery"
	| "needs_reroute"
	| "complete"
	| "stopped";
type RecoveryOutcome = "changed" | "unchanged" | "human_handoff" | "continued";
type ProofStatus = "ok" | "error";
type ReplayAction = "prove" | "read_map" | "recover" | "reroute" | "auto_step" | "reset";

type Environment = {
	adapter_id: AdapterId;
	dependency_ready: boolean;
	binding_matches: boolean;
	auto_launch_risk: boolean;
	ambiguous_binding: boolean;
	tab_signal_count: number;
	recovery_budget: number;
};

type ProofResult = {
	status: ProofStatus;
	diagnostic_code: DiagnosticCode | null;
	continuation_action: ContinuationAction;
	router_can_receive_attachment_proof: boolean;
	constraints: string[];
	warnings: DiagnosticCode[];
	evidence_fresh: boolean;
};

type MapEntry = {
	key: DiagnosticCode | ContinuationAction;
	recovery_action: ContinuationAction;
	expected_outcome: RecoveryOutcome;
	operator_guidance: string;
};

type LoopState = {
	throwaway: true;
	question: string;
	scenario_key: string;
	last_action: string;
	phase: LoopPhase;
	environment: Environment;
	proof_result: ProofResult | null;
	map_entry: MapEntry | null;
	recovery_outcome: RecoveryOutcome | null;
	router_handoff: {
		ready: boolean;
		action: "use_selected_browser_adapter" | "stop" | null;
		reason: string | null;
	};
	history: string[];
};

type Scenario = {
	key: string;
	label: string;
	description: string;
	environment: Environment;
};

const question =
	"Does proof -> map -> recovery -> proof -> reroute converge or stop cleanly?";
const scenarios: Scenario[] = [
	{
		key: "chrome_stale_config",
		label: "chrome stale config converges",
		description: "chrome-devtools starts on stale config and repairs with update_adapter_config.",
		environment: {
			adapter_id: "chrome-devtools",
			dependency_ready: true,
			binding_matches: false,
			auto_launch_risk: false,
			ambiguous_binding: false,
			tab_signal_count: 2,
			recovery_budget: 2,
		},
	},
	{
		key: "agent_missing_dependency",
		label: "agent missing dependency converges",
		description: "agent-browser starts missing and repairs with configure_adapter_dependency.",
		environment: {
			adapter_id: "agent-browser",
			dependency_ready: false,
			binding_matches: true,
			auto_launch_risk: false,
			ambiguous_binding: false,
			tab_signal_count: 2,
			recovery_budget: 2,
		},
	},
	{
		key: "agent_auto_launch_risk",
		label: "agent auto-launch risk stops",
		description: "agent-browser appears attached to an auto-launched browser and stops.",
		environment: {
			adapter_id: "agent-browser",
			dependency_ready: true,
			binding_matches: true,
			auto_launch_risk: true,
			ambiguous_binding: false,
			tab_signal_count: 2,
			recovery_budget: 1,
		},
	},
	{
		key: "weak_signal_continue",
		label: "weak signal continues",
		description: "proof is ok with zero tabs/pages and continues with warning evidence.",
		environment: {
			adapter_id: "agent-browser",
			dependency_ready: true,
			binding_matches: true,
			auto_launch_risk: false,
			ambiguous_binding: false,
			tab_signal_count: 0,
			recovery_budget: 1,
		},
	},
	{
		key: "ambiguous_binding_budget_stop",
		label: "ambiguous binding budget stop",
		description: "inspect does not change ambiguous binding; retry budget stops the loop.",
		environment: {
			adapter_id: "chrome-devtools",
			dependency_ready: true,
			binding_matches: true,
			auto_launch_risk: false,
			ambiguous_binding: true,
			tab_signal_count: 2,
			recovery_budget: 1,
		},
	},
];

const mapEntries: Record<DiagnosticCode | ContinuationAction, MapEntry> = {
	adapter_auto_launch_risk: {
		key: "adapter_auto_launch_risk",
		recovery_action: "inspect_adapter_config",
		expected_outcome: "human_handoff",
		operator_guidance: "Stop and inspect why the adapter launched a browser.",
	},
	adapter_binding_ambiguous: {
		key: "adapter_binding_ambiguous",
		recovery_action: "inspect_adapter_config",
		expected_outcome: "unchanged",
		operator_guidance: "Inspect config sources; do not act until ambiguity is removed.",
	},
	adapter_config_stale: {
		key: "adapter_config_stale",
		recovery_action: "update_adapter_config",
		expected_outcome: "changed",
		operator_guidance: "Update adapter config to the verified Warm Chrome endpoint.",
	},
	adapter_dependency_missing: {
		key: "adapter_dependency_missing",
		recovery_action: "configure_adapter_dependency",
		expected_outcome: "changed",
		operator_guidance: "Expose adapter dependency or set command override.",
	},
	adapter_signal_weak: {
		key: "adapter_signal_weak",
		recovery_action: "use_verified_browser_adapter",
		expected_outcome: "continued",
		operator_guidance: "Continue with warning-only proof evidence.",
	},
	configure_adapter_dependency: {
		key: "configure_adapter_dependency",
		recovery_action: "configure_adapter_dependency",
		expected_outcome: "changed",
		operator_guidance: "Run dependency setup, then rerun proof.",
	},
	inspect_adapter_config: {
		key: "inspect_adapter_config",
		recovery_action: "inspect_adapter_config",
		expected_outcome: "unchanged",
		operator_guidance: "Inspect adapter state before repair.",
	},
	update_adapter_config: {
		key: "update_adapter_config",
		recovery_action: "update_adapter_config",
		expected_outcome: "changed",
		operator_guidance: "Repair adapter config, then rerun proof.",
	},
	use_verified_browser_adapter: {
		key: "use_verified_browser_adapter",
		recovery_action: "use_verified_browser_adapter",
		expected_outcome: "continued",
		operator_guidance: "Attach proof evidence to Router and reroute.",
	},
};

function initialState(scenario: Scenario): LoopState {
	return {
		throwaway: true,
		question,
		scenario_key: scenario.key,
		last_action: `loaded ${scenario.label}`,
		phase: "needs_proof",
		environment: { ...scenario.environment },
		proof_result: null,
		map_entry: null,
		recovery_outcome: null,
		router_handoff: {
			ready: false,
			action: null,
			reason: "No fresh proof evidence yet.",
		},
		history: [`scenario: ${scenario.description}`],
	};
}

function reduce(state: LoopState, action: ReplayAction): LoopState {
	if (action === "auto_step") return autoStep(state);
	if (action === "reset") return initialState(scenarios[0]);
	if (state.phase === "complete" || state.phase === "stopped") {
		return appendHistory(state, action, "Loop already ended.");
	}
	switch (action) {
		case "prove":
			return proveAdapter(state);
		case "read_map":
			return readMap(state);
		case "recover":
			return applyRecovery(state);
		case "reroute":
			return reroute(state);
		default:
			return appendHistory(state, action, "Unknown action.");
	}
}

function proveAdapter(state: LoopState): LoopState {
	if (state.phase !== "needs_proof") {
		return appendHistory(state, "prove", `Cannot prove during ${state.phase}.`);
	}
	const proof = evaluateProof(state.environment);
	return {
		...state,
		last_action: "prove",
		phase: proof.status === "ok" ? "needs_map" : "needs_map",
		proof_result: proof,
		map_entry: null,
		recovery_outcome: null,
		router_handoff: {
			ready: false,
			action: null,
			reason:
				proof.status === "ok"
					? "Proof is fresh; read map before reroute."
					: "Proof failed; read map before recovery.",
		},
		history: [
			...state.history,
			`prove -> ${proof.status} ${proof.diagnostic_code ?? proof.continuation_action}`,
		],
	};
}

function readMap(state: LoopState): LoopState {
	if (state.phase !== "needs_map" || !state.proof_result) {
		return appendHistory(state, "read_map", `Cannot read map during ${state.phase}.`);
	}
	const key =
		state.proof_result.diagnostic_code ??
		(state.proof_result.warnings[0] ?? state.proof_result.continuation_action);
	const entry = mapEntries[key];
	return {
		...state,
		last_action: "read_map",
		phase:
			state.proof_result.status === "ok" && entry.recovery_action === "use_verified_browser_adapter"
				? "needs_reroute"
				: "needs_recovery",
		map_entry: entry,
		history: [
			...state.history,
			`read_map -> ${entry.key} uses ${entry.recovery_action}`,
		],
	};
}

function applyRecovery(state: LoopState): LoopState {
	if (state.phase !== "needs_recovery" || !state.map_entry || !state.proof_result) {
		return appendHistory(state, "recover", `Cannot recover during ${state.phase}.`);
	}
	const result = applyRecoveryAction(state.environment, state.map_entry);
	const budget = Math.max(0, state.environment.recovery_budget - 1);
	const stop =
		result.outcome === "human_handoff" ||
		(result.outcome === "unchanged" && budget === 0);
	return {
		...state,
		last_action: "recover",
		phase: stop ? "stopped" : "needs_proof",
		environment: { ...result.environment, recovery_budget: budget },
		proof_result: stop ? state.proof_result : null,
		map_entry: stop ? state.map_entry : null,
		recovery_outcome: result.outcome,
		router_handoff: {
			ready: false,
			action: stop ? "stop" : null,
			reason: stop
				? result.reason
				: "Recovery changed local state; rerun proof before Router handoff.",
		},
		history: [...state.history, `recover -> ${result.outcome}: ${result.reason}`],
	};
}

function reroute(state: LoopState): LoopState {
	if (state.phase !== "needs_reroute" || !state.proof_result) {
		return appendHistory(state, "reroute", `Cannot reroute during ${state.phase}.`);
	}
	if (!state.proof_result.router_can_receive_attachment_proof) {
		return {
			...state,
			last_action: "reroute",
			phase: "stopped",
			router_handoff: {
				ready: false,
				action: "stop",
				reason: "Router cannot receive failed proof evidence.",
			},
			history: [...state.history, "reroute -> stopped: no proof evidence"],
		};
	}
	return {
		...state,
		last_action: "reroute",
		phase: "complete",
		router_handoff: {
			ready: true,
			action: "use_selected_browser_adapter",
			reason:
				state.proof_result.warnings.length > 0
					? "Fresh proof includes warning-only signal."
					: "Fresh proof proves adapter attachment.",
		},
		history: [...state.history, "reroute -> use_selected_browser_adapter"],
	};
}

function evaluateProof(environment: Environment): ProofResult {
	if (!environment.dependency_ready) {
		return errorProof("adapter_dependency_missing", "configure_adapter_dependency");
	}
	if (environment.auto_launch_risk) {
		return errorProof("adapter_auto_launch_risk", "inspect_adapter_config");
	}
	if (environment.ambiguous_binding) {
		return errorProof("adapter_binding_ambiguous", "inspect_adapter_config");
	}
	if (!environment.binding_matches) {
		return errorProof("adapter_config_stale", "update_adapter_config");
	}
	if (environment.tab_signal_count === 0) {
		return {
			status: "ok",
			diagnostic_code: "adapter_signal_weak",
			continuation_action: "use_verified_browser_adapter",
			router_can_receive_attachment_proof: true,
			constraints: [],
			warnings: ["adapter_signal_weak"],
			evidence_fresh: true,
		};
	}
	return {
		status: "ok",
		diagnostic_code: null,
		continuation_action: "use_verified_browser_adapter",
		router_can_receive_attachment_proof: true,
		constraints: [],
		warnings: [],
		evidence_fresh: true,
	};
}

function errorProof(
	diagnosticCode: DiagnosticCode,
	continuationAction: ContinuationAction,
): ProofResult {
	return {
		status: "error",
		diagnostic_code: diagnosticCode,
		continuation_action: continuationAction,
		router_can_receive_attachment_proof: false,
		constraints: ["no_adapter_fallback"],
		warnings: [],
		evidence_fresh: true,
	};
}

function applyRecoveryAction(
	environment: Environment,
	entry: MapEntry,
): { environment: Environment; outcome: RecoveryOutcome; reason: string } {
	switch (entry.recovery_action) {
		case "configure_adapter_dependency":
			return {
				environment: { ...environment, dependency_ready: true },
				outcome: "changed",
				reason: "Dependency became available.",
			};
		case "update_adapter_config":
			return {
				environment: { ...environment, binding_matches: true },
				outcome: "changed",
				reason: "Adapter binding now points at verified Warm Chrome.",
			};
		case "inspect_adapter_config":
			if (entry.expected_outcome === "human_handoff") {
				return {
					environment,
					outcome: "human_handoff",
					reason: "Inspection found risk that needs human repair.",
				};
			}
			return {
				environment,
				outcome: "unchanged",
				reason: "Inspection did not change adapter state.",
			};
		case "use_verified_browser_adapter":
			return {
				environment,
				outcome: "continued",
				reason: "No repair needed.",
			};
	}
}

function autoStep(state: LoopState): LoopState {
	switch (state.phase) {
		case "needs_proof":
			return reduce(state, "prove");
		case "needs_map":
			return reduce(state, "read_map");
		case "needs_recovery":
			return reduce(state, "recover");
		case "needs_reroute":
			return reduce(state, "reroute");
		default:
			return appendHistory(state, "auto_step", "Loop ended.");
	}
}

function appendHistory(
	state: LoopState,
	action: ReplayAction,
	message: string,
): LoopState {
	return {
		...state,
		last_action: action,
		history: [...state.history, `${action} -> ${message}`],
	};
}

function renderState(state: LoopState, options: { clear: boolean }): void {
	if (options.clear) console.clear();
	console.log(bold("Browser Adapter replay simulator"));
	console.log(dim("PROTOTYPE - throwaway; inspect NOTES.md before deleting."));
	console.log("");
	console.log(bold("Current State"));
	console.log(JSON.stringify(state, null, 2));
	console.log("");
	console.log(bold("Shortcuts"));
	console.log(
		[
			"[p] prove",
			"[m] read map",
			"[r] recover",
			"[v] reroute",
			"[n] auto-step",
			"[a] auto-run scenario",
			...scenarios.map((scenario, index) => `[${index + 1}] ${scenario.label}`),
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
	let state = initialState(scenarios[0]);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	renderState(state, { clear: true });
	for (;;) {
		const answer = (await rl.question("> ")).trim().toLowerCase();
		if (answer === "q" || answer === "quit" || answer === "exit") break;
		const scenario = scenarioForInput(answer);
		if (scenario) {
			state = initialState(scenario);
		} else if (answer === "a" || answer === "auto") {
			state = runScenarioToEnd(state, true);
		} else {
			state = reduce(state, actionForInput(answer));
		}
		renderState(state, { clear: true });
	}
	rl.close();
}

function runAuto(keys = scenarios.map((scenario) => scenario.key)): void {
	for (const key of keys) {
		const scenario = scenarios.find((item) => item.key === key);
		if (!scenario) {
			console.error(`Unknown scenario: ${key}`);
			process.exitCode = 2;
			continue;
		}
		let state = initialState(scenario);
		renderState(state, { clear: false });
		while (state.phase !== "complete" && state.phase !== "stopped") {
			state = autoStep(state);
			renderState(state, { clear: false });
		}
		console.log("");
	}
}

function runScenarioToEnd(state: LoopState, appendOnly: boolean): LoopState {
	let next = state;
	while (next.phase !== "complete" && next.phase !== "stopped") {
		next = autoStep(next);
	}
	return appendOnly ? next : state;
}

function scenarioForInput(input: string): Scenario | undefined {
	if (/^[1-9]$/.test(input)) return scenarios[Number(input) - 1];
	return scenarios.find(
		(scenario) => scenario.key === input || scenario.label === input,
	);
}

function actionForInput(input: string): ReplayAction {
	switch (input) {
		case "p":
		case "prove":
			return "prove";
		case "m":
		case "map":
		case "read_map":
			return "read_map";
		case "r":
		case "recover":
			return "recover";
		case "v":
		case "reroute":
		case "verify":
			return "reroute";
		case "n":
		case "next":
			return "auto_step";
		default:
			return "auto_step";
	}
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
