// ---------------------------------------------------------------------------
// Browser Use runtime port (the I/O seam).
//
// Every side effect the CLI performs — command execution, file reads/writes,
// directory creation, stdin — flows through this port so the discovery,
// selection, and operation assemblers stay pure and the driver owns all I/O
// (mirrors AdapterProofRuntime / prepare's read-then-assemble split). The
// default implementation binds the port to the real process; tests pass a
// capturing runtime.
// ---------------------------------------------------------------------------

import {
	closeSync,
	constants as fsConstants,
	existsSync,
	realpathSync,
	type Stats,
} from "node:fs";
import {
	type FileHandle,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, parse, sep } from "node:path";
import {
	type AdmissionRuntime,
	createNativeAbsentRuntime,
} from "@side-quest/browser-use-security";
import {
	type BrowserUseOpExecute,
	type BrowserUseTokenRetrievalPort,
	createOpTokenRetrievalPort,
} from "./browser-use-op";
import type { BrowserUseAuthAccessProvider } from "./browser-use-auth-access";
import type {
	BrowserUseAuthContext,
	BrowserUseItemBinding,
} from "./browser-use-auth-bindings";
import type { BrowserUseAuthenticatedStateProof } from "./browser-use-login-engine";
import {
	BROWSER_USE_APPROVAL_BROKER_ENV,
	type BrowserUseHumanIdentityAttestationDriver,
	createNativeHumanIdentityAttestationDriver,
} from "./browser-use-human-identity-attestation";
import {
	type BrowserUseReviewedActionApprovalVerifier,
	type BrowserUseReviewedActionVerifierIdentity,
	REVIEWED_ACTION_VERIFIER_CONTRACT,
	REVIEWED_ACTION_VERIFIER_FILE,
	REVIEWED_ACTION_VERIFIER_SCHEMA_VERSION,
	createP256ReviewedActionApprovalVerifier,
	reviewedActionVerifierIdentityIsValid,
} from "./browser-use-reviewed-action-approval";
import type { BrowserUseCdpObserverRequest } from "./browser-use-cdp-observer";
import type { BrowserUseDevToolsRequest } from "./browser-use-target-proof";
import {
	type BrowserUsePlatformFs,
	createDefaultPlatformFs,
	fullFsyncDurableFile,
	inspectBrowserUseRoot,
	resolveBrowserUsePaths,
} from "./browser-use-paths";
import { createEnvironmentTokenRetrievalPort } from "./browser-use-environment-op";
import {
	type McporterCommandInput,
	type McporterCommandResult,
	spawnMcporterCommand,
} from "./mcporter-transport";

/**
 * The native security seam the runtime factory queries to decide whether a real
 * Token Retrieval Port can be constructed (auth plan U3a/U3b, ADR 0028).
 *
 * `admission` is the injectable admission runtime from
 * `@side-quest/browser-use-security` — production wires
 * {@link createNativeAbsentRuntime}, which reports `native-capability-absent`
 * for every query until the signed native product exists. Only when
 * `verifyProduct()` returns `admitted` does the factory ask the seam for its
 * op-executor via {@link createTokenExecutor} and construct the port; on this
 * machine the product is unsigned/absent, so the executor is never requested and
 * `authTokenRetrieval` stays undefined (the public auth command then returns the
 * typed `native-capability-absent` evaluation, never a crash).
 *
 * `createTokenExecutor` is the in-process op-executor factory (library-import
 * precedent, never a shell-out): the signed product owns the real 1Password
 * custody path. The prod placeholder has no executor because it is never
 * admitted; the earned in-memory fake (tests) supplies both an `admitted`
 * verdict and a capturing executor so the present branch is driven end-to-end.
 * `createUserPresentAccessProvider`, when supplied by that admitted product,
 * owns one bounded desktop sign-in or biometric session and returns only a
 * transaction-scoped credential-delivery lease. It never grants Browser Use
 * vault administration or ambient `op` session authority.
 */
export type BrowserUseSecuritySeam = {
	admission: AdmissionRuntime;
	/**
	 * Yield the op-executor + opaque token handle the port drives. Only invoked
	 * after `admission.verifyProduct()` reports `admitted`, so an absent seam
	 * never reaches it.
	 */
	createTokenExecutor: () => {
		execute: BrowserUseOpExecute;
		token_handle_id: string;
	};
	/**
	 * Yield the bounded user-present fallback. Only invoked after native product
	 * admission. Absence is a supported, typed recovery state.
	 */
	createUserPresentAccessProvider?: () => BrowserUseAuthAccessProvider;
};

export type AuthTokenSupervisorInput =
	| { mode: "install"; input: "prompt" | "stdin"; replace: boolean }
	| {
			mode: "install";
			input: "source";
			replace: boolean;
			sourceRef: string;
	  }
	| { mode: "remove" }
	| { mode: "status" };

export type AuthTokenSupervisorResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/** Environment keys that can carry token authority and never enter auth children. */
export const AUTH_TOKEN_FORBIDDEN_ENV_KEYS = [
	"OP_SERVICE_ACCOUNT_TOKEN",
	"OP_CONNECT_HOST",
	"OP_CONNECT_TOKEN",
	"BROWSER_USE_TOKEN",
	"BROWSER_USE_OP_TOKEN",
] as const;

/** Spawn contract for bounded OP and supervisor children on the source-install path. */
export type AuthTokenProcessSpawnInput = {
	argv: readonly string[];
	env: Record<string, string | undefined>;
	stdin: "ignore" | "inherit" | number;
	stdout: "ignore" | "pipe" | number;
	stderr: "ignore" | "pipe";
	timeoutMs: number;
};

/** Minimal child handle exposing only bounded, non-token supervisor output streams. */
export type AuthTokenProcess = {
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
	exited: Promise<{
		exitCode: number | null;
		signalCode: NodeJS.Signals | null;
		spawnError?: boolean;
	}>;
	kill: () => void;
};

/** Injectable process spawn used to prove raw-fd wiring and scrubbed environments. */
export type AuthTokenProcessSpawn = (
	input: AuthTokenProcessSpawnInput,
) => AuthTokenProcess;

/** Raw kernel pipe endpoints used to keep source token bytes outside JavaScript streams. */
export type AuthTokenPipe = {
	readFd: number;
	writeFd: number;
	closeParent: () => void;
};

/** Injectable raw-pipe owner for the source-install process-boundary proof. */
export type AuthTokenPipeOpen = () => AuthTokenPipe;

const AUTH_TOKEN_SOURCE_REFERENCE_PATTERN =
	/^op:\/\/[^/?#]+\/[^/?#]+\/[^/?#]+$/;

function hasAsciiControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint <= 0x1f || codePoint === 0x7f) return true;
	}
	return false;
}

