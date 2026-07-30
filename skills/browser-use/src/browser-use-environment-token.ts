import { isAbsolute, join } from "node:path";

/** Fixed names shared with the native custody executable. */
const TOKEN_CUSTODY_DIRECTORY_NAME = "auth.nosync";
const TOKEN_FILE_NAME = "op-service-account-token";
const NONINTERACTIVE_MUTATION_TIMEOUT_MS = 30_000;
const HIDDEN_TTY_LIFECYCLE_TIMEOUT_MS = 330_000;

/**
 * Fixed, secret-free custody paths beneath one admitted Browser Use config root.
 */
export type BrowserUseEnvironmentTokenPaths = {
	/** Owner-only directory containing the token and transient staging inode. */
	custody_dir: string;
	/** The only admitted service-account token pathname. */
	token_file: string;
	/** Prefix identifying crash residue that requires explicit cleanup. */
	staging_prefix: string;
};

/**
 * Derive the native custody paths without reading the filesystem.
 *
 * @param configRoot - Absolute Browser Use configuration root already resolved by the path owner
 * @returns Fixed custody directory, token file, and staging prefix
 * @throws {TypeError} When the root is not absolute
 *
 * @example
 * ```typescript
 * environmentTokenPathsFor("/Users/me/.config/browser-use")
 * ```
 */
export function environmentTokenPathsFor(
	configRoot: string,
): BrowserUseEnvironmentTokenPaths {
	if (!isAbsolute(configRoot)) {
		throw new TypeError("environment token config root must be absolute");
	}
	const custodyDir = join(configRoot, TOKEN_CUSTODY_DIRECTORY_NAME);
	const tokenFile = join(custodyDir, TOKEN_FILE_NAME);
	return {
		custody_dir: custodyDir,
		token_file: tokenFile,
		staging_prefix: join(custodyDir, `.${TOKEN_FILE_NAME}.stage.`),
	};
}

/** Native custody lifecycle actions available to a TypeScript caller. */
export type BrowserUseEnvironmentTokenCustodyAction =
	| "status"
	| "install"
	| "replace"
	| "remove"
	| "cleanup";

/** Secret-free launch description for the disposable native executable. */
export type BrowserUseEnvironmentTokenCustodyInvocation = {
	/** Absolute installed executable path. */
	executable_path: string;
	/** Arguments containing only action, fixed path, and descriptor numbers. */
	argv: readonly string[];
	/** Exact descriptors the launcher keeps open in the child. */
	inherited_fds: readonly number[];
	/** Extended bounded deadline for an interactive hidden-terminal mutation. */
	timeout_ms?: number;
};

/** Explicit non-environment input source for an install or replacement. */
export type BrowserUseEnvironmentTokenInput =
	| { kind: "stdin"; fd: number }
	| { kind: "tty" };

/** Inputs accepted by the secret-free native invocation builder. */
export type BrowserUseEnvironmentTokenCustodyInvocationInput = {
	/** Absolute path discovered from the installed package. */
	executable_path: string;
	/** Requested lifecycle action. */
	action: BrowserUseEnvironmentTokenCustodyAction;
	/** Admitted Browser Use config root. */
	config_root: string;
	/** Install/replace input channel; never the token value. */
	input?: BrowserUseEnvironmentTokenInput;
	/** Full-duplex Unix socket used for descriptor-only validation. */
	validator_fd?: number;
	/** Installed native validator used when custody creates the private socket. */
	validator_executable_path?: string;
	/** Fixed official OP executable the native validator admits. */
	op_executable_path?: string;
};

function assertDescriptor(fd: number, name: string): void {
	if (!Number.isSafeInteger(fd) || fd < 0) {
		throw new TypeError(`${name} must be a non-negative descriptor`);
	}
}

/**
 * Build the only TypeScript-to-custody launch form.
 *
 * Unknown keys are refused so callers cannot smuggle a token through an
 * untyped argv or environment option. Token entry remains inside the native
 * process through an inherited descriptor or its hidden controlling TTY.
 *
 * @param input - Action, fixed paths, and descriptor numbers
 * @returns Secret-free executable launch description
 * @throws {TypeError} For relative paths, unsupported keys, or invalid action descriptors
 *
 * @example
 * ```typescript
 * buildEnvironmentTokenCustodyInvocation({
 *   executable_path: "/opt/browser-use/bin/browser-use-token-custody",
 *   action: "status",
 *   config_root: "/Users/me/.config/browser-use",
 * })
 * ```
 */
