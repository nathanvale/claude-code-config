import {
	COMMAND_FACADE_SIDE_EFFECTS,
	type CommandFacadeSideEffect,
} from "./command-contract";
import {
	validateFailureDomain,
	validateNonEmptyProjectedText,
	validateNonEmptyString,
	validateOptionalDocsUrl,
} from "./runtime-text-safety";

export const RUNTIME_ERROR_SEVERITIES = [
	"info",
	"warning",
	"error",
	"fatal",
] as const;

export type RuntimeErrorSeverity = (typeof RUNTIME_ERROR_SEVERITIES)[number];

export const RUNTIME_ERROR_RECOVERABILITIES = [
	"none",
	"retry",
	"change_input",
	"authenticate",
	"repair_state",
	"contact_support",
] as const;

export type RuntimeErrorRecoverability =
	(typeof RUNTIME_ERROR_RECOVERABILITIES)[number];

export const AGENT_HINT_ACTIONS = [
	"retry",
	"change_input",
	"authenticate",
	"repair_state",
	"open_docs",
	"contact_support",
] as const;

export type AgentHintAction = (typeof AGENT_HINT_ACTIONS)[number];

export type AgentHint = {
	summary: string;
	action?: AgentHintAction;
	docs_url?: string;
};

type AgentHintActionByRecoverability = {
	none: "contact_support" | "open_docs";
	retry: "retry";
	change_input: "change_input" | "open_docs";
	authenticate: "authenticate" | "open_docs";
	repair_state: "repair_state" | "open_docs";
	contact_support: "contact_support" | "open_docs";
};

export type AgentHintActionForRecoverability<
	TRecoverability extends RuntimeErrorRecoverability,
> = AgentHintActionByRecoverability[TRecoverability];

export type AgentHintForRecoverability<
	TRecoverability extends RuntimeErrorRecoverability,
> = Omit<AgentHint, "action"> & {
	action?: AgentHintActionForRecoverability<TRecoverability>;
};

export type StructuredRuntimeError = {
	run_id: string;
	code: string;
	message: string;
	exit_code: number;
	severity: RuntimeErrorSeverity;
	recoverability: RuntimeErrorRecoverability;
	retryable: boolean;
	hint?: AgentHint;
	failure_domain?: string;
};

/**
 * Shared input for structured CLI runtime-error helper constructors.
 *
 * @example
 * ```typescript
 * const input: CliRuntimeErrorBuilderInput = {
 *   run_id: "run-1",
 *   code: "config_missing",
 *   message: "Config is missing.",
 *   exit_code: 1,
 * }
 * ```
 */
export type CliRuntimeErrorBuilderInput<
	TRecoverability extends RuntimeErrorRecoverability = RuntimeErrorRecoverability,
> = {
	run_id: string;
	code: string;
	message: string;
	exit_code: number;
	severity?: RuntimeErrorSeverity;
	hint?: AgentHintForRecoverability<TRecoverability>;
	failure_domain?: string;
};

export type CliUsageRuntimeErrorBuilderInput = Omit<
	CliRuntimeErrorBuilderInput<"change_input">,
	"code" | "exit_code"
> & {
	code?: string;
	exit_code?: 2;
};

/**
 * Input for callers that own the exact recoverability and retry semantics.
 *
 * @example
 * ```typescript
 * const input: CliStructuredRuntimeErrorBuilderInput = {
 *   run_id: "run-1",
 *   code: "temporary_unavailable",
 *   message: "Dependency unavailable.",
 *   exit_code: 1,
 *   recoverability: "retry",
 *   retryable: true,
 * }
 * ```
 */
export type CliStructuredRuntimeErrorBuilderInput = {
	[TRecoverability in RuntimeErrorRecoverability]: CliRuntimeErrorBuilderInput<TRecoverability> & {
		recoverability: TRecoverability;
		retryable: TRecoverability extends "retry" ? true : false;
	};
}[RuntimeErrorRecoverability];

export type RuntimeActionGuidance = {
	id: string;
	summary: string;
	side_effects: readonly CommandFacadeSideEffect[];
	docs_url?: string;
};

export type RuntimeRecoveryChoice = {
	id: string;
	label: string;
	summary: string;
	recoverability: RuntimeErrorRecoverability;
	action_id?: string;
	side_effects?: readonly CommandFacadeSideEffect[];
	docs_url?: string;
};

