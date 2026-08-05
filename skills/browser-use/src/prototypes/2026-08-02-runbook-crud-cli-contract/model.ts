/** Contract variant being exercised by the throwaway CLI prototype. */
export type ContractVariant = "plan" | "resolved";

/** One in-memory runbook shape sufficient to expose CRUD semantics. */
export type PrototypeRunbook = {
	service: string;
	flow: string;
	summary: string;
	origins: readonly string[];
	authContext?: string;
	stepCount: number;
};

/** Last simulated public-command outcome. */
export type PrototypeOutcome = {
	command: string;
	status: "accepted" | "preview" | "refused" | "unknown";
	exitCode: number;
	changed: boolean;
	message: string;
	nextAction?: string;
};

/** Complete state shown after every prototype action. */
export type PrototypeState = {
	variant: ContractVariant;
	runbook?: PrototypeRunbook;
	lastOutcome?: PrototypeOutcome;
};

/** User actions supported by the terminal driver. */
export type PrototypeAction =
	| "toggle-variant"
	| "create-minimal"
	| "create-valid"
	| "edit-summary"
	| "replace-origins"
	| "clear-auth-context"
	| "delete-preview"
	| "delete-force"
	| "reset";

const validRunbook: PrototypeRunbook = {
	service: "unifi",
	flow: "login",
	summary: "Sign in to UniFi OS.",
	origins: ["https://192.168.1.1"],
	authContext: "unifi-session",
	stepCount: 4,
};

/**
 * Apply one simulated CRUD action without filesystem effects.
 *
 * @param state - Current prototype catalog and selected contract variant.
 * @param action - One public CLI scenario to exercise.
 * @returns New state plus the full public-command outcome.
 *
 * @example
 * ```ts
 * const next = reducePrototype(initialPrototypeState(), "create-valid")
 * ```
 */
export function reducePrototype(
	state: PrototypeState,
	action: PrototypeAction,
): PrototypeState {
	if (action === "toggle-variant") {
		return initialPrototypeState(state.variant === "plan" ? "resolved" : "plan");
	}
	if (action === "reset") return initialPrototypeState(state.variant);
	return state.variant === "plan"
		? reducePlanContract(state, action)
		: reduceResolvedContract(state, action);
}

/**
 * Construct a clean prototype state.
 *
 * @param variant - Contract variant to show first.
 * @returns Empty in-memory catalog state.
 *
 * @example
 * ```ts
 * const state = initialPrototypeState("resolved")
 * ```
 */
export function initialPrototypeState(
	variant: ContractVariant = "plan",
): PrototypeState {
	return { variant };
}

function reducePlanContract(
	state: PrototypeState,
	action: Exclude<PrototypeAction, "toggle-variant" | "reset">,
): PrototypeState {
	switch (action) {
		case "create-minimal":
			return outcome(state, {
				command: "runbook create --service unifi --flow login",
				status: "refused",
				exitCode: 1,
				changed: false,
				message:
					"Parser accepts the advertised minimum, then validation rejects missing origins and steps.",
			});
		case "create-valid":
			return {
				variant: state.variant,
				runbook: validRunbook,
				lastOutcome: {
					command:
						"runbook create --service unifi --flow login --summary 'Sign in to UniFi OS.' --origin https://192.168.1.1 --auth-context unifi-session --from-json ./steps.json",
					status: "accepted",
					exitCode: 0,
					changed: true,
					message:
						"Creates a valid runbook, but --from-json does not reveal whether its value is a path, inline JSON, steps, or a full definition.",
				},
			};
		case "edit-summary":
			return outcome(state, {
				command:
					"runbook edit --service unifi --flow login --summary 'Local console sign-in.'",
				status: "unknown",
				exitCode: 2,
				changed: false,
				message:
					"The plan never states whether omitted origins, auth context, and steps are preserved or replaced.",
			});
		case "replace-origins":
			return outcome(state, {
				command:
					"runbook edit --service unifi --flow login --origin https://192.168.1.1",
				status: "unknown",
				exitCode: 2,
				changed: false,
				message: "Repeated --origin collection has no append-versus-replace contract.",
			});
		case "clear-auth-context":
			return outcome(state, {
				command: "runbook edit --service unifi --flow login",
				status: "refused",
				exitCode: 2,
				changed: false,
				message: "No declared syntax can clear an existing auth context.",
			});
		case "delete-preview":
			return outcome(state, {
				command: "runbook delete --service unifi --flow login",
				status: "refused",
				exitCode: 2,
				changed: false,
				message:
					"Parser-level confirmation refusal prevents the handler from emitting the preview promised by KTD4.",
			});
		case "delete-force":
			return {
				variant: state.variant,
				lastOutcome: {
					command: "runbook delete --service unifi --flow login --force",
					status: "accepted",
					exitCode: 0,
					changed: state.runbook !== undefined,
					message: "Deletes the repo-catalog runbook when present.",
				},
			};
	}
}

