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

import { existsSync, realpathSync } from "node:fs";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
	type AdmissionRuntime,
	createNativeAbsentRuntime,
} from "@side-quest/browser-use-security";
import type {
	BrowserUseNativeDocumentReadPort,
	BrowserUseNativeDocumentReadRequest,
	BrowserUseNativeTargetProofPort,
	BrowserUseNativeTargetProofRequest,
} from "./browser-use-agent-browser";
import type {
	BrowserUseAuthLaneAdmission,
	BrowserUseItemBinding,
} from "./browser-use-auth-bindings";
import type {
	BrowserUseNativeConfidentialDeliveryPort,
	BrowserUseNativeConfidentialDeliveryRequest,
} from "./browser-use-confidential-field-delivery";
import {
	type BrowserUseEnvironmentOpMetadataOperation,
	buildEnvironmentOpAdmissionInvocation,
	buildEnvironmentOpMetadataInvocation,
	createEnvironmentOpTokenRetrievalPort,
	parseEnvironmentOpAdmissionResult,
	parseEnvironmentOpMetadataResult,
} from "./browser-use-environment-op-executor";
import {
	type BrowserUseOpExecute,
	type BrowserUseCredentialCapabilityTarget,
	type BrowserUseOpCredentialField,
	type BrowserUseSecretHandle,
	type BrowserUseTokenRetrievalPort,
	createOpTokenRetrievalPort,
} from "./browser-use-op";
import {
	type BrowserUsePlatformFs,
	admitBrowserUseRoot,
	createDefaultPlatformFs,
	inspectBrowserUsePaths,
	resolveBrowserUsePaths,
} from "./browser-use-paths";
import { createBrowserUseAdminAuthorityReceiptStore } from "./browser-use-admin-authority-receipt";
import {
	type BrowserUseProfilePostureStatus,
	parseBrowserConnectProfilePostureStatus,
} from "./browser-use-profile-posture";
import {
	type BrowserUseEnvironmentTokenCustodyAction,
	type BrowserUseEnvironmentTokenCustodyState,
	buildEnvironmentTokenCustodyInvocation,
	parseEnvironmentTokenCustodyState,
} from "./browser-use-environment-token";
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
	 * Lower-assurance lane. It is consulted only after the native admission
	 * runtime proves that the signed product is absent.
	 */
	environment?: {
		inspectToken: () => Promise<BrowserUseEnvironmentTokenCustodyState>;
		createTokenRetrieval: () => BrowserUseTokenRetrievalPort;
	};
};

/** Command-scoped lane evidence paired with the only port it admits. */
export type BrowserUseAuthAdmissionSnapshot =
	BrowserUseAuthLaneAdmission<BrowserUseTokenRetrievalPort>;

/**
 * Read-only supporting evidence for composed authentication status.
 *
 * The producer owns executable, authority-receipt, Warm Chrome, and binding
 * proof. Browser Use treats the returned value as untrusted and applies an
 * exact bounded projection before reporting it.
 */
export type BrowserUseAuthStatusSupportCoordinates = {
	lane_digest: string;
	principal_digest: string;
	vault_digest: string;
	profile_digest: string;
};

export type BrowserUseAuthStatusSupportPort = (
	proofCoordinates?: BrowserUseAuthStatusSupportCoordinates,
) => Promise<unknown>;

/** Secret-free native lifecycle request; input names a channel, never bytes. */
export type BrowserUseEnvironmentTokenLifecycleRequest = {
	action: BrowserUseEnvironmentTokenCustodyAction;
	input_channel?: "stdin" | "tty";
};

/** Runtime seam keeping local auth bytes outside TypeScript. */
export type BrowserUseEnvironmentTokenLifecyclePort = {
	inputIsTTY(): boolean;
	execute(
		input: BrowserUseEnvironmentTokenLifecycleRequest,
	): Promise<BrowserUseEnvironmentTokenCustodyState>;
};

/** One browser-bound view over the command-scoped native delivery owner. */
export type BrowserUseConfidentialDeliveryRuntimePort = {
	forBrowser(input: {
		browser_ws_endpoint: string;
		browser_pid: number;
	}): BrowserUseNativeConfidentialDeliveryPort;
};

type BrowserUseEnvironmentDeferredCapability = {
	binding: BrowserUseItemBinding;
	field: BrowserUseOpCredentialField;
	target: BrowserUseCredentialCapabilityTarget;
	expires_at_epoch_ms: number;
};

type BrowserUseEnvironmentPrivateDeliveryInput = {
	browser_ws_endpoint: string;
	browser_pid: number;
	binding: BrowserUseItemBinding;
	field: BrowserUseOpCredentialField;
	target: BrowserUseNativeConfidentialDeliveryRequest["target"];
	locator: BrowserUseNativeConfidentialDeliveryRequest["locator"];
};

type BrowserUseCanonicalConfigRootResolver = () => Promise<string>;

export type BrowserUseEnvironmentPrivateDeliveryProcess = (
	input: BrowserUseEnvironmentPrivateDeliveryInput,
) => Promise<unknown>;

/** Exact native prove-target process invocation. Endpoint/PID stay in stdin. */
export type BrowserUseNativeTargetProofInvocation = {
	executable_path: string;
	argv: readonly ["prove-target"];
	env: Readonly<{ PATH: "/usr/bin:/bin"; LANG: "C" }>;
	stdin_text: string;
	timeout_ms: 15_000;
};

/**
 * Build the read-only U7 prove-target process boundary.
 *
 * The running-browser endpoint is capability-bearing. Keep it out of argv and
 * output; the native helper receives it only in one bounded stdin request.
 */
export function buildBrowserUseNativeTargetProofInvocation(input: {
	native_bin_root: string;
	request: BrowserUseNativeTargetProofRequest;
}): BrowserUseNativeTargetProofInvocation {
	if (
		!isAbsolute(input.native_bin_root) ||
		!safeLoopbackBrowserWebSocket(input.request.browser_ws_endpoint) ||
		!Number.isSafeInteger(input.request.browser_pid) ||
		input.request.browser_pid <= 0 ||
		!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(input.request.target_id)
	) {
		throw new Error("native target proof request is inadmissible");
	}
	const stdinText = JSON.stringify({
		schema_version: 1,
		browser_ws_endpoint: input.request.browser_ws_endpoint,
		browser_pid: input.request.browser_pid,
		target_id: input.request.target_id,
	});
	if (Buffer.byteLength(stdinText, "utf8") > 4_096) {
		throw new Error("native target proof request exceeded its bound");
	}
	return {
		executable_path: join(
			input.native_bin_root,
			"browser-use-confidential-delivery",
		),
		argv: ["prove-target"],
		env: { PATH: "/usr/bin:/bin", LANG: "C" },
		stdin_text: stdinText,
		timeout_ms: 15_000,
	};
}