/**
 * Prove that a persisted token source names exactly one OP item field.
 *
 * @param value - Candidate source reference
 * @returns Whether the reference has exactly vault, item, and field segments
 *
 * @example
 * ```typescript
 * isAuthTokenSourceReference("op://vault/item/field")
 * ```
 */
export function isAuthTokenSourceReference(value: string): boolean {
	if (hasAsciiControlCharacter(value)) return false;
	const match = AUTH_TOKEN_SOURCE_REFERENCE_PATTERN.exec(value);
	return match?.[0] === value;
}

/** Typed source-file validation outcome; source bytes are exposed only for a validated pointer. */
export type AuthTokenSourceReadResult =
	| { status: "missing" }
	| { status: "present"; sourceRef: string }
	| {
			status: "blocked";
			cause: "source-file-unsafe" | "source-reference-invalid";
	  };

/** Typed result for the post-install atomic source-file write. */
export type AuthTokenSourceWriteResult =
	| { ok: true }
	| {
			ok: false;
			cause:
				| "source-file-unsafe"
				| "source-reference-invalid"
				| "source-write-failed";
	  };

const AUTH_TOKEN_CUSTODY_DIRECTORY = "auth.nosync";
const AUTH_TOKEN_SOURCE_FILE = "token-source.json";
const AUTH_TOKEN_SOURCE_MAXIMUM_BYTES = 4_096;
let authTokenSourceTempCounter = 0;

type AuthTokenSourcePaths = {
	configRoot: string;
	custodyDirectory: string;
	sourceFile: string;
};

function authTokenSourcePaths(
	env: Record<string, string | undefined>,
): AuthTokenSourcePaths | undefined {
	const paths = resolveBrowserUsePaths(env);
	if (!paths.ok) return undefined;
	const configRoot = paths.resolution.roots.config;
	const custodyDirectory = join(configRoot, AUTH_TOKEN_CUSTODY_DIRECTORY);
	return {
		configRoot,
		custodyDirectory,
		sourceFile: join(custodyDirectory, AUTH_TOKEN_SOURCE_FILE),
	};
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

function currentUserId(): number | undefined {
	return typeof process.geteuid === "function"
		? process.geteuid()
		: typeof process.getuid === "function"
			? process.getuid()
			: undefined;
}

async function proveAuthTokenSourceDirectories(
	paths: AuthTokenSourcePaths,
): Promise<"ready" | "missing" | "unsafe"> {
	const userId = currentUserId();
	if (userId === undefined) return "unsafe";
	const root = parse(paths.configRoot).root;
	if (root !== sep || !paths.configRoot.startsWith(root)) return "unsafe";
	const components = paths.configRoot
		.slice(root.length)
		.split(sep)
		.filter((component) => component !== "");
	let current: string = root;
	for (let index = 0; index < components.length; index += 1) {
		current = join(current, components[index] ?? "");
		let metadata: Stats;
		try {
			metadata = await lstat(current);
		} catch (error) {
			return isMissingFileError(error) ? "missing" : "unsafe";
		}
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) return "unsafe";
		const mode = metadata.mode & 0o777;
		if (index === components.length - 1) {
			if (metadata.uid !== userId || mode !== 0o700) return "unsafe";
		} else if (
			(metadata.uid !== 0 && metadata.uid !== userId) ||
			(mode & 0o022) !== 0
		) {
			return "unsafe";
		}
	}
	let custodyMetadata: Stats;
	try {
		custodyMetadata = await lstat(paths.custodyDirectory);
	} catch (error) {
		return isMissingFileError(error) ? "missing" : "unsafe";
	}
	if (
		custodyMetadata.isSymbolicLink() ||
		!custodyMetadata.isDirectory() ||
		custodyMetadata.uid !== userId ||
		(custodyMetadata.mode & 0o777) !== 0o700
	) {
		return "unsafe";
	}
	return "ready";
}

function sourceFileMetadataIsSafe(
	metadata: Stats,
): boolean {
	const userId = currentUserId();
	return (
		userId !== undefined &&
		!metadata.isSymbolicLink() &&
		metadata.isFile() &&
		metadata.uid === userId &&
		(metadata.mode & 0o777) === 0o600 &&
		metadata.nlink === 1 &&
		metadata.size > 0 &&
		metadata.size <= AUTH_TOKEN_SOURCE_MAXIMUM_BYTES
	);
}

async function readAuthTokenSource(
	env: Record<string, string | undefined>,
): Promise<AuthTokenSourceReadResult> {
	const paths = authTokenSourcePaths(env);
	if (paths === undefined) return { status: "blocked", cause: "source-file-unsafe" };
	const directoryState = await proveAuthTokenSourceDirectories(paths);
	if (directoryState === "missing") return { status: "missing" };
	if (directoryState === "unsafe") {
		return { status: "blocked", cause: "source-file-unsafe" };
	}
	let pathMetadata: Stats;
	try {
		pathMetadata = await lstat(paths.sourceFile);
	} catch (error) {
		return isMissingFileError(error)
			? { status: "missing" }
			: { status: "blocked", cause: "source-file-unsafe" };
	}
	if (!sourceFileMetadataIsSafe(pathMetadata)) {
		return { status: "blocked", cause: "source-file-unsafe" };
	}
	let handle: FileHandle | undefined;
	try {
		handle = await open(
			paths.sourceFile,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		);
		const descriptorMetadata = await handle.stat();
		if (
			!sourceFileMetadataIsSafe(descriptorMetadata) ||
			descriptorMetadata.dev !== pathMetadata.dev ||
			descriptorMetadata.ino !== pathMetadata.ino
		) {
			return { status: "blocked", cause: "source-file-unsafe" };
		}
		const contents = await handle.readFile({ encoding: "utf8" });
		const reproved = await lstat(paths.sourceFile);
		if (
			!sourceFileMetadataIsSafe(reproved) ||
			reproved.dev !== descriptorMetadata.dev ||
			reproved.ino !== descriptorMetadata.ino
		) {
			return { status: "blocked", cause: "source-file-unsafe" };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(contents);
		} catch {
			return { status: "blocked", cause: "source-reference-invalid" };
		}
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return { status: "blocked", cause: "source-reference-invalid" };
		}
		const keys = Object.keys(parsed);
		if (
			keys.length !== 2 ||
			!("schema_version" in parsed) ||
			!("source" in parsed)
		) {
			return { status: "blocked", cause: "source-reference-invalid" };
		}
		const record = parsed as Record<string, unknown>;
		if (
			record.schema_version !== 1 ||
			typeof record.source !== "string" ||
			!isAuthTokenSourceReference(record.source)
		) {
			return { status: "blocked", cause: "source-reference-invalid" };
		}
		return { status: "present", sourceRef: record.source };
	} catch {
		return { status: "blocked", cause: "source-file-unsafe" };
	} finally {
		await handle?.close().catch(() => {});
	}
}

