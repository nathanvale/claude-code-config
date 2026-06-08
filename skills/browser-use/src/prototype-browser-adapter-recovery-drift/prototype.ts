#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * Can browser-use keep Browser Adapter Proof and Browser Adapter Map recovery
 * vocabulary DRY across chrome-devtools and agent-browser by using shared
 * recovery machinery plus adapter-local proof specs?
 *
 * Run:
 * bun skills/browser-use/src/prototype-browser-adapter-recovery-drift/prototype.ts
 * bun skills/browser-use/src/prototype-browser-adapter-recovery-drift/prototype.ts --auto
 *
 * Notes:
 * skills/browser-use/src/prototype-browser-adapter-recovery-drift/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type AdapterId = "chrome-devtools" | "agent-browser";
type CoverageMode = "adapter_emitted" | "global_catalog";
type RecoveryTarget =
	| "browser_entry_handoff"
	| "change_adapter_input"
	| "configure_adapter_dependency"
	| "inspect_adapter_config"
	| "update_adapter_config"
	| "use_verified_browser_adapter"
	| "warning_only";
type MapSection =
	| "Owners"
	| "Rules"
	| "Recovery Map"
	| "Dependency"
	| "Config"
	| "Inspect"
	| "Warnings"
	| "Verify";

type CatalogEntry = {
	target: RecoveryTarget;
	section: MapSection;
	class: "dependency" | "input" | "binding" | "signal" | "runtime" | "risk";
	shared: boolean;
};

type AdapterSpec = {
	adapter_id: AdapterId;
	dependency_surface: string;
	binding_proof: string;
	weak_signal: string;
	risk_signals: string[];
	emits: string[];
};

type AdapterMapModel = {
	adapter_id: AdapterId;
	sections: MapSection[];
	recovery_map: Record<string, RecoveryTarget>;
};

type Scenario = {
	key: string;
	label: string;
	description: string;
	mode: CoverageMode;
	catalog: Record<string, CatalogEntry>;
	adapters: Record<AdapterId, AdapterSpec>;
	maps: Record<AdapterId, AdapterMapModel>;
};

type AdapterDriftReport = {
	adapter_id: AdapterId;
	expected_keys: string[];
	actual_keys: string[];
	missing_sections: MapSection[];
	missing_keys: string[];
	extra_keys: string[];
	unknown_keys: string[];
	noncanonical_targets: Array<{
		key: string;
		expected: RecoveryTarget;
		actual: RecoveryTarget;
	}>;
	map_specificity: "small_adapter_map" | "global_bloated_map";
	ok: boolean;
};

type PrototypeState = {
	throwaway: true;
	question: string;
	last_action: string;
	coverage_mode: CoverageMode;
	shared_patterns: {
		common_diagnostics: string[];
		common_targets: RecoveryTarget[];
		common_map_sections: MapSection[];
		common_proof_phases: string[];
	};
	adapter_specific: Record<AdapterId, string[]>;
	catalog: Record<string, CatalogEntry>;
	adapters: Record<AdapterId, AdapterSpec>;
	maps: Record<AdapterId, AdapterMapModel>;
	drift_report: {
		ok: boolean;
		adapters: AdapterDriftReport[];
		candidate_machinery: string[];
	};
};

const question =
	"Can shared recovery machinery keep two Browser Adapter Maps DRY without hiding adapter-specific proof facts?";
const requiredSections: MapSection[] = ["Owners", "Rules", "Recovery Map", "Verify"];
const localRecoveryTargets: Record<string, RecoveryTarget> = {
	browser_entry_handoff: "browser_entry_handoff",
	missing_adapter: "change_adapter_input",
	unknown_adapter: "change_adapter_input",
	non_loopback_endpoint: "change_adapter_input",
	invalid_usage: "change_adapter_input",
	runtime_failure: "inspect_adapter_config",
};
const actionTargets: Record<string, RecoveryTarget> = {
	configure_adapter_dependency: "configure_adapter_dependency",
	update_adapter_config: "update_adapter_config",
	inspect_adapter_config: "inspect_adapter_config",
	change_adapter_input: "change_adapter_input",
	use_verified_browser_adapter: "use_verified_browser_adapter",
};
const baseCatalog: Record<string, CatalogEntry> = {
	adapter_config_stale: {
		target: "update_adapter_config",
		section: "Config",
		class: "binding",
		shared: true,
	},
	adapter_config_missing: {
		target: "update_adapter_config",
		section: "Config",
		class: "binding",
		shared: true,
	},
	adapter_dependency_missing: {
		target: "configure_adapter_dependency",
		section: "Dependency",
		class: "dependency",
		shared: true,
	},
	adapter_command_override_invalid: {
		target: "configure_adapter_dependency",
		section: "Dependency",
		class: "dependency",
		shared: false,
	},
	adapter_binding_mismatch: {
		target: "update_adapter_config",
		section: "Config",
		class: "binding",
		shared: true,
	},
	adapter_binding_ambiguous: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "binding",
		shared: true,
	},
	adapter_signal_weak: {
		target: "warning_only",
		section: "Warnings",
		class: "signal",
		shared: true,
	},
	adapter_chrome_for_testing_risk: {
		target: "inspect_adapter_config",
		section: "Warnings",
		class: "risk",
		shared: true,
	},
	adapter_auto_launch_risk: {
		target: "inspect_adapter_config",
		section: "Warnings",
		class: "risk",
		shared: true,
	},
	adapter_proof_timeout: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "runtime",
		shared: true,
	},
	adapter_command_failed: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "runtime",
		shared: true,
	},
	adapter_output_unparsable: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "runtime",
		shared: true,
	},
	adapter_config_parse_error: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "binding",
		shared: true,
	},
};