/** Reject any capability-bearing endpoint reflected by native output. */
export function browserUseNativeTargetProofOutputIsSafe(input: {
	stdout: string;
	stderr: string;
	browser_ws_endpoint: string;
}): boolean {
	return (
		!input.stdout.includes(input.browser_ws_endpoint) &&
		!input.stderr.includes(input.browser_ws_endpoint)
	);
}

/** Exact native reviewed-read process invocation. Browser authority stays in stdin. */
export type BrowserUseNativeDocumentReadInvocation = {
	executable_path: string;
	argv: readonly ["read-reviewed"];
	env: Readonly<{ PATH: "/usr/bin:/bin"; LANG: "C" }>;
	stdin_text: string;
	timeout_ms: 15_000;
};

const NATIVE_DOCUMENT_READ_STDIN_LIMIT_BYTES = 131_072;
const NATIVE_DOCUMENT_READ_SCRIPT_LIMIT_BYTES = 100_000;
const SAFE_NATIVE_DOCUMENT_COORDINATE =
	/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const SAFE_NATIVE_DOCUMENT_DIGEST = /^[a-f0-9]{64}$/;

function exactWebOrigin(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === "https:" || parsed.protocol === "http:") &&
			parsed.origin === value
		);
	} catch {
		return false;
	}
}

/** Build one bounded, shell-free reviewed document read. */
export function buildBrowserUseNativeDocumentReadInvocation(input: {
	native_bin_root: string;
	request: BrowserUseNativeDocumentReadRequest;
}): BrowserUseNativeDocumentReadInvocation {
	const request = input.request;
	if (
		!isAbsolute(input.native_bin_root) ||
		!safeLoopbackBrowserWebSocket(request.browser_ws_endpoint) ||
		!Number.isSafeInteger(request.browser_pid) ||
		request.browser_pid <= 0 ||
		!SAFE_NATIVE_DOCUMENT_COORDINATE.test(request.target_id) ||
		!SAFE_NATIVE_DOCUMENT_COORDINATE.test(request.document_id) ||
		!exactWebOrigin(request.top_level_origin) ||
		!exactWebOrigin(request.frame_origin) ||
		!SAFE_NATIVE_DOCUMENT_DIGEST.test(request.target_proof_digest) ||
		typeof request.reset_navigation_history !== "boolean" ||
		request.script.length === 0 ||
		Buffer.byteLength(request.script, "utf8") >
			NATIVE_DOCUMENT_READ_SCRIPT_LIMIT_BYTES ||
		!SAFE_NATIVE_DOCUMENT_DIGEST.test(request.script_sha256) ||
		createHash("sha256").update(request.script).digest("hex") !==
			request.script_sha256
	) {
		throw new Error("native reviewed document read request is inadmissible");
	}
	const stdinText = JSON.stringify({
		schema_version: 1,
		browser_ws_endpoint: request.browser_ws_endpoint,
		browser_pid: request.browser_pid,
		target_id: request.target_id,
		document_id: request.document_id,
		top_level_origin: request.top_level_origin,
		frame_origin: request.frame_origin,
		target_proof_digest: request.target_proof_digest,
		script: request.script,
		script_sha256: request.script_sha256,
		reset_navigation_history:
			request.reset_navigation_history,
	});
	if (
		Buffer.byteLength(stdinText, "utf8") >
		NATIVE_DOCUMENT_READ_STDIN_LIMIT_BYTES
	) {
		throw new Error("native reviewed document read request exceeded its bound");
	}
	return {
		executable_path: join(
			input.native_bin_root,
			"browser-use-confidential-delivery",
		),
		argv: ["read-reviewed"],
		env: { PATH: "/usr/bin:/bin", LANG: "C" },
		stdin_text: stdinText,
		timeout_ms: 15_000,
	};
}

/** Reject reflected browser authority or reviewed source from native output. */
export function browserUseNativeDocumentReadOutputIsSafe(input: {
	stdout: string;
	stderr: string;
	request: BrowserUseNativeDocumentReadRequest;
}): boolean {
	return (
		!input.stdout.includes(input.request.browser_ws_endpoint) &&
		!input.stderr.includes(input.request.browser_ws_endpoint) &&
		!input.stdout.includes(input.request.script) &&
		!input.stderr.includes(input.request.script)
	);
}

/** Parse one bounded native process result without trusting its stdout. */
export function parseBrowserUseNativeDocumentReadProcessOutput(input: {
	stdout: string;
	stderr: string;
	exit_code: number;
	signal_code: NodeJS.Signals | null | undefined;
	request: BrowserUseNativeDocumentReadRequest;
}): Record<string, unknown> {
	if (
		input.signal_code != null ||
		Buffer.byteLength(input.stdout, "utf8") >
			NATIVE_LIFECYCLE_OUTPUT_LIMIT_BYTES ||
		Buffer.byteLength(input.stderr, "utf8") >
			NATIVE_LIFECYCLE_OUTPUT_LIMIT_BYTES ||
		!browserUseNativeDocumentReadOutputIsSafe(input)
	) {
		throw new Error("native reviewed document read output was unsafe");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.stdout);
	} catch {
		throw new Error(
			"native reviewed document read process contract drifted",
		);
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		throw new Error(
			"native reviewed document read process contract drifted",
		);
	}
	const envelope = parsed as Record<string, unknown>;
	if (
		envelope.schema_version !== 1 ||
		typeof envelope.ok !== "boolean" ||
		(envelope.ok &&
			!exactObjectKeys(envelope, [
				"schema_version",
				"ok",
				"proof",
				"result",
				"navigation_history_sealed",
			])) ||
		(envelope.ok &&
			envelope.navigation_history_sealed !==
				input.request.reset_navigation_history) ||
		input.exit_code !== (envelope.ok ? 0 : 20)
	) {
		throw new Error(
			"native reviewed document read process contract drifted",
		);
	}
	return envelope;
}

/**
 * Link deferred field minting and one-shot native consumption inside one
 * command. The map contains secret-free coordinates only; deletion happens
 * before any validation or process start, so every attempted handle use is
 * terminal.
 */