async function writeAuthTokenSource(
	env: Record<string, string | undefined>,
	sourceRef: string,
): Promise<AuthTokenSourceWriteResult> {
	if (!isAuthTokenSourceReference(sourceRef)) {
		return { ok: false, cause: "source-reference-invalid" };
	}
	const paths = authTokenSourcePaths(env);
	if (paths === undefined) return { ok: false, cause: "source-file-unsafe" };
	if ((await proveAuthTokenSourceDirectories(paths)) !== "ready") {
		return { ok: false, cause: "source-file-unsafe" };
	}
	try {
		const existing = await lstat(paths.sourceFile).catch((error: unknown) => {
			if (isMissingFileError(error)) return undefined;
			throw error;
		});
		if (existing !== undefined && !sourceFileMetadataIsSafe(existing)) {
			return { ok: false, cause: "source-file-unsafe" };
		}
	} catch {
		return { ok: false, cause: "source-file-unsafe" };
	}
	const tempPath = join(
		dirname(paths.sourceFile),
		`.${AUTH_TOKEN_SOURCE_FILE}.tmp-${process.pid}-${authTokenSourceTempCounter++}`,
	);
	let tempExists = false;
	let handle: FileHandle | undefined;
	try {
		handle = await open(
			tempPath,
			fsConstants.O_WRONLY |
				fsConstants.O_CREAT |
				fsConstants.O_EXCL |
				fsConstants.O_NOFOLLOW,
			0o600,
		);
		tempExists = true;
		// Reapply owner-only mode so the file stays private under any process umask.
		await handle.chmod(0o600);
		await handle.writeFile(`${JSON.stringify({ schema_version: 1, source: sourceRef })}\n`, {
			encoding: "utf8",
		});
		await fullFsyncDurableFile(handle);
		await handle.close();
		handle = undefined;
		await rename(tempPath, paths.sourceFile);
		tempExists = false;
		const directoryHandle = await open(paths.custodyDirectory, fsConstants.O_RDONLY);
		try {
			await directoryHandle.sync();
		} finally {
			await directoryHandle.close();
		}
		const reproved = await readAuthTokenSource(env);
		return reproved.status === "present" && reproved.sourceRef === sourceRef
			? { ok: true }
			: {
					ok: false,
					cause:
						reproved.status === "blocked"
							? reproved.cause
							: "source-write-failed",
				};
	} catch {
		return { ok: false, cause: "source-write-failed" };
	} finally {
		await handle?.close().catch(() => {});
		if (tempExists) await unlink(tempPath).catch(() => {});
	}
}

async function removeAuthTokenSource(
	env: Record<string, string | undefined>,
): Promise<AuthTokenSourceWriteResult> {
	const paths = authTokenSourcePaths(env);
	if (paths === undefined) return { ok: false, cause: "source-file-unsafe" };
	if ((await proveAuthTokenSourceDirectories(paths)) !== "ready") {
		return { ok: false, cause: "source-file-unsafe" };
	}
	let metadata: Stats;
	try {
		metadata = await lstat(paths.sourceFile);
	} catch (error) {
		return isMissingFileError(error)
			? { ok: true }
			: { ok: false, cause: "source-file-unsafe" };
	}
	if (!sourceFileMetadataIsSafe(metadata)) {
		return { ok: false, cause: "source-file-unsafe" };
	}
	let handle: FileHandle | undefined;
	try {
		handle = await open(
			paths.sourceFile,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		);
		const descriptorMetadata = await handle.stat();
		if (
			!sourceFileMetadataIsSafe(descriptorMetadata) ||
			descriptorMetadata.dev !== metadata.dev ||
			descriptorMetadata.ino !== metadata.ino
		) {
			return { ok: false, cause: "source-file-unsafe" };
		}
		const reproved = await lstat(paths.sourceFile);
		if (
			!sourceFileMetadataIsSafe(reproved) ||
			reproved.dev !== descriptorMetadata.dev ||
			reproved.ino !== descriptorMetadata.ino
		) {
			return { ok: false, cause: "source-file-unsafe" };
		}
		await unlink(paths.sourceFile);
		const directoryHandle = await open(paths.custodyDirectory, fsConstants.O_RDONLY);
		try {
			await directoryHandle.sync();
		} finally {
			await directoryHandle.close();
		}
		return (await readAuthTokenSource(env)).status === "missing"
			? { ok: true }
			: { ok: false, cause: "source-write-failed" };
	} catch {
		return { ok: false, cause: "source-write-failed" };
	} finally {
		await handle?.close().catch(() => {});
	}
}

/**
 * The production security seam: native capability is absent until the signed
 * product exists (ADR 0028). `admission` always reports
 * `native-capability-absent`; `createTokenExecutor` is unreachable behind that
 * verdict and throws a typed error if a future miswiring ever calls it, so the
 * absent path can never silently mint a port over a non-existent executor.
 */
function createNativeAbsentSecuritySeam(): BrowserUseSecuritySeam {
	return {
		admission: createNativeAbsentRuntime(),
		createTokenExecutor: () => {
			throw new Error(
				"native token executor is absent; the signed Browser Use Security product is not installed.",
			);
		},
	};
}

/**
 * Construct the runtime's Token Retrieval Port ONLY when the native seam admits
 * the product. Any non-`admitted` verdict (including the default
 * `native-capability-absent`) leaves the port undefined so the auth command
 * keeps returning the typed absent state. Never throws: a seam probe that
 * rejects — whether the admission probe, `createTokenExecutor()`, or port
 * construction — is treated as absence, fail-closed. Executor/port construction
 * stays inside the guard so an admitted seam whose `createTokenExecutor()`
 * throws (the exact miswiring the native-absent seam's typed throw surfaces)
 * yields absence, never an escaping rejection the CLI awaits unguarded.
 */
async function resolveAuthTokenRetrieval(
	seam: BrowserUseSecuritySeam,
): Promise<BrowserUseTokenRetrievalPort | undefined> {
	try {
		const verdict = await seam.admission.verifyProduct();
		if (verdict.verdict !== "admitted") return undefined;
		const { execute, token_handle_id } = seam.createTokenExecutor();
		return createOpTokenRetrievalPort({ execute, token_handle_id });
	} catch {
		return undefined;
	}
}

/**
 * Resolve user-present confidential-delivery authority from the admitted
 * Browser Use Security owner. Never consults shell state or a generic secret
 * store workflow. Provider construction failure is treated as absence so the
 * transaction returns its typed recovery continuation.
 */
async function resolveUserPresentAuthAccess(
	seam: BrowserUseSecuritySeam,
): Promise<BrowserUseAuthAccessProvider | undefined> {
	if (seam.createUserPresentAccessProvider === undefined) return undefined;
	try {
		const verdict = await seam.admission.verifyProduct();
		if (verdict.verdict !== "admitted") return undefined;
		return seam.createUserPresentAccessProvider();
	} catch {
		return undefined;
	}
}

