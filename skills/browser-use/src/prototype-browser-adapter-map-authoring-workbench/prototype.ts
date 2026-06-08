#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway.
 *
 * Question:
 * Can browser-use generate and review a draft Browser Adapter Map from an
 * adapter proof spec before the map exists?
 *
 * Run:
 * bun skills/browser-use/src/prototype-browser-adapter-map-authoring-workbench/prototype.ts
 * bun skills/browser-use/src/prototype-browser-adapter-map-authoring-workbench/prototype.ts --auto
 *
 * Notes:
 * skills/browser-use/src/prototype-browser-adapter-map-authoring-workbench/NOTES.md
 */

import { createInterface } from "node:readline/promises";

type RecoveryTarget =
	| "browser_entry_handoff"
	| "change_adapter_input"
	| "configure_adapter_dependency"
	| "inspect_adapter_config"
	| "update_adapter_config"
	| "use_verified_browser_adapter"
	| "warning_only";
type Section =
	| "Owners"
	| "Rules"
	| "Recovery Map"
	| "Dependency"
	| "Config"
	| "Inspect"
	| "Warnings"
	| "Verify";
type DiagnosticClass = "dependency" | "input" | "binding" | "signal" | "runtime" | "risk";
type CommandSlot = "dependency" | "config" | "inspect" | "verify";
type Readiness = "ready_to_draft" | "draft_with_todos" | "blocked_on_spec";

type CatalogEntry = {
	target: RecoveryTarget;
	section: Section;
	class: DiagnosticClass;
};

type AdapterAuthoringSpec = {
	adapter_id: string;
	map_path: string;
	owners: {
		proof_runtime: string;
		proof_cli: string;
		command_contract: string;
	};
	proof_surface: {
		dependency: string | null;
		binding_probe: string | null;
		weak_signal_probe: string | null;
		risk_probes: string[];
	};
	emitted_diagnostics: string[];
	commands: Partial<Record<CommandSlot, string>>;
	notes: string[];
};

type DraftMap = {
	path: string;
	sections: Section[];
	recovery_map: Record<string, RecoveryTarget>;
	command_todos: CommandSlot[];
	markdown_preview: string[];
};

type AuthoringReview = {
	readiness: Readiness;
	missing_spec_fields: string[];
	missing_commands: CommandSlot[];
	invented_diagnostics: string[];
	missing_catalog_diagnostics: string[];
	duplicate_recovery_targets: Record<RecoveryTarget, string[]>;
	suggested_section_placement: Record<string, Section>;
	next_safe_actions: string[];
};

type PrototypeState = {
	throwaway: true;
	question: string;
	last_action: string;
	input_spec: AdapterAuthoringSpec;
	draft_map: DraftMap;
	review: AuthoringReview;
};

type Scenario = {
	key: string;
	label: string;
	description: string;
	spec: AdapterAuthoringSpec;
};

const question =
	"Can an adapter proof spec guide Browser Adapter Map authoring before the map exists?";
const requiredSections: Section[] = ["Owners", "Rules", "Recovery Map", "Verify"];
const localRecovery: Record<string, RecoveryTarget> = {
	browser_entry_handoff: "browser_entry_handoff",
	missing_adapter: "change_adapter_input",
	unknown_adapter: "change_adapter_input",
	non_loopback_endpoint: "change_adapter_input",
	invalid_usage: "change_adapter_input",
	runtime_failure: "inspect_adapter_config",
};
const sharedActions: Record<string, RecoveryTarget> = {
	configure_adapter_dependency: "configure_adapter_dependency",
	update_adapter_config: "update_adapter_config",
	inspect_adapter_config: "inspect_adapter_config",
	change_adapter_input: "change_adapter_input",
	use_verified_browser_adapter: "use_verified_browser_adapter",
};
const catalog: Record<string, CatalogEntry> = {
	adapter_config_stale: {
		target: "update_adapter_config",
		section: "Config",
		class: "binding",
	},
	adapter_config_missing: {
		target: "update_adapter_config",
		section: "Config",
		class: "binding",
	},
	adapter_dependency_missing: {
		target: "configure_adapter_dependency",
		section: "Dependency",
		class: "dependency",
	},
	adapter_command_override_invalid: {
		target: "configure_adapter_dependency",
		section: "Dependency",
		class: "dependency",
	},
	adapter_binding_mismatch: {
		target: "update_adapter_config",
		section: "Config",
		class: "binding",
	},
	adapter_binding_ambiguous: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "binding",
	},
	adapter_signal_weak: {
		target: "warning_only",
		section: "Warnings",
		class: "signal",
	},
	adapter_chrome_for_testing_risk: {
		target: "inspect_adapter_config",
		section: "Warnings",
		class: "risk",
	},
	adapter_auto_launch_risk: {
		target: "inspect_adapter_config",
		section: "Warnings",
		class: "risk",
	},
	adapter_proof_timeout: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "runtime",
	},
	adapter_command_failed: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "runtime",
	},
	adapter_output_unparsable: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "runtime",
	},
	adapter_config_parse_error: {
		target: "inspect_adapter_config",
		section: "Inspect",
		class: "binding",
	},
};