export function createEnvironmentConfidentialAuthPorts(input: {
	env: Record<string, string | undefined>;
	now: () => number;
	executePrivateDelivery: BrowserUseEnvironmentPrivateDeliveryProcess;
	resolveCanonicalConfigRoot?: BrowserUseCanonicalConfigRootResolver;
}): {
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	confidentialDelivery: BrowserUseConfidentialDeliveryRuntimePort;
} {
	const capabilities = new Map<
		string,
		BrowserUseEnvironmentDeferredCapability
	>();
	const resolveCanonicalConfigRoot =
		input.resolveCanonicalConfigRoot ??
		createAdmittedCanonicalConfigRootResolver(
			input.env,
			createDefaultPlatformFs(),
		);
	const tokenRetrieval = createNativeEnvironmentTokenRetrievalPort(
		resolveCanonicalConfigRoot,
		input.now,
		(capability) => {
			capabilities.set(capability.handle.handle_id, capability.record);
			return capability.handle;
		},
	);
	return {
		tokenRetrieval,
		confidentialDelivery: {
			forBrowser(browser) {
				return {
					async consumePrivatePipeAndDeliver(request) {
						const record = capabilities.get(request.capability.handle_id);
						capabilities.delete(request.capability.handle_id);
						if (
							record === undefined ||
							request.capability.field !== record.field ||
							request.capability.expires_at_epoch_ms !==
								record.expires_at_epoch_ms ||
							input.now() >= record.expires_at_epoch_ms ||
							!credentialTargetsEqual(record.target, request.target) ||
							request.locator.input_kind !== record.field ||
							!Number.isSafeInteger(browser.browser_pid) ||
							browser.browser_pid <= 0 ||
							!safeLoopbackBrowserWebSocket(browser.browser_ws_endpoint)
						) {
							return blockedPrivateDeliveryResult();
						}
						try {
							return await input.executePrivateDelivery({
								browser_ws_endpoint: browser.browser_ws_endpoint,
								browser_pid: browser.browser_pid,
								binding: structuredClone(record.binding),
								field: record.field,
								target: { ...request.target },
								locator: { ...request.locator },
							});
						} catch {
							return unknownPrivateDeliveryResult();
						}
					},
				};
			},
		},
	};
}

function credentialTargetsEqual(
	expected: BrowserUseCredentialCapabilityTarget,
	actual: BrowserUseNativeConfidentialDeliveryRequest["target"],
): boolean {
	return (
		expected.lane_id === actual.lane_id &&
		expected.run_id === actual.run_id &&
		expected.target_id === actual.target_id &&
		expected.page_id === actual.page_id &&
		expected.frame_id === actual.frame_id &&
		expected.top_level_origin === actual.top_level_origin &&
		expected.frame_origin === actual.frame_origin &&
		expected.target_proof_digest === actual.target_proof_digest
	);
}

function safeLoopbackBrowserWebSocket(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (
			parsed.protocol === "ws:" &&
			(parsed.hostname === "127.0.0.1" ||
				parsed.hostname === "::1") &&
			parsed.username === "" &&
			parsed.password === "" &&
			parsed.port !== "" &&
			parsed.hash === ""
		);
	} catch {
		return false;
	}
}

function blockedPrivateDeliveryResult() {
	return {
		schema_version: 1,
		ok: false,
		write_state: "blocked-before-write",
		rejection: {
			code: "invalid-request",
			message:
				"confidential field delivery blocked; inspect the typed code.",
		},
		protocol_trace: [],
	} as const;
}

/**
 * The production security seam: native capability is absent until the signed
 * product exists (ADR 0028). `admission` always reports
 * `native-capability-absent`; `createTokenExecutor` is unreachable behind that
 * verdict and throws a typed error if a future miswiring ever calls it, so the
 * absent path can never silently mint a port over a non-existent executor.
 */
function createNativeAbsentSecuritySeam(
	runtime: BrowserUseRuntime,
	resolveCanonicalConfigRoot: BrowserUseCanonicalConfigRootResolver,
): BrowserUseSecuritySeam {
	const lifecycle = runtime.environmentTokenLifecycle;
	const environmentAuth = createEnvironmentConfidentialAuthPorts({
		env: runtime.env,
		now: runtime.now,
		resolveCanonicalConfigRoot,
		executePrivateDelivery: (input) =>
			executeNativeEnvironmentPrivateDelivery(
				resolveCanonicalConfigRoot,
				input,
			),
	});
	runtime.authConfidentialDelivery ??= environmentAuth.confidentialDelivery;
	return {
		admission: createNativeAbsentRuntime(),
		createTokenExecutor: () => {
			throw new Error(
				"native token executor is absent; the signed Browser Use Security product is not installed.",
			);
		},
		environment: {
			inspectToken: async () => {
				if (lifecycle === undefined) {
					throw new Error("environment token lifecycle is unavailable");
				}
				return lifecycle.execute({ action: "status" });
			},
			createTokenRetrieval: () =>
				environmentAuth.tokenRetrieval,
		},
	};
}

function unknownPrivateDeliveryResult() {
	return {
		...blockedPrivateDeliveryResult(),
		write_state: "write-outcome-unknown" as const,
		rejection: {
			code: "write-outcome-unknown" as const,
			message:
				"confidential field delivery blocked; inspect the typed code." as const,
		},
	};
}

/**
 * Capture one command's lane decision.
 *
 * Signed admission wins. Only typed native absence may inspect the environment
 * token. Native drift, probe failure, and executor failure remain distinct
 * blocks and never trigger fallback.
 */
async function resolveAuthAdmission(
	seam: BrowserUseSecuritySeam,
): Promise<BrowserUseAuthAdmissionSnapshot> {
	let native: Awaited<ReturnType<AdmissionRuntime["verifyProduct"]>>;
	try {
		native = await seam.admission.verifyProduct();
	} catch {
		return {
			kind: "blocked",
			cause: { code: "native-probe-failed" },
			evidence: {},
		};
	}
	if (native.verdict === "not-admitted") {
		return {
			kind: "blocked",
			cause: { code: "native-not-admitted" },
			evidence: { native },
		};
	}
	if (native.verdict === "admitted") {
		try {
			const { execute, token_handle_id } = seam.createTokenExecutor();
			const tokenRetrieval = createOpTokenRetrievalPort({
				execute,
				token_handle_id,
			});
			return {
				kind: "signed-admitted",
				evidence: {
					lane: "signed-native",
					assurance: "signed-native",
					native,
				},
				tokenRetrieval,
			};
		} catch {
			return {
				kind: "blocked",
				cause: { code: "native-executor-failed" },
				evidence: { native },
			};
		}
	}
	if (seam.environment === undefined) {
		return {
			kind: "blocked",
			cause: { code: "environment-probe-failed" },
			evidence: { native },
		};
	}
	let environment: BrowserUseEnvironmentTokenCustodyState;
	try {
		environment = await seam.environment.inspectToken();
	} catch {
		return {
			kind: "blocked",
			cause: { code: "environment-probe-failed" },
			evidence: { native },
		};
	}
	if (environment.state !== "ready") {
		return {
			kind: "blocked",
			cause: { code: "environment-token-not-ready" },
			evidence: { native, environment },
		};
	}
	try {
		const tokenRetrieval = seam.environment.createTokenRetrieval();
		return {
			kind: "environment-admitted",
			evidence: {
				lane: "environment-injected-op",
				assurance: "lower-assurance",
				native,
				environment,
			},
			tokenRetrieval,
		};
	} catch {
		return {
			kind: "blocked",
			cause: { code: "environment-executor-failed" },
			evidence: { native, environment },
		};
	}
}