function environmentTokenRetrievalOf(
	runtime: BrowserUseRuntime,
): BrowserUseTokenRetrievalPort | undefined {
	const deps = environmentTokenSupervisorDeps(runtime.env);
	if (deps === undefined || deps.opPath === undefined) return undefined;
	return createEnvironmentTokenRetrievalPort({
		supervisorPath: deps.supervisorPath,
		opPath: deps.opPath,
		configRoot: deps.configRoot,
		realpath: (path) => runtime.platformFs.realpath(path),
	});
}

type BrowserUseReviewedActionApprovalVerifierIssue = {
	code:
		| "action_promotion_verifier_store_unsafe"
		| "action_promotion_verifier_identity_invalid";
	message: string;
};

type BrowserUseReviewedActionApprovalVerifierResolution =
	| {
			status: "ready";
			verifier: BrowserUseReviewedActionApprovalVerifier;
			identity: BrowserUseReviewedActionVerifierIdentity;
	  }
	| { status: "absent" }
	| { status: "rejected"; issue: BrowserUseReviewedActionApprovalVerifierIssue };

async function productionReviewedActionApprovalVerifierOf(
	runtime: BrowserUseRuntime,
): Promise<BrowserUseReviewedActionApprovalVerifierResolution> {
	const resolved = resolveBrowserUsePaths(runtime.env);
	if (!resolved.ok) {
		return {
			status: "rejected",
			issue: {
				code: "action_promotion_verifier_store_unsafe",
				message: "the Reviewed Action verifier config root could not be resolved safely.",
			},
		};
	}
	const configRoot = resolved.resolution.roots.config;
	const inspected = await inspectBrowserUseRoot(runtime.platformFs, {
		kind: "config",
		path: configRoot,
	});
	if (!inspected.ok) {
		return {
			status: "rejected",
			issue: {
				code: "action_promotion_verifier_store_unsafe",
				message: "the Reviewed Action verifier config root is not private and owner-controlled.",
			},
		};
	}
	if (!inspected.exists) return { status: "absent" };
	const canonicalConfigRoot = await runtime.platformFs.realpath(configRoot);
	if (canonicalConfigRoot === undefined) {
		return {
			status: "rejected",
			issue: {
				code: "action_promotion_verifier_store_unsafe",
				message: "the Reviewed Action verifier config root could not be canonicalized.",
			},
		};
	}
	const path = join(canonicalConfigRoot, REVIEWED_ACTION_VERIFIER_FILE);
	try {
		const stat = await runtime.platformFs.lstat(path);
		if (stat === undefined) return { status: "absent" };
		const processUid = process.getuid?.();
		if (
			stat.kind !== "file" ||
			(stat.mode & 0o077) !== 0 ||
			(processUid !== undefined && stat.uid !== processUid)
		) {
			return {
				status: "rejected",
				issue: {
					code: "action_promotion_verifier_store_unsafe",
					message: "the Reviewed Action verifier pin is not an owner-only regular file.",
				},
			};
		}
		const parsed = JSON.parse(
			await runtime.platformFs.readTextFile(path),
		) as Record<string, unknown>;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			Object.keys(parsed).sort().join("\0") !==
				["contract", "key_id", "public_key", "schema_version"]
					.sort()
					.join("\0") ||
			parsed.contract !== REVIEWED_ACTION_VERIFIER_CONTRACT ||
			parsed.schema_version !== REVIEWED_ACTION_VERIFIER_SCHEMA_VERSION ||
			typeof parsed.key_id !== "string" ||
			typeof parsed.public_key !== "string"
		) {
			return {
				status: "rejected",
				issue: {
					code: "action_promotion_verifier_identity_invalid",
					message: "the Reviewed Action verifier pin is malformed or carries an invalid identity.",
				},
			};
		}
		const identity = {
			key_id: parsed.key_id,
			public_key: parsed.public_key,
		};
		return reviewedActionVerifierIdentityIsValid(identity)
			? {
					status: "ready",
					verifier: createP256ReviewedActionApprovalVerifier(identity),
					identity,
				}
			: {
					status: "rejected",
					issue: {
						code: "action_promotion_verifier_identity_invalid",
						message: "the Reviewed Action verifier pin is malformed or carries an invalid identity.",
					},
				};
	} catch {
		return {
			status: "rejected",
			issue: {
				code: "action_promotion_verifier_identity_invalid",
				message: "the Reviewed Action verifier pin could not be parsed.",
			},
		};
	}
}

type EnvironmentTokenSupervisorDeps = {
	supervisorPath: string;
	opPath?: string;
	configRoot: string;
	profilePath: string;
};

/**
 * Resolve the one Warm Chrome profile path shared by custody evaluation and repair.
 *
 * @param env - Environment carrying the profile override and home directory
 * @returns Absolute profile path, or undefined when no safe home-based default exists
 *
 * @example
 * ```typescript
 * resolveWarmChromeProfilePath({ HOME: "/Users/agent" })
 * ```
 */
export function resolveWarmChromeProfilePath(
	env: Record<string, string | undefined>,
): string | undefined {
	const profileInput = env.WARM_CHROME_PROFILE_DIR;
	if (profileInput?.startsWith("/") === true) return profileInput;
	if (profileInput?.startsWith("~/") === true && env.HOME !== undefined) {
		return join(env.HOME, profileInput.slice(2));
	}
	return env.HOME === undefined
		? undefined
		: join(env.HOME, ".agent-warm-profile");
}

function environmentTokenSupervisorDeps(
	env: Record<string, string | undefined>,
): EnvironmentTokenSupervisorDeps | undefined {
	const paths = resolveBrowserUsePaths(env);
	if (!paths.ok) return undefined;
	const nativeBinRoot = import.meta.dir.endsWith("/dist")
		? join(import.meta.dir, "bin")
		: join(
				import.meta.dir,
				"..",
				"..",
				"..",
				"runtime",
				"browser-use-environment-auth",
				".build",
				"release",
			);
	const supervisorPath = join(nativeBinRoot, "browser-use-op-supervisor");
	if (!existsSync(supervisorPath)) return undefined;
	const opPaths =
		process.arch === "arm64"
			? ["/opt/homebrew/bin/op", "/usr/local/bin/op"]
			: ["/usr/local/bin/op", "/opt/homebrew/bin/op"];
	const profilePath = resolveWarmChromeProfilePath(env);
	if (profilePath === undefined) return undefined;
	return {
		supervisorPath,
		opPath: opPaths.find((path) => existsSync(path)),
		configRoot: paths.resolution.roots.config,
		profilePath,
	};
}