export function buildEnvironmentTokenCustodyInvocation(
	input: BrowserUseEnvironmentTokenCustodyInvocationInput,
): BrowserUseEnvironmentTokenCustodyInvocation {
	const allowedKeys = new Set([
		"executable_path",
		"action",
		"config_root",
		"input",
		"validator_fd",
		"validator_executable_path",
		"op_executable_path",
	]);
	for (const key of Object.keys(input)) {
		if (!allowedKeys.has(key)) {
			throw new TypeError("unsupported token-bearing option");
		}
	}
	if (!isAbsolute(input.executable_path)) {
		throw new TypeError("custody executable path must be absolute");
	}
	environmentTokenPathsFor(input.config_root);

	const argv = [input.action, "--config-root", input.config_root];
	const inheritedFds: number[] = [];
	if (input.action === "install" || input.action === "replace") {
		const descriptorValidator = input.validator_fd !== undefined;
		const processValidator =
			input.validator_executable_path !== undefined &&
			input.op_executable_path !== undefined;
		if (
			input.input === undefined ||
			descriptorValidator === processValidator
		) {
			throw new TypeError(
				"install and replace require an input channel and exactly one validator form",
			);
		}
		if (input.input.kind === "stdin") {
			assertDescriptor(input.input.fd, "input fd");
			argv.push("--input-fd", String(input.input.fd));
			inheritedFds.push(input.input.fd);
		} else {
			argv.push("--hidden-tty");
		}
		if (descriptorValidator) {
			assertDescriptor(input.validator_fd as number, "validator fd");
			argv.push("--validator-fd", String(input.validator_fd));
			inheritedFds.push(input.validator_fd as number);
		} else {
			if (
				!isAbsolute(input.validator_executable_path as string) ||
				!isAbsolute(input.op_executable_path as string)
			) {
				throw new TypeError(
					"validator and OP executable paths must be absolute",
				);
			}
			argv.push(
				"--validator-executable",
				input.validator_executable_path as string,
				"--op-path",
				input.op_executable_path as string,
			);
		}
	} else if (
		input.input !== undefined ||
		input.validator_fd !== undefined ||
		input.validator_executable_path !== undefined ||
		input.op_executable_path !== undefined
	) {
		throw new TypeError(
			"status, remove, and cleanup accept no input or validator",
		);
	}
	return {
		executable_path: input.executable_path,
		argv,
		inherited_fds: inheritedFds,
		...(input.input === undefined
			? {}
			: {
					timeout_ms:
						input.input.kind === "tty"
							? HIDDEN_TTY_LIFECYCLE_TIMEOUT_MS
							: NONINTERACTIVE_MUTATION_TIMEOUT_MS,
				}),
	};
}

/** Native lifecycle state values mirrored for exhaustive public parsing. */
export const BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_STATES = [
	"missing",
	"ready",
	"installed",
	"replaced",
	"removed",
	"removed-sync-unproven",
	"cleaned",
	"cleanup-required",
	"blocked",
] as const;

/** Native lifecycle causes mirrored for exhaustive public parsing. */
export const BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_CAUSES = [
	"invalid-arguments",
	"unsafe-ancestry",
	"unsafe-config-root",
	"unsafe-custody-directory",
	"backup-exclusion-unproven",
	"sync-exclusion-unproven",
	"token-missing",
	"token-already-installed",
	"token-unsafe",
	"staging-residue",
	"removal-residue",
	"input-cancelled",
	"input-invalid",
	"write-failed",
	"validation-failed",
	"validation-timeout",
	"validation-unavailable",
	"path-identity-changed",
	"atomic-replace-failed",
	"cleanup-failed",
	"parent-sync-failed",
	"core-dump-disable-failed",
] as const;

/** Typed native refusal reason that never contains token bytes. */
export type BrowserUseEnvironmentTokenCustodyCause =
	(typeof BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_CAUSES)[number];

/**
 * Secret-free state emitted by the native custody executable.
 */
export type BrowserUseEnvironmentTokenCustodyState =
	| {
			state: "missing";
			next_action: "install-local-token";
	  }
	| {
			state: "ready";
			next_action: "validate-service-account";
	  }
	| {
			state: "cleanup-required";
			cause: "staging-residue";
			next_action: "cleanup-token-staging";
	  }
	| {
			state: "cleanup-required";
			cause: "removal-residue";
			next_action: "complete-local-token-removal";
			remote_authority: "may-remain-live";
	  }
	| {
			state: "blocked";
			cause: Exclude<
				BrowserUseEnvironmentTokenCustodyCause,
				"staging-residue" | "removal-residue"
			>;
			next_action: "repair-token-custody";
	  }
	| {
			state: "blocked";
			cause: "staging-residue";
			next_action: "cleanup-token-staging";
	  }
	| {
			state: "blocked";
			cause: "removal-residue";
			next_action: "complete-local-token-removal";
			remote_authority: "may-remain-live";
	  }
	| {
			state: "installed" | "replaced";
			next_action: "validate-service-account";
	  }
	| {
			state: "removed";
			remote_authority: "may-remain-live";
			next_action: "revoke-service-account-token-remotely";
	  }
	| {
			state: "removed-sync-unproven";
			cause: "parent-sync-failed";
			remote_authority: "may-remain-live";
			next_action: "revoke-service-account-token-remotely";
	  }
	| {
			state: "cleaned";
			next_action: "inspect-token-status";
	  }
	| {
			state: "cleaned";
			remote_authority: "may-remain-live";
			next_action: "revoke-service-account-token-remotely";
	  };