export type BrowserUseRuntime = {
	env: Record<string, string | undefined>;
	now: () => number;
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
	/** True only when the invoking human owns an interactive terminal. */
	operatorInputIsTTY?: () => boolean;
	/** Post-metadata human challenge; the response never enters argv or state. */
	confirmAdminAuthority?: (input: {
		challenge: string;
	}) => Promise<boolean>;
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
	/**
	 * Command-scoped one-shot delivery owner paired with the selected
	 * environment token port. It consumes only opaque capabilities and returns
	 * the native helper's bounded structural result.
	 */
	authConfidentialDelivery?: BrowserUseConfidentialDeliveryRuntimePort;
	/**
	 * Read-only native U7 target proof owner used around identity reads.
	 */
	authTargetProof?: BrowserUseNativeTargetProofPort;
	/**
	 * Read-only native owner for one reviewed action bound to one root document.
	 */
	authDocumentRead?: BrowserUseNativeDocumentReadPort;
	/**
	 * One admission decision captured during production runtime construction.
	 * Every consumer receives this same object and selected port.
	 */
	authAdmission?: BrowserUseAuthAdmissionSnapshot;
	/**
	 * Earned read-only status evidence from runtime owners outside the U4 lane.
	 *
	 * Absence is a typed fail-closed state. Tests inject hermetic earned proof;
	 * production wiring must never fabricate an authority receipt, browser
	 * posture, executable admission, or live binding.
	 */
	authStatusSupport?: BrowserUseAuthStatusSupportPort;
	/**
	 * Read-only Browser Connect check reduced to Warm Chrome's exact redacted
	 * profile posture. Tests inject earned proof; production calls the owning
	 * browser-connect check surface in-process.
	 */
	authProfilePosture?: () => Promise<BrowserUseProfilePostureStatus>;
	/**
	 * Native local-token lifecycle. Token bytes remain in inherited stdin or
	 * the native hidden terminal; TypeScript receives only the secret-free
	 * lifecycle state.
	 */
	environmentTokenLifecycle?: BrowserUseEnvironmentTokenLifecyclePort;
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
		port?: string;
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
		operatorInputIsTTY: () => Boolean(process.stdin.isTTY),
		confirmAdminAuthority: async ({ challenge }) => {
			if (!process.stdin.isTTY) return false;
			const terminal = createInterface({
				input: process.stdin,
				output: process.stderr,
				terminal: true,
			});
			try {
				const response = await terminal.question(
					`Type ${challenge} to attest read-item-only authority: `,
				);
				return response.trim() === challenge;
			} finally {
				terminal.close();
			}
		},
		platformFs: createDefaultPlatformFs(),
		authProfilePosture: () =>
			inspectProfilePostureInProcess(
				overrides.env === undefined
					? process.env.WARM_CHROME_CDP_PORT
					: overrides.env.WARM_CHROME_CDP_PORT,
				overrides.now?.() ?? Date.now(),
			),
		mintHandoff: (input) => mintHandoffInProcess(input),
		...overrides,
	};
}

/**
 * Build one production command runtime and capture its admission snapshot.
 *
 * Runtime overrides cannot mint production admission. Tests that need a lane
 * inject its evidence through the security seam.
 *
 * @param overrides - Partial non-admission runtime overrides
 * @param seam - Injectable signed/environment security seam
 */
export async function createProductionBrowserUseRuntime(
	overrides: Partial<BrowserUseRuntime> = {},
	seam?: BrowserUseSecuritySeam,
): Promise<BrowserUseRuntime> {
	const runtime = createDefaultBrowserUseRuntime(overrides);
	const resolveCanonicalConfigRoot =
		createAdmittedCanonicalConfigRootResolver(
			runtime.env,
			runtime.platformFs,
		);
	if (runtime.environmentTokenLifecycle === undefined) {
		runtime.environmentTokenLifecycle = createNativeEnvironmentTokenLifecyclePort(
			resolveCanonicalConfigRoot,
		);
	}
	runtime.authTargetProof ??= createNativeTargetProofPort();
	runtime.authDocumentRead ??= createNativeDocumentReadPort();
	runtime.authAdmission = await resolveAuthAdmission(
		seam ??
			createNativeAbsentSecuritySeam(
				runtime,
				resolveCanonicalConfigRoot,
			),
	);
	runtime.authTokenRetrieval =
		runtime.authAdmission.kind === "blocked"
			? undefined
			: runtime.authAdmission.tokenRetrieval;
	runtime.authStatusSupport ??= createProductionAuthStatusSupportPort(runtime);
	return runtime;
}

const NATIVE_LIFECYCLE_TIMEOUT_MS = 15_000;
const NATIVE_LIFECYCLE_TERMINATION_GRACE_MS = 2_000;
const NATIVE_LIFECYCLE_OUTPUT_LIMIT_BYTES = 65_536;
const GIT_IGNORE_PROBE_TIMEOUT_MS = 2_000;