// Deadline for the non-interactive supervisor modes (`remove`, `status`): a
// hung supervisor must not block the CLI forever. `install` stays unbounded
// because it inherits stdin for the interactive token prompt.
const NON_INTERACTIVE_SUPERVISOR_TIMEOUT_MS = 30_000;
const OP_AUTH_CHECK_TIMEOUT_MS = 10_000;
const OP_SOURCE_FETCH_TIMEOUT_MS = 30_000;
const AUTH_TOKEN_SOURCE_RELOAD_SUPERVISOR_MARGIN_MS = 5_000;
const AUTH_TOKEN_SOURCE_RELOAD_OWNER_TIMEOUT_MAX_MS = 120_000;
export const AUTH_TOKEN_SOURCE_RELOAD_OWNER_TIMEOUT_MS = Math.min(
	AUTH_TOKEN_SOURCE_RELOAD_OWNER_TIMEOUT_MAX_MS,
	OP_AUTH_CHECK_TIMEOUT_MS +
		OP_SOURCE_FETCH_TIMEOUT_MS +
		NON_INTERACTIVE_SUPERVISOR_TIMEOUT_MS +
		AUTH_TOKEN_SOURCE_RELOAD_SUPERVISOR_MARGIN_MS,
);
const AUTH_TOKEN_CHILD_MAXIMUM_OUTPUT_BYTES = 1_048_576;

export const AUTH_TOKEN_SUPERVISOR_DEGRADED_ACTIONS = {
	"token-supervisor-unavailable": "build-token-supervisor",
	"op-path-unavailable": "install-op-cli",
	"unsafe-config-root": "repair-config-root",
	"token-supervisor-output-too-large": "repair-op-admission",
} as const;

export type AuthTokenSupervisorDegradedCause =
	keyof typeof AUTH_TOKEN_SUPERVISOR_DEGRADED_ACTIONS;

function authSupervisorUnavailable(
	code: AuthTokenSupervisorDegradedCause,
): AuthTokenSupervisorResult {
	return {
		exitCode: 20,
		stdout: JSON.stringify({
			schema_version: 1,
			ok: false,
			state: "blocked",
			cause: code,
			next_action: AUTH_TOKEN_SUPERVISOR_DEGRADED_ACTIONS[code],
		}),
		stderr: "",
	};
}

function authTokenSourceUnavailable(
	cause: "op-session-unavailable" | "source-fetch-failed",
): AuthTokenSupervisorResult {
	return {
		exitCode: 20,
		stdout: JSON.stringify({
			schema_version: 1,
			ok: false,
			state: "blocked",
			cause,
			next_action:
				cause === "op-session-unavailable"
					? "authenticate-op-session"
					: "install-token",
		}),
		stderr: "",
	};
}

function scrubAuthTokenChildEnv(
	env: Record<string, string | undefined>,
): Record<string, string | undefined> {
	const scrubbed = { ...env };
	for (const key of AUTH_TOKEN_FORBIDDEN_ENV_KEYS) delete scrubbed[key];
	return scrubbed;
}

function spawnAuthTokenProcess(
	input: AuthTokenProcessSpawnInput,
): AuthTokenProcess {
	if (input.argv.length === 0) {
		return {
			stdout: null,
			stderr: null,
			exited: Promise.resolve({
				exitCode: null,
				signalCode: null,
				spawnError: true,
			}),
			kill: () => {},
		};
	}
	try {
		const child = Bun.spawn([...input.argv], {
			env: input.env,
			stdin: input.stdin,
			stdout: input.stdout,
			stderr: input.stderr,
			timeout: input.timeoutMs,
			killSignal: "SIGTERM",
		});
		return {
			stdout:
				input.stdout === "pipe"
					? (child.stdout as ReadableStream<Uint8Array>)
					: null,
			stderr:
				input.stderr === "pipe"
					? (child.stderr as ReadableStream<Uint8Array>)
					: null,
			exited: child.exited
				.then((exitCode) => ({
					exitCode,
					signalCode: child.signalCode,
				}))
				.catch(() => ({
					exitCode: null,
					signalCode: null,
					spawnError: true as const,
				})),
			kill: () => {
				try {
					child.kill("SIGTERM");
				} catch {
					// Already exited; no remaining process to terminate.
				}
			},
		};
	} catch {
		return {
			stdout: null,
			stderr: null,
			exited: Promise.resolve({
				exitCode: null,
				signalCode: null,
				spawnError: true,
			}),
			kill: () => {},
		};
	}
}

const DARWIN_LIBC_PATH = "/usr/lib/libSystem.B.dylib";
const DARWIN_F_SETFD = 2;
const DARWIN_FD_CLOEXEC = 1;

function openAuthTokenPipe(): AuthTokenPipe {
	if (process.platform !== "darwin") {
		throw new Error("raw auth token pipe is unavailable on this platform");
	}
	const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
	const libc = dlopen(DARWIN_LIBC_PATH, {
		pipe: {
			args: [FFIType.ptr],
			returns: FFIType.int,
		},
		fcntl: {
			args: [FFIType.int, FFIType.int, FFIType.int],
			returns: FFIType.int,
		},
	});
	const descriptors = new Int32Array(2);
	let pipeCreated = false;
	try {
		if (libc.symbols.pipe(descriptors) !== 0) {
			throw new Error("pipe(2) failed");
		}
		pipeCreated = true;
		for (const descriptor of descriptors) {
			if (
				libc.symbols.fcntl(
					descriptor,
					DARWIN_F_SETFD,
					DARWIN_FD_CLOEXEC,
				) !== 0
			) {
				throw new Error("pipe fd close-on-exec setup failed");
			}
		}
	} catch (error) {
		if (pipeCreated) {
			for (const descriptor of descriptors) closeSync(descriptor);
		}
		throw error;
	} finally {
		libc.close();
	}
	const [readFd, writeFd] = descriptors;
	if (readFd === undefined || writeFd === undefined) {
		throw new Error("pipe(2) returned incomplete descriptors");
	}
	let closed = false;
	return {
		readFd,
		writeFd,
		closeParent: () => {
			if (closed) return;
			closed = true;
			closeSync(readFd);
			closeSync(writeFd);
		},
	};
}

export async function readBoundedAuthChildOutput(
	stream: ReadableStream<Uint8Array> | null,
	child: Pick<AuthTokenProcess, "kill">,
): Promise<{ ok: true; text: string } | { ok: false }> {
	if (stream === null) return { ok: false };
	const chunks: Buffer[] = [];
	let byteCount = 0;
	for await (const chunk of stream) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		byteCount += bytes.byteLength;
		if (byteCount > AUTH_TOKEN_CHILD_MAXIMUM_OUTPUT_BYTES) {
			child.kill();
			return { ok: false };
		}
		chunks.push(bytes);
	}
	return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

