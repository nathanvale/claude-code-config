#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * Can agent-browser prove one real Browser Adapter vertical slice before the
 * codebase promotes Adapter, Template Method, or Abstract Factory names?
 *
 * Run:
 * bun --filter browser-use-scripts prototype:agent-browser-vertical-slice
 * bun --filter browser-use-scripts prototype:agent-browser-vertical-slice --auto
 *
 * Notes:
 * skills/browser-use/src/prototype-agent-browser-vertical-slice/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type AdapterId = "agent-browser";
type GateId =
	| "known"
	| "reportable"
	| "dependency_checked"
	| "binding_checked"
	| "action_probe_checked"
	| "risk_scanned"
	| "provable"
	| "mapped"
	| "selectable";
type GateStatus = "pass" | "warning" | "blocked" | "not_reached";
type DependencyStatus = "unknown" | "present" | "missing";
type BindingStatus =
	| "unknown"
	| "matches_verified_endpoint"
	| "missing"
	| "stale"
	| "mismatch";
type ActionProbeStatus = "unknown" | "passed" | "zero_tabs" | "failed";
type RiskStatus = "unknown" | "absent" | "present";
type PatternVerdict = "defer" | "hypothesis" | "earned_after_production_slice";

type Diagnostic =
	| "adapter_dependency_missing"
	| "adapter_config_missing"
	| "adapter_config_stale"
	| "adapter_binding_mismatch"
	| "adapter_command_failed"
	| "adapter_signal_weak"
	| "adapter_auto_launch_risk"
	| "adapter_chrome_for_testing_risk"
	| "map_missing";

type AgentBrowserEvidence = {
	adapter_id: AdapterId;
	verified_warm_chrome_endpoint: string;
	dependency: {
		status: DependencyStatus;
		command: string;
	};
	binding: {
		status: BindingStatus;
		source: "session_cdp_binding";
		observed_endpoint?: string;
	};
	action_probe: {
		status: ActionProbeStatus;
		action: "tab_list";
		observed_tabs?: number;
	};
	risks: {
		auto_launch: RiskStatus;
		chrome_for_testing: RiskStatus;
		sticky_daemon: RiskStatus;
	};
	map: "absent" | "draft" | "valid";
};

type GateResult = {
	gate: GateId;
	status: GateStatus;
	reason: string;
	diagnostic?: Diagnostic;
};

type SliceEvaluation = {
	gates: GateResult[];
	diagnostics: Diagnostic[];
	provable: boolean;
	patterns: {
		adapter: PatternVerdict;
		template_method: PatternVerdict;
		abstract_factory: PatternVerdict;
	};
	next_safe_actions: string[];
};

type PrototypeState = {
	throwaway: true;
	question: string;
	last_action: string;
	scenario: string;
	evidence: AgentBrowserEvidence;
	evaluation: SliceEvaluation;
};

type Scenario = {
	key: string;
	label: string;
	evidence: AgentBrowserEvidence;
};

const question =
	"Can agent-browser prove one vertical slice before GoF pattern promotion?";
const verifiedEndpoint = "127.0.0.1:9222";

const baseEvidence: AgentBrowserEvidence = {
	adapter_id: "agent-browser",
	verified_warm_chrome_endpoint: verifiedEndpoint,
	dependency: {
		status: "unknown",
		command: "agent-browser",
	},
	binding: {
		status: "unknown",
		source: "session_cdp_binding",
	},
	action_probe: {
		status: "unknown",
		action: "tab_list",
	},
	risks: {
		auto_launch: "unknown",
		chrome_for_testing: "unknown",
		sticky_daemon: "unknown",
	},
	map: "absent",
};