function createNativeTargetProofPort(): BrowserUseNativeTargetProofPort {
	return {
		async proveTarget(request) {
			const invocation = buildBrowserUseNativeTargetProofInvocation({
				native_bin_root: browserUseNativeBinRoot(),
				request,
			});
			const child = Bun.spawn(
				[invocation.executable_path, ...invocation.argv],
				{
					env: invocation.env,
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			child.stdin.write(invocation.stdin_text);
			child.stdin.end();
			const stdoutPromise = readBoundedNativeOutput(child.stdout);
			const stderrPromise = readBoundedNativeOutput(child.stderr);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = await Promise.race([
				child.exited.then(() => false),
				new Promise<true>((resolve) => {
					timer = setTimeout(
						() => resolve(true),
						invocation.timeout_ms,
					);
				}),
			]);
			if (timer !== undefined) clearTimeout(timer);
			if (timedOut) {
				void Promise.allSettled([stdoutPromise, stderrPromise]);
				await terminateEnvironmentTokenLifecycleProcess(child);
				throw new Error("native target proof timed out");
			}
			const exitCode = await child.exited;
			const [stdout, stderr] = await Promise.all([
				stdoutPromise,
				stderrPromise,
			]);
			if (
				child.signalCode != null ||
				!browserUseNativeTargetProofOutputIsSafe({
					stdout,
					stderr,
					browser_ws_endpoint: request.browser_ws_endpoint,
				})
			) {
				throw new Error("native target proof output was unsafe");
			}
			const parsed = JSON.parse(stdout) as unknown;
			if (
				typeof parsed !== "object" ||
				parsed === null ||
				Array.isArray(parsed) ||
				!("ok" in parsed) ||
				typeof parsed.ok !== "boolean" ||
				exitCode !== (parsed.ok ? 0 : 20)
			) {
				throw new Error("native target proof process contract drifted");
			}
			return parsed;
		},
	};
}

function exactObjectKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function createNativeDocumentReadPort(): BrowserUseNativeDocumentReadPort {
	return {
		async readDocument(request) {
			const invocation = buildBrowserUseNativeDocumentReadInvocation({
				native_bin_root: browserUseNativeBinRoot(),
				request,
			});
			const child = Bun.spawn(
				[invocation.executable_path, ...invocation.argv],
				{
					env: invocation.env,
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			child.stdin.write(invocation.stdin_text);
			child.stdin.end();
			const stdoutPromise = readBoundedNativeOutput(child.stdout);
			const stderrPromise = readBoundedNativeOutput(child.stderr);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = await Promise.race([
				child.exited.then(() => false),
				new Promise<true>((resolve) => {
					timer = setTimeout(
						() => resolve(true),
						invocation.timeout_ms,
					);
				}),
			]);
			if (timer !== undefined) clearTimeout(timer);
			if (timedOut) {
				void Promise.allSettled([stdoutPromise, stderrPromise]);
				await terminateEnvironmentTokenLifecycleProcess(child);
				throw new Error("native reviewed document read timed out");
			}
			const exitCode = await child.exited;
			const [stdout, stderr] = await Promise.all([
				stdoutPromise,
				stderrPromise,
			]);
			return parseBrowserUseNativeDocumentReadProcessOutput({
				stdout,
				stderr,
				exit_code: exitCode,
				signal_code: child.signalCode,
				request,
			});
		},
	};
}

export type BrowserUseEnvironmentTokenLifecycleProcess = {
	readonly exited: Promise<number>;
	kill(signal: "SIGTERM" | "SIGKILL"): unknown;
};

function processExitedWithin(
	exited: Promise<number>,
	timeoutMs: number,
): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(false);
		}, timeoutMs);
		timer.unref?.();
		void exited.then(() => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(true);
		});
	});
}

/**
 * Give native custody its cleanup signal before forcing termination.
 *
 * SIGTERM runs the custody handler that terminates its validator process group.
 * SIGKILL is reserved for a child that outlives the bounded cleanup grace.
 */
export async function terminateEnvironmentTokenLifecycleProcess(
	child: BrowserUseEnvironmentTokenLifecycleProcess,
	graceMs: number = NATIVE_LIFECYCLE_TERMINATION_GRACE_MS,
): Promise<void> {
	child.kill("SIGTERM");
	if (await processExitedWithin(child.exited, graceMs)) return;
	child.kill("SIGKILL");
	await processExitedWithin(child.exited, graceMs);
}

/** Enforce the native executable's exact state-to-exit contract. */
export function assertEnvironmentTokenLifecycleExit(
	exitCode: number,
	signalCode: NodeJS.Signals | null | undefined,
	state: BrowserUseEnvironmentTokenCustodyState,
): void {
	if (signalCode != null) {
		throw new Error("native lifecycle terminated by signal");
	}
	const expectedExitCode = state.state === "blocked" ? 20 : 0;
	if (exitCode !== expectedExitCode) {
		throw new Error("native lifecycle exit did not match its state");
	}
}

function browserUseNativeBinRoot(): string {
	if (import.meta.dir.endsWith("/dist")) return join(import.meta.dir, "bin");
	const sourceBuildRoot = join(
		import.meta.dir,
		"..",
		"..",
		"..",
		"runtime",
		"browser-use-environment-auth",
		".build",
		"release",
	);
	try {
		return realpathSync(sourceBuildRoot);
	} catch {
		return sourceBuildRoot;
	}
}

function fixedOpExecutablePath(): string {
	const preferred =
		process.arch === "arm64"
			? ["/opt/homebrew/bin/op", "/usr/local/bin/op"]
			: ["/usr/local/bin/op", "/opt/homebrew/bin/op"];
	return preferred.find((path) => existsSync(path)) ?? preferred[0];
}

async function checkBrowserUseRootIgnored(path: string): Promise<boolean> {
	let canonicalPath: string;
	try {
		canonicalPath = realpathSync(path);
	} catch {
		return false;
	}
	let child: ReturnType<typeof Bun.spawn>;
	try {
		child = Bun.spawn(
			[
				"/usr/bin/git",
				"-C",
				canonicalPath,
				"check-ignore",
				"-q",
				"--",
				canonicalPath,
			],
			{
				env: { PATH: "/usr/bin:/bin", LANG: "C" },
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			},
		);
	} catch {
		return false;
	}
	if (
		!(await processExitedWithin(child.exited, GIT_IGNORE_PROBE_TIMEOUT_MS))
	) {
		child.kill("SIGTERM");
		if (
			!(await processExitedWithin(
				child.exited,
				NATIVE_LIFECYCLE_TERMINATION_GRACE_MS,
			))
		) {
			child.kill("SIGKILL");
			await processExitedWithin(
				child.exited,
				NATIVE_LIFECYCLE_TERMINATION_GRACE_MS,
			);
		}
		return false;
	}
	return (await child.exited) === 0 && child.signalCode === null;
}

/**
 * Resolve one runtime's config root once, then re-admit that pinned canonical
 * path before every native auth operation. A later XDG symlink retarget cannot
 * split token custody, metadata, and field delivery across different roots.
 */
