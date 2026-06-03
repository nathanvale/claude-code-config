#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * When Browser Adapter Proof fails, does each output surface make the next safe
 * action obvious without adding recovery vocabulary drift?
 *
 * Run:
 * bun skills/browser-use/scripts/prototype-browser-adapter-failure-explanation/prototype.ts
 * bun skills/browser-use/scripts/prototype-browser-adapter-failure-explanation/prototype.ts --auto
 *
 * Notes:
 * skills/browser-use/scripts/prototype-browser-adapter-failure-explanation/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type OutcomeKind = "blocking_failure" | "warning_success" | "success";
type FailureDomain = "browser_adapter_proof" | "browser_entry_handoff" | null;
type ContinuationAction =
	| "configure_adapter_dependency"
	| "inspect_adapter_config"
	| "update_adapter_config"
	| "use_verified_browser_adapter";
type Surface =
	| "json_envelope"
	| "plain_cli"
	| "browser_adapter_map"
	| "router_handoff"
	| "operator_choice";
type ExplanationStatus = "clear" | "muddy" | "drift";

type ProofCase = {
	key: string;
	label: string;
	adapter_id: "chrome-devtools" | "agent-browser";
	kind: OutcomeKind;
	code: string | null;
	failure_domain: FailureDomain;
	continuation_action: ContinuationAction;
	constraints: string[];
	map_section: string | null;
	reason: string;
	operator_required: boolean;
};

type ExplanationSurface = {
	surface: Surface;
	text: string;
	names_code: boolean;
	names_action: boolean;
	names_constraint: boolean;
	repair_detail_level: "none" | "section" | "command";
};

type ExplanationReview = {
	status: ExplanationStatus;
	cognitive_load_score: number;
	drift: string[];
	missing: string[];
	next_safe_action_visible: boolean;
	notes: string[];
};

type PrototypeState = {
	throwaway: true;
	question: string;
	last_action: string;
	proof_case: ProofCase;
	surfaces: ExplanationSurface[];
	review: ExplanationReview;
};

type Scenario = {
	key: string;
	label: string;
	proof_case: ProofCase;
	mutate?: (surfaces: ExplanationSurface[]) => void;
};

const question =
	"Do proof outputs explain the next safe action consistently across surfaces?";
const cases: Record<string, ProofCase> = {
	stale_config: {
		key: "stale_config",
		label: "stale config",
		adapter_id: "chrome-devtools",
		kind: "blocking_failure",
		code: "adapter_config_stale",
		failure_domain: "browser_adapter_proof",
		continuation_action: "update_adapter_config",
		constraints: ["no_adapter_fallback"],
		map_section: "Config",
		reason: "Adapter config points at a stale CDP endpoint.",
		operator_required: false,
	},
	missing_dependency: {
		key: "missing_dependency",
		label: "missing dependency",
		adapter_id: "agent-browser",
		kind: "blocking_failure",
		code: "adapter_dependency_missing",
		failure_domain: "browser_adapter_proof",
		continuation_action: "configure_adapter_dependency",
		constraints: ["no_adapter_fallback"],
		map_section: "Dependency",
		reason: "agent-browser is not available to the proof runtime.",
		operator_required: true,
	},
	auto_launch_risk: {
		key: "auto_launch_risk",
		label: "auto-launch risk",
		adapter_id: "agent-browser",
		kind: "blocking_failure",
		code: "adapter_auto_launch_risk",
		failure_domain: "browser_adapter_proof",
		continuation_action: "inspect_adapter_config",
		constraints: ["no_adapter_fallback"],
		map_section: "Warnings",
		reason: "agent-browser appears to have launched a browser outside Warm Chrome.",
		operator_required: true,
	},
	ambiguous_binding: {
		key: "ambiguous_binding",
		label: "ambiguous binding",
		adapter_id: "chrome-devtools",
		kind: "blocking_failure",
		code: "adapter_binding_ambiguous",
		failure_domain: "browser_adapter_proof",
		continuation_action: "inspect_adapter_config",
		constraints: ["no_adapter_fallback"],
		map_section: "Inspect",
		reason: "Multiple viable adapter config sources prevent safe handoff.",
		operator_required: false,
	},
	weak_signal: {
		key: "weak_signal",
		label: "weak signal",
		adapter_id: "agent-browser",
		kind: "warning_success",
		code: "adapter_signal_weak",
		failure_domain: null,
		continuation_action: "use_verified_browser_adapter",
		constraints: [],
		map_section: "Warnings",
		reason: "Adapter is attached to Warm Chrome but listed zero tabs.",
		operator_required: false,
	},
};