const scenarios: Scenario[] = [
	{
		key: "unknown",
		label: "unknown evidence",
		evidence: baseEvidence,
	},
	{
		key: "golden_slice",
		label: "golden vertical slice",
		evidence: {
			...baseEvidence,
			dependency: { status: "present", command: "agent-browser" },
			binding: {
				status: "matches_verified_endpoint",
				source: "session_cdp_binding",
				observed_endpoint: verifiedEndpoint,
			},
			action_probe: { status: "passed", action: "tab_list", observed_tabs: 3 },
			risks: {
				auto_launch: "absent",
				chrome_for_testing: "absent",
				sticky_daemon: "absent",
			},
		},
	},
	{
		key: "missing_dependency",
		label: "missing dependency",
		evidence: {
			...baseEvidence,
			dependency: { status: "missing", command: "agent-browser" },
		},
	},
	{
		key: "stale_binding",
		label: "stale CDP binding",
		evidence: {
			...baseEvidence,
			dependency: { status: "present", command: "agent-browser" },
			binding: {
				status: "stale",
				source: "session_cdp_binding",
				observed_endpoint: "127.0.0.1:9333",
			},
		},
	},
	{
		key: "action_failed",
		label: "harmless action fails",
		evidence: {
			...baseEvidence,
			dependency: { status: "present", command: "agent-browser" },
			binding: {
				status: "matches_verified_endpoint",
				source: "session_cdp_binding",
				observed_endpoint: verifiedEndpoint,
			},
			action_probe: { status: "failed", action: "tab_list" },
		},
	},
	{
		key: "zero_tabs_warning",
		label: "zero tabs warning",
		evidence: {
			...baseEvidence,
			dependency: { status: "present", command: "agent-browser" },
			binding: {
				status: "matches_verified_endpoint",
				source: "session_cdp_binding",
				observed_endpoint: verifiedEndpoint,
			},
			action_probe: { status: "zero_tabs", action: "tab_list", observed_tabs: 0 },
			risks: {
				auto_launch: "absent",
				chrome_for_testing: "absent",
				sticky_daemon: "absent",
			},
		},
	},
	{
		key: "auto_launch_risk",
		label: "auto-launch risk",
		evidence: {
			...baseEvidence,
			dependency: { status: "present", command: "agent-browser" },
			binding: {
				status: "matches_verified_endpoint",
				source: "session_cdp_binding",
				observed_endpoint: verifiedEndpoint,
			},
			action_probe: { status: "passed", action: "tab_list", observed_tabs: 2 },
			risks: {
				auto_launch: "present",
				chrome_for_testing: "absent",
				sticky_daemon: "absent",
			},
		},
	},
	{
		key: "chrome_for_testing_risk",
		label: "Chrome for Testing risk",
		evidence: {
			...baseEvidence,
			dependency: { status: "present", command: "agent-browser" },
			binding: {
				status: "matches_verified_endpoint",
				source: "session_cdp_binding",
				observed_endpoint: verifiedEndpoint,
			},
			action_probe: { status: "passed", action: "tab_list", observed_tabs: 2 },
			risks: {
				auto_launch: "absent",
				chrome_for_testing: "present",
				sticky_daemon: "absent",
			},
		},
	},
];

function createState(scenario: Scenario, lastAction: string): PrototypeState {
	const evidence = cloneEvidence(scenario.evidence);
	return {
		throwaway: true,
		question,
		last_action: lastAction,
		scenario: scenario.label,
		evidence,
		evaluation: evaluateSlice(evidence),
	};
}

