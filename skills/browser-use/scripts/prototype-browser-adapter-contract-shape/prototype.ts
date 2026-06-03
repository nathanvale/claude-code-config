#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * Can one adapter contract shape feed Browser Adapter Proof, Browser Adapter Map
 * validation, map authoring, and Router proof evidence without duplicating
 * recovery vocabulary?
 *
 * Run:
 * bun skills/browser-use/scripts/prototype-browser-adapter-contract-shape/prototype.ts
 * bun skills/browser-use/scripts/prototype-browser-adapter-contract-shape/prototype.ts --auto
 *
 * Notes:
 * skills/browser-use/scripts/prototype-browser-adapter-contract-shape/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type AdapterId = "chrome-devtools" | "agent-browser";
type Consumer =
	| "proof_runtime"
	| "map_validation"
	| "map_authoring"
	| "router_evidence";
type RecoveryTarget =
	| "configure_adapter_dependency"
	| "inspect_adapter_config"
	| "update_adapter_config"
	| "use_verified_browser_adapter"
	| "warning_only";
type Section = "Dependency" | "Config" | "Inspect" | "Warnings" | "Verify";
type ProjectionStatus = "ok" | "warning" | "blocked";

type DiagnosticCatalogEntry = {
	recovery_target: RecoveryTarget;
	map_section: Section;
	severity_behavior: "blocking" | "warning_only";
};

type AdapterContractSpec = {
	adapter_id: AdapterId;
	proof_probes: {
		dependency: string;
		binding: string;
		weak_signal: string;
		risks: string[];
	};
	emitted_diagnostics: string[];
	command_slots: {
		dependency?: string;
		config?: string;
		inspect?: string;
		verify?: string;
	};
	map_path: string;
};

type ContractShape = {
	shape_id: string;
	description: string;
	diagnostic_catalog: Record<string, DiagnosticCatalogEntry>;
	adapter_specs: Record<AdapterId, AdapterContractSpec>;
	duplicated_consumer_vocab?: Partial<Record<Consumer, string[]>>;
};

type ConsumerProjection = {
	consumer: Consumer;
	status: ProjectionStatus;
	output_keys: string[];
	missing_inputs: string[];
	drift_risks: string[];
	derived_from: string[];
};

type PrototypeState = {
	throwaway: true;
	question: string;
	last_action: string;
	shape: ContractShape;
	projections: ConsumerProjection[];
	judgement: {
		ok: boolean;
		best_source_of_truth: string;
		contract_smells: string[];
		next_safe_actions: string[];
	};
};

type Scenario = {
	key: string;
	label: string;
	shape: ContractShape;
};

const question =
	"Can one contract shape produce proof, map, authoring, and Router projections?";
const catalog: Record<string, DiagnosticCatalogEntry> = {
	adapter_config_stale: {
		recovery_target: "update_adapter_config",
		map_section: "Config",
		severity_behavior: "blocking",
	},
	adapter_config_missing: {
		recovery_target: "update_adapter_config",
		map_section: "Config",
		severity_behavior: "blocking",
	},
	adapter_dependency_missing: {
		recovery_target: "configure_adapter_dependency",
		map_section: "Dependency",
		severity_behavior: "blocking",
	},
	adapter_binding_mismatch: {
		recovery_target: "update_adapter_config",
		map_section: "Config",
		severity_behavior: "blocking",
	},
	adapter_binding_ambiguous: {
		recovery_target: "inspect_adapter_config",
		map_section: "Inspect",
		severity_behavior: "blocking",
	},
	adapter_signal_weak: {
		recovery_target: "warning_only",
		map_section: "Warnings",
		severity_behavior: "warning_only",
	},
	adapter_auto_launch_risk: {
		recovery_target: "inspect_adapter_config",
		map_section: "Warnings",
		severity_behavior: "blocking",
	},
	adapter_chrome_for_testing_risk: {
		recovery_target: "inspect_adapter_config",
		map_section: "Warnings",
		severity_behavior: "blocking",
	},
	adapter_proof_timeout: {
		recovery_target: "inspect_adapter_config",
		map_section: "Inspect",
		severity_behavior: "blocking",
	},
	adapter_command_failed: {
		recovery_target: "inspect_adapter_config",
		map_section: "Inspect",
		severity_behavior: "blocking",
	},
	adapter_output_unparsable: {
		recovery_target: "inspect_adapter_config",
		map_section: "Inspect",
		severity_behavior: "blocking",
	},
};