const CUSTODY_STATE_SET = new Set<string>(
	BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_STATES,
);
const CUSTODY_CAUSE_SET = new Set<string>(
	BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_CAUSES,
);
const CUSTODY_NEXT_ACTION_SET = new Set<string>([
	"install-local-token",
	"validate-service-account",
	"cleanup-token-staging",
	"complete-local-token-removal",
	"repair-token-custody",
	"revoke-service-account-token-remotely",
	"inspect-token-status",
]);

function hasExactKeys(
	candidate: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const keys = Object.keys(candidate);
	return (
		keys.length === expected.length &&
		keys.every((key) => expected.includes(key))
	);
}

/**
 * Parse the native lifecycle projection without accepting free-form output.
 *
 * @param value - Decoded JSON emitted by the native custody executable
 * @returns One exhaustively checked lifecycle state
 * @throws {TypeError} When the native projection is unknown or inconsistent
 *
 * @example
 * ```typescript
 * parseEnvironmentTokenCustodyState({
 *   state: "missing",
 *   next_action: "install-local-token",
 * })
 * ```
 */
export function parseEnvironmentTokenCustodyState(
	value: unknown,
): BrowserUseEnvironmentTokenCustodyState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError("native custody result must be an object");
	}
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.state !== "string" ||
		!CUSTODY_STATE_SET.has(candidate.state) ||
		typeof candidate.next_action !== "string" ||
		!CUSTODY_NEXT_ACTION_SET.has(candidate.next_action)
	) {
		throw new TypeError("native custody result has an unknown state or action");
	}
	if (
		candidate.cause !== undefined &&
		(typeof candidate.cause !== "string" ||
			!CUSTODY_CAUSE_SET.has(candidate.cause))
	) {
		throw new TypeError("native custody result has an unknown cause");
	}
	if (
		candidate.remote_authority !== undefined &&
		candidate.remote_authority !== "may-remain-live"
	) {
		throw new TypeError("native custody result has an unknown remote authority");
	}
	const allowedKeys = new Set([
		"state",
		"cause",
		"next_action",
		"remote_authority",
	]);
	if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) {
		throw new TypeError("native custody result contains an unsupported field");
	}
	switch (candidate.state) {
		case "missing":
			if (
				hasExactKeys(candidate, ["state", "next_action"]) &&
				candidate.next_action === "install-local-token"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			break;
		case "ready":
		case "installed":
		case "replaced":
			if (
				hasExactKeys(candidate, ["state", "next_action"]) &&
				candidate.next_action === "validate-service-account"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			break;
		case "cleanup-required":
			if (
				candidate.cause === "staging-residue" &&
				hasExactKeys(candidate, ["state", "cause", "next_action"]) &&
				candidate.next_action === "cleanup-token-staging"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			if (
				candidate.cause === "removal-residue" &&
				hasExactKeys(candidate, [
					"state",
					"cause",
					"next_action",
					"remote_authority",
				]) &&
				candidate.next_action === "complete-local-token-removal" &&
				candidate.remote_authority === "may-remain-live"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			break;
		case "blocked":
			if (
				candidate.cause === "staging-residue" &&
				hasExactKeys(candidate, ["state", "cause", "next_action"]) &&
				candidate.next_action === "cleanup-token-staging"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			if (
				candidate.cause === "removal-residue" &&
				hasExactKeys(candidate, [
					"state",
					"cause",
					"next_action",
					"remote_authority",
				]) &&
				candidate.next_action === "complete-local-token-removal" &&
				candidate.remote_authority === "may-remain-live"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			if (
				typeof candidate.cause === "string" &&
				candidate.cause !== "staging-residue" &&
				candidate.cause !== "removal-residue" &&
				hasExactKeys(candidate, ["state", "cause", "next_action"]) &&
				candidate.next_action === "repair-token-custody"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			break;
		case "removed":
			if (
				hasExactKeys(candidate, [
					"state",
					"next_action",
					"remote_authority",
				]) &&
				candidate.next_action ===
					"revoke-service-account-token-remotely" &&
				candidate.remote_authority === "may-remain-live"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			break;
		case "removed-sync-unproven":
			if (
				hasExactKeys(candidate, [
					"state",
					"cause",
					"next_action",
					"remote_authority",
				]) &&
				candidate.cause === "parent-sync-failed" &&
				candidate.next_action ===
					"revoke-service-account-token-remotely" &&
				candidate.remote_authority === "may-remain-live"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			break;
		case "cleaned":
			if (
				hasExactKeys(candidate, ["state", "next_action"]) &&
				candidate.next_action === "inspect-token-status"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			if (
				hasExactKeys(candidate, [
					"state",
					"next_action",
					"remote_authority",
				]) &&
				candidate.next_action ===
					"revoke-service-account-token-remotely" &&
				candidate.remote_authority === "may-remain-live"
			) {
				return candidate as BrowserUseEnvironmentTokenCustodyState;
			}
			break;
	}
	throw new TypeError("native custody result fields are inconsistent");
}