function evaluateSlice(evidence: AgentBrowserEvidence): SliceEvaluation {
	const gates: GateResult[] = [
		{
			gate: "known",
			status: "pass",
			reason: "agent-browser is the named second adapter candidate.",
		},
		{
			gate: "reportable",
			status: "pass",
			reason: "Router manifests can carry agent-browser capability evidence.",
		},
	];

	gates.push(dependencyGate(evidence));
	gates.push(bindingGate(evidence));
	gates.push(actionProbeGate(evidence));
	gates.push(riskGate(evidence));

	const blocking = gates.some((gate) => gate.status === "blocked");
	const unreached = gates.some((gate) => gate.status === "not_reached");
	const provable = !blocking && !unreached;

	gates.push({
		gate: "provable",
		status: provable ? "pass" : "blocked",
		reason: provable
			? "Dependency, binding, harmless action, and blocking risk gates all pass."
			: "At least one proof gate has not produced usable evidence.",
	});
	gates.push({
		gate: "mapped",
		status: evidence.map === "valid" ? "pass" : "blocked",
		reason:
			evidence.map === "valid"
				? "Browser Adapter Map exists and validates."
				: "No real agent-browser Browser Adapter Map exists yet.",
		diagnostic: evidence.map === "valid" ? undefined : "map_missing",
	});
	gates.push({
		gate: "selectable",
		status: provable && evidence.map === "valid" ? "pass" : "blocked",
		reason:
			provable && evidence.map === "valid"
				? "Router may select agent-browser."
				: "Router selection waits for production proof plus valid map.",
	});

	const diagnostics = gates.flatMap((gate) =>
		gate.diagnostic ? [gate.diagnostic] : [],
	);

	return {
		gates,
		diagnostics,
		provable,
		patterns: {
			adapter: provable
				? "earned_after_production_slice"
				: "defer",
			template_method: provable ? "hypothesis" : "defer",
			abstract_factory: "defer",
		},
		next_safe_actions: nextSafeActions({ evidence, provable }),
	};
}

function dependencyGate(evidence: AgentBrowserEvidence): GateResult {
	if (evidence.dependency.status === "present") {
		return {
			gate: "dependency_checked",
			status: "pass",
			reason: `${evidence.dependency.command} is available.`,
		};
	}
	if (evidence.dependency.status === "missing") {
		return {
			gate: "dependency_checked",
			status: "blocked",
			reason: `${evidence.dependency.command} is not available.`,
			diagnostic: "adapter_dependency_missing",
		};
	}
	return {
		gate: "dependency_checked",
		status: "not_reached",
		reason: "No dependency evidence yet.",
	};
}

function bindingGate(evidence: AgentBrowserEvidence): GateResult {
	if (evidence.dependency.status !== "present") {
		return {
			gate: "binding_checked",
			status: "not_reached",
			reason: "Binding proof waits for dependency evidence.",
		};
	}
	if (evidence.binding.status === "matches_verified_endpoint") {
		return {
			gate: "binding_checked",
			status: "pass",
			reason: `agent-browser binds to ${evidence.verified_warm_chrome_endpoint}.`,
		};
	}
	if (evidence.binding.status === "stale") {
		return {
			gate: "binding_checked",
			status: "blocked",
			reason: `Observed ${evidence.binding.observed_endpoint}; expected ${evidence.verified_warm_chrome_endpoint}.`,
			diagnostic: "adapter_config_stale",
		};
	}
	if (evidence.binding.status === "mismatch") {
		return {
			gate: "binding_checked",
			status: "blocked",
			reason: "Binding points outside verified loopback Warm Chrome.",
			diagnostic: "adapter_binding_mismatch",
		};
	}
	if (evidence.binding.status === "missing") {
		return {
			gate: "binding_checked",
			status: "blocked",
			reason: "No session/CDP binding evidence exists.",
			diagnostic: "adapter_config_missing",
		};
	}
	return {
		gate: "binding_checked",
		status: "not_reached",
		reason: "No binding evidence yet.",
	};
}

function actionProbeGate(evidence: AgentBrowserEvidence): GateResult {
	if (evidence.binding.status !== "matches_verified_endpoint") {
		return {
			gate: "action_probe_checked",
			status: "not_reached",
			reason: "Harmless action waits for verified binding.",
		};
	}
	if (evidence.action_probe.status === "passed") {
		return {
			gate: "action_probe_checked",
			status: "pass",
			reason: `tab_list observed ${evidence.action_probe.observed_tabs ?? "some"} tabs.`,
		};
	}
	if (evidence.action_probe.status === "zero_tabs") {
		return {
			gate: "action_probe_checked",
			status: "warning",
			reason: "tab_list ran but saw zero tabs; proof can pass with weak signal.",
			diagnostic: "adapter_signal_weak",
		};
	}
	if (evidence.action_probe.status === "failed") {
		return {
			gate: "action_probe_checked",
			status: "blocked",
			reason: "tab_list failed against the verified session.",
			diagnostic: "adapter_command_failed",
		};
	}
	return {
		gate: "action_probe_checked",
		status: "not_reached",
		reason: "No harmless action evidence yet.",
	};
}