export type RuntimeContinuationConstraint = {
	id: string;
	summary: string;
	forbidden_action_ids?: readonly string[];
	forbidden_side_effects?: readonly CommandFacadeSideEffect[];
};

export type RuntimeContinuationGuidance = {
	next_action_id?: string;
	requires_operator?: boolean;
	constraints?: readonly RuntimeContinuationConstraint[];
	choices?: readonly RuntimeRecoveryChoice[];
};

export const DIAGNOSTIC_TRAIL_SURFACE_KINDS = ["diagnostic_capability"] as const;

export type DiagnosticTrailSurfaceKind =
	(typeof DIAGNOSTIC_TRAIL_SURFACE_KINDS)[number];

export type DiagnosticTrailReference = {
	run_id: string;
	surface: {
		kind: DiagnosticTrailSurfaceKind;
		id: string;
	};
	summary?: string;
	docs_url?: string;
};

export type CliRuntimeSuccessEnvelope<TData = unknown> = {
	status: "ok";
	run_id: string;
	data: TData;
	runtime_actions?: readonly RuntimeActionGuidance[];
	continuation?: RuntimeContinuationGuidance;
	diagnostic_trail?: DiagnosticTrailReference;
};

export type CliRuntimeErrorEnvelope<TData = unknown> = {
	status: "error";
	run_id: string;
	data?: TData;
	error: StructuredRuntimeError;
	runtime_actions?: readonly RuntimeActionGuidance[];
	continuation?: RuntimeContinuationGuidance;
	diagnostic_trail?: DiagnosticTrailReference;
};

export class CliRuntimeContractError extends Error {
	constructor(readonly issues: readonly string[]) {
		super(issues.join("; "));
		this.name = "CliRuntimeContractError";
	}
}

export function createCliRuntimeSuccessEnvelope<TData>(input: {
	run_id: string;
	data: TData;
	runtime_actions?: readonly RuntimeActionGuidance[];
	continuation?: RuntimeContinuationGuidance;
	diagnostic_trail?: DiagnosticTrailReference;
}): CliRuntimeSuccessEnvelope<TData> {
	const issues = [
		...validateNonEmptyString("run_id", input.run_id),
		...validateOptionalRuntimeActions(input.runtime_actions),
			...validateOptionalRuntimeContinuation(input.continuation, {
				envelopeStatus: "ok",
				...(input.runtime_actions !== undefined
					? { runtimeActions: input.runtime_actions }
					: {}),
			}),
		...validateOptionalDiagnosticTrail(input.diagnostic_trail, {
			run_id: input.run_id,
		}),
	];
	throwIfRuntimeContractIssues(issues);
	return {
		status: "ok",
		run_id: input.run_id,
		data: input.data,
		...(input.runtime_actions
			? { runtime_actions: cloneRuntimeActions(input.runtime_actions) }
			: {}),
		...(input.continuation
			? { continuation: cloneRuntimeContinuation(input.continuation) }
			: {}),
		...(input.diagnostic_trail
			? { diagnostic_trail: cloneDiagnosticTrail(input.diagnostic_trail) }
			: {}),
	};
}

export function createCliRuntimeErrorEnvelope<TData = unknown>(input: {
	run_id: string;
	data?: TData;
	error: StructuredRuntimeError;
	process_exit_code: number;
	runtime_actions?: readonly RuntimeActionGuidance[];
	continuation?: RuntimeContinuationGuidance;
	diagnostic_trail?: DiagnosticTrailReference;
}): CliRuntimeErrorEnvelope<TData> {
	const issues = [
		...validateNonEmptyString("run_id", input.run_id),
		...validateProcessExitCode(input.process_exit_code),
		...validateStructuredRuntimeError(input.error, {
			run_id: input.run_id,
			process_exit_code: input.process_exit_code,
		}),
		...validateOptionalRuntimeActions(input.runtime_actions),
			...validateOptionalRuntimeContinuation(input.continuation, {
				envelopeStatus: "error",
				...(input.runtime_actions !== undefined
					? { runtimeActions: input.runtime_actions }
					: {}),
			}),
		...validateOptionalDiagnosticTrail(input.diagnostic_trail, {
			run_id: input.run_id,
		}),
	];
	throwIfRuntimeContractIssues(issues);
	return {
		status: "error",
		run_id: input.run_id,
		...(input.data !== undefined ? { data: input.data } : {}),
		error: cloneStructuredRuntimeError(input.error),
		...(input.runtime_actions
			? { runtime_actions: cloneRuntimeActions(input.runtime_actions) }
			: {}),
		...(input.continuation
			? { continuation: cloneRuntimeContinuation(input.continuation) }
			: {}),
		...(input.diagnostic_trail
			? { diagnostic_trail: cloneDiagnosticTrail(input.diagnostic_trail) }
			: {}),
	};
}