function reduceResolvedContract(
	state: PrototypeState,
	action: Exclude<PrototypeAction, "toggle-variant" | "reset">,
): PrototypeState {
	switch (action) {
		case "create-minimal":
			return outcome(state, {
				command: "runbook create --service unifi --flow login",
				status: "refused",
				exitCode: 2,
				changed: false,
				message:
					"Parser names the missing --summary, --origin, and --steps-file inputs before any write.",
				nextAction:
					"Add --summary <text> --origin <exact-origin> --steps-file <path>.",
			});
		case "create-valid":
			return {
				variant: state.variant,
				runbook: validRunbook,
				lastOutcome: {
					command:
						"runbook create --service unifi --flow login --summary 'Sign in to UniFi OS.' --origin https://192.168.1.1 --auth-context unifi-session --steps-file ./steps.json",
					status: "accepted",
					exitCode: 0,
					changed: true,
					message:
						"Creates, validates, and writes one runbook. --steps-file explicitly means a path containing the JSON step array.",
					nextAction: "Run build-dist before using the packaged binary.",
				},
			};
		case "edit-summary":
			if (!state.runbook) return missingTarget(state, "edit");
			return {
				...state,
				runbook: { ...state.runbook, summary: "Local console sign-in." },
				lastOutcome: {
					command:
						"runbook edit --service unifi --flow login --summary 'Local console sign-in.'",
					status: "accepted",
					exitCode: 0,
					changed: true,
					message: "Patch semantics: every omitted field is preserved.",
				},
			};
		case "replace-origins":
			if (!state.runbook) return missingTarget(state, "edit");
			return {
				...state,
				runbook: {
					...state.runbook,
					origins: ["https://192.168.1.1", "https://unifi.local"],
				},
				lastOutcome: {
					command:
						"runbook edit --service unifi --flow login --origin https://192.168.1.1 --origin https://unifi.local",
					status: "accepted",
					exitCode: 0,
					changed: true,
					message: "When present, repeated --origin replaces the complete origin set.",
				},
			};
		case "clear-auth-context":
			if (!state.runbook) return missingTarget(state, "edit");
			return {
				...state,
				runbook: { ...state.runbook, authContext: undefined },
				lastOutcome: {
					command:
						"runbook edit --service unifi --flow login --clear-auth-context",
					status: "accepted",
					exitCode: 0,
					changed: true,
					message:
						"Dedicated boolean distinguishes clear from preserve; conflicts with --auth-context.",
				},
			};
		case "delete-preview":
			return outcome(state, {
				command: "runbook delete --service unifi --flow login",
				status: "preview",
				exitCode: 0,
				changed: false,
				message:
					"Handler reports the exact repo-catalog path and changed:false without deleting.",
				nextAction:
					"Rerun the same command with --force after reviewing the target.",
			});
		case "delete-force":
			return {
				variant: state.variant,
				lastOutcome: {
					command: "runbook delete --service unifi --flow login --force",
					status: "accepted",
					exitCode: 0,
					changed: state.runbook !== undefined,
					message:
						state.runbook === undefined
							? "Target absent; idempotent no-op with changed:false."
							: "Deletes the reviewed target and reports changed:true.",
				},
			};
	}
}

function outcome(
	state: PrototypeState,
	lastOutcome: PrototypeOutcome,
): PrototypeState {
	return { ...state, lastOutcome };
}

function missingTarget(
	state: PrototypeState,
	verb: "edit",
): PrototypeState {
	return outcome(state, {
		command: `runbook ${verb} --service unifi --flow login`,
		status: "refused",
		exitCode: 1,
		changed: false,
		message: "Repo-catalog target not found; no store-first fallback.",
	});
}