function riskGate(evidence: AgentBrowserEvidence): GateResult {
	if (evidence.action_probe.status !== "passed" && evidence.action_probe.status !== "zero_tabs") {
		return {
			gate: "risk_scanned",
			status: "not_reached",
			reason: "Risk scan waits for an action probe.",
		};
	}
	if (evidence.risks.auto_launch === "present") {
		return {
			gate: "risk_scanned",
			status: "blocked",
			reason: "agent-browser may auto-launch an unverified browser.",
			diagnostic: "adapter_auto_launch_risk",
		};
	}
	if (evidence.risks.chrome_for_testing === "present") {
		return {
			gate: "risk_scanned",
			status: "blocked",
			reason: "agent-browser appears attached to Chrome for Testing.",
			diagnostic: "adapter_chrome_for_testing_risk",
		};
	}
	if (evidence.risks.auto_launch === "absent" && evidence.risks.chrome_for_testing === "absent") {
		return {
			gate: "risk_scanned",
			status: evidence.risks.sticky_daemon === "present" ? "warning" : "pass",
			reason:
				evidence.risks.sticky_daemon === "present"
					? "Blocking risks absent; sticky daemon remains a warning."
					: "Blocking risks absent.",
		};
	}
	return {
		gate: "risk_scanned",
		status: "not_reached",
		reason: "Risk scan has not produced enough evidence.",
	};
}

function nextSafeActions(input: {
	evidence: AgentBrowserEvidence;
	provable: boolean;
}): string[] {
	if (input.evidence.dependency.status !== "present") {
		return ["Find a real agent-browser invocation surface.", "Do not add map or Router selectability."];
	}
	if (input.evidence.binding.status !== "matches_verified_endpoint") {
		return ["Prototype a session/CDP binding probe.", "Keep exact commands adapter-local."];
	}
	if (
		input.evidence.action_probe.status !== "passed" &&
		input.evidence.action_probe.status !== "zero_tabs"
	) {
		return ["Choose one harmless action probe.", "Record its failure diagnostics before map authoring."];
	}
	if (!input.provable) {
		return ["Resolve blocking risks.", "Rerun the vertical slice before production extraction."];
	}
	return [
		"Port this shape into a production agent-browser proof handler.",
		"Add a real Browser Adapter Map only after observed failures exist.",
		"Keep Template/Factory names deferred until production duplication appears.",
	];
}

function cloneEvidence(evidence: AgentBrowserEvidence): AgentBrowserEvidence {
	return JSON.parse(JSON.stringify(evidence)) as AgentBrowserEvidence;
}