/**
 * Create a structured runtime error with package-owned recovery semantics.
 *
 * @param input - Complete structured-error builder input
 * @returns Validated structured runtime error
 * @throws When the structured error violates the runtime contract
 *
 * @example
 * ```typescript
 * const error = createCliRuntimeError({
 *   run_id: "run-1",
 *   code: "auth_required",
 *   message: "Authentication is required.",
 *   exit_code: 1,
 *   recoverability: "authenticate",
 *   retryable: false,
 * })
 * ```
 */
export function createCliRuntimeError(
	input: CliStructuredRuntimeErrorBuilderInput,
): StructuredRuntimeError {
	return createStructuredRuntimeError(input);
}

/**
 * Create a structured runtime error for caller-correctable usage failures.
 *
 * @param input - Error fields; `code` defaults to `usage_error`
 * @returns Validated change-input structured runtime error
 * @throws When the structured error violates the runtime contract
 *
 * @example
 * ```typescript
 * const error = createCliUsageRuntimeError({
 *   run_id: "run-1",
 *   message: "Missing --json.",
 *   exit_code: 2,
 * })
 * ```
 */
export function createCliUsageRuntimeError(
	input: CliUsageRuntimeErrorBuilderInput,
): StructuredRuntimeError {
	return createCliRuntimeError({
		...input,
		code: input.code ?? "usage_error",
		exit_code: 2,
		recoverability: "change_input",
		retryable: false,
	});
}

/**
 * Create a structured runtime error for repairable local state failures.
 *
 * @param input - Error fields for a repair-state failure
 * @returns Validated repair-state structured runtime error
 * @throws When the structured error violates the runtime contract
 *
 * @example
 * ```typescript
 * const error = createCliRepairStateRuntimeError({
 *   run_id: "run-1",
 *   code: "config_missing",
 *   message: "Config is missing.",
 *   exit_code: 1,
 * })
 * ```
 */
export function createCliRepairStateRuntimeError(
	input: CliRuntimeErrorBuilderInput<"repair_state">,
): StructuredRuntimeError {
	return createCliRuntimeError({
		...input,
		recoverability: "repair_state",
		retryable: false,
	});
}

/**
 * Create a structured runtime error for safe same-input retry failures.
 *
 * @param input - Error fields for a retryable failure
 * @returns Validated retry structured runtime error
 * @throws When the structured error violates the runtime contract
 *
 * @example
 * ```typescript
 * const error = createCliRetryRuntimeError({
 *   run_id: "run-1",
 *   code: "temporary_unavailable",
 *   message: "Dependency unavailable.",
 *   exit_code: 1,
 * })
 * ```
 */
export function createCliRetryRuntimeError(
	input: CliRuntimeErrorBuilderInput<"retry">,
): StructuredRuntimeError {
	return createCliRuntimeError({
		...input,
		recoverability: "retry",
		retryable: true,
	});
}

export function validateStructuredRuntimeError(
	error: unknown,
	options: { run_id?: string; process_exit_code?: number } = {},
): string[] {
	const issues: string[] = [];
	if (!isJsonObject(error)) {
		return ["error must be an object"];
	}

	issues.push(
		...validateAllowedKeys("error", error, [
			"run_id",
			"code",
			"message",
			"exit_code",
			"severity",
			"recoverability",
			"retryable",
			"hint",
			"failure_domain",
		]),
		...validateNonEmptyString("error.run_id", error.run_id),
		...validateNonEmptyString("error.code", error.code),
		...validateNonEmptyString("error.message", error.message),
	);

	if (options.run_id !== undefined && error.run_id !== options.run_id) {
		issues.push("error.run_id must match envelope run_id");
	}
	if (!Number.isInteger(error.exit_code) || Number(error.exit_code) < 0) {
		issues.push("error.exit_code must be a non-negative integer");
	}
	if (
		options.process_exit_code !== undefined &&
		error.exit_code !== options.process_exit_code
	) {
		issues.push("error.exit_code must match process_exit_code");
	}
	if (
		!RUNTIME_ERROR_SEVERITIES.includes(error.severity as RuntimeErrorSeverity)
	) {
		issues.push(
			`error.severity must be one of: ${RUNTIME_ERROR_SEVERITIES.join(", ")}`,
		);
	}
	if (
		!RUNTIME_ERROR_RECOVERABILITIES.includes(
			error.recoverability as RuntimeErrorRecoverability,
		)
	) {
		issues.push(
			`error.recoverability must be one of: ${RUNTIME_ERROR_RECOVERABILITIES.join(", ")}`,
		);
	}
	if (typeof error.retryable !== "boolean") {
		issues.push("error.retryable must be a boolean");
	}
	if (error.retryable === true && error.recoverability !== "retry") {
		issues.push("error.retryable true requires recoverability retry");
	}
	if (error.recoverability === "retry" && error.retryable !== true) {
		issues.push("error.recoverability retry requires retryable true");
	}
	if (error.failure_domain !== undefined) {
		issues.push(...validateFailureDomain(error.failure_domain));
	}
	if (error.hint !== undefined) {
		issues.push(
			...validateAgentHint(error.hint, {
				recoverability: error.recoverability as RuntimeErrorRecoverability,
			}),
		);
	}
	return issues;
}