const adapterSpecs: Record<AdapterId, AdapterContractSpec> = {
	"chrome-devtools": {
		adapter_id: "chrome-devtools",
		proof_probes: {
			dependency: "mcporter command vector",
			binding: "mcporter config get chrome-devtools --json",
			weak_signal: "chrome-devtools.list_pages",
			risks: ["DevToolsActivePort wrong profile"],
		},
		emitted_diagnostics: [
			"adapter_config_stale",
			"adapter_config_missing",
			"adapter_dependency_missing",
			"adapter_binding_mismatch",
			"adapter_binding_ambiguous",
			"adapter_signal_weak",
			"adapter_proof_timeout",
			"adapter_command_failed",
			"adapter_output_unparsable",
		],
		command_slots: {
			dependency: "export BROWSER_USE_MCPORTER_COMMAND_JSON='[\"bunx\",\"mcporter\"]'",
			config: "mcporter config add chrome-devtools ... --browserUrl http://127.0.0.1:$PORT",
			inspect: "mcporter call chrome-devtools.list_pages --args '{}' --output json",
			verify:
				"skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter chrome-devtools --port $PORT --json",
		},
		map_path: "skills/browser-use/references/browser-adapter-chrome-devtools.md",
	},
	"agent-browser": {
		adapter_id: "agent-browser",
		proof_probes: {
			dependency: "agent-browser executable",
			binding: "agent-browser get cdp-url --session $SESSION --cdp $PORT",
			weak_signal: "agent-browser tab list --session $SESSION --cdp $PORT",
			risks: ["auto-launch", "Chrome for Testing", "sticky daemon"],
		},
		emitted_diagnostics: [
			"adapter_config_stale",
			"adapter_config_missing",
			"adapter_dependency_missing",
			"adapter_binding_mismatch",
			"adapter_binding_ambiguous",
			"adapter_signal_weak",
			"adapter_auto_launch_risk",
			"adapter_chrome_for_testing_risk",
			"adapter_proof_timeout",
			"adapter_command_failed",
			"adapter_output_unparsable",
		],
		command_slots: {
			dependency: "command -v agent-browser",
			inspect: "agent-browser tab list --session $SESSION --cdp $PORT",
			verify:
				"skills/browser-use/scripts/preflight-browser-adapter.sh check --adapter agent-browser --port $PORT --json",
		},
		map_path: "skills/browser-use/references/browser-adapter-agent-browser.md",
	},
};

