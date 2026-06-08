import { findBaselineExitCodeDrift } from "./baseline-exit-drift";
import {
	COMMAND_FACADE_CAPABILITY_ROLES,
	COMMAND_FACADE_EXECUTION_MODES,
	COMMAND_FACADE_INTERACTIVITY,
	COMMAND_FACADE_OUTPUT_MODES,
	COMMAND_FACADE_SIDE_EFFECTS,
	type CommandDiscoveryActionAffordance,
	type CommandDiscoveryActionAffordances,
	type CommandDiscoveryAugment,
	type CommandDiscoveryCommand,
	type CommandDiscoveryFlag,
	type CommandDiscoveryResultContract,
	type CommandDiscoveryTree,
	type CommandFacadeActionAffordances,
	type CommandFacadeContract,
	type CommandFacadeFlag,
	type CommandFacadeMetadataDrift,
	type CommandFacadeResultContract,
	type ProjectCommandDiscoveryTreeOptions,
} from "./command-contract";
import {
	ENV_VAR_NAME_PATTERN,
	matchSensitiveEnvVarName,
	validateProjectedFreeText,
} from "./runtime-text-safety";

const COMMAND_DISCOVERY_CORE_KEYS = new Set<string>([
	"script",
	"summary",
	"json",
	"mutation",
	"audience",
	"side_effects",
	"execution_modes",
	"output_modes",
	"capability_roles",
	"interactivity",
	"env_vars",
	"result_contract",
	"action_affordances",
	"usage",
	"flags",
	"exit_codes",
	"alias_of",
	"default_args",
	"unified_route",
	"canonical_usage",
]);

export function projectCommandDiscoveryFlag(
	flag: CommandFacadeFlag,
	options: { includeDescription?: boolean } = {},
): CommandDiscoveryFlag {
	const description =
		(options.includeDescription ?? true) ? flag.description : undefined;
	if (flag.type === "boolean") {
		return {
			type: "boolean",
			...(description ? { description } : {}),
		};
	}
	if (flag.type === "enum") {
		return {
			type: "enum",
			values: [...flag.values],
			...(flag.required ? { required: true } : {}),
			...(description ? { description } : {}),
		};
	}
	return {
		type: flag.type,
		...(flag.required ? { required: true } : {}),
		...(description ? { description } : {}),
	};
}

export function projectCommandDiscoveryResultContract(
	resultContract: CommandFacadeResultContract,
): CommandDiscoveryResultContract {
	return { ...resultContract };
}

export function projectCommandDiscoveryActionAffordances(
	actionAffordances: CommandFacadeActionAffordances,
): CommandDiscoveryActionAffordances {
	return Object.fromEntries(
		Object.entries(actionAffordances).map(([group, actions]) => [
			group,
			actions.map((action) => ({
				id: action.id,
				summary: action.summary,
				side_effects: [...action.sideEffects],
			})),
		]),
	);
}

export function projectCommandDiscoveryTree<
	TCommand extends string,
	TContract extends CommandFacadeContract<TCommand, string, string>,
	TExtra extends CommandDiscoveryAugment = Record<never, never>,
>(
	contracts: readonly (readonly [TCommand, TContract])[],
	options: ProjectCommandDiscoveryTreeOptions<TCommand, TContract, TExtra> = {},
): CommandDiscoveryTree<
	TCommand,
	CommandDiscoveryCommand<TContract["audience"], TContract["mutation"]> & TExtra
