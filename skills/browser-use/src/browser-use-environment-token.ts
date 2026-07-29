import { isAbsolute, join } from "node:path";

/** Fixed names shared with the native custody executable. */
const TOKEN_CUSTODY_DIRECTORY_NAME = "auth.nosync";
const TOKEN_FILE_NAME = "op-service-account-token";

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
		if (input.input === undefined || input.validator_fd === undefined) {
			throw new TypeError(
				"install and replace require an input channel and validator descriptor",
			);
		}
		if (input.input.kind === "stdin") {
			assertDescriptor(input.input.fd, "input fd");
			argv.push("--input-fd", String(input.input.fd));
			inheritedFds.push(input.input.fd);
		} else {
			argv.push("--hidden-tty");
		}
		assertDescriptor(input.validator_fd, "validator fd");
		argv.push("--validator-fd", String(input.validator_fd));
		inheritedFds.push(input.validator_fd);
	} else if (input.input !== undefined || input.validator_fd !== undefined) {
		throw new TypeError(
			"status, remove, and cleanup accept no input or validator descriptor",
		);
	}
	return {
		executable_path: input.executable_path,
		argv,
		inherited_fds: inheritedFds,
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
			cause: "staging-residue" | "removal-residue";
			next_action:
				| "cleanup-token-staging"
				| "complete-local-token-removal";
			remote_authority?: "may-remain-live";
	  }
	| {
			state: "blocked";
			cause: BrowserUseEnvironmentTokenCustodyCause;
			next_action: string;
	  }
	| {
			state: "installed" | "replaced";
			next_action: "validate-service-account";
	  }
	| {
			state: "removed" | "removed-sync-unproven";
			cause?: "parent-sync-failed";
			remote_authority: "may-remain-live";
			next_action: "revoke-service-account-token-remotely";
	  }
	| {
			state: "cleaned";
			remote_authority?: "may-remain-live";
			next_action:
				| "inspect-token-status"
				| "revoke-service-account-token-remotely";
	  };