const scenarios: Scenario[] = [
	{
		key: "composed_contract",
		label: "composed contract",
		shape: {
			shape_id: "composed_contract",
			description: "Shared diagnostic catalogue plus adapter-local proof specs.",
			diagnostic_catalog: catalog,
			adapter_specs: adapterSpecs,
		},
	},
	{
		key: "router_heavy_contract",
		label: "router-heavy contract",
		shape: {
			shape_id: "router_heavy_contract",
			description: "Router projection carries repair vocabulary and command slots.",
			diagnostic_catalog: catalog,
			adapter_specs: adapterSpecs,
			duplicated_consumer_vocab: {
				router_evidence: [
					"adapter_config_stale",
					"adapter_dependency_missing",
					"update_adapter_config",
					"configure_adapter_dependency",
					"mcporter config add ...",
				],
			},
		},
	},
	{
		key: "map_as_contract",
		label: "map-as-contract",
		shape: {
			shape_id: "map_as_contract",
			description: "Map prose is treated as the source of emitted diagnostics.",
			diagnostic_catalog: catalog,
			adapter_specs: adapterSpecs,
			duplicated_consumer_vocab: {
				map_validation: Object.keys(catalog),
				proof_runtime: [
					"adapter_config_stale",
					"adapter_dependency_missing",
					"adapter_session_missing",
				],
			},
		},
	},
	{
		key: "thin_agent_spec",
		label: "thin agent spec",
		shape: {
			shape_id: "thin_agent_spec",
			description: "agent-browser lacks config command and binding probe detail.",
			diagnostic_catalog: catalog,
			adapter_specs: {
				...adapterSpecs,
				"agent-browser": {
					...adapterSpecs["agent-browser"],
					proof_probes: {
						...adapterSpecs["agent-browser"].proof_probes,
						binding: "",
					},
					command_slots: {
						dependency: "command -v agent-browser",
					},
				},
			},
		},
	},
	{
		key: "duplicated_consumer_vocab",
		label: "duplicated consumer vocab",
		shape: {
			shape_id: "duplicated_consumer_vocab",
			description: "Each consumer carries its own subset of codes.",
			diagnostic_catalog: catalog,
			adapter_specs: adapterSpecs,
			duplicated_consumer_vocab: {
				proof_runtime: ["adapter_config_stale", "adapter_dependency_missing"],
				map_validation: [
					"adapter_config_stale",
					"adapter_dependency_missing",
					"adapter_auto_launch_risk",
				],
				map_authoring: [
					"adapter_config_stale",
					"adapter_dependency_missing",
					"adapter_session_missing",
				],
			},
		},
	},
];

function buildState(scenario: Scenario): PrototypeState {
	const projections: ConsumerProjection[] = [
		projectProofRuntime(scenario.shape),
		projectMapValidation(scenario.shape),
		projectMapAuthoring(scenario.shape),
		projectRouterEvidence(scenario.shape),
	];
	const contractSmells = smellContract(scenario.shape, projections);
	return {
		throwaway: true,
		question,
		last_action: scenario.label,
		shape: scenario.shape,
		projections,
		judgement: {
			ok: projections.every((projection) => projection.status !== "blocked") && contractSmells.length === 0,
			best_source_of_truth:
				"diagnostic_catalog plus adapter_specs; consumer outputs are projections.",
			contract_smells: contractSmells,
			next_safe_actions: nextActions(contractSmells, projections),
		},
	};
}

function projectProofRuntime(shape: ContractShape): ConsumerProjection {
	const missingInputs = Object.values(shape.adapter_specs).flatMap((spec) => [
		...(spec.proof_probes.dependency ? [] : [`${spec.adapter_id}.proof.dependency`]),
		...(spec.proof_probes.binding ? [] : [`${spec.adapter_id}.proof.binding`]),
		...(spec.proof_probes.weak_signal
			? []
			: [`${spec.adapter_id}.proof.weak_signal`]),
	]);
	return {
		consumer: "proof_runtime",
		status: missingInputs.length > 0 ? "blocked" : "ok",
		output_keys: uniqueSorted(
			Object.values(shape.adapter_specs).flatMap((spec) => spec.emitted_diagnostics),
		),
		missing_inputs: missingInputs,
		drift_risks: duplicatedVocabRisks(shape, "proof_runtime"),
		derived_from: ["adapter_specs[*].proof_probes", "adapter_specs[*].emitted_diagnostics"],
	};
}

function projectMapValidation(shape: ContractShape): ConsumerProjection {
	const unknownCodes = Object.values(shape.adapter_specs)
		.flatMap((spec) => spec.emitted_diagnostics)
		.filter((code) => !shape.diagnostic_catalog[code]);
	return {
		consumer: "map_validation",
		status: unknownCodes.length > 0 ? "blocked" : "ok",
		output_keys: uniqueSorted([
			"Owners",
			"Rules",
			"Recovery Map",
			"Verify",
			...Object.values(shape.adapter_specs).flatMap((spec) => spec.emitted_diagnostics),
		]),
		missing_inputs: unknownCodes.map((code) => `catalog.${code}`),
		drift_risks: duplicatedVocabRisks(shape, "map_validation"),
		derived_from: ["diagnostic_catalog", "adapter_specs[*].emitted_diagnostics"],
	};
}