function authTokenSupervisorArgs(
	deps: EnvironmentTokenSupervisorDeps,
	configRoot: string,
	input: Extract<AuthTokenSupervisorInput, { mode: "install" }>,
): string[] {
	return [
		deps.supervisorPath,
		"install",
		"--config-root",
		configRoot,
		"--op-path",
		deps.opPath ?? "",
		"--input",
		input.input === "source" ? "stdin" : input.input,
		"--replace",
		String(input.replace),
	];
}

async function runAuthTokenSourceInstall(
	env: Record<string, string | undefined>,
	input: Extract<AuthTokenSupervisorInput, { mode: "install"; input: "source" }>,
	deps: EnvironmentTokenSupervisorDeps,
	spawn: AuthTokenProcessSpawn,
	openPipe: AuthTokenPipeOpen = openAuthTokenPipe,
): Promise<AuthTokenSupervisorResult> {
	if (!isAuthTokenSourceReference(input.sourceRef) || deps.opPath === undefined) {
		return authTokenSourceUnavailable("source-fetch-failed");
	}
	const operatorEnv = scrubAuthTokenChildEnv(env);
	const whoami = spawn({
		argv: [deps.opPath, "whoami"],
		env: operatorEnv,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		timeoutMs: OP_AUTH_CHECK_TIMEOUT_MS,
	});
	const whoamiExit = await whoami.exited;
	if (
		whoamiExit.spawnError ||
		whoamiExit.signalCode !== null ||
		whoamiExit.exitCode !== 0
	) {
		return authTokenSourceUnavailable("op-session-unavailable");
	}

	let tokenPipe: AuthTokenPipe;
	try {
		tokenPipe = openPipe();
	} catch {
		return authSupervisorUnavailable("token-supervisor-unavailable");
	}
	let source: AuthTokenProcess;
	let supervisor: AuthTokenProcess;
	try {
		source = spawn({
			argv: [deps.opPath, "read", input.sourceRef],
			env: operatorEnv,
			stdin: "ignore",
			stdout: tokenPipe.writeFd,
			stderr: "ignore",
			timeoutMs: OP_SOURCE_FETCH_TIMEOUT_MS,
		});
		supervisor = spawn({
			argv: authTokenSupervisorArgs(deps, deps.configRoot, input),
			env: {
				PATH: "/usr/bin:/bin",
				LANG: "C.UTF-8",
				TMPDIR: deps.configRoot,
			},
			stdin: tokenPipe.readFd,
			stdout: "pipe",
			stderr: "pipe",
			timeoutMs: NON_INTERACTIVE_SUPERVISOR_TIMEOUT_MS,
		});
	} finally {
		tokenPipe.closeParent();
	}
	const [stdout, stderr, supervisorExit, sourceExit] = await Promise.all([
		readBoundedAuthChildOutput(supervisor.stdout, supervisor),
		readBoundedAuthChildOutput(supervisor.stderr, supervisor),
		supervisor.exited,
		source.exited,
	]);
	if (
		sourceExit.spawnError ||
		sourceExit.signalCode !== null ||
		sourceExit.exitCode !== 0
	) {
		return authTokenSourceUnavailable("source-fetch-failed");
	}
	if (
		supervisorExit.spawnError ||
		supervisorExit.signalCode !== null ||
		supervisorExit.exitCode === null
	) {
		return authSupervisorUnavailable("token-supervisor-unavailable");
	}
	if (!stdout.ok || !stderr.ok) {
		return authSupervisorUnavailable("token-supervisor-output-too-large");
	}
	return {
		exitCode: supervisorExit.exitCode,
		stdout: stdout.text,
		stderr: stderr.text,
	};
}

