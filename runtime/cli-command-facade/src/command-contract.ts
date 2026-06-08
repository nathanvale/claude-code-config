export const COMMAND_FACADE_AUDIENCES = [
	"agent",
	"operator",
	"smoke",
	"governance",
] as const;

export type CommandFacadeAudience = (typeof COMMAND_FACADE_AUDIENCES)[number];

export type CommandFacadeFlag =
	| {
			type: "boolean";
			description?: string;
	  }
	| {
			type: "string" | "path" | "json";
			required?: boolean;
			description?: string;
	  }
	| {
			type: "enum";
			values: readonly string[];
			required?: boolean;
			description?: string;
	  };

export type CommandFacadeAlias<TCommand extends string = string> = {
	command: TCommand;
	defaultArgs: readonly string[];
};

export const COMMAND_FACADE_SIDE_EFFECTS = [
	"read",
	"check",
	"write",
	"destructive",
	"auth",
	"network",
	"browser",
] as const;

export type CommandFacadeSideEffect =
	(typeof COMMAND_FACADE_SIDE_EFFECTS)[number];

export const COMMAND_FACADE_EXECUTION_MODES = [
	"normal",
	"check",
	"dry_run",
] as const;

export type CommandFacadeExecutionMode =
	(typeof COMMAND_FACADE_EXECUTION_MODES)[number];

export const COMMAND_FACADE_OUTPUT_MODES = ["json", "plain", "jsonl"] as const;

export type CommandFacadeOutputMode =
	(typeof COMMAND_FACADE_OUTPUT_MODES)[number];

/**
 * Baseline Exit Semantics: the minimum exit-code meanings every agent-native
 * command contract must declare (KTD4) — `0` success, `1` generic or runtime
 * failure, `2` invalid usage. Additional exit codes remain package-owned. The
 * facade requires these entries by default; it does not judge the message text
 * beyond the existing projected-free-text safety scan. This intentionally
 * supersedes the older create-cli reference wording that said the facade does
 * not judge whether exit codes are sensible.
 */
export const COMMAND_FACADE_BASELINE_EXIT_CODES = ["0", "1", "2"] as const;

export const COMMAND_FACADE_INTERACTIVITY = [
	"required",
	"optional",
	"none",
] as const;

export type CommandFacadeInteractivity =
	(typeof COMMAND_FACADE_INTERACTIVITY)[number];

/**
 * Command Capability Roles: package-agnostic discovery labels for a command's
 * generic role (KTD5). A role does not control the command's route name, key,
 * script path, or package meaning — it lets an agent find a command by what it
 * does rather than by a route taxonomy.
 *
 * `diagnostic` marks a Diagnostic Capability: a discoverable readiness command
 * across environment, auth, config, service reachability, or local dependencies.
 * `doctor` stays the preferred CLI spelling when a package has no established
 * diagnostic route, but the facade validates the role, never the command name.
 */
export const COMMAND_FACADE_CAPABILITY_ROLES = ["diagnostic"] as const;

export type CommandFacadeCapabilityRole =
	(typeof COMMAND_FACADE_CAPABILITY_ROLES)[number];

export type CommandFacadeResultContract = {
	id: string;
	kind?: string;
	schema_version?: string | number;
};

export type CommandFacadeEnvVar = {
	name: string;
	required?: boolean;
	secret?: boolean;
	description?: string;
};

export type CommandFacadeActionAffordance = {
	id: string;
	summary: string;
	sideEffects: readonly CommandFacadeSideEffect[];
};

export type CommandFacadeActionAffordances = Readonly<
	Record<string, readonly CommandFacadeActionAffordance[]>
>;

/**
 * The narrow escape hatch for Write Preview Capability (KTD7): a write or
 * destructive command that genuinely cannot offer a `check`/`dry_run` path
 * declares a package-owned `reason` instead. The reason is free text only and
 * is scanned for unsafe runtime-contract content; it deliberately carries no
 * idempotency, rollback, or confirmation policy — those stay package-owned and
 * out of this slice.
 */