function render(state: PrototypeState): string {
	const gateLines = state.evaluation.gates
		.map((gate) => {
			const marker =
				gate.status === "pass"
					? "PASS"
					: gate.status === "warning"
						? "WARN"
						: gate.status === "blocked"
							? "BLOCK"
							: "WAIT";
			const diagnostic = gate.diagnostic ? ` (${gate.diagnostic})` : "";
			return `  ${marker.padEnd(5)} ${gate.gate}${diagnostic}\n        ${gate.reason}`;
		})
		.join("\n");
	const diagnostics =
		state.evaluation.diagnostics.length === 0
			? "  none"
			: state.evaluation.diagnostics.map((code) => `  - ${code}`).join("\n");
	const actions = state.evaluation.next_safe_actions
		.map((action) => `  - ${action}`)
		.join("\n");

	return [
		bold("Agent Browser Vertical Slice Prototype"),
		dim("PROTOTYPE - throwaway; no production code path."),
		"",
		`${bold("Question")}: ${state.question}`,
		`${bold("Scenario")}: ${state.scenario}`,
		`${bold("Last action")}: ${state.last_action}`,
		"",
		bold("Evidence"),
		`  adapter_id: ${state.evidence.adapter_id}`,
		`  verified_warm_chrome_endpoint: ${state.evidence.verified_warm_chrome_endpoint}`,
		`  dependency: ${state.evidence.dependency.status} (${state.evidence.dependency.command})`,
		`  binding: ${state.evidence.binding.status} (${state.evidence.binding.observed_endpoint ?? "none"})`,
		`  action_probe: ${state.evidence.action_probe.status} (${state.evidence.action_probe.action}, tabs=${state.evidence.action_probe.observed_tabs ?? "n/a"})`,
		`  risks.auto_launch: ${state.evidence.risks.auto_launch}`,
		`  risks.chrome_for_testing: ${state.evidence.risks.chrome_for_testing}`,
		`  risks.sticky_daemon: ${state.evidence.risks.sticky_daemon}`,
		`  map: ${state.evidence.map}`,
		"",
		bold("Gate Results"),
		gateLines,
		"",
		bold("Diagnostics"),
		diagnostics,
		"",
		bold("Pattern Verdict"),
		`  Adapter: ${state.evaluation.patterns.adapter}`,
		`  Template Method: ${state.evaluation.patterns.template_method}`,
		`  Abstract Factory: ${state.evaluation.patterns.abstract_factory}`,
		"",
		bold("Next Safe Actions"),
		actions,
		"",
		bold("Keys"),
		"  [1] golden  [2] missing dep  [3] stale bind  [4] action fail",
		"  [5] auto-launch  [6] CfT risk  [7] zero tabs  [r] reset  [a] auto  [q] quit",
	].join("\n");
}

async function main(): Promise<void> {
	if (Bun.argv.includes("--auto")) {
		runAuto();
		return;
	}

	let state = createState(scenarios[0], "start");
	const reader = createInterface({ input: process.stdin, output: process.stdout });
	try {
		while (true) {
			console.clear();
			console.log(render(state));
			const key = (await reader.question("\nchoice> ")).trim().toLowerCase();
			if (key === "q") break;
			if (key === "a") {
				console.clear();
				runAuto();
				await reader.question("\npress enter to return> ");
				state = createState(scenarios[0], "returned from auto");
				continue;
			}
			const next = scenarioForKey(key);
			state = createState(next ?? scenarios[0], next ? `loaded ${next.label}` : "reset");
		}
	} finally {
		reader.close();
	}
}

function runAuto(): void {
	for (const scenario of scenarios) {
		const state = createState(scenario, `auto ${scenario.label}`);
		console.log("=".repeat(72));
		console.log(stripAnsi(render(state)));
	}
	console.log("=".repeat(72));
	console.log(
		JSON.stringify(
			{
				answer:
					"Prototype proof passes only for the golden and zero-tabs-warning slices; GoF names still wait for production agent-browser proof plus map evidence.",
				passing_scenarios: scenarios
					.map((scenario) => createState(scenario, "auto"))
					.filter((state) => state.evaluation.provable)
					.map((state) => state.scenario),
				observed_diagnostics: [
					...new Set(
						scenarios.flatMap((scenario) =>
							createState(scenario, "auto").evaluation.diagnostics,
						),
					),
				],
			},
			null,
			2,
		),
	);
}

function scenarioForKey(key: string): Scenario | undefined {
	const byKey: Record<string, string> = {
		"1": "golden_slice",
		"2": "missing_dependency",
		"3": "stale_binding",
		"4": "action_failed",
		"5": "auto_launch_risk",
		"6": "chrome_for_testing_risk",
		"7": "zero_tabs_warning",
		r: "unknown",
	};
	const scenarioKey = byKey[key];
	return scenarios.find((scenario) => scenario.key === scenarioKey);
}

function bold(value: string): string {
	return `\x1b[1m${value}\x1b[0m`;
}

function dim(value: string): string {
	return `\x1b[2m${value}\x1b[0m`;
}

function stripAnsi(value: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ANSI escape byte is the point.
	return value.replace(/\x1b\[[0-9;]*m/g, "");
}

await main();