function createAdmittedCanonicalConfigRootResolver(
	env: Record<string, string | undefined>,
	platformFs: BrowserUsePlatformFs,
): BrowserUseCanonicalConfigRootResolver {
	let canonicalConfigRoot: string | undefined;
	let initialResolution: Promise<string> | undefined;

	const admitCanonical = async (path: string): Promise<string> => {
		const admission = await admitBrowserUseRoot(platformFs, {
			kind: "config",
			path,
			checkIgnored: checkBrowserUseRootIgnored,
		});
		if (!admission.ok) {
			throw new Error("Browser Use config root is unavailable");
		}
		return path;
	};

	return async () => {
		if (canonicalConfigRoot !== undefined) {
			return admitCanonical(canonicalConfigRoot);
		}
		initialResolution ??= (async () => {
			const resolved = resolveBrowserUsePaths(env);
			if (!resolved.ok) {
				throw new Error("Browser Use paths are unavailable");
			}
			const configRoot = resolved.resolution.roots.config;
			await admitCanonical(configRoot);
			const canonical = await platformFs.realpath(configRoot);
			if (canonical === undefined) {
				throw new Error("Browser Use config root is unavailable");
			}
			if (canonical !== configRoot) {
				await admitCanonical(canonical);
			}
			canonicalConfigRoot = canonical;
			return canonical;
		})();
		try {
			return await initialResolution;
		} catch (error) {
			initialResolution = undefined;
			throw error;
		}
	};
}

type BrowserUseAuthStatusExecutableState =
	| "ready"
	| "missing"
	| "unsafe"
	| "unproven";

type BrowserUseAuthStatusExecutableExpectation =
	| {
			kind: "op";
			approved_path: string;
			supervisor_path: string;
	  }
	| {
			kind: "owned-native";
			approved_path: string;
			expected_identifier: string;
	  };

async function inspectOwnedNativeIdentity(
	path: string,
	expectedIdentifier: string,
): Promise<BrowserUseAuthStatusExecutableState> {
	if (process.platform !== "darwin") return "unproven";
	try {
		const child = Bun.spawn(
			["/usr/bin/codesign", "-d", "--verbose=4", path],
			{ env: {}, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			readBoundedNativeOutput(child.stdout),
			readBoundedNativeOutput(child.stderr),
		]);
		const receipt = `${stdout}\n${stderr}`;
		return exitCode === 0 &&
			child.signalCode == null &&
			receipt.includes(`Identifier=${expectedIdentifier}`) &&
			receipt.includes("Signature=adhoc")
			? "ready"
			: "unsafe";
	} catch {
		return "unproven";
	}
}