export type CommandFacadePreviewExemption = {
	reason: string;
};

export type CommandFacadeContract<
	TCommand extends string = string,
	TAudience extends string = CommandFacadeAudience,
	TMutation extends string = string,
> = {
	script: string;
	summary: string;
	usage: readonly string[];
	json: boolean;
	audience: TAudience;
	mutation: TMutation;
	sideEffects?: readonly CommandFacadeSideEffect[];
	executionModes?: readonly CommandFacadeExecutionMode[];
	outputModes?: readonly CommandFacadeOutputMode[];
	capabilityRoles?: readonly CommandFacadeCapabilityRole[];
	previewExemption?: CommandFacadePreviewExemption;
	interactivity?: CommandFacadeInteractivity;
	envVars?: readonly CommandFacadeEnvVar[];
	resultContract?: CommandFacadeResultContract;
	actionAffordances?: CommandFacadeActionAffordances;
	flags: Record<string, CommandFacadeFlag>;
	exitCodes: Record<string, string>;
	alias?: CommandFacadeAlias<TCommand>;
};

export type CommandDiscoveryFlag =
	| {
			type: "boolean";
			description?: string;
	  }
	| {
			type: "string" | "path" | "json";
			required?: true;
			description?: string;
	  }
	| {
			type: "enum";
			values: readonly string[];
			required?: true;
			description?: string;
	  };

export type CommandDiscoveryRoute = {
	executable?: string;
	route: readonly string[];
	canonical: string;
};

export type CommandDiscoveryResultContract = CommandFacadeResultContract;

export type CommandDiscoveryActionAffordance = {
	id: string;
	summary: string;
	side_effects: readonly CommandFacadeSideEffect[];
};

export type CommandDiscoveryActionAffordances = Readonly<
	Record<string, readonly CommandDiscoveryActionAffordance[]>
>;

export type CommandDiscoveryCommand<
	TAudience extends string = string,
	TMutation extends string = string,
> = {
	script: string;
	summary: string;
	json: boolean;
	mutation: TMutation;
	audience: TAudience;
	side_effects?: readonly CommandFacadeSideEffect[];
	execution_modes?: readonly CommandFacadeExecutionMode[];
	output_modes?: readonly CommandFacadeOutputMode[];
	capability_roles?: readonly CommandFacadeCapabilityRole[];
	interactivity?: CommandFacadeInteractivity;
	env_vars?: readonly CommandFacadeEnvVar[];
	result_contract?: CommandDiscoveryResultContract;
	action_affordances?: CommandDiscoveryActionAffordances;
	usage: readonly string[];
	flags: Readonly<Record<string, CommandDiscoveryFlag>>;
	exit_codes: Readonly<Record<string, string>>;
	alias_of?: string;
	default_args?: readonly string[];
	unified_route?: CommandDiscoveryRoute;
	canonical_usage?: readonly string[];
};

export type CommandDiscoveryTree<
	TCommand extends string = string,
	TCommandEntry extends CommandDiscoveryCommand = CommandDiscoveryCommand,
> = {
	commands: Readonly<Partial<Record<TCommand, TCommandEntry>>>;
};

type CommandDiscoveryCoreKey = keyof CommandDiscoveryCommand;

export type CommandDiscoveryAugment = object & {
	[K in CommandDiscoveryCoreKey]?: never;
};

export type ProjectCommandDiscoveryTreeOptions<
	TCommand extends string,
	TContract extends CommandFacadeContract<TCommand, string, string>,
	TExtra extends CommandDiscoveryAugment,
> = {
	include?: (command: TCommand, contract: TContract) => boolean;
	includeFlagDescriptions?: boolean;
	routesByCommand?: ReadonlyMap<TCommand, CommandDiscoveryRoute>;
	canonicalUsageByCommand?: ReadonlyMap<TCommand, readonly string[]>;
	augment?: (command: TCommand, contract: TContract) => TExtra;
};

export type CommandFacadeMetadataDrift = {
	category: string;
	path: string;
	action: string;
};