> {
	const commands = Object.fromEntries(
		contracts
			.filter(
				([command, contract]) => options.include?.(command, contract) ?? true,
			)
			.map(([command, contract]) => {
				const alias = contract.alias
					? {
							alias_of: contract.alias.command,
							default_args: [...contract.alias.defaultArgs],
						}
					: {};
				const route = options.routesByCommand?.get(command);
				const canonicalUsage = options.canonicalUsageByCommand?.get(command);
				const augment = projectCommandDiscoveryAugment(
					command,
					options.augment?.(command, contract),
				);
				return [
					command,
					{
						script: contract.script,
						summary: contract.summary,
						json: contract.json,
						mutation: contract.mutation,
						audience: contract.audience,
						...(contract.sideEffects
							? { side_effects: [...contract.sideEffects] }
							: {}),
						...(contract.executionModes
							? { execution_modes: [...contract.executionModes] }
							: {}),
						...(contract.outputModes
							? { output_modes: [...contract.outputModes] }
							: {}),
						...(contract.capabilityRoles
							? { capability_roles: [...contract.capabilityRoles] }
							: {}),
						...(contract.interactivity
							? { interactivity: contract.interactivity }
							: {}),
						...(contract.envVars
							? {
									env_vars: contract.envVars.map((envVar) => ({
										name: envVar.name,
										...(envVar.required ? { required: true } : {}),
										...(envVar.secret ? { secret: true } : {}),
										...(envVar.description
											? { description: envVar.description }
											: {}),
									})),
								}
							: {}),
						...(contract.resultContract
							? {
									result_contract: projectCommandDiscoveryResultContract(
										contract.resultContract,
									),
								}
							: {}),
						...(contract.actionAffordances
							? {
									action_affordances: projectCommandDiscoveryActionAffordances(
										contract.actionAffordances,
									),
								}
							: {}),
						usage: [...contract.usage],
						flags: Object.fromEntries(
							Object.entries(contract.flags).map(([flag, metadata]) => [
								flag,
								projectCommandDiscoveryFlag(metadata, {
									includeDescription: options.includeFlagDescriptions,
								}),
							]),
						),
						exit_codes: { ...contract.exitCodes },
						...alias,
						...(route
							? {
									unified_route: {
										...route,
										route: [...route.route],
									},
								}
							: {}),
						...(canonicalUsage ? { canonical_usage: [...canonicalUsage] } : {}),
						...augment,
					},
				];
			}),
	) as Partial<
		Record<
			TCommand,
			CommandDiscoveryCommand<TContract["audience"], TContract["mutation"]> &
				TExtra
		>
	>;

	return { commands };
}

function projectCommandDiscoveryAugment<TExtra extends CommandDiscoveryAugment>(
	command: string,
	augment: TExtra | undefined,
): TExtra | Record<never, never> {
	if (!augment) return {};
	for (const key of Object.keys(augment)) {
		if (COMMAND_DISCOVERY_CORE_KEYS.has(key)) {
			throw new Error(
				`Command discovery augment for ${command} cannot override core field ${key}.`,
			);
		}
	}
	return augment;
}