const baseAdapters: Record<AdapterId, AdapterSpec> = {
	"chrome-devtools": {
		adapter_id: "chrome-devtools",
		dependency_surface: "mcporter command vector",
		binding_proof: "selected config binding plus chrome-devtools.list_pages",
		weak_signal: "list_pages returns empty page list",
		risk_signals: ["DevToolsActivePort from wrong profile"],
		emits: [
			"adapter_config_stale",
			"adapter_config_missing",
			"adapter_dependency_missing",
			"adapter_command_override_invalid",
			"adapter_binding_mismatch",
			"adapter_binding_ambiguous",
			"adapter_signal_weak",
			"adapter_proof_timeout",
			"adapter_command_failed",
			"adapter_output_unparsable",
			"adapter_config_parse_error",
		],
	},
	"agent-browser": {
		adapter_id: "agent-browser",
		dependency_surface: "agent-browser executable",
		binding_proof: "session CDP pin plus agent-browser get cdp-url",
		weak_signal: "agent-browser tab list returns zero tabs",
		risk_signals: ["auto-launch", "Chrome for Testing", "sticky daemon"],
		emits: [
			"adapter_config_stale",
			"adapter_config_missing",
			"adapter_dependency_missing",
			"adapter_binding_mismatch",
			"adapter_binding_ambiguous",
			"adapter_signal_weak",
			"adapter_chrome_for_testing_risk",
			"adapter_auto_launch_risk",
			"adapter_proof_timeout",
			"adapter_command_failed",
			"adapter_output_unparsable",
		],
	},
};

const scenarios: Scenario[] = [
	buildScenario({
		key: "generated_adapter_maps",
		label: "generated adapter-emitted maps",
		description:
			"Both maps are generated from adapter-emitted diagnostics plus shared actions.",
		mode: "adapter_emitted",
	}),
	buildScenario({
		key: "global_map_pressure",
		label: "global catalogue pressure",
		description:
			"Validation expects every global diagnostic in every adapter map.",
		mode: "global_catalog",
	}),
	buildScenario({
		key: "agent_missing_risk",
		label: "agent map missing risk entries",
		description:
			"agent-browser emits risk diagnostics but its map forgot those recovery keys.",
		mode: "adapter_emitted",
		mutateMaps: (maps) => {
			delete maps["agent-browser"].recovery_map.adapter_auto_launch_risk;
			delete maps["agent-browser"].recovery_map.adapter_chrome_for_testing_risk;
		},
	}),
	buildScenario({
		key: "invented_vocabulary",
		label: "agent map invents vocabulary",
		description:
			"agent-browser map invents adapter_session_missing instead of using shared codes.",
		mode: "adapter_emitted",
		mutateMaps: (maps) => {
			maps["agent-browser"].recovery_map.adapter_session_missing =
				"update_adapter_config";
		},
	}),
	buildScenario({
		key: "noncanonical_target",
		label: "chrome map drifts semantically",
		description:
			"chrome-devtools maps adapter_config_stale to inspect instead of update.",
		mode: "adapter_emitted",
		mutateMaps: (maps) => {
			maps["chrome-devtools"].recovery_map.adapter_config_stale =
				"inspect_adapter_config";
		},
	}),
	buildScenario({
		key: "new_catalog_code",
		label: "new shared code missing from maps",
		description:
			"Runtime learns adapter_session_stale; generated maps have not been migrated.",
		mode: "adapter_emitted",
		mutateCatalog: (catalog) => {
			catalog.adapter_session_stale = {
				target: "update_adapter_config",
				section: "Config",
				class: "binding",
				shared: false,
			};
		},
		mutateAdapters: (adapters) => {
			adapters["agent-browser"].emits.push("adapter_session_stale");
		},
		mutateMaps: (maps) => {
			delete maps["agent-browser"].recovery_map.adapter_session_stale;
		},
	}),
];