const baseOwners = {
	proof_runtime: "skills/browser-use/src/preflight-browser-adapter.ts",
	proof_cli: "skills/browser-use/src/preflight-browser-adapter.ts",
	command_contract: "skills/browser-use/src/command-contract.ts",
};

const agentBrowserSpec: AdapterAuthoringSpec = {
	adapter_id: "agent-browser",
	map_path: "skills/browser-use/references/browser-adapter-agent-browser.md",
	owners: baseOwners,
	proof_surface: {
		dependency: "agent-browser executable",
		binding_probe: "agent-browser get cdp-url --session $SESSION --cdp $PORT",
		weak_signal_probe: "agent-browser tab list --session $SESSION --cdp $PORT",
		risk_probes: ["auto-launch detection", "Chrome for Testing detection"],
	},
	emitted_diagnostics: [
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
	commands: {
		dependency: "command -v agent-browser",
		inspect: "agent-browser tab list --session $SESSION --cdp $PORT",
		verify:
			"skills/browser-use/src/preflight-browser-adapter.ts check --adapter agent-browser --port $PORT --json",
	},
	notes: ["Config repair command is intentionally unknown in this prototype."],
};

const chromeSpec: AdapterAuthoringSpec = {
	adapter_id: "chrome-devtools",
	map_path: "skills/browser-use/references/browser-adapter-chrome-devtools.md",
	owners: baseOwners,
	proof_surface: {
		dependency: "mcporter command vector",
		binding_probe: "mcporter config get chrome-devtools --json",
		weak_signal_probe: "mcporter call chrome-devtools.list_pages --args '{}' --output json",
		risk_probes: ["DevToolsActivePort userDataDir resolves to wrong profile"],
	},
	emitted_diagnostics: [
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
	commands: {
		dependency: "export BROWSER_USE_MCPORTER_COMMAND_JSON='[\"bunx\",\"mcporter\"]'",
		config:
			"mcporter config add chrome-devtools --scope home --command npx --arg -y --arg chrome-devtools-mcp --arg --browserUrl --arg http://127.0.0.1:$PORT",
		inspect:
			"mcporter call chrome-devtools.list_pages --args '{}' --output json",
		verify:
			"skills/browser-use/src/preflight-browser-adapter.ts check --adapter chrome-devtools --port $PORT --json",
	},
	notes: ["Mirrors current map shape."],
};

const scenarios: Scenario[] = [
	{
		key: "agent_browser_starter",
		label: "agent-browser starter",
		description: "Draft from plausible agent-browser proof facts.",
		spec: agentBrowserSpec,
	},
	{
		key: "chrome_devtools_reference",
		label: "chrome-devtools reference",
		description: "Draft from the existing chrome-devtools map facts.",
		spec: chromeSpec,
	},
	{
		key: "thin_agent_spec",
		label: "thin agent-browser spec",
		description: "Missing proof probes and commands should block authoring.",
		spec: {
			...agentBrowserSpec,
			proof_surface: {
				dependency: "agent-browser executable",
				binding_probe: null,
				weak_signal_probe: null,
				risk_probes: [],
			},
			commands: { dependency: "command -v agent-browser" },
			notes: ["Simulates starting from package name only."],
		},
	},
	{
		key: "invented_vocabulary",
		label: "invented vocabulary",
		description: "Spec invents a local code that is not in the shared catalogue.",
		spec: {
			...agentBrowserSpec,
			emitted_diagnostics: [
				...agentBrowserSpec.emitted_diagnostics,
				"adapter_session_missing",
			],
			commands: {
				...agentBrowserSpec.commands,
				config: "agent-browser session pin --session $SESSION --cdp $PORT",
			},
			notes: ["Tests whether authoring catches new vocabulary."],
		},
	},
	{
		key: "complete_agent_spec",
		label: "complete agent-browser spec",
		description: "Same agent facts with a guessed config command filled in.",
		spec: {
			...agentBrowserSpec,
			commands: {
				...agentBrowserSpec.commands,
				config: "agent-browser session pin --session $SESSION --cdp $PORT",
			},
			notes: ["Command is speculative; use only to feel the authoring flow."],
		},
	},
];

function buildState(scenario: Scenario): PrototypeState {
	const draft = generateDraft(scenario.spec);
	return {
		throwaway: true,
		question,
		last_action: scenario.label,
		input_spec: scenario.spec,
		draft_map: draft,
		review: reviewDraft(scenario.spec, draft),
	};
}

function generateDraft(spec: AdapterAuthoringSpec): DraftMap {
	const recoveryMap: Record<string, RecoveryTarget> = {
		...localRecovery,
		...sharedActions,
	};
	for (const code of spec.emitted_diagnostics) {
		const entry = catalog[code];
		recoveryMap[code] = entry?.target ?? "inspect_adapter_config";
	}
	const sections = deriveSections(spec, recoveryMap);
	const commandTodos = (["dependency", "config", "inspect", "verify"] as const).filter(
		(slot) => !spec.commands[slot],
	);
	return {
		path: spec.map_path,
		sections,
		recovery_map: recoveryMap,
		command_todos: commandTodos,
		markdown_preview: renderMarkdownPreview(spec, recoveryMap, sections, commandTodos),
	};
}

function reviewDraft(
	spec: AdapterAuthoringSpec,
	draft: DraftMap,
): AuthoringReview {
	const missingSpecFields = [
		...(spec.proof_surface.dependency ? [] : ["proof_surface.dependency"]),
		...(spec.proof_surface.binding_probe ? [] : ["proof_surface.binding_probe"]),
		...(spec.proof_surface.weak_signal_probe
			? []
			: ["proof_surface.weak_signal_probe"]),
		...(spec.emitted_diagnostics.length > 0 ? [] : ["emitted_diagnostics"]),
	];
	const inventedDiagnostics = spec.emitted_diagnostics.filter(
		(code) => !catalog[code],
	);
	const missingCatalogDiagnostics = riskDiagnosticsForSpec(spec).filter(
		(code) => !spec.emitted_diagnostics.includes(code),
	);
	const duplicateRecoveryTargets = groupDiagnosticsByTarget(spec.emitted_diagnostics);
	const nextSafeActions = nextActions({
		missingSpecFields,
		missingCommands: draft.command_todos,
		inventedDiagnostics,
	});
	const readiness: Readiness =
		missingSpecFields.length > 0 || inventedDiagnostics.length > 0
			? "blocked_on_spec"
			: draft.command_todos.length > 0
				? "draft_with_todos"
				: "ready_to_draft";
	return {
		readiness,
		missing_spec_fields: missingSpecFields,
		missing_commands: draft.command_todos,
		invented_diagnostics: inventedDiagnostics,
		missing_catalog_diagnostics: missingCatalogDiagnostics,
		duplicate_recovery_targets: duplicateRecoveryTargets,
		suggested_section_placement: Object.fromEntries(
			spec.emitted_diagnostics.map((code) => [
				code,
				catalog[code]?.section ?? "Inspect",
			]),
		),
		next_safe_actions: nextSafeActions,
	};
}

function deriveSections(
	spec: AdapterAuthoringSpec,
	recoveryMap: Record<string, RecoveryTarget>,
): Section[] {
	const sections = new Set<Section>(requiredSections);
	for (const code of Object.keys(recoveryMap)) {
		const section = catalog[code]?.section;
		if (section) sections.add(section);
	}
	if (spec.commands.dependency) sections.add("Dependency");
	if (spec.commands.config) sections.add("Config");
	if (spec.commands.inspect) sections.add("Inspect");
	if (spec.commands.verify) sections.add("Verify");
	return [...sections].sort();
}

function renderMarkdownPreview(
	spec: AdapterAuthoringSpec,
	recoveryMap: Record<string, RecoveryTarget>,
	sections: Section[],
	commandTodos: CommandSlot[],
): string[] {
	return [
		`# Browser Adapter Map: ${spec.adapter_id}`,
		"",
		"## Owners",
		`- Proof runtime: \`${spec.owners.proof_runtime}\`.`,
		`- Proof CLI: \`${spec.owners.proof_cli}\`.`,
		`- Command contract: \`${spec.owners.command_contract}\`.`,
		"",
		"## Rules",
		"- Verify Warm Chrome first.",
		"- Follow the proof continuation.",
		"- Keep exact repair commands in adapter sections.",
		"",
		"## Recovery Map",
		...Object.entries(recoveryMap)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, target]) => `- \`${key}\`: use \`${target}\`.`),
		"",
		...commandSection("Dependency", sections, spec.commands.dependency),
		...commandSection("Config", sections, spec.commands.config),
		...commandSection("Inspect", sections, spec.commands.inspect),
		...textSection("Warnings", sections, warningsLine(spec)),
		...commandSection("Verify", sections, spec.commands.verify),
		...(commandTodos.length > 0
			? ["", "## TODO", ...commandTodos.map((slot) => `- Add ${slot} command.`)]
			: []),
	].slice(0, 80);
}

