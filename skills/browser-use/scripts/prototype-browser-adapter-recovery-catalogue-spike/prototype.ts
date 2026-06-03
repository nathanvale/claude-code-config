#!/usr/bin/env bun
/*
 * PROTOTYPE - throwaway spike collation.
 *
 * Question:
 * Did the accidental RecoveryCatalogue production spike identify a useful
 * catalogue shape without proving it should be production code yet?
 *
 * Run:
 * bun skills/browser-use/scripts/prototype-browser-adapter-recovery-catalogue-spike/prototype.ts
 *
 * Notes:
 * skills/browser-use/scripts/prototype-browser-adapter-recovery-catalogue-spike/NOTES.md
 */

type RecoveryActionId =
	| "configure_adapter_dependency"
	| "update_adapter_config"
	| "inspect_adapter_config"
	| "change_adapter_input"
	| "use_verified_browser_adapter"
	| "warning_only";
type MapSection = "Dependency" | "Config" | "Inspect" | "Warnings" | "Verify";
type Severity = "blocking" | "warning";

type CatalogueEntry = {
	recovery_action_id: RecoveryActionId;
	map_section: MapSection;
	severity: Severity;
};

const diagnosticCodes = [
	"adapter_config_stale",
	"adapter_config_missing",
	"adapter_dependency_missing",
	"adapter_command_override_invalid",
	"adapter_binding_mismatch",
	"adapter_binding_ambiguous",
	"adapter_signal_weak",
	"adapter_chrome_for_testing_risk",
	"adapter_auto_launch_risk",
	"adapter_proof_timeout",
	"adapter_command_failed",
	"adapter_output_unparsable",
	"adapter_config_parse_error",
] as const;

const localRecoveryKeys = [
	"browser_entry_handoff",
	"missing_adapter",
	"unknown_adapter",
	"non_loopback_endpoint",
	"invalid_usage",
	"runtime_failure",
] as const;

const warmChromeFailureActionIds = [
	"launch_warm_chrome",
	"repair_profile",
	"enable_remote_debugging",
	"inspect_listener",
	"inspect_diagnostics",
	"change_input",
] as const;

const browserAdapterFailureActionIds = [
	...warmChromeFailureActionIds,
	"inspect_adapter_config",
	"configure_adapter_dependency",
	"update_adapter_config",
	"change_adapter_input",
] as const;

const browserAdapterSuccessActionIds = ["use_verified_browser_adapter"] as const;

const catalogue = {
	adapter_config_stale: {
		recovery_action_id: "update_adapter_config",
		map_section: "Config",
		severity: "blocking",
	},
	adapter_config_missing: {
		recovery_action_id: "update_adapter_config",
		map_section: "Config",
		severity: "blocking",
	},
	adapter_dependency_missing: {
		recovery_action_id: "configure_adapter_dependency",
		map_section: "Dependency",
		severity: "blocking",
	},
	adapter_command_override_invalid: {
		recovery_action_id: "configure_adapter_dependency",
		map_section: "Dependency",
		severity: "blocking",
	},
	adapter_binding_mismatch: {
		recovery_action_id: "update_adapter_config",
		map_section: "Config",
		severity: "blocking",
	},
	adapter_binding_ambiguous: {
		recovery_action_id: "inspect_adapter_config",
		map_section: "Inspect",
		severity: "blocking",
	},
	adapter_signal_weak: {
		recovery_action_id: "warning_only",
		map_section: "Warnings",
		severity: "warning",
	},
	adapter_chrome_for_testing_risk: {
		recovery_action_id: "inspect_adapter_config",
		map_section: "Warnings",
		severity: "blocking",
	},
	adapter_auto_launch_risk: {
		recovery_action_id: "inspect_adapter_config",
		map_section: "Warnings",
		severity: "blocking",
	},
	adapter_proof_timeout: {
		recovery_action_id: "inspect_adapter_config",
		map_section: "Inspect",
		severity: "blocking",
	},
	adapter_command_failed: {
		recovery_action_id: "inspect_adapter_config",
		map_section: "Inspect",
		severity: "blocking",
	},
	adapter_output_unparsable: {
		recovery_action_id: "inspect_adapter_config",
		map_section: "Inspect",
		severity: "blocking",
	},
	adapter_config_parse_error: {
		recovery_action_id: "inspect_adapter_config",
		map_section: "Inspect",
		severity: "blocking",
	},
} satisfies Record<(typeof diagnosticCodes)[number], CatalogueEntry>;

function expectedRecoveryMapKeys(): string[] {
	const warmChromeActions = new Set(warmChromeFailureActionIds);
	const adapterActions = browserAdapterFailureActionIds.filter(
		(action) => !warmChromeActions.has(action),
	);
	return uniqueSorted([
		...adapterActions,
		...browserAdapterSuccessActionIds,
		...diagnosticCodes,
		...localRecoveryKeys,
	]);
}

function bySection(): Record<MapSection, string[]> {
	const sections: Record<MapSection, string[]> = {
		Dependency: [],
		Config: [],
		Inspect: [],
		Warnings: [],
		Verify: [],
	};
	for (const [code, entry] of Object.entries(catalogue)) {
		sections[entry.map_section].push(
			`${code} -> ${entry.recovery_action_id} (${entry.severity})`,
		);
	}
	return Object.fromEntries(
		Object.entries(sections).map(([section, values]) => [
			section,
			uniqueSorted(values),
		]),
	) as Record<MapSection, string[]>;
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

console.log(
	JSON.stringify(
		{
			throwaway: true,
			question:
				"Does the RecoveryCatalogue shape earn future production depth?",
			answer:
				"Candidate only. Keep as spike until two real adapter maps need it.",
			expected_recovery_map_keys: expectedRecoveryMapKeys(),
			catalogue_by_section: bySection(),
			risks: [
				"production module before real second adapter facts",
				"map checker contract owner undecided",
				"adapter-emitted coverage still hypothetical for agent-browser",
			],
			next_safe_action:
				"restore production wiring and revisit when agent-browser proof emits real diagnostics",
		},
		null,
		2,
	),
);

