import { validateNonEmptyProjectedText } from "./runtime-text-safety";

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

type CommandResultMetadataKey = "contract_id" | "schema_version";

type CommandResultInvalidPayloadBranch<TData extends object> =
	TData extends (...args: never[]) => unknown
		? true
		: TData extends readonly unknown[]
			? true
			: keyof TData extends never
				? true
				: string extends keyof TData
					? true
					: number extends keyof TData
						? true
						: symbol extends keyof TData
							? true
							: Extract<keyof TData, CommandResultMetadataKey> extends never
								? false
								: true;

/**
 * Package-owned command result payload before facade metadata is attached.
 *
 * The generic form accepts named object shapes and rejects facade-owned
 * metadata keys, broad dictionaries, arrays, functions, and empty objects even
 * when a consumer does not enable `exactOptionalPropertyTypes`.
 */
export type CommandResultPayload<TData extends object> = true extends (
	TData extends unknown ? CommandResultInvalidPayloadBranch<TData> : never
)
	? never
	: TData;

type CommandResultMetadata<
	TResultContract extends CommandFacadeResultContract = CommandFacadeResultContract,
> = {
	contract_id: TResultContract["id"];
} & (TResultContract extends { schema_version: infer TSchemaVersion }
	? { schema_version: TSchemaVersion }
	: { schema_version?: string | number });

/**
 * Command result payload after facade-owned metadata is attached.
 *
 * @example
 * ```typescript
 * type ReportResult = CommandResultData<{ total: number }>
 * ```
 */
export type CommandResultData<
	TData extends object,
	TResultContract extends CommandFacadeResultContract = CommandFacadeResultContract,
> = TData extends unknown
	? Omit<TData, CommandResultMetadataKey> &
			CommandResultMetadata<TResultContract>
	: never;

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

/**
 * Attach result-contract metadata to a package-owned command result payload.
 *
 * The helper accepts structured object payloads, reserves facade metadata keys,
 * and rejects non-plain objects before spreading into the emitted data shape.
 *
 * @param contract - Command facade contract that declares `resultContract`
 * @param data - Package-owned result payload without facade metadata keys
 * @returns Payload with `contract_id` and optional `schema_version`
 * @throws When the contract lacks result metadata or data is not plain
 *
 * @example
 * ```typescript
 * const data = createCommandResultData(reportContract, { total: 1 })
 * ```
 */
export function createCommandResultData<
	TData extends object,
	TResultContract extends CommandFacadeResultContract = CommandFacadeResultContract,
>(
	contract: { resultContract?: TResultContract },
	data: CommandResultPayload<TData>,
): CommandResultData<TData, TResultContract> {
	const resultContract = contract.resultContract;
	if (!resultContract) {
		throw new Error("Command result contract is required.");
	}
	assertValidCommandResultContract(resultContract);
	if (!isPlainCommandResultPayload(data)) {
		throw new Error("Command result data must be a plain object.");
	}
	if (hasOwn(data, "contract_id")) {
		throw new Error("Command result data must not define contract_id.");
	}
	if (hasOwn(data, "schema_version")) {
		throw new Error("Command result data must not define schema_version.");
	}

	return {
		...data,
		contract_id: resultContract.id,
		...(resultContract.schema_version !== undefined
			? { schema_version: resultContract.schema_version }
			: {}),
	} as unknown as CommandResultData<TData, TResultContract>;
}

function assertValidCommandResultContract(
	resultContract: CommandFacadeResultContract,
): void {
	const issues = validateNonEmptyProjectedText(
		"resultContract.id",
		resultContract.id,
	);
	if (resultContract.schema_version !== undefined) {
		if (typeof resultContract.schema_version === "string") {
			issues.push(
				...validateNonEmptyProjectedText(
					"resultContract.schema_version",
					resultContract.schema_version,
				),
			);
		} else if (typeof resultContract.schema_version === "number") {
			if (!Number.isFinite(resultContract.schema_version)) {
				issues.push("resultContract.schema_version must be a finite number");
			}
		} else {
			issues.push(
				"resultContract.schema_version must be a string or number.",
			);
		}
	}
	if (issues.length > 0) {
		throw new Error(`Invalid command result contract: ${issues.join("; ")}`);
	}
}

function isPlainCommandResultPayload(value: unknown): value is object {
	if (value === null || typeof value !== "object") return false;
	if (Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: object, key: string): boolean {
	return Object.hasOwn(value, key);
}

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
	TContract extends CommandFacadeContract<string, string, string>,
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