export function findCommandDiscoveryTreeDrift(
	tree: CommandDiscoveryTree<string, CommandDiscoveryCommand>,
	options: { path?: string } = {},
): CommandFacadeMetadataDrift[] {
	const path = options.path ?? "command-discovery-tree";
	const routeOwners = new Map<string, string>();
	const allowedSideEffects = new Set<string>(COMMAND_FACADE_SIDE_EFFECTS);
	const allowedExecutionModes = new Set<string>(COMMAND_FACADE_EXECUTION_MODES);
	const allowedOutputModes = new Set<string>(COMMAND_FACADE_OUTPUT_MODES);
	const allowedCapabilityRoles = new Set<string>(
		COMMAND_FACADE_CAPABILITY_ROLES,
	);
	const allowedInteractivity = new Set<string>(COMMAND_FACADE_INTERACTIVITY);

	return Object.entries(tree.commands).flatMap(([command, entry]) => {
		if (!entry) return [];
		const drift: CommandFacadeMetadataDrift[] = [];
		for (const issue of validateProjectedFreeText(
			`${command}.summary`,
			entry.summary,
		)) {
			drift.push({
				category: "command-discovery-summary-unsafe-text",
				path,
				action: `Remove unsafe content from ${command} summary (${issue}).`,
			});
		}
		for (const [index, usageLine] of entry.usage.entries()) {
			for (const issue of validateProjectedFreeText(
				`${command}.usage[${index}]`,
				usageLine,
			)) {
				drift.push({
					category: "command-discovery-usage-unsafe-text",
					path,
					action: `Remove unsafe content from ${command} usage[${index}] (${issue}).`,
				});
			}
		}
		for (const sideEffect of entry.side_effects ?? []) {
			if (!allowedSideEffects.has(sideEffect)) {
				drift.push({
					category: "command-discovery-side-effect-invalid",
					path,
					action: `Use a known side effect for ${command}: ${[...allowedSideEffects].join(", ")}.`,
				});
			}
		}
		for (const executionMode of entry.execution_modes ?? []) {
			if (!allowedExecutionModes.has(executionMode)) {
				drift.push({
					category: "command-discovery-execution-mode-invalid",
					path,
					action: `Use a known execution mode for ${command}: ${[...allowedExecutionModes].join(", ")}.`,
				});
			}
		}
		for (const outputMode of entry.output_modes ?? []) {
			if (!allowedOutputModes.has(outputMode)) {
				drift.push({
					category: "command-discovery-output-mode-invalid",
					path,
					action: `Use a known output mode for ${command}: ${[...allowedOutputModes].join(", ")}.`,
				});
			}
		}
		for (const capabilityRole of entry.capability_roles ?? []) {
			if (!allowedCapabilityRoles.has(capabilityRole)) {
				drift.push({
					category: "command-discovery-capability-role-invalid",
					path,
					action: `Use a known capability role for ${command}: ${[...allowedCapabilityRoles].join(", ")}.`,
				});
			}
		}
		if (
			entry.interactivity !== undefined &&
			!allowedInteractivity.has(entry.interactivity)
		) {
			drift.push({
				category: "command-discovery-interactivity-invalid",
				path,
				action: `Use a known interactivity for ${command}: ${[...allowedInteractivity].join(", ")}.`,
			});
		}
		for (const envVar of entry.env_vars ?? []) {
			if (!ENV_VAR_NAME_PATTERN.test(envVar.name)) {
				drift.push({
					category: "command-discovery-env-var-name-invalid",
					path,
					action: `Environment variable name ${JSON.stringify(envVar.name)} for command ${command} must match ^[A-Z_][A-Z0-9_]*$.`,
				});
				continue;
			}
			if (matchSensitiveEnvVarName(envVar.name)) {
				drift.push({
					category: "command-discovery-env-var-name-sensitive",
					path,
					action: `Environment variable name ${envVar.name} for command ${command} implies a secret and must not be declared (it would leak into agent-facing discovery).`,
				});
			}
			if (envVar.description !== undefined) {
				for (const issue of validateProjectedFreeText(
					`${command}.env_vars.${envVar.name}.description`,
					envVar.description,
				)) {
					drift.push({
						category: "command-discovery-env-var-description-unsafe-text",
						path,
						action: `Remove unsafe content from ${command} env-var ${envVar.name} description (${issue}).`,
					});
				}
			}
		}
		for (const [flag, metadata] of Object.entries(entry.flags)) {
			if (!flag.startsWith("--")) {
				drift.push({
					category: "command-discovery-flag-name-invalid",
					path,
					action: `Rename ${command} flag ${flag} so it starts with --.`,
				});
			}
			if (metadata.type === "enum" && metadata.values.length === 0) {
				drift.push({
					category: "command-discovery-enum-flag-values-missing",
					path,
					action: `Add enum values for ${command} ${flag}.`,
				});
			}
			if (metadata.description !== undefined) {
				for (const issue of validateProjectedFreeText(
					`${command}.flags.${flag}.description`,
					metadata.description,
				)) {
					drift.push({
						category: "command-discovery-flag-description-unsafe-text",
						path,
						action: `Remove unsafe content from ${command} flag ${flag} description (${issue}).`,
					});
				}
			}
		}
		for (const [code, message] of Object.entries(entry.exit_codes)) {
			if (!/^\d+$/.test(code)) {
				drift.push({
					category: "command-discovery-exit-code-invalid",
					path,
					action: `Rename ${command} exit code ${code} to a numeric string.`,
				});
			}
			for (const issue of validateProjectedFreeText(
				`${command}.exit_codes.${code}`,
				message,
			)) {
				drift.push({
					category: "command-discovery-exit-code-unsafe-text",
					path,
					action: `Remove unsafe content from ${command} exit_codes.${code} (${issue}).`,
				});
			}
		}
		drift.push(
			...findBaselineExitCodeDrift({
				command,
				path,
				exitCodes: entry.exit_codes,
				discovery: true,
			}),
		);
		if (entry.alias_of && !tree.commands[entry.alias_of]) {
			drift.push({
				category: "command-discovery-alias-target-missing",
				path,
				action: `Point alias command ${command} at a command in the discovery tree, or exclude the alias from this projection.`,
			});
		}
		drift.push(
			...findCommandDiscoveryResultContractDrift({
				command,
				path,
				resultContract: entry.result_contract,
				actionAffordances: entry.action_affordances,
				allowedSideEffects,
			}),
		);
		if (entry.unified_route) {
			const existing = routeOwners.get(entry.unified_route.canonical);
			if (existing) {
				drift.push({
					category: "command-discovery-route-duplicate",
					path,
					action: `Route ${entry.unified_route.canonical} is projected by both ${existing} and ${command}.`,
				});
			} else {
				routeOwners.set(entry.unified_route.canonical, command);
			}
		}
		return drift;
	});
}