function createStructuredRuntimeError(
	input: CliStructuredRuntimeErrorBuilderInput,
): StructuredRuntimeError {
	const error: StructuredRuntimeError = {
		run_id: input.run_id,
		code: input.code,
		message: input.message,
		exit_code: input.exit_code,
		severity: input.severity ?? "error",
		recoverability: input.recoverability,
		retryable: input.retryable,
		...(input.hint !== undefined ? { hint: input.hint } : {}),
		...(input.failure_domain !== undefined
			? { failure_domain: input.failure_domain }
			: {}),
	};
	throwIfRuntimeContractIssues(validateStructuredRuntimeError(error));
	return error;
}

export function validateAgentHint(
	hint: unknown,
	options: { recoverability?: RuntimeErrorRecoverability } = {},
): string[] {
	const issues: string[] = [];
	if (!isJsonObject(hint)) {
		return ["hint must be an object"];
	}
	issues.push(
		...validateAllowedKeys("hint", hint, ["summary", "action", "docs_url"]),
		...validateNonEmptyString("hint.summary", hint.summary),
	);
	if (hint.action !== undefined) {
		if (!AGENT_HINT_ACTIONS.includes(hint.action as AgentHintAction)) {
			issues.push(
				`hint.action must be one of: ${AGENT_HINT_ACTIONS.join(", ")}`,
			);
		} else if (
			options.recoverability &&
			!isAgentHintActionCompatible(
				hint.action as AgentHintAction,
				options.recoverability,
			)
		) {
			issues.push("hint.action must match or refine recoverability");
		}
	}
	if (hint.docs_url !== undefined) {
		issues.push(...validateOptionalDocsUrl("hint.docs_url", hint.docs_url));
	}
	return issues;
}

function throwIfRuntimeContractIssues(issues: readonly string[]): void {
	if (issues.length > 0) {
		throw new CliRuntimeContractError(issues);
	}
}

function validateProcessExitCode(value: unknown): string[] {
	if (!Number.isInteger(value) || Number(value) < 0) {
		return ["process_exit_code must be a non-negative integer"];
	}
	return [];
}

function validateAllowedKeys(
	path: string,
	value: Record<string, unknown>,
	allowedKeys: readonly string[],
): string[] {
	const allowed = new Set(allowedKeys);
	return Object.keys(value)
		.filter((key) => !allowed.has(key))
		.map((key) => `${path}.${key} is not a supported runtime-contract field`);
}