function projectMapAuthoring(shape: ContractShape): ConsumerProjection {
	const missingSlots = Object.values(shape.adapter_specs).flatMap((spec) => [
		...(spec.command_slots.dependency ? [] : [`${spec.adapter_id}.commands.dependency`]),
		...(spec.command_slots.config ? [] : [`${spec.adapter_id}.commands.config`]),
		...(spec.command_slots.inspect ? [] : [`${spec.adapter_id}.commands.inspect`]),
		...(spec.command_slots.verify ? [] : [`${spec.adapter_id}.commands.verify`]),
	]);
	return {
		consumer: "map_authoring",
		status: missingSlots.length > 0 ? "warning" : "ok",
		output_keys: uniqueSorted([
			...Object.keys(shape.adapter_specs),
			...Object.keys(shape.diagnostic_catalog),
			"markdown_preview",
			"todo_markers",
		]),
		missing_inputs: missingSlots,
		drift_risks: duplicatedVocabRisks(shape, "map_authoring"),
		derived_from: ["diagnostic_catalog", "adapter_specs[*].command_slots"],
	};
}

function projectRouterEvidence(shape: ContractShape): ConsumerProjection {
	return {
		consumer: "router_evidence",
		status: duplicatedVocabRisks(shape, "router_evidence").length > 0 ? "warning" : "ok",
		output_keys: [
			"adapter_id",
			"proof_status",
			"verified_endpoint",
			"warnings",
			"use_verified_browser_adapter",
		],
		missing_inputs: [],
		drift_risks: duplicatedVocabRisks(shape, "router_evidence"),
		derived_from: ["proof success envelope", "adapter_specs[*].adapter_id"],
	};
}

function duplicatedVocabRisks(
	shape: ContractShape,
	consumer: Consumer,
): string[] {
	const vocab = shape.duplicated_consumer_vocab?.[consumer] ?? [];
	const known = new Set([
		...Object.keys(shape.diagnostic_catalog),
		"configure_adapter_dependency",
		"inspect_adapter_config",
		"update_adapter_config",
		"use_verified_browser_adapter",
	]);
	return vocab
		.filter((value) => !known.has(value))
		.map((value) => `${consumer} has noncatalogue value: ${value}`);
}

function smellContract(
	shape: ContractShape,
	projections: ConsumerProjection[],
): string[] {
	return [
		...(shape.duplicated_consumer_vocab
			? ["consumer-specific vocabulary duplicates source of truth"]
			: []),
		...projections.flatMap((projection) => projection.drift_risks),
		...projections
			.filter((projection) => projection.status === "blocked")
			.map((projection) => `${projection.consumer} is blocked`),
		...(shape.shape_id === "router_heavy_contract"
			? ["Router evidence carries repair details it should not own"]
			: []),
		...(shape.shape_id === "map_as_contract"
			? ["Map prose becomes source of runtime emissions"]
			: []),
	];
}

function nextActions(
	smells: string[],
	projections: ConsumerProjection[],
): string[] {
	const blocked = projections.filter((projection) => projection.status === "blocked");
	if (blocked.length > 0) return ["Fill missing adapter spec fields before production."];
	if (smells.length > 0) return ["Collapse duplicated consumer vocabulary into shared catalogue projections."];
	return ["Try this shape against production Browser Adapter Map validation."];
}

function renderState(state: PrototypeState, options: { clear: boolean }): void {
	if (options.clear) console.clear();
	console.log(bold("Browser Adapter contract shape prototype"));
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

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
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