function findCommandDiscoveryResultContractDrift(input: {
	command: string;
	path: string;
	resultContract: CommandDiscoveryCommand["result_contract"];
	actionAffordances: CommandDiscoveryCommand["action_affordances"];
	allowedSideEffects: ReadonlySet<string>;
}): CommandFacadeMetadataDrift[] {
	const drift: CommandFacadeMetadataDrift[] = [];
	if (input.resultContract) {
		if (
			typeof input.resultContract.id !== "string" ||
			input.resultContract.id.trim().length === 0
		) {
			drift.push({
				category: "command-discovery-result-contract-id-invalid",
				path: input.path,
				action: `Give ${input.command} result_contract.id a non-empty string value.`,
			});
		}
		if (input.resultContract.kind !== undefined) {
			for (const issue of validateProjectedFreeText(
				`${input.command}.result_contract.kind`,
				input.resultContract.kind,
			)) {
				drift.push({
					category: "command-discovery-result-contract-kind-unsafe-text",
					path: input.path,
					action: `Remove unsafe content from ${input.command} result_contract.kind (${issue}).`,
				});
			}
		}
		if (
			input.resultContract.schema_version !== undefined &&
			typeof input.resultContract.schema_version !== "number"
		) {
			for (const issue of validateProjectedFreeText(
				`${input.command}.result_contract.schema_version`,
				input.resultContract.schema_version,
			)) {
				drift.push({
					category:
						"command-discovery-result-contract-schema-version-unsafe-text",
					path: input.path,
					action: `Remove unsafe content from ${input.command} result_contract.schema_version (${issue}).`,
				});
			}
		}
	}

	if (!input.actionAffordances) return drift;

	const actionOwners = new Map<string, string>();
	for (const [group, actions] of Object.entries(input.actionAffordances)) {
		if (!Array.isArray(actions)) {
			drift.push({
				category: "command-discovery-action-affordance-group-invalid",
				path: input.path,
				action: `Make ${input.command} action_affordances.${group} an array of action affordances.`,
			});
			continue;
		}
		for (const action of actions) {
			if (!isCommandDiscoveryActionRecord(action)) {
				drift.push({
					category: "command-discovery-action-affordance-invalid",
					path: input.path,
					action: `Make every ${input.command} action affordance in group ${group} an object.`,
				});
				continue;
			}
			if (typeof action.id !== "string" || action.id.trim().length === 0) {
				drift.push({
					category: "command-discovery-action-id-invalid",
					path: input.path,
					action: `Give every ${input.command} action affordance in group ${group} a non-empty id.`,
				});
			} else {
				const existingGroup = actionOwners.get(action.id);
				if (existingGroup) {
					drift.push({
						category: "command-discovery-action-id-duplicate",
						path: input.path,
						action: `Use unique action affordance ids for ${input.command}; ${action.id} appears in both ${existingGroup} and ${group}.`,
					});
				} else {
					actionOwners.set(action.id, group);
				}
			}
			if (
				typeof action.summary !== "string" ||
				action.summary.trim().length === 0
			) {
				drift.push({
					category: "command-discovery-action-summary-missing",
					path: input.path,
					action: `Add a short summary for ${input.command} action affordance ${action.id || "(missing id)"}.`,
				});
			} else {
				for (const issue of validateProjectedFreeText(
					`${input.command}.action_affordances.${group}.${action.id}.summary`,
					action.summary,
				)) {
					drift.push({
						category: "command-discovery-action-summary-unsafe-text",
						path: input.path,
						action: `Remove unsafe content from ${input.command} action affordance ${action.id || "(missing id)"} summary (${issue}).`,
					});
				}
			}
			for (const sideEffect of action.side_effects ?? []) {
				if (!input.allowedSideEffects.has(sideEffect)) {
					drift.push({
						category: "command-discovery-action-side-effect-invalid",
						path: input.path,
						action: `Use a known side effect for ${input.command} action affordance ${action.id || "(missing id)"}: ${[...input.allowedSideEffects].join(", ")}.`,
					});
				}
			}
			if ("command_template" in action) {
				drift.push({
					category: "command-discovery-action-command-template-unsupported",
					path: input.path,
					action: `Remove command_template from ${input.command} action affordance ${action.id || "(missing id)"}; command templates are not part of the current discovery grammar.`,
				});
			}
		}
	}
	return drift;
}

function isCommandDiscoveryActionRecord(
	value: unknown,
): value is Record<string, unknown> & CommandDiscoveryActionAffordance {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