const scenarios: Scenario[] = [
	{
		key: "stale_config_clear",
		label: "stale config clear",
		proof_case: cases.stale_config,
	},
	{
		key: "missing_dependency_clear",
		label: "missing dependency clear",
		proof_case: cases.missing_dependency,
	},
	{
		key: "auto_launch_stop",
		label: "auto-launch stop",
		proof_case: cases.auto_launch_risk,
	},
	{
		key: "ambiguous_binding_stop",
		label: "ambiguous binding stop",
		proof_case: cases.ambiguous_binding,
	},
	{
		key: "weak_signal_success",
		label: "weak signal success",
		proof_case: cases.weak_signal,
	},
	{
		key: "plain_cli_missing_action",
		label: "plain CLI missing action",
		proof_case: cases.stale_config,
		mutate: (surfaces) => {
			const plain = surfaces.find((surface) => surface.surface === "plain_cli");
			if (plain) {
				plain.text = "browser_adapter_proof adapter_config_stale: stale endpoint";
				plain.names_action = false;
			}
		},
	},
	{
		key: "router_overexplains",
		label: "Router overexplains",
		proof_case: cases.missing_dependency,
		mutate: (surfaces) => {
			const router = surfaces.find((surface) => surface.surface === "router_handoff");
			if (router) {
				router.text =
					"Router blocked; run command -v agent-browser or install agent-browser, then configure_adapter_dependency.";
				router.repair_detail_level = "command";
			}
		},
	},
];

function buildState(scenario: Scenario): PrototypeState {
	const surfaces = generateSurfaces(scenario.proof_case);
	scenario.mutate?.(surfaces);
	return {
		throwaway: true,
		question,
		last_action: scenario.label,
		proof_case: scenario.proof_case,
		surfaces,
		review: reviewSurfaces(scenario.proof_case, surfaces),
	};
}

function generateSurfaces(proofCase: ProofCase): ExplanationSurface[] {
	const action = proofCase.continuation_action;
	const code = proofCase.code ?? "adapter_ready";
	return [
		{
			surface: "json_envelope",
			text: JSON.stringify({
				status: proofCase.kind === "blocking_failure" ? "error" : "ok",
				code: proofCase.code,
				failure_domain: proofCase.failure_domain,
				continuation: { next_action_id: action },
				constraints: proofCase.constraints,
			}),
			names_code: Boolean(proofCase.code),
			names_action: true,
			names_constraint: proofCase.constraints.length > 0,
			repair_detail_level: "none",
		},
		{
			surface: "plain_cli",
			text:
				proofCase.kind === "blocking_failure"
					? `${proofCase.failure_domain} ${code}: ${proofCase.reason} action=${action}`
					: `adapter_ready ${code}: ${proofCase.reason} action=${action}`,
			names_code: Boolean(proofCase.code),
			names_action: true,
			names_constraint: proofCase.constraints.length > 0,
			repair_detail_level: "none",
		},
		{
			surface: "browser_adapter_map",
			text: mapText(proofCase),
			names_code: Boolean(proofCase.code),
			names_action: true,
			names_constraint: proofCase.constraints.length > 0,
			repair_detail_level: proofCase.map_section ? "section" : "none",
		},
		{
			surface: "router_handoff",
			text:
				proofCase.kind === "blocking_failure"
					? `Router blocked for ${proofCase.adapter_id}; wait for ${action} recovery and fresh proof.`
					: `Router may use ${proofCase.adapter_id}; proof is fresh with ${code} warning.`,
			names_code: proofCase.kind !== "success",
			names_action: true,
			names_constraint: false,
			repair_detail_level: "none",
		},
		{
			surface: "operator_choice",
			text: proofCase.operator_required
				? `Operator choice: ${action}; read ${proofCase.map_section} before changing local state.`
				: `No operator choice required; next action is ${action}.`,
			names_code: false,
			names_action: true,
			names_constraint: false,
			repair_detail_level: proofCase.operator_required ? "section" : "none",
		},
	];
}