function validateOptionalRuntimeActions(
	actions: unknown,
	path = "runtime_actions",
): string[] {
	if (actions === undefined) return [];
	if (!Array.isArray(actions)) {
		return [`${path} must be an array`];
	}
	if (actions.length === 0) {
		return [`${path} must be omitted when no runtime actions are present`];
	}
	const ids = new Set<string>();
	return actions.flatMap((action, index) => {
		const actionPath = `${path}.${index}`;
		if (!isJsonObject(action)) {
			return [`${actionPath} must be an object`];
		}
		const issues = [
			...validateAllowedKeys(actionPath, action, [
				"id",
				"summary",
				"side_effects",
				"docs_url",
			]),
			...validateNonEmptyString(`${actionPath}.id`, action.id),
			...validateNonEmptyString(`${actionPath}.summary`, action.summary),
		];
		if (action.docs_url !== undefined) {
			issues.push(
				...validateOptionalDocsUrl(`${actionPath}.docs_url`, action.docs_url),
			);
		}
		if (typeof action.id === "string" && action.id.trim().length > 0) {
			if (ids.has(action.id)) {
				issues.push(`${actionPath}.id must be unique`);
			}
			ids.add(action.id);
		}
		if (!Array.isArray(action.side_effects)) {
			issues.push(`${actionPath}.side_effects must be an array`);
		} else if (action.side_effects.length === 0) {
			issues.push(`${actionPath}.side_effects must not be empty`);
		} else {
			for (const [
				sideEffectIndex,
				sideEffect,
			] of action.side_effects.entries()) {
				if (
					!COMMAND_FACADE_SIDE_EFFECTS.includes(
						sideEffect as CommandFacadeSideEffect,
					)
				) {
					issues.push(
						`${actionPath}.side_effects.${sideEffectIndex} must be one of: ${COMMAND_FACADE_SIDE_EFFECTS.join(", ")}`,
					);
				}
			}
		}
		return issues;
	});
}

function validateOptionalRuntimeContinuation(
	continuation: unknown,
	options: {
		envelopeStatus?: "ok" | "error";
		runtimeActions?: readonly RuntimeActionGuidance[];
	} = {},
	path = "continuation",
): string[] {
	const hasActions =
		Array.isArray(options.runtimeActions) && options.runtimeActions.length > 0;
	if (continuation === undefined) {
		return hasActions
			? [`${path} is required when runtime_actions is present`]
			: [];
	}
	if (!isJsonObject(continuation)) {
		return [`${path} must be an object`];
	}

	const issues = validateAllowedKeys(path, continuation, [
		"next_action_id",
		"requires_operator",
		"constraints",
		"choices",
	]);

	const hasNextAction = continuation.next_action_id !== undefined;
	const requiresOperator = continuation.requires_operator === true;
	const hasChoices = continuation.choices !== undefined;
	if (
		continuation.requires_operator !== undefined &&
		typeof continuation.requires_operator !== "boolean"
	) {
		issues.push(`${path}.requires_operator must be a boolean`);
	}
	if (hasNextAction === requiresOperator) {
		issues.push(
			`${path} must set exactly one of next_action_id or requires_operator`,
		);
	}
	if (hasNextAction) {
		issues.push(
			...validateNonEmptyString(
				`${path}.next_action_id`,
				continuation.next_action_id,
			),
		);
	}

	const {
		constraintIssues,
		forbiddenActionIds,
		forbiddenSideEffects,
		hasNonEmptySummary,
	} = validateRuntimeContinuationConstraints(continuation.constraints, path);
	issues.push(...constraintIssues);

	if (requiresOperator && !hasNonEmptySummary) {
		issues.push(
			`${path}.requires_operator requires at least one constraint summary`,
		);
	}
	if (hasChoices) {
		if (options.envelopeStatus !== "error") {
			issues.push(`${path}.choices is valid only on error envelopes`);
		}
		if (!requiresOperator) {
			issues.push(`${path}.choices requires requires_operator true`);
		}
		if (hasNextAction) {
			issues.push(`${path}.choices must not be used with ${path}.next_action_id`);
		}
			issues.push(
				...validateRuntimeRecoveryChoices(continuation.choices, {
					forbiddenActionIds,
					forbiddenSideEffects,
					...(options.runtimeActions !== undefined
						? { runtimeActions: options.runtimeActions }
						: {}),
					path,
				}),
			);
	}

	if (
		typeof continuation.next_action_id === "string" &&
		continuation.next_action_id.trim().length > 0
	) {
		const nextActionId = continuation.next_action_id;
		const primaryAction = options.runtimeActions?.find(
			(action) => action.id === nextActionId,
		);
		if (!primaryAction) {
			issues.push(
				`${path}.next_action_id must reference a runtime_actions[].id`,
			);
		}
		if (forbiddenActionIds.has(nextActionId)) {
			issues.push(
				`${path}.next_action_id must not appear in ${path}.constraints[].forbidden_action_ids`,
			);
		}
		if (
			Array.isArray(primaryAction?.side_effects) &&
			primaryAction.side_effects.some((sideEffect) =>
				forbiddenSideEffects.has(sideEffect),
			)
		) {
			issues.push(
				`${path} primary action must not use a side effect forbidden by ${path}.constraints`,
			);
		}
	}

	return issues;
}