async function runAuthTokenSupervisor(
	env: Record<string, string | undefined>,
	input: AuthTokenSupervisorInput,
): Promise<AuthTokenSupervisorResult> {
	const deps = environmentTokenSupervisorDeps(env);
	if (deps === undefined) {
		return authSupervisorUnavailable("token-supervisor-unavailable");
	}
	if (input.mode !== "remove" && deps.opPath === undefined) {
		return authSupervisorUnavailable("op-path-unavailable");
	}
	if (input.mode === "install") {
		await mkdir(deps.configRoot, { recursive: true, mode: 0o700 });
	}
	let configRoot: string;
	try {
		configRoot = realpathSync(deps.configRoot);
	} catch {
		return authSupervisorUnavailable("unsafe-config-root");
	}
	if (input.mode === "install" && input.input === "source") {
		return runAuthTokenSourceInstall(
			env,
			input,
			{ ...deps, configRoot },
			spawnAuthTokenProcess,
		);
	}
	const args = [input.mode, "--config-root", configRoot];
	if (input.mode === "install") {
		args.push(
			"--op-path",
			deps.opPath ?? "",
			"--input",
			input.input,
			"--replace",
			String(input.replace),
		);
	} else if (input.mode === "status") {
		args.push(
			"--op-path",
			deps.opPath ?? "",
			"--profile-path",
			deps.profilePath,
		);
	}
	const child = Bun.spawn([deps.supervisorPath, ...args], {
		env: {
			PATH: "/usr/bin:/bin",
			LANG: "C.UTF-8",
			TMPDIR: configRoot,
		},
		stdin: input.mode === "install" ? "inherit" : "ignore",
		stdout: "pipe",
		stderr: "pipe",
		// Bound the non-interactive modes so `await child.exited` below has a
		// deadline; Bun kills a timed-out child with SIGTERM (the default
		// killSignal), which surfaces as a non-null signalCode.
		...(input.mode === "install"
			? {}
			: { timeout: NON_INTERACTIVE_SUPERVISOR_TIMEOUT_MS }),
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (input.mode !== "install" && child.signalCode != null) {
		// The deadline (or an external signal) killed the supervisor before it
		// completed; a signalled child never produced a trustworthy envelope, so
		// report the typed unavailable state instead of the partial result.
		return authSupervisorUnavailable("token-supervisor-unavailable");
	}
	if (
		Buffer.byteLength(stdout, "utf8") > AUTH_TOKEN_CHILD_MAXIMUM_OUTPUT_BYTES ||
		Buffer.byteLength(stderr, "utf8") > AUTH_TOKEN_CHILD_MAXIMUM_OUTPUT_BYTES
	) {
		return authSupervisorUnavailable("token-supervisor-output-too-large");
	}
	return { exitCode, stdout, stderr };
}

/** @internal Source-install and process seams for spawn-contract tests; production uses both helpers. */
export const __authTokenSupervisorForTest = {
	run: runAuthTokenSourceInstall,
	spawn: spawnAuthTokenProcess,
	openPipe: openAuthTokenPipe,
} as const;

export type BrowserUseApprovedBindingResolver = (input: {
	binding_ref: string;
	service_id: string;
	auth_context: BrowserUseAuthContext;
	environment: string;
	profile: string;
}) => Promise<BrowserUseItemBinding | null>;

export type BrowserUseAuthTransportFactory = () => {
	transport: {
		request(
			request:
				| BrowserUseDevToolsRequest
				| BrowserUseCdpObserverRequest
				| {
						method: "Page.navigate";
						sessionId: string;
						params: { url: string };
					  },
		): Promise<unknown>;
	};
	close(): void;
};

export type BrowserUseRuntime = {
	env: Record<string, string | undefined>;
	now: () => number;
	/** Explicit setup-owned source root; null models packaged invocation in tests. */
	sourceCheckoutRoot?: string | null;
	// Structured, shell-free command runner the shared mcporter transport drives
	// (plan U4). Same shape Browser Adapter Proof uses, so both surfaces run the
	// command vector identically.
	runCommand: (input: McporterCommandInput) => Promise<McporterCommandResult>;
	// Read a supplied evidence file (--route, --adapter-proof) or selected-target
	// state (--state). Kept on the runtime so the discovery/selection assembler
	// stays pure and the CLI driver owns all I/O (mirrors AdapterProofRuntime /
	// prepare's read-then-assemble split).
	readTextFile: (path: string) => Promise<string>;
	// Write run-scoped selected-target state (U6). Owner-only and atomic: the
	// default writes a temp sibling with 0600 perms then renames it over the
	// target so a partial write is never observed and the file is never group/
	// world readable. Kept on the runtime so the selection assembler stays pure
	// and the CLI driver owns the single write.
	writeTextFile: (path: string, contents: string) => Promise<void>;
	// Create local artifact directories before browser operations that write files.
	// This keeps filesystem failures before live browser focus/operation side
	// effects.
	ensureDirectory: (path: string) => Promise<void>;
	// Read the piped stdin envelope `targets select` resolves against (U6),
	// mirroring the Router envelope seam. Returns "" when nothing is piped; the
	// inline env var is the fallback the CLI driver applies when this is empty.
	readStdin: () => Promise<string>;
	/** Platform store filesystem (U2). Default binds node:fs/promises; tests
	 *  inject temp-rooted real fs or the volatile-overlay fake. */
	platformFs: BrowserUsePlatformFs;
	/**
	 * Prompt-free token retrieval custody (auth plan U3a, R7). ABSENT by
	 * default: production custody belongs to the signed Token Retrieval
	 * Launcher (ADR 0028 U3b), which does not exist on an unenrolled machine —
	 * a legal typed state the auth commands report, never a crash. Tests and
	 * the future U3b wiring inject a port.
	 */
	authTokenRetrieval?: BrowserUseTokenRetrievalPort;
	/** Transaction-scoped managed authority. Receives no browser secret bytes. */
	authManagedAccess?: BrowserUseAuthAccessProvider;
	/** One bounded desktop-sign-in or biometric-unlock fallback. */
	authUserPresentAccess?: BrowserUseAuthAccessProvider;
	/** Approved binding owner shared by reviewed-runbook and freeform entry modes. */
	authApprovedBindingResolver?: BrowserUseApprovedBindingResolver;
	/** Fresh session proof owner shared by both authentication entry modes. */
	authenticatedStateProof?: BrowserUseAuthenticatedStateProof;
	/** Endpoint-bound transport shared by both entry modes. */
	authTransport?: BrowserUseAuthTransportFactory;
	/** Test/composition seam for an already approved binding catalog owner. */
	runbookApprovedBindingResolver?: BrowserUseApprovedBindingResolver;
	/** Offline-only Reviewed Action receipt verifier; no broker or signing method. */
	reviewedActionApprovalVerifier?: BrowserUseReviewedActionApprovalVerifier;
	/** Present but rejected production verifier pin; absent means not provisioned. */
	reviewedActionApprovalVerifierIssue?: BrowserUseReviewedActionApprovalVerifierIssue;
	/** Fresh auth-owned session proof. Absence fails runbook auth closed. */
	runbookAuthenticatedStateProof?: BrowserUseAuthenticatedStateProof;
	/** Presence-backed one-run fallback for portals without Session Identity Proof. */
	runbookHumanIdentityAttestation?: BrowserUseHumanIdentityAttestationDriver;
	/** Endpoint-bound auth transport override for hermetic process-route tests. */
	runbookAuthTransport?: BrowserUseAuthTransportFactory;
	/**
	 * Native token lifecycle boundary. The default child inherits stdin
	 * directly for install, so token bytes never enter the TypeScript process.
	 */
	runAuthTokenSupervisor?: (
		input: AuthTokenSupervisorInput,
	) => Promise<AuthTokenSupervisorResult>;
	/** Read and re-prove the persisted reload source without touching token bytes. */
	readAuthTokenSource?: () => Promise<AuthTokenSourceReadResult>;
	/** Persist a validated reload source only after native installation succeeds. */
	writeAuthTokenSource?: (
		sourceRef: string,
	) => Promise<AuthTokenSourceWriteResult>;
	/** Clear a validated reload source after a non-source installation succeeds. */
	removeAuthTokenSource?: () => Promise<AuthTokenSourceWriteResult>;
	/** True only when the current stdin can safely host the hidden fallback prompt. */
	stdinIsTTY?: () => boolean;
	/**
	 * Internal Verified Handoff Envelope mint (design brief D4): prove the
	 * connection and mint the envelope in-process through browser-connect's
	 * exported `main` — the everyday `task run --intent` path needs no caller-
	 * managed `--handoff`. Returns browser-connect's exact stdout/stderr and
	 * exit code so a connect failure (exit 20, one Repair Path) surfaces
	 * verbatim. Envelope contract ownership stays with browser-connect; this
	 * seam only carries bytes. Tests inject a fixture-backed fake.
	 */
	mintHandoff: (input: {
		adapterId: string;
		runId?: string;
	}) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
};

export function createDefaultBrowserUseRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
): BrowserUseRuntime {
	return {
		env: { ...process.env },
		now: () => Date.now(),
		runCommand: (input: McporterCommandInput) => spawnMcporterCommand(input),
		readTextFile: (path: string) => readFile(path, "utf-8"),
		writeTextFile: (path: string, contents: string) =>
			writeStateFileAtomically(path, contents),
		ensureDirectory: async (path: string) => {
			await mkdir(path, { recursive: true, mode: 0o700 });
		},
		readStdin: () => readAllStdin(),
		platformFs: createDefaultPlatformFs(),
		runAuthTokenSupervisor: (input) =>
			runAuthTokenSupervisor(overrides.env ?? process.env, input),
		readAuthTokenSource: () =>
			readAuthTokenSource(overrides.env ?? process.env),
		writeAuthTokenSource: (sourceRef) =>
			writeAuthTokenSource(overrides.env ?? process.env, sourceRef),
		removeAuthTokenSource: () =>
			removeAuthTokenSource(overrides.env ?? process.env),
		stdinIsTTY: () => process.stdin.isTTY === true,
		mintHandoff: (input) => mintHandoffInProcess(input),
		...overrides,
	};
}

/**
 * Production runtime construction with native-capability wiring (auth plan
 * U3a/U3b). Builds the default runtime, then queries the native security seam:
 * only an `admitted` product yields a real Token Retrieval Port. On this
 * machine the product is unsigned/absent, so `authTokenRetrieval` stays
 * undefined and the public auth command keeps returning the typed
 * `native-capability-absent` evaluation — byte-identical to today. An explicit
 * `overrides.authTokenRetrieval` (or a caller-supplied port) is honored as-is
 * and never overwritten by the seam probe.
 *
 * Kept separate from the synchronous {@link createDefaultBrowserUseRuntime} so
 * the sync factory (and every test that constructs it) is unchanged; the
 * seam probe is async and lives only on this production path.
 *
 * @param overrides - Partial runtime overrides, same shape the sync factory takes
 * @param seam - The native security seam; defaults to the native-absent placeholder
 */
export async function createProductionBrowserUseRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
	seam?: BrowserUseSecuritySeam,
): Promise<BrowserUseRuntime> {
	const runtime = createDefaultBrowserUseRuntime(overrides);
	const securitySeam = seam ?? createNativeAbsentSecuritySeam();
	// Honor an explicitly injected port; otherwise let the seam decide. Absence
	// leaves the field undefined so the auth command reports typed absence.
	if (runtime.authTokenRetrieval === undefined) {
		const port = await resolveAuthTokenRetrieval(securitySeam);
		if (port !== undefined) runtime.authTokenRetrieval = port;
	}
	if (runtime.authTokenRetrieval === undefined && seam === undefined) {
		runtime.authTokenRetrieval = environmentTokenRetrievalOf(runtime);
	}
	if (runtime.authUserPresentAccess === undefined) {
		const provider = await resolveUserPresentAuthAccess(securitySeam);
		if (provider !== undefined) runtime.authUserPresentAccess = provider;
	}
	let reviewedActionVerifierIdentity: BrowserUseReviewedActionVerifierIdentity | undefined;
	if (
		runtime.reviewedActionApprovalVerifier === undefined ||
		runtime.runbookHumanIdentityAttestation === undefined
	) {
		const resolution = await productionReviewedActionApprovalVerifierOf(runtime);
		if (resolution.status === "ready") {
			reviewedActionVerifierIdentity = resolution.identity;
			if (runtime.reviewedActionApprovalVerifier === undefined) {
				runtime.reviewedActionApprovalVerifier = resolution.verifier;
			}
		} else if (resolution.status === "rejected") {
			runtime.reviewedActionApprovalVerifierIssue = resolution.issue;
		}
	}
	const brokerPath = runtime.env[BROWSER_USE_APPROVAL_BROKER_ENV];
	if (
		runtime.runbookHumanIdentityAttestation === undefined &&
		brokerPath !== undefined &&
		brokerPath !== "" &&
		reviewedActionVerifierIdentity !== undefined
	) {
		runtime.runbookHumanIdentityAttestation =
			createNativeHumanIdentityAttestationDriver(
				brokerPath,
				reviewedActionVerifierIdentity,
			);
	}
	return runtime;
}