function buildScenario(input: {
	key: string;
	label: string;
	description: string;
	mode: CoverageMode;
	mutateCatalog?: (catalog: Record<string, CatalogEntry>) => void;
	mutateAdapters?: (adapters: Record<AdapterId, AdapterSpec>) => void;
	mutateMaps?: (maps: Record<AdapterId, AdapterMapModel>) => void;
}): Scenario {
	const catalog = clone(baseCatalog);
	const adapters = clone(baseAdapters);
	input.mutateCatalog?.(catalog);
	input.mutateAdapters?.(adapters);
	const maps: Record<AdapterId, AdapterMapModel> = {
		"chrome-devtools": makeGeneratedMap("chrome-devtools", input.mode, catalog, adapters),
		"agent-browser": makeGeneratedMap("agent-browser", input.mode, catalog, adapters),
	};
	input.mutateMaps?.(maps);
	return {
		key: input.key,
		label: input.label,
		description: input.description,
		mode: input.mode,
		catalog,
		adapters,
		maps,
	};
}

function makeGeneratedMap(
	adapterId: AdapterId,
	mode: CoverageMode,
	catalog: Record<string, CatalogEntry>,
	adapters: Record<AdapterId, AdapterSpec>,
): AdapterMapModel {
	const recovery_map: Record<string, RecoveryTarget> = {
		...localRecoveryTargets,
		...actionTargets,
	};
	for (const key of diagnosticKeysForAdapter(adapterId, mode, catalog, adapters)) {
		recovery_map[key] = catalog[key]?.target ?? "inspect_adapter_config";
	}
	return {
		adapter_id: adapterId,
		sections: sectionKeysForMap(recovery_map, catalog),
		recovery_map,
	};
}

function evaluateScenario(scenario: Scenario): PrototypeState {
	const sharedPatterns = deriveSharedPatterns(scenario.adapters, scenario.catalog);
	const adapterReports = (Object.keys(scenario.adapters) as AdapterId[]).map(
		(adapterId) =>
			checkAdapterMap({
				adapterId,
				mode: scenario.mode,
				catalog: scenario.catalog,
				adapters: scenario.adapters,
				map: scenario.maps[adapterId],
			}),
	);
	return {
		throwaway: true,
		question,
		last_action: scenario.label,
		coverage_mode: scenario.mode,
		shared_patterns: sharedPatterns,
		adapter_specific: {
			"chrome-devtools": adapterSpecificFacts(
				scenario.adapters["chrome-devtools"],
				scenario.adapters["agent-browser"],
			),
			"agent-browser": adapterSpecificFacts(
				scenario.adapters["agent-browser"],
				scenario.adapters["chrome-devtools"],
			),
		},
		catalog: scenario.catalog,
		adapters: scenario.adapters,
		maps: scenario.maps,
		drift_report: {
			ok: adapterReports.every((report) => report.ok),
			adapters: adapterReports,
			candidate_machinery: [
				"Catalog owns diagnostic -> canonical recovery target.",
				"Adapter specs own emitted diagnostics and proof probes.",
				"Map checker derives expected keys from catalog plus adapter spec.",
				"Maps own exact commands and operator guidance.",
			],
		},
	};
}

function checkAdapterMap(input: {
	adapterId: AdapterId;
	mode: CoverageMode;
	catalog: Record<string, CatalogEntry>;
	adapters: Record<AdapterId, AdapterSpec>;
	map: AdapterMapModel;
}): AdapterDriftReport {
	const expectedKeys = expectedMapKeys(
		input.adapterId,
		input.mode,
		input.catalog,
		input.adapters,
	);
	const actualKeys = Object.keys(input.map.recovery_map).sort();
	const knownKeys = uniqueSorted([
		...Object.keys(input.catalog),
		...Object.keys(localRecoveryTargets),
		...Object.keys(actionTargets),
	]);
	const missingKeys = expectedKeys.filter((key) => !actualKeys.includes(key));
	const extraKeys = actualKeys.filter((key) => !expectedKeys.includes(key));
	const unknownKeys = actualKeys.filter((key) => !knownKeys.includes(key));
	const noncanonicalTargets = actualKeys.flatMap((key) => {
		const expectedTarget = canonicalTargetForKey(key, input.catalog);
		const actualTarget = input.map.recovery_map[key];
		if (!expectedTarget || expectedTarget === actualTarget) return [];
		return [{ key, expected: expectedTarget, actual: actualTarget }];
	});
	const missingSections = requiredSections.filter(
		(section) => !input.map.sections.includes(section),
	);
	return {
		adapter_id: input.adapterId,
		expected_keys: expectedKeys,
		actual_keys: actualKeys,
		missing_sections: missingSections,
		missing_keys: missingKeys,
		extra_keys: extraKeys,
		unknown_keys: unknownKeys,
		noncanonical_targets: noncanonicalTargets,
		map_specificity:
			input.mode === "global_catalog" ? "global_bloated_map" : "small_adapter_map",
		ok:
			missingSections.length === 0 &&
			missingKeys.length === 0 &&
			unknownKeys.length === 0 &&
			noncanonicalTargets.length === 0,
	};
}

