import type {
	AgentHint,
	AgentHintForRecoverability,
	CliStructuredRuntimeErrorBuilderInput,
	RuntimeErrorRecoverability,
	RuntimeErrorSeverity,
} from "@side-quest/cli-command-facade";

/**
 * Retryable flag paired with the facade recoverability invariant.
 *
 * The facade validates this pair at runtime: `recoverability: "retry"` requires
 * `retryable: true`, and every other recoverability requires `retryable: false`.
 */
export type RuntimeErrorRetryability<
	TRecoverability extends RuntimeErrorRecoverability = RuntimeErrorRecoverability,
> = TRecoverability extends "retry"
	? { recoverability: "retry"; retryable: true }
	: { recoverability: TRecoverability; retryable: false };

/**
 * Return the discriminated recoverability/retryable pair expected by the facade.
 *
 * @param recoverability - Runtime repair lane selected by the command.
 * @returns A pair that satisfies `CliStructuredRuntimeErrorBuilderInput`.
 */
export function retryabilityForRecoverability(
	recoverability: "retry",
): RuntimeErrorRetryability<"retry">;
export function retryabilityForRecoverability<
	TRecoverability extends Exclude<RuntimeErrorRecoverability, "retry">,
>(recoverability: TRecoverability): RuntimeErrorRetryability<TRecoverability>;
export function retryabilityForRecoverability(
	recoverability: RuntimeErrorRecoverability,
): RuntimeErrorRetryability<RuntimeErrorRecoverability>;
export function retryabilityForRecoverability(
	recoverability: RuntimeErrorRecoverability,
): RuntimeErrorRetryability<RuntimeErrorRecoverability> {
	if (recoverability === "retry") {
		return { recoverability, retryable: true };
	}
	return { recoverability, retryable: false };
}

type RuntimeErrorInput = {
	run_id: string;
	code: string;
	message: string;
	exit_code: number;
	severity?: RuntimeErrorSeverity;
	recoverability: RuntimeErrorRecoverability;
	failure_domain?: string;
	hint?: AgentHint;
};

/**
 * Shape runtime-error builder input so hint action and retryability stay paired
 * with recoverability before the facade validates the envelope.
 */
export function structuredRuntimeErrorInput(
	input: RuntimeErrorInput,
): CliStructuredRuntimeErrorBuilderInput {
	switch (input.recoverability) {
		case "retry":
			return {
				...runtimeErrorBase(input),
				recoverability: "retry",
				retryable: true,
				...optionalHint("retry", input.hint),
			};
		case "change_input":
			return {
				...runtimeErrorBase(input),
				recoverability: "change_input",
				retryable: false,
				...optionalHint("change_input", input.hint),
			};
		case "authenticate":
			return {
				...runtimeErrorBase(input),
				recoverability: "authenticate",
				retryable: false,
				...optionalHint("authenticate", input.hint),
			};
		case "repair_state":
			return {
				...runtimeErrorBase(input),
				recoverability: "repair_state",
				retryable: false,
				...optionalHint("repair_state", input.hint),
			};
		case "contact_support":
			return {
				...runtimeErrorBase(input),
				recoverability: "contact_support",
				retryable: false,
				...optionalHint("contact_support", input.hint),
			};
		case "none":
			return {
				...runtimeErrorBase(input),
				recoverability: "none",
				retryable: false,
				...optionalHint("none", input.hint),
			};
	}
}

function runtimeErrorBase(input: RuntimeErrorInput): Omit<
	CliStructuredRuntimeErrorBuilderInput,
	"recoverability" | "retryable" | "hint"
> {
	return {
		run_id: input.run_id,
		code: input.code,
		message: input.message,
		exit_code: input.exit_code,
		...(input.severity ? { severity: input.severity } : {}),
		...(input.failure_domain ? { failure_domain: input.failure_domain } : {}),
	};
}

function optionalHint<TRecoverability extends RuntimeErrorRecoverability>(
	recoverability: TRecoverability,
	hint: AgentHint | undefined,
): { hint: AgentHintForRecoverability<TRecoverability> } | Record<string, never> {
	const compatibleHint = hintForRecoverability(recoverability, hint);
	return compatibleHint ? { hint: compatibleHint } : {};
}

function hintForRecoverability<TRecoverability extends RuntimeErrorRecoverability>(
	recoverability: TRecoverability,
	hint: AgentHint | undefined,
): AgentHintForRecoverability<TRecoverability> | undefined {
	if (!hint) return undefined;
	const compatibleAction = compatibleHintAction(recoverability, hint.action);
	return {
		summary: hint.summary,
		...(compatibleAction ? { action: compatibleAction } : {}),
		...(hint.docs_url ? { docs_url: hint.docs_url } : {}),
	} as AgentHintForRecoverability<TRecoverability>;
}

function compatibleHintAction<TRecoverability extends RuntimeErrorRecoverability>(
	recoverability: TRecoverability,
	action: AgentHint["action"] | undefined,
): AgentHintForRecoverability<TRecoverability>["action"] | undefined {
	if (!action) return undefined;
	switch (recoverability) {
		case "none":
			return (action === "contact_support" || action === "open_docs"
				? action
				: undefined) as AgentHintForRecoverability<TRecoverability>["action"];
		case "retry":
			return (action === "retry"
				? action
				: undefined) as AgentHintForRecoverability<TRecoverability>["action"];
		case "change_input":
			return (action === "change_input" || action === "open_docs"
				? action
				: undefined) as AgentHintForRecoverability<TRecoverability>["action"];
		case "authenticate":
			return (action === "authenticate" || action === "open_docs"
				? action
				: undefined) as AgentHintForRecoverability<TRecoverability>["action"];
		case "repair_state":
			return (action === "repair_state" || action === "open_docs"
				? action
				: undefined) as AgentHintForRecoverability<TRecoverability>["action"];
		case "contact_support":
			return (action === "contact_support" || action === "open_docs"
				? action
				: undefined) as AgentHintForRecoverability<TRecoverability>["action"];
	}
}