function mapText(proofCase: ProofCase): string {
	if (proofCase.kind === "warning_success") {
		return `${proofCase.code}: warning-only; continue with ${proofCase.continuation_action} after recording ${proofCase.map_section}.`;
	}
	if (proofCase.code === "adapter_auto_launch_risk") {
		return `${proofCase.code}: stop; use ${proofCase.continuation_action}; do not use adapter fallback.`;
	}
	return `${proofCase.code}: use ${proofCase.continuation_action}; read ${proofCase.map_section}.`;
}

function reviewSurfaces(
	proofCase: ProofCase,
	surfaces: ExplanationSurface[],
): ExplanationReview {
	const drift = surfaces.flatMap((surface) => {
		const issues: string[] = [];
		if (proofCase.code && !surface.names_code && surface.surface !== "operator_choice") {
			issues.push(`${surface.surface} does not name ${proofCase.code}`);
		}
		if (!surface.names_action) {
			issues.push(`${surface.surface} does not name ${proofCase.continuation_action}`);
		}
		if (
			proofCase.constraints.includes("no_adapter_fallback") &&
			surface.surface === "browser_adapter_map" &&
			!surface.names_constraint
		) {
			issues.push("map does not name no_adapter_fallback");
		}
		if (surface.surface === "router_handoff" && surface.repair_detail_level === "command") {
			issues.push("Router handoff includes adapter-local command detail");
		}
		return issues;
	});
	const missing = [
		...requiredSurfaces().filter(
			(surface) => !surfaces.some((candidate) => candidate.surface === surface),
		),
	];
	const cognitiveLoadScore =
		surfaces.reduce((score, surface) => {
			const words = surface.text.split(/\s+/).filter(Boolean).length;
			return score + (words > 22 ? 2 : words > 14 ? 1 : 0);
		}, 0) + drift.length * 2;
	const nextSafeActionVisible = surfaces.every(
		(surface) => surface.surface === "operator_choice" || surface.names_action,
	);
	return {
		status:
			drift.length > 0
				? "drift"
				: cognitiveLoadScore > 6
					? "muddy"
					: "clear",
		cognitive_load_score: cognitiveLoadScore,
		drift,
		missing,
		next_safe_action_visible: nextSafeActionVisible,
		notes: reviewNotes(proofCase, cognitiveLoadScore),
	};
}

function reviewNotes(proofCase: ProofCase, cognitiveLoadScore: number): string[] {
	return [
		...(proofCase.kind === "warning_success"
			? ["Warning success should not read as failure."]
			: []),
		...(proofCase.code === "adapter_auto_launch_risk"
			? ["Auto-launch risk needs stop language and no fallback."]
			: []),
		...(proofCase.code === "adapter_binding_ambiguous"
			? ["Ambiguous binding should say stop before action."]
			: []),
		...(cognitiveLoadScore > 6 ? ["Trim plain and Router wording."] : []),
	];
}

function requiredSurfaces(): Surface[] {
	return [
		"json_envelope",
		"plain_cli",
		"browser_adapter_map",
		"router_handoff",
		"operator_choice",
	];
}

function renderState(state: PrototypeState, options: { clear: boolean }): void {
	if (options.clear) console.clear();
	console.log(bold("Browser Adapter failure explanation prototype"));
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

function runAuto(keys = scenarios.map((scenario) => scenario.key)): void {
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