function expectedMapKeys(
	adapterId: AdapterId,
	mode: CoverageMode,
	catalog: Record<string, CatalogEntry>,
	adapters: Record<AdapterId, AdapterSpec>,
): string[] {
	return uniqueSorted([
		...Object.keys(localRecoveryTargets),
		...Object.keys(actionTargets),
		...diagnosticKeysForAdapter(adapterId, mode, catalog, adapters),
	]);
}

function diagnosticKeysForAdapter(
	adapterId: AdapterId,
	mode: CoverageMode,
	catalog: Record<string, CatalogEntry>,
	adapters: Record<AdapterId, AdapterSpec>,
): string[] {
	if (mode === "global_catalog") return Object.keys(catalog).sort();
	return uniqueSorted(adapters[adapterId].emits);
}

function canonicalTargetForKey(
	key: string,
	catalog: Record<string, CatalogEntry>,
): RecoveryTarget | undefined {
	return catalog[key]?.target ?? localRecoveryTargets[key] ?? actionTargets[key];
}

function sectionKeysForMap(
	recoveryMap: Record<string, RecoveryTarget>,
	catalog: Record<string, CatalogEntry>,
): MapSection[] {
	const sections = new Set<MapSection>(requiredSections);
	for (const key of Object.keys(recoveryMap)) {
		const section = catalog[key]?.section;
		if (section) sections.add(section);
	}
	return [...sections].sort();
}

function deriveSharedPatterns(
	adapters: Record<AdapterId, AdapterSpec>,
	catalog: Record<string, CatalogEntry>,
): PrototypeState["shared_patterns"] {
	const chrome = adapters["chrome-devtools"];
	const agent = adapters["agent-browser"];
	const commonDiagnostics = chrome.emits.filter((key) => agent.emits.includes(key));
	const commonTargets = uniqueSorted(
		commonDiagnostics
			.map((key) => catalog[key]?.target)
			.filter((target): target is RecoveryTarget => Boolean(target)),
	);
	const commonMapSections = uniqueSorted(
		commonDiagnostics
			.map((key) => catalog[key]?.section)
			.filter((section): section is MapSection => Boolean(section)),
	);
	return {
		common_diagnostics: commonDiagnostics.sort(),
		common_targets: commonTargets,
		common_map_sections: commonMapSections,
		common_proof_phases: [
			"dependency check",
			"binding proof",
			"weak signal check",
			"risk classification",
			"continuation emission",
		],
	};
}

function adapterSpecificFacts(
	adapter: AdapterSpec,
	other: AdapterSpec,
): string[] {
	return [
		`Dependency surface: ${adapter.dependency_surface}.`,
		`Binding proof: ${adapter.binding_proof}.`,
		`Weak signal: ${adapter.weak_signal}.`,
		...adapter.risk_signals.map((signal) => `Risk signal: ${signal}.`),
		...adapter.emits
			.filter((key) => !other.emits.includes(key))
			.map((key) => `Unique diagnostic: ${key}.`),
	];
}

function renderState(state: PrototypeState, options: { clear: boolean }): void {
	if (options.clear) console.clear();
	console.log(bold("Browser Adapter recovery drift prototype"));
	console.log(dim("PROTOTYPE - throwaway; inspect NOTES.md before deleting."));
	console.log("");
	console.log(bold("Current State"));
	console.log(JSON.stringify(state, null, 2));
	console.log("");
	console.log(bold("Shortcuts"));
	console.log(
		[
			...scenarios.map(
				(scenario, index) => `[${index + 1}] ${scenario.label}`,
			),
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
	let state = evaluateScenario(scenarios[0]);
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
		if (scenario) state = evaluateScenario(scenario);
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
		renderState(evaluateScenario(scenario), { clear: false });
		console.log("");
	}
}

function scenarioForInput(input: string): Scenario | undefined {
	if (/^[1-9]$/.test(input)) return scenarios[Number(input) - 1];
	return scenarios.find(
		(scenario) => scenario.key === input || scenario.label === input,
	);
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
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