function validateRuntimeRecoveryChoices(
	choices: unknown,
	options: {
		forbiddenActionIds: ReadonlySet<string>;
		forbiddenSideEffects: ReadonlySet<string>;
		runtimeActions?: readonly RuntimeActionGuidance[];
		path: string;
	},
): string[] {
	const path = `${options.path}.choices`;
	if (!Array.isArray(choices)) {
		return [`${path} must be an array`];
	}
	if (choices.length === 0) {
		return [`${path} must not be empty`];
	}

	const ids = new Set<string>();
	return choices.flatMap((choice, index) => {
		const choicePath = `${path}.${index}`;
		if (!isJsonObject(choice)) {
			return [`${choicePath} must be an object`];
		}

		const issues = [
			...validateAllowedKeys(choicePath, choice, [
				"id",
				"label",
				"summary",
				"recoverability",
				"action_id",
				"side_effects",
				"docs_url",
			]),
			...validateNonEmptyString(`${choicePath}.id`, choice.id),
			...validateNonEmptyProjectedText(`${choicePath}.label`, choice.label),
			...validateNonEmptyProjectedText(`${choicePath}.summary`, choice.summary),
			...validateRuntimeRecoveryChoiceRecoverability(
				`${choicePath}.recoverability`,
				choice.recoverability,
			),
		];

		if (choice.docs_url !== undefined) {
			issues.push(
				...validateOptionalDocsUrl(`${choicePath}.docs_url`, choice.docs_url),
			);
		}
		if (typeof choice.id === "string" && choice.id.trim().length > 0) {
			if (ids.has(choice.id)) {
				issues.push(`${choicePath}.id must be unique`);
			}
			ids.add(choice.id);
		}

		const hasActionId = choice.action_id !== undefined;
		if (hasActionId) {
			issues.push(
				...validateNonEmptyString(`${choicePath}.action_id`, choice.action_id),
			);
			if (choice.side_effects !== undefined) {
				issues.push(
					`${choicePath}.side_effects must be omitted when action_id is present`,
				);
			}
		} else if (choice.side_effects === undefined) {
			issues.push(`${choicePath}.side_effects is required without action_id`);
		}

		const directSideEffects = validateRuntimeRecoveryChoiceSideEffects(
			choice.side_effects,
			choicePath,
		);
		issues.push(...directSideEffects.issues);

		if (
			typeof choice.action_id === "string" &&
			choice.action_id.trim().length > 0
		) {
			const action = options.runtimeActions?.find(
				(runtimeAction) => runtimeAction.id === choice.action_id,
			);
			if (!options.runtimeActions || options.runtimeActions.length === 0) {
				issues.push(
					`${choicePath}.action_id requires emitted runtime_actions`,
				);
			} else if (!action) {
				issues.push(
					`${choicePath}.action_id must reference a runtime_actions[].id`,
				);
			}
			if (options.forbiddenActionIds.has(choice.action_id)) {
				issues.push(
					`${choicePath}.action_id must not appear in ${options.path}.constraints[].forbidden_action_ids`,
				);
			}
			if (
				Array.isArray(action?.side_effects) &&
				action.side_effects.some((sideEffect) =>
					options.forbiddenSideEffects.has(sideEffect),
				)
			) {
				issues.push(
					`${choicePath} must not use a side effect forbidden by ${options.path}.constraints`,
				);
			}
		} else if (
			directSideEffects.sideEffects.some((sideEffect) =>
				options.forbiddenSideEffects.has(sideEffect),
			)
		) {
			issues.push(
				`${choicePath} must not use a side effect forbidden by ${options.path}.constraints`,
			);
		}

		return issues;
	});
}

function validateRuntimeRecoveryChoiceRecoverability(
	path: string,
	value: unknown,
): string[] {
	if (
		!RUNTIME_ERROR_RECOVERABILITIES.includes(
			value as RuntimeErrorRecoverability,
		)
	) {
		return [
			`${path} must be one of: ${RUNTIME_ERROR_RECOVERABILITIES.join(", ")}`,
		];
	}
	return [];
}