function commandSection(
	section: Section,
	sections: Section[],
	command: string | undefined,
): string[] {
	if (!sections.includes(section)) return [];
	return ["", `## ${section}`, command ? "```bash" : "- TODO.", ...(command ? [command, "```"] : [])];
}

function textSection(
	section: Section,
	sections: Section[],
	line: string | undefined,
): string[] {
	if (!sections.includes(section)) return [];
	return ["", `## ${section}`, line ? `- ${line}` : "- TODO."];
}

function warningsLine(spec: AdapterAuthoringSpec): string {
	const risks = spec.proof_surface.risk_probes;
	if (risks.length === 0) return "Record warning diagnostics from proof.";
	return `Record risk probes: ${risks.join(", ")}.`;
}

function riskDiagnosticsForSpec(spec: AdapterAuthoringSpec): string[] {
	const probes = spec.proof_surface.risk_probes.join(" ").toLowerCase();
	return [
		...(probes.includes("auto-launch") || probes.includes("auto launch")
			? ["adapter_auto_launch_risk"]
			: []),
		...(probes.includes("chrome for testing")
			? ["adapter_chrome_for_testing_risk"]
			: []),
	];
}

function groupDiagnosticsByTarget(
	codes: string[],
): Record<RecoveryTarget, string[]> {
	const groups: Partial<Record<RecoveryTarget, string[]>> = {};
	for (const code of codes) {
		const target = catalog[code]?.target ?? "inspect_adapter_config";
		groups[target] = [...(groups[target] ?? []), code];
	}
	return Object.fromEntries(
		Object.entries(groups).filter(([, values]) => values.length > 1),
	) as Record<RecoveryTarget, string[]>;
}

function nextActions(input: {
	missingSpecFields: string[];
	missingCommands: CommandSlot[];
	inventedDiagnostics: string[];
}): string[] {
	if (input.inventedDiagnostics.length > 0) {
		return [
			"Map invented diagnostics to existing catalogue codes, or add catalogue entries first.",
		];
	}
	if (input.missingSpecFields.length > 0) {
		return ["Fill proof-surface fields before drafting the map."];
	}
	if (input.missingCommands.length > 0) {
		return ["Draft map with TODO markers, then fill exact operator commands."];
	}
	return ["Review markdown preview, then write map source and run map validation."];
}

function renderState(state: PrototypeState, options: { clear: boolean }): void {
	if (options.clear) console.clear();
	console.log(bold("Browser Adapter Map authoring workbench"));
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