async function inspectNativeEnvironmentOpAdmission(
	path: string,
	supervisorPath: string,
): Promise<BrowserUseAuthStatusExecutableState> {
	const supervisorState = await inspectBrowserUseAuthStatusExecutable(
		supervisorPath,
		{
			kind: "owned-native",
			approved_path: supervisorPath,
			expected_identifier: "browser-use-op-supervisor",
		},
	);
	if (supervisorState !== "ready") return supervisorState;
	try {
		const invocation = buildEnvironmentOpAdmissionInvocation({
			supervisor_path: supervisorPath,
			op_path: path,
		});
		const child = Bun.spawn(
			[invocation.executable_path, ...invocation.argv],
			{
				env: invocation.env,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const stdoutPromise = readBoundedNativeOutput(child.stdout);
		const stderrPromise = readBoundedNativeOutput(child.stderr);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = await Promise.race([
			child.exited.then(() => false),
			new Promise<true>((resolve) => {
				timer = setTimeout(
					() => resolve(true),
					NATIVE_LIFECYCLE_TIMEOUT_MS,
				);
			}),
		]);
		if (timer !== undefined) clearTimeout(timer);
		if (timedOut) {
			void Promise.allSettled([stdoutPromise, stderrPromise]);
			await terminateEnvironmentTokenLifecycleProcess(child);
			return "unproven";
		}
		const exitCode = await child.exited;
		const [stdout] = await Promise.all([stdoutPromise, stderrPromise]);
		if (child.signalCode != null) return "unproven";
		const state = parseEnvironmentOpAdmissionResult(JSON.parse(stdout));
		const expectedExitCode = state === "ready" ? 0 : 20;
		return exitCode === expectedExitCode ? state : "unproven";
	} catch {
		return "unproven";
	}
}

/**
 * Prove one fixed authentication executable before status reports it ready.
 *
 * The walk rejects links, foreign owners, writable ancestry, non-regular
 * files, multiple hard links, and non-executable modes. OP additionally earns
 * its supported-version result; owned native helpers earn their linker-signed
 * identifier through the same receipt checked during packaging.
 *
 * @param path - Exact absolute executable path selected by the runtime owner
 * @param expectation - Approved path and role-specific identity expectation
 * @returns One bounded readiness state with no executable output relay
 *
 * @example
 * ```typescript
 * await inspectBrowserUseAuthStatusExecutable("/opt/browser-use/bin/helper", {
 *   kind: "owned-native",
 *   approved_path: "/opt/browser-use/bin/helper",
 *   expected_identifier: "browser-use-confidential-delivery",
 * })
 * ```
 */
export async function inspectBrowserUseAuthStatusExecutable(
	path: string,
	expectation: BrowserUseAuthStatusExecutableExpectation,
): Promise<BrowserUseAuthStatusExecutableState> {
	if (
		!isAbsolute(path) ||
		path !== normalize(path) ||
		path !== expectation.approved_path
	) {
		return "unsafe";
	}
	if (expectation.kind === "op") {
		return inspectNativeEnvironmentOpAdmission(
			path,
			expectation.supervisor_path,
		);
	}
	const expectedUid = process.geteuid?.() ?? process.getuid?.();
	let current = path;
	let executable = true;
	try {
		while (true) {
			const metadata = await lstat(current);
			const trustedOwner =
				metadata.uid === 0 ||
				(expectedUid !== undefined && metadata.uid === expectedUid);
			if (
				metadata.isSymbolicLink() ||
				!trustedOwner ||
				(metadata.mode & 0o022) !== 0
			) {
				return "unsafe";
			}
			if (executable) {
				if (
					!metadata.isFile() ||
					metadata.nlink !== 1 ||
					(metadata.mode & 0o111) === 0
				) {
					return "unsafe";
				}
				executable = false;
			} else if (!metadata.isDirectory()) {
				return "unsafe";
			}
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}
	} catch (error) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? String(error.code)
				: undefined;
		if (code === "ENOENT" || code === "ENOTDIR") return "missing";
		if (code === "EACCES" || code === "EPERM") return "unsafe";
		return "unproven";
	}
	return inspectOwnedNativeIdentity(path, expectation.expected_identifier);
}

/**
 * Inspect only local packaged executable availability.
 *
 * Human authority, running-Chrome posture, and route binding have no
 * command-independent production proof owner here. Report those states
 * explicitly as absent/unproven so the status composer can prioritize a
 * bounded repair without claiming live evidence.
 */
function createProductionAuthStatusSupportPort(
	runtime: Pick<
		BrowserUseRuntime,
		"authProfilePosture" | "env" | "now" | "platformFs"
	>,
): BrowserUseAuthStatusSupportPort {
	let executableEvidence:
		| Promise<{
				op: "ready" | "missing" | "unsafe" | "unproven";
				wrapper: "ready" | "missing" | "unsafe" | "unproven";
				helper: "ready" | "missing" | "unsafe" | "unproven";
		  }>
		| undefined;
	const inspectExecutables = () => {
		if (executableEvidence !== undefined) return executableEvidence;
		const nativeBinRoot = browserUseNativeBinRoot();
		const supervisorPath = join(nativeBinRoot, "browser-use-op-supervisor");
		const opPath = fixedOpExecutablePath();
		executableEvidence = Promise.all([
			inspectBrowserUseAuthStatusExecutable(
				opPath,
				{
					kind: "op",
					approved_path: opPath,
					supervisor_path: supervisorPath,
				},
			),
			inspectBrowserUseAuthStatusExecutable(
				supervisorPath,
				{
					kind: "owned-native",
					approved_path: supervisorPath,
					expected_identifier: "browser-use-op-supervisor",
				},
			),
			inspectBrowserUseAuthStatusExecutable(
				join(nativeBinRoot, "browser-use-confidential-delivery"),
				{
					kind: "owned-native",
					approved_path: join(
						nativeBinRoot,
						"browser-use-confidential-delivery",
					),
					expected_identifier: "browser-use-confidential-delivery",
				},
			),
		]).then(([op, wrapper, helper]) => ({ op, wrapper, helper }));
		return executableEvidence;
	};
	return async (coordinates) => {
		const executables = await inspectExecutables();
		let adminAuthority: "proven" | "missing" | "invalid" = "missing";
		let profile: "live-clean" | "missing" | "unsafe" | "unproven" =
			"unproven";
		if (coordinates !== undefined) {
			const opened = await inspectBrowserUsePaths(
				runtime.platformFs,
				runtime.env,
			);
			if (!opened.ok) {
				adminAuthority = "invalid";
			} else {
				const receipt = await createBrowserUseAdminAuthorityReceiptStore({
					fs: runtime.platformFs,
					paths: opened.paths,
					clock: runtime.now,
				}).inspect({
					lane_digest: coordinates.lane_digest,
					principal_digest: coordinates.principal_digest,
					vault_digest: coordinates.vault_digest,
				});
				adminAuthority =
					receipt.state === "proven"
						? "proven"
						: receipt.state === "missing"
							? "missing"
							: "invalid";
			}
			if (
				adminAuthority === "proven" &&
				runtime.authProfilePosture !== undefined
			) {
				try {
					profile = (await runtime.authProfilePosture()).state;
				} catch {
					profile = "unproven";
				}
			}
		}
		return {
			contract: "browser-use.auth-status-support",
			schema_version: "1",
			executables,
			admin_authority: adminAuthority,
			profile,
			binding: "missing",
			proof: null,
		};
	};
}

function environmentMetadataFailure() {
	return {
		ok: false as const,
		rejection: {
			code: "io-failure" as const,
			message: "native OP metadata execution failed.",
		},
	};
}

async function executeNativeEnvironmentMetadata(
	resolveCanonicalConfigRoot: BrowserUseCanonicalConfigRootResolver,
	operation: BrowserUseEnvironmentOpMetadataOperation,
) {
	try {
		const configRoot = await resolveCanonicalConfigRoot();
		const invocation = buildEnvironmentOpMetadataInvocation({
			supervisor_path: join(
				browserUseNativeBinRoot(),
				"browser-use-op-supervisor",
			),
			op_path: fixedOpExecutablePath(),
			config_root: configRoot,
			operation,
		});
		const child = Bun.spawn(
			[invocation.executable_path, ...invocation.argv],
			{
				env: invocation.env,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const stdoutPromise = readBoundedNativeOutput(child.stdout);
		const stderrPromise = readBoundedNativeOutput(child.stderr);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = await Promise.race([
			child.exited.then(() => false),
			new Promise<true>((resolve) => {
				timer = setTimeout(
					() => resolve(true),
					NATIVE_LIFECYCLE_TIMEOUT_MS,
				);
			}),
		]);
		if (timer !== undefined) clearTimeout(timer);
		if (timedOut) {
			void Promise.allSettled([stdoutPromise, stderrPromise]);
			await terminateEnvironmentTokenLifecycleProcess(child);
			return {
				ok: false as const,
				rejection: {
					code: "timeout" as const,
					message: "native OP metadata execution timed out.",
				},
			};
		}
		const exitCode = await child.exited;
		const [stdout] = await Promise.all([stdoutPromise, stderrPromise]);
		if (child.signalCode != null) return environmentMetadataFailure();
		const parsed = parseEnvironmentOpMetadataResult(JSON.parse(stdout));
		const expectedExitCode = parsed.ok ? 0 : 20;
		return exitCode === expectedExitCode
			? parsed
			: environmentMetadataFailure();
	} catch {
		return environmentMetadataFailure();
	}
}

async function executeNativeEnvironmentPrivateDelivery(
	resolveCanonicalConfigRoot: BrowserUseCanonicalConfigRootResolver,
	input: BrowserUseEnvironmentPrivateDeliveryInput,
): Promise<unknown> {
	let started = false;
	try {
		const configRoot = await resolveCanonicalConfigRoot();
		const executable = join(
			browserUseNativeBinRoot(),
			"browser-use-confidential-delivery",
		);
		const child = Bun.spawn(
			[
				executable,
				"private",
				"--config-root",
				configRoot,
				"--op-path",
				fixedOpExecutablePath(),
			],
			{
				env: { PATH: "/usr/bin:/bin", LANG: "C" },
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		started = true;
		child.stdin.write(
			JSON.stringify({
				schema_version: 1,
				browser_ws_endpoint: input.browser_ws_endpoint,
				browser_pid: input.browser_pid,
				binding: {
					vault_id: input.binding.vault_id,
					item_id: input.binding.item_id,
				},
				target: input.target,
				locator: input.locator,
			}),
		);
		child.stdin.end();
		const stdoutPromise = readBoundedNativeOutput(child.stdout);
		const stderrPromise = readBoundedNativeOutput(child.stderr);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = await Promise.race([
			child.exited.then(() => false),
			new Promise<true>((resolve) => {
				timer = setTimeout(
					() => resolve(true),
					NATIVE_LIFECYCLE_TIMEOUT_MS,
				);
			}),
		]);
		if (timer !== undefined) clearTimeout(timer);
		if (timedOut) {
			void Promise.allSettled([stdoutPromise, stderrPromise]);
			await terminateEnvironmentTokenLifecycleProcess(child);
			return unknownPrivateDeliveryResult();
		}
		const exitCode = await child.exited;
		const [stdout] = await Promise.all([stdoutPromise, stderrPromise]);
		if (child.signalCode != null) return unknownPrivateDeliveryResult();
		const parsed: unknown = JSON.parse(stdout);
		const ok =
			typeof parsed === "object" &&
			parsed !== null &&
			"ok" in parsed &&
			(parsed as { ok?: unknown }).ok === true;
		if (exitCode !== (ok ? 0 : 20)) return unknownPrivateDeliveryResult();
		return parsed;
	} catch {
		return started
			? unknownPrivateDeliveryResult()
			: blockedPrivateDeliveryResult();
	}
}

function createNativeEnvironmentTokenRetrievalPort(
	resolveCanonicalConfigRoot: BrowserUseCanonicalConfigRootResolver,
	now: () => number,
	recordCapability: (input: {
		handle: BrowserUseSecretHandle;
		record: BrowserUseEnvironmentDeferredCapability;
	}) => BrowserUseSecretHandle = ({ handle }) => handle,
): BrowserUseTokenRetrievalPort {
	return createEnvironmentOpTokenRetrievalPort({
		executeMetadata: (operation) =>
			executeNativeEnvironmentMetadata(
				resolveCanonicalConfigRoot,
				operation,
			),
		mintCapability: ({ binding, field, target }) => {
			const expiresAt = now() + 60_000;
			const handle = {
				handle_id: `environment-${randomUUID()}`,
				field,
				expires_at_epoch_ms: expiresAt,
			};
			if (target === undefined) return handle;
			return recordCapability({
				handle,
				record: {
					binding: structuredClone(binding),
					field,
					target: { ...target },
					expires_at_epoch_ms: expiresAt,
				},
			});
		},
	});
}

async function readBoundedNativeOutput(
	stream: ReadableStream<Uint8Array>,
): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		total += next.value.byteLength;
		if (total > NATIVE_LIFECYCLE_OUTPUT_LIMIT_BYTES) {
			await reader.cancel();
			throw new Error("native lifecycle output exceeded its bound");
		}
		chunks.push(next.value);
	}
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
		"utf8",
	);
}

function createNativeEnvironmentTokenLifecyclePort(
	resolveCanonicalConfigRoot: BrowserUseCanonicalConfigRootResolver,
): BrowserUseEnvironmentTokenLifecyclePort {
	const nativeBinRoot = browserUseNativeBinRoot();
	const custodyExecutable = join(nativeBinRoot, "browser-use-token-custody");
	const validatorExecutable = join(
		nativeBinRoot,
		"browser-use-op-supervisor",
	);
	const opExecutable = fixedOpExecutablePath();
	return {
		inputIsTTY: () => process.stdin.isTTY === true,
		async execute(input) {
			const canonicalConfigRoot = await resolveCanonicalConfigRoot();
			const invocation = buildEnvironmentTokenCustodyInvocation({
				executable_path: custodyExecutable,
				action: input.action,
				config_root: canonicalConfigRoot,
				...(input.input_channel === "stdin"
					? { input: { kind: "stdin" as const, fd: 0 } }
					: input.input_channel === "tty"
						? { input: { kind: "tty" as const } }
						: {}),
				...(input.action === "install" || input.action === "replace"
					? {
							validator_executable_path: validatorExecutable,
							op_executable_path: opExecutable,
						}
					: {}),
			});
			const child = Bun.spawn(
				[invocation.executable_path, ...invocation.argv],
				{
					env: { PATH: "/usr/bin:/bin", LANG: "C" },
					stdin: input.input_channel === "stdin" ? "inherit" : "ignore",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const stdoutPromise = readBoundedNativeOutput(child.stdout);
			const stderrPromise = readBoundedNativeOutput(child.stderr);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = await Promise.race([
				child.exited.then(() => false),
				new Promise<true>((resolve) => {
					timer = setTimeout(
						() => resolve(true),
						NATIVE_LIFECYCLE_TIMEOUT_MS,
					);
				}),
			]);
			if (timer !== undefined) clearTimeout(timer);
			if (timedOut) {
				void Promise.allSettled([stdoutPromise, stderrPromise]);
				await terminateEnvironmentTokenLifecycleProcess(child);
				throw new Error("native lifecycle timed out");
			}
			const exitCode = await child.exited;
			const [stdout] = await Promise.all([stdoutPromise, stderrPromise]);
			const parsed = parseEnvironmentTokenCustodyState(JSON.parse(stdout));
			assertEnvironmentTokenLifecycleExit(
				exitCode,
				child.signalCode,
				parsed,
			);
			return parsed;
		},
	};
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
	port?: string;
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
				...(input.port === undefined ? [] : ["--port", input.port]),
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

async function inspectProfilePostureInProcess(
	port: string | undefined,
	now: number,
): Promise<BrowserUseProfilePostureStatus> {
	let cli: typeof import("@side-quest/browser-connect/cli");
	try {
		cli = await import("@side-quest/browser-connect/cli");
	} catch {
		return { state: "unproven" };
	}
	const outputLimit = 64 * 1024;
	const capture = () => {
		const chunks: string[] = [];
		let bytes = 0;
		let overflow = false;
		return {
			writer: {
				write: (text: string) => {
					bytes += Buffer.byteLength(text, "utf8");
					if (bytes > outputLimit) {
						overflow = true;
						return true;
					}
					chunks.push(text);
					return true;
				},
			},
			text: () => (overflow ? "" : chunks.join("")),
		};
	};
	const stdout = capture();
	const stderr = capture();
	try {
		const deps = await cli.createProductionDeps();
		const exitCode = await cli.main(
			[
				"check",
				"--json",
				...(port === undefined ? [] : ["--port", port]),
			],
			{ ...deps, stdout: stdout.writer, stderr: stderr.writer },
		);
		return parseBrowserConnectProfilePostureStatus(
			stdout.text(),
			exitCode,
			now,
		);
	} catch {
		return { state: "unproven" };
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