function validateRuntimeRecoveryChoiceSideEffects(
	value: unknown,
	path: string,
): { issues: string[]; sideEffects: CommandFacadeSideEffect[] } {
	if (value === undefined) return { issues: [], sideEffects: [] };
	if (!Array.isArray(value)) {
		return {
			issues: [`${path}.side_effects must be an array`],
			sideEffects: [],
		};
	}
	if (value.length === 0) {
		return {
			issues: [`${path}.side_effects must not be empty`],
			sideEffects: [],
		};
	}

	const sideEffects: CommandFacadeSideEffect[] = [];
	const issues = value.flatMap((sideEffect, index) => {
		if (
			!COMMAND_FACADE_SIDE_EFFECTS.includes(
				sideEffect as CommandFacadeSideEffect,
			)
		) {
			return [
				`${path}.side_effects.${index} must be one of: ${COMMAND_FACADE_SIDE_EFFECTS.join(", ")}`,
			];
		}
		sideEffects.push(sideEffect as CommandFacadeSideEffect);
		return [];
	});
	return { issues, sideEffects };
}

function validateRuntimeContinuationConstraints(
	constraints: unknown,
	path: string,
): {
	constraintIssues: string[];
	forbiddenActionIds: Set<string>;
	forbiddenSideEffects: Set<string>;
	hasNonEmptySummary: boolean;
} {
	const forbiddenActionIds = new Set<string>();
	const forbiddenSideEffects = new Set<string>();
	if (constraints === undefined) {
		return {
			constraintIssues: [],
			forbiddenActionIds,
			forbiddenSideEffects,
			hasNonEmptySummary: false,
		};
	}
	if (!Array.isArray(constraints)) {
		return {
			constraintIssues: [`${path}.constraints must be an array`],
			forbiddenActionIds,
			forbiddenSideEffects,
			hasNonEmptySummary: false,
		};
	}
	const ids = new Set<string>();
	let hasNonEmptySummary = false;
	const constraintIssues = constraints.flatMap((constraint, index) => {
		const constraintPath = `${path}.constraints.${index}`;
		if (!isJsonObject(constraint)) {
			return [`${constraintPath} must be an object`];
		}
		const entryIssues = [
			...validateAllowedKeys(constraintPath, constraint, [
				"id",
				"summary",
				"forbidden_action_ids",
				"forbidden_side_effects",
			]),
			...validateNonEmptyString(`${constraintPath}.id`, constraint.id),
			...validateNonEmptyString(
				`${constraintPath}.summary`,
				constraint.summary,
			),
		];
		if (
			typeof constraint.summary === "string" &&
			constraint.summary.trim().length > 0
		) {
			hasNonEmptySummary = true;
		}
		if (typeof constraint.id === "string" && constraint.id.trim().length > 0) {
			if (ids.has(constraint.id)) {
				entryIssues.push(`${constraintPath}.id must be unique`);
			}
			ids.add(constraint.id);
		}
		entryIssues.push(
			...validateForbiddenActionIds(
				constraint.forbidden_action_ids,
				constraintPath,
				forbiddenActionIds,
			),
			...validateForbiddenSideEffects(
				constraint.forbidden_side_effects,
				constraintPath,
				forbiddenSideEffects,
			),
		);
		return entryIssues;
	});
	return {
		constraintIssues,
		forbiddenActionIds,
		forbiddenSideEffects,
		hasNonEmptySummary,
	};
}

function validateForbiddenActionIds(
	value: unknown,
	path: string,
	collected: Set<string>,
): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		return [`${path}.forbidden_action_ids must be an array`];
	}
	return value.flatMap((id, index) => {
		const idPath = `${path}.forbidden_action_ids.${index}`;
		const issues = validateNonEmptyString(idPath, id);
		if (typeof id === "string" && id.trim().length > 0) {
			collected.add(id);
		}
		return issues;
	});
}

function validateForbiddenSideEffects(
	value: unknown,
	path: string,
	collected: Set<string>,
): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		return [`${path}.forbidden_side_effects must be an array`];
	}
	return value.flatMap((sideEffect, index) => {
		if (
			!COMMAND_FACADE_SIDE_EFFECTS.includes(
				sideEffect as CommandFacadeSideEffect,
			)
		) {
			return [
				`${path}.forbidden_side_effects.${index} must be one of: ${COMMAND_FACADE_SIDE_EFFECTS.join(", ")}`,
			];
		}
		collected.add(sideEffect as string);
		return [];
	});
}