// In-process envelope mint (D4). Imports browser-connect's CLI lazily so the
// module cost lands only on the mint path, captures its writers, and returns
// the raw envelope bytes: browser-use never re-implements connect semantics
// and never re-declares the envelope schema. A missing browser-connect module
// (published-package edge) degrades to a typed failure shape the task-run
// driver maps to `supply_matching_handoff` — never a crash.
async function mintHandoffInProcess(input: {
	adapterId: string;
	runId?: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	let cli: typeof import("@side-quest/browser-connect/cli");
	try {
		cli = await import("@side-quest/browser-connect/cli");
	} catch {
		return {
			exitCode: 1,
			stdout: "",
			stderr:
				"browser-connect is not importable in this installation; pass --handoff <path> with a pre-minted Verified Handoff Envelope.",
		};
	}
	const capture = () => {
		const chunks: string[] = [];
		return {
			writer: {
				write: (text: string) => {
					chunks.push(text);
					return true;
				},
			},
			text: () => chunks.join(""),
		};
	};
	const stdout = capture();
	const stderr = capture();
	// The whole embedded interaction stays inside the guard, not just the
	// import above: createProductionDeps() lazily imports warm-chrome and
	// main() can throw before it owns the process exit — either would
	// otherwise crash the mint path instead of returning the documented typed
	// failure. The thrown message names a module/stage, never a secret.
	try {
		const deps = await cli.createProductionDeps();
		const exitCode = await cli.main(
			[
				"connect",
				input.adapterId,
				"--json",
				...(input.runId === undefined ? [] : ["--run-id", input.runId]),
			],
			{ ...deps, stdout: stdout.writer, stderr: stderr.writer },
		);
		return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return {
			exitCode: 1,
			stdout: "",
			stderr: `browser-connect could not mint the handoff in this installation (${detail}); pass --handoff <path> with a pre-minted Verified Handoff Envelope.`,
		};
	}
}

// Read all of stdin as UTF-8. An interactive terminal has no piped envelope, so
// return "" rather than blocking on a TTY; the CLI driver then falls back to the
// inline env var. Mirrors the Router stdin seam: collect raw chunks and decode
// ONCE over the joined bytes. Decoding per chunk (`data += toString` per chunk)
// corrupts any multi-byte UTF-8 codepoint split across a chunk boundary (finding
// #5); Buffer.concat then a single decode keeps codepoints intact.
async function readAllStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";
	const chunks: Uint8Array[] = [];
	for await (const chunk of Bun.stdin.stream()) {
		chunks.push(chunk);
	}
	return decodeStdinChunks(chunks);
}

// Concatenate raw stdin byte chunks and decode ONCE as UTF-8. Decoding each
// chunk independently corrupts a multi-byte codepoint that straddles a chunk
// boundary; joining the bytes first then decoding keeps codepoints intact
// (finding #5). Exported so the boundary-decode behavior is unit-testable
// without a live stdin pipe.
export function decodeStdinChunks(chunks: readonly Uint8Array[]): string {
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
		"utf-8",
	);
}

// Atomic, owner-only state write. Write a temp sibling in the same directory
// (so rename stays on one filesystem and is atomic), force 0600 via the open
// mode, then rename over the target. A crash mid-write leaves the temp file, not
// a half-written state file. The temp suffix carries the pid so two processes
// writing the same run state do not clobber each other's temp file before the
// rename. No randomness or clock reads here: the suffix need only be unique per
// concurrent writer, not unpredictable, and the state contents own freshness.
async function writeStateFileAtomically(
	path: string,
	contents: string,
): Promise<void> {
	const tempPath = `${path}.tmp-${process.pid}`;
	await writeFile(tempPath, contents, { mode: 0o600 });
	await rename(tempPath, path);
}