function validateOptionalDiagnosticTrail(
	trail: unknown,
	options: { run_id?: string } = {},
	path = "diagnostic_trail",
): string[] {
	if (trail === undefined) return [];
	if (!isJsonObject(trail)) {
		return [`${path} must be an object`];
	}
	const issues = [
		...validateAllowedKeys(path, trail, [
			"run_id",
			"surface",
			"summary",
			"docs_url",
		]),
		...validateNonEmptyString(`${path}.run_id`, trail.run_id),
	];
	if (
		options.run_id !== undefined &&
		typeof trail.run_id === "string" &&
		trail.run_id !== options.run_id
	) {
		issues.push(`${path}.run_id must match envelope run_id`);
	}
	if (!isJsonObject(trail.surface)) {
		issues.push(`${path}.surface must be an object`);
	} else {
		issues.push(
			...validateAllowedKeys(`${path}.surface`, trail.surface, ["kind", "id"]),
			...validateNonEmptyProjectedText(
				`${path}.surface.id`,
				trail.surface.id,
			),
		);
		if (
			!DIAGNOSTIC_TRAIL_SURFACE_KINDS.includes(
				trail.surface.kind as DiagnosticTrailSurfaceKind,
			)
		) {
			issues.push(
				`${path}.surface.kind must be one of: ${DIAGNOSTIC_TRAIL_SURFACE_KINDS.join(", ")}`,
			);
		}
	}
	if (trail.summary !== undefined) {
		issues.push(
			...validateNonEmptyProjectedText(`${path}.summary`, trail.summary),
		);
	}
	if (trail.docs_url !== undefined) {
		issues.push(...validateOptionalDocsUrl(`${path}.docs_url`, trail.docs_url));
	}
	return issues;
}

function isAgentHintActionCompatible(
	action: AgentHintAction,
	recoverability: RuntimeErrorRecoverability,
): boolean {
	if (action === "open_docs") {
		return recoverability !== "retry";
	}
	if (action === "contact_support") {
		return recoverability === "contact_support" || recoverability === "none";
	}
	return action === recoverability;
}

function cloneRuntimeActions(
	actions: readonly RuntimeActionGuidance[],
): RuntimeActionGuidance[] {
	return actions.map((action) => ({
		id: action.id,
		summary: action.summary,
		side_effects: [...action.side_effects],
		...(action.docs_url ? { docs_url: action.docs_url } : {}),
	}));
}

function cloneRuntimeContinuation(
	continuation: RuntimeContinuationGuidance,
): RuntimeContinuationGuidance {
	return {
		...(continuation.next_action_id !== undefined
			? { next_action_id: continuation.next_action_id }
			: {}),
		...(continuation.requires_operator !== undefined
			? { requires_operator: continuation.requires_operator }
			: {}),
		...(continuation.constraints
			? {
					constraints: continuation.constraints.map((constraint) => ({
						id: constraint.id,
						summary: constraint.summary,
						...(constraint.forbidden_action_ids
							? { forbidden_action_ids: [...constraint.forbidden_action_ids] }
							: {}),
						...(constraint.forbidden_side_effects
							? {
									forbidden_side_effects: [
										...constraint.forbidden_side_effects,
									],
								}
							: {}),
					})),
				}
			: {}),
		...(continuation.choices
			? {
					choices: continuation.choices.map((choice) => ({
						id: choice.id,
						label: choice.label,
						summary: choice.summary,
						recoverability: choice.recoverability,
						...(choice.action_id !== undefined
							? { action_id: choice.action_id }
							: {}),
						...(choice.side_effects
							? { side_effects: [...choice.side_effects] }
							: {}),
						...(choice.docs_url !== undefined
							? { docs_url: choice.docs_url }
							: {}),
					})),
				}
			: {}),
	};
}

function cloneDiagnosticTrail(
	trail: DiagnosticTrailReference,
): DiagnosticTrailReference {
	return {
		run_id: trail.run_id,
		surface: { kind: trail.surface.kind, id: trail.surface.id },
		...(trail.summary !== undefined ? { summary: trail.summary } : {}),
		...(trail.docs_url !== undefined ? { docs_url: trail.docs_url } : {}),
	};
}

function cloneStructuredRuntimeError(
	error: StructuredRuntimeError,
): StructuredRuntimeError {
	return {
		run_id: error.run_id,
		code: error.code,
		message: error.message,
		exit_code: error.exit_code,
		severity: error.severity,
		recoverability: error.recoverability,
		retryable: error.retryable,
		...(error.hint
			? {
					hint: {
						summary: error.hint.summary,
						...(error.hint.action ? { action: error.hint.action } : {}),
						...(error.hint.docs_url ? { docs_url: error.hint.docs_url } : {}),
					},
				}
			: {}),
		...(error.failure_domain ? { failure_domain: error.failure_domain } : {}),
	};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
