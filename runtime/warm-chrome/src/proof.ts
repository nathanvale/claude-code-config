// U5: single module owns the whole `check` proof chain (plan decision — no
// per-probe modules). The suggested-explicit-port loopback scan lives inline
// in the port-occupied probe; envelope construction stays with the cli.ts
// chassis, which maps the thrown WarmChromeRuntimeError to a structured
// envelope with Runtime Continuation Guidance.
//
// CDP responses are UNTRUSTED input (plan R6 invariant): every acceptance is
// cross-validated against process identity from the seam's findListener, and
// the browser websocket URL is taken verbatim from a live /json/version
// round-trip — never synthesized, never trusted from argv tokens.

import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

// ESM cycle with cli.ts: safe only because warmChromeRuntimeAction is called
// at invocation time (inside the handler this module returns), never at module
// parse time. cli.ts's defaultCommandHandlers evaluates after imports resolve,
// so function-declaration hoisting covers the cycle. Do not add a module-scope
// call into a cli.ts binding here — that would read undefined under the
// proof-first import order the tests use.
import {
	type WarmChromeCommandHandler,
	warmChromeRuntimeAction,
} from "./cli.ts";
import {
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_SCHEMA_VERSION,
	type WarmChromeCheckErrorCode,
	type WarmChromeCheckReason,
	type WarmChromeCommand,
} from "./model.ts";
import {
	observeWarmChromeEffectivePosture,
	WARM_CHROME_EFFECTIVE_POSTURE_BUDGET_MS,
	type WarmChromeEffectivePostureInput,
} from "./effective-posture.ts";
import {
	expandHome,
	extractUserDataDir,
	isDefaultChromeProfilePath,
	type ListenerProcess,
	parseProcessCommand,
	type ProfileStat,
	readCommandFlagValue,
	isRealGoogleChromeBinary,
	redactListenerDetail,
	tokenizeCommandArgs,
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
	type WarmChromeRuntime,
	WarmChromeRuntimeError,
	type WarmChromeRuntimeErrorOptions,
} from "./runtime.ts";

/**
 * Bounded attach budget for the live `/json/version` HTTP round-trip and the
 * CDP websocket round-trips (plan R6): a hang is `endpoint_unreachable`
 * reason `attach_timeout`, never a silent pass.
 */
export const WARM_CHROME_ATTACH_TIMEOUT_MS = 3000;

/**
 * Bounded unprivileged loopback window for `suggested_explicit_port`
 * (plan R7). Starts above the 9222 convention and never dips below 1024.
 */
export const WARM_CHROME_SUGGESTED_PORT_WINDOW = {
	start: 9223,
	end: 9299,
} as const;

/**
 * One CDP command round-trip over the browser-level websocket.
 */
export type WarmChromeCdpResult = Record<string, unknown>;

/**
 * CDP round-trip seam. The default implementation opens a websocket to the
 * verbatim `webSocketDebuggerUrl`; tests inject canned per-method results.
 */
export type WarmChromeCdpRoundTrip = (
	wsUrl: string,
	method: string,
) => Promise<WarmChromeCdpResult>;

/**
 * Parsed `DevToolsActivePort` hint content used by the repair lifecycle.
 */
export type WarmChromeDevToolsActivePort = {
	port: string;
	wsPath: string;
};

/**
 * Browser-entry dependencies beyond the {@link WarmChromeRuntime} seam. The U4
 * seam carries no websocket or file-read primitive, so the package owns these
 * injectable probes; repair consumes the file hint while every proof consumes
 * the websocket round-trip.
 */
export type WarmChromeProofDeps = {
	/** Live CDP round-trip over the verbatim browser websocket (R6). */
	cdpRoundTrip: WarmChromeCdpRoundTrip;
	/** Redacted effective-state observer bound to the running browser. */
	observeEffectiveCredentialPosture: (
		input: WarmChromeEffectivePostureInput,
	) => ReturnType<typeof observeWarmChromeEffectivePosture>;
	/** Read `<profileDir>/DevToolsActivePort`; null when absent (R6c). */
	readDevToolsActivePort: (
		profileDir: string,
	) => Promise<WarmChromeDevToolsActivePort | null>;
};

/**
 * Build the default proof deps bound to a real websocket and filesystem.
 */
export function createDefaultProofDeps(): WarmChromeProofDeps {
	return {
		cdpRoundTrip: defaultCdpRoundTrip,
		observeEffectiveCredentialPosture: (input) =>
			observeWarmChromeEffectivePosture(input),
		readDevToolsActivePort: defaultReadDevToolsActivePort,
	};
}

function defaultCdpRoundTrip(
	wsUrl: string,
	method: string,
): Promise<WarmChromeCdpResult> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let socket: WebSocket;
		const finish = (settle: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				socket.close();
			} catch {
				// closing an already-dead socket must not mask the settle path
			}
			settle();
		};
		const timer = setTimeout(() => {
			finish(() => reject(new Error(`CDP ${method} round-trip timed out.`)));
		}, WARM_CHROME_ATTACH_TIMEOUT_MS);
		try {
			socket = new WebSocket(wsUrl);
		} catch (error) {
			settled = true;
			clearTimeout(timer);
			reject(error instanceof Error ? error : new Error("CDP websocket failed."));
			return;
		}
		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ id: 1, method }));
		});
		socket.addEventListener("error", () => {
			finish(() => reject(new Error(`CDP ${method} round-trip failed.`)));
		});
		socket.addEventListener("close", () => {
			finish(() =>
				reject(new Error(`CDP ${method} socket closed before a response.`)),
			);
		});
		socket.addEventListener("message", (event) => {
			let payload: unknown;
			try {
				payload = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (!isRecord(payload) || payload.id !== 1) return;
			finish(() => {
				const result = payload.result;
				if (isRecord(result)) {
					resolve(result);
				} else {
					reject(new Error(`CDP ${method} returned no result.`));
				}
			});
		});
	});
}

async function defaultReadDevToolsActivePort(
	profileDir: string,
): Promise<WarmChromeDevToolsActivePort | null> {
	let text: string;
	try {
		const path = join(profileDir, "DevToolsActivePort");
		const info = await lstat(path);
		if (!info.isFile()) {
			throw new Error("DevToolsActivePort is not a regular file.");
		}
		text = await readFile(path, {
			encoding: "utf8",
			signal: AbortSignal.timeout(WARM_CHROME_ATTACH_TIMEOUT_MS),
		});
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") return null;
		throw error;
	}
	const [portLine = "", wsLine = ""] = text
		.split("\n")
		.map((line) => line.trim());
	if (portLine === "" || wsLine === "") return null;
	return { port: portLine, wsPath: wsLine };
}

/**
 * Input the proof chain verifies. `command` is the display command so the
 * envelope names `status` when the alias ran.
 */
export type WarmChromeCheckProofInput = {
	command: WarmChromeCommand;
	endpoint: string;
	port: string;
	profileInput?: string;
};

/**
 * Verified proof result. `data` is the full ok-envelope payload: it is the
 * only endpoint authority (R8) and carries the verbatim browser-level
 * websocket URL plus the observed Chrome build (R17).
 */
export type WarmChromeVerifiedProof = {
	endpoint: string;
	webSocketDebuggerUrl: string;
	browser: string;
	data: Record<string, unknown>;
};

// Per-code envelope shaping so every canonical code maps to its catalog
// station: exit, recoverability, hint, and primary-action routing.
const CHECK_ERROR_ENVELOPE_OPTIONS: Record<
	WarmChromeCheckErrorCode,
	WarmChromeRuntimeErrorOptions
> = {
	endpoint_unreachable: {},
	non_loopback: {
		// Catalog pins exit 20; the input failure domain routes the primary
		// action to change_input without a chassis switch entry.
		exitCode: WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
		failureDomain: "input",
		recoverability: "change_input",
		hintAction: "change_input",
		hintSummary:
			"Use a numeric loopback CDP endpoint such as http://127.0.0.1:<port>.",
	},
	invalid_cdp: {
		primaryActionId: "inspect_listener",
		recoverability: "repair_state",
		hintAction: "repair_state",
		hintSummary: "Stop and inspect the CDP listener before adapter work.",
	},
	port_occupied_foreign: {
		recoverability: "change_input",
		hintAction: "change_input",
		hintSummary:
			"Choose a free CDP port, then rerun the same command with an explicit --port value.",
	},
	wrong_browser: {
		recoverability: "repair_state",
		hintAction: "repair_state",
		hintSummary:
			"Launch real headed Google Chrome with a dedicated persistent profile.",
	},
	unsafe_profile: {
		recoverability: "repair_state",
		hintAction: "repair_state",
		hintSummary: "Run warm-chrome repair with the same port and profile.",
	},
	profile_posture_unsafe: {
		recoverability: "repair_state",
		hintAction: "repair_state",
		hintSummary:
			"Create a fresh isolated Warm Chrome profile after explicit human approval; preserve the prior profile.",
		primaryActionId: "create_clean_profile",
	},
	listener_mismatch: {
		recoverability: "repair_state",
		hintAction: "repair_state",
		hintSummary: "Inspect the current listener before adapter work.",
	},
};

type CheckProofErrorInput = {
	code: WarmChromeCheckErrorCode;
	reason: WarmChromeCheckReason;
	message: string;
	data?: Record<string, unknown>;
};

function checkProofError(input: CheckProofErrorInput): WarmChromeRuntimeError {
	// Result-contract metadata (contract_id, schema_version) is stamped by the
	// cli.ts error-envelope chokepoint; the proof owns only the reason detail.
	const endpointUnreachableOverride =
		input.code === "endpoint_unreachable" && input.reason !== "no_listener"
			? {
					primaryActionId: "inspect_listener" as const,
					recoverability: "repair_state" as const,
					hintAction: "repair_state" as const,
					hintSummary:
						"The CDP port was not proven free; inspect the listener before any launch.",
				}
			: {};
	return new WarmChromeRuntimeError(input.code, input.message, {
		...CHECK_ERROR_ENVELOPE_OPTIONS[input.code],
		...endpointUnreachableOverride,
		data: {
			reason: input.reason,
			...input.data,
		},
	});
}

/**
 * Canonical non-loopback endpoint rejection (station `check.non_loopback`,
 * reason `non_loopback_endpoint`). The cli.ts parser throws this when
 * `--endpoint` names a non-loopback host, so the rejection carries the same
 * canonical code and reason detail as the in-chain loopback assertions.
 */
export function nonLoopbackEndpointError(
	data: Record<string, unknown> = {},
): WarmChromeRuntimeError {
	return checkProofError({
		code: "non_loopback",
		reason: "non_loopback_endpoint",
		message: "Warm Chrome CDP endpoint must be numeric loopback 127.0.0.1.",
		data,
	});
}

/**
 * Run the whole check proof chain against a live endpoint (plan U5).
 *
 * Returns the verified proof or throws a {@link WarmChromeRuntimeError}
 * carrying the canonical station code and closed-union `reason` detail.
 * U6's launch lifecycle re-enters this function after spawning.
 *
 * @param input - Endpoint, port, display command, and optional expected profile
 * @param runtime - Injectable runtime seam
 * @param deps - Websocket and DevToolsActivePort probes; defaults are real
 * @returns Verified proof with the ok-envelope payload
 *
 * @example
 * ```typescript
 * const proof = await runWarmChromeCheckProof(
 *   { command: "check", endpoint: "http://127.0.0.1:9222", port: "9222" },
 *   runtime,
 * )
 * ```
 */
export async function runWarmChromeCheckProof(
	input: WarmChromeCheckProofInput,
	runtime: WarmChromeRuntime,
	deps: WarmChromeProofDeps = createDefaultProofDeps(),
): Promise<WarmChromeVerifiedProof> {
	const contextData = {
		command: input.command,
		endpoint: input.endpoint,
		port: input.port,
	};
	const fail = (
		code: WarmChromeCheckErrorCode,
		reason: WarmChromeCheckReason,
		message: string,
		data: Record<string, unknown> = {},
	): WarmChromeRuntimeError =>
		checkProofError({ code, reason, message, data: { ...contextData, ...data } });

	// 1. Numeric-loopback assertion before anything trusts the endpoint: a
	// mangled hosts file can point the localhost alias anywhere (R6).
	const endpointUrl = new URL(input.endpoint);
	if (endpointUrl.hostname === "localhost") {
		throw fail(
			"non_loopback",
			"localhost_alias",
			"Warm Chrome CDP endpoint must be numeric loopback 127.0.0.1, not the localhost alias.",
		);
	}
	if (endpointUrl.hostname !== "127.0.0.1") {
		throw fail(
			"non_loopback",
			"non_loopback_endpoint",
			"Warm Chrome CDP endpoint must be numeric loopback 127.0.0.1.",
		);
	}

	// 2. Live /json/version HTTP round-trip under the bounded attach budget —
	// never trust argv tokens (R6); a hang is a verdict, not a wait (R7a).
	const probe = await probeJsonVersion(input.endpoint, runtime);
	if (probe.kind === "timeout") {
		throw fail(
			"endpoint_unreachable",
			"attach_timeout",
			"The CDP endpoint did not answer /json/version within the attach budget.",
		);
	}
	if (probe.kind === "error") {
		throw await classifyUnreachable(input, runtime, probe.error, fail);
	}

	// 3. Listener identity next: CDP responses are untrusted input, so the
	// payload is only trusted after cross-validation against process identity.
	const listener = await resolveListener(input, runtime, fail);
	const parsedCommand = parseProcessCommand(listener.command);
	const binaryClass = classifyListenerBinary(parsedCommand.executable);
	if (binaryClass === "foreign") {
		throw await portOccupiedForeignError({
			input,
			runtime,
			reason: "foreign_listener",
			message: "The requested CDP port is owned by a foreign process.",
			listener,
			fail,
		});
	}
	if (binaryClass !== "real_google_chrome") {
		// Identity decided by BINARY PATH via findListener, never by the CDP
		// banner: a clean banner with a CfT binary path still rejects (R6).
		throw fail(
			"wrong_browser",
			binaryClass,
			"CDP listener is not the real Google Chrome app binary.",
			{ listener: redactListenerDetail(listener) },
		);
	}

	// R6c: a /json/version answer while pointed at the DEFAULT profile is a
	// foreign Chrome — the hardened default-profile server has no HTTP endpoint.
	const userDataDirRaw = extractUserDataDir(listener.command);
	const userDataDir =
		userDataDirRaw === null ? null : expandHome(userDataDirRaw, runtime.env);
	if (userDataDir !== null && !isAbsolute(userDataDir)) {
		throw fail(
			"unsafe_profile",
			"invalid_profile_path",
			"Chrome --user-data-dir is relative and cannot be verified safely.",
			{ listener: redactListenerDetail(listener) },
		);
	}
	if (
		userDataDir === null ||
		isDefaultChromeProfilePath(userDataDir, runtime.env)
	) {
		throw await portOccupiedForeignError({
			input,
			runtime,
			reason: "json_answers_on_default_profile",
			message:
				"A CDP server answered /json/version on the default Chrome profile; treating it as a foreign instance.",
			listener,
			fail,
		});
	}

	if (!hasRemoteDebuggingPort(parsedCommand.args, input.port)) {
		throw fail(
			"listener_mismatch",
			"port_mismatch",
			"Google Chrome listener does not use the requested CDP port.",
			{ listener: redactListenerDetail(listener) },
		);
	}

	// 4. Validate the /json/version payload shape.
	if (!isRecord(probe.value)) {
		throw fail(
			"invalid_cdp",
			"malformed_json_version",
			"CDP /json/version response was not a JSON object.",
		);
	}
	const version = probe.value;
	const browserBanner = stringField(version, "Browser");
	const httpUserAgent = stringField(version, "User-Agent");
	if (browserBanner === null || httpUserAgent === null) {
		throw fail(
			"invalid_cdp",
			"malformed_json_version",
			"CDP /json/version response is missing required fields.",
		);
	}
	// Untrusted-input cross-check: a crafted payload that reports a process
	// identity disagreeing with the observed listener is rejected.
	if (version.pid !== undefined && Number(version.pid) !== listener.pid) {
		throw fail(
			"listener_mismatch",
			"pid_mismatch",
			"CDP /json/version reports a process identity that disagrees with the observed listener.",
			{ listener: redactListenerDetail(listener) },
		);
	}

		const webSocketDebuggerUrl = stringField(version, "webSocketDebuggerUrl");
		if (webSocketDebuggerUrl === null) {
		// R7a: a target missing its websocket under multi-client contention is
		// not a dead browser. Re-probe before any browser-down verdict.
		const reProbe = await probeJsonVersion(input.endpoint, runtime);
			if (reProbe.kind === "value") {
				throw fail(
					"invalid_cdp",
				"cdp_contention",
					"CDP target is missing its webSocketDebuggerUrl while the browser stays live; another client likely holds it.",
				);
			}
			if (reProbe.kind === "timeout") {
				throw fail(
					"endpoint_unreachable",
					"attach_timeout",
					"CDP endpoint stopped answering /json/version within the attach budget.",
					{ listener: redactListenerDetail(listener) },
				);
			}
			throw fail(
				"invalid_cdp",
				"roundtrip_failed",
				"CDP endpoint failed during webSocketDebuggerUrl contention re-probe.",
				{ listener: redactListenerDetail(listener) },
			);
		}

	let ws: URL;
	try {
		ws = new URL(webSocketDebuggerUrl);
	} catch {
		throw fail(
			"invalid_cdp",
			"malformed_json_version",
			"CDP websocket URL is invalid.",
		);
	}
	if (
		ws.protocol !== "ws:" ||
		ws.hostname !== "127.0.0.1" ||
		ws.port !== input.port
	) {
		throw fail(
			"non_loopback",
			"non_loopback_websocket",
			"CDP websocket URL is not pinned to the requested numeric loopback port.",
		);
	}
	if (!ws.pathname.startsWith("/devtools/browser/")) {
		throw fail(
			"invalid_cdp",
			"malformed_json_version",
			"CDP websocket URL is not a browser-level DevTools target.",
		);
	}

	// 5. Browser.getVersion round-trip over the VERBATIM websocket: a
	// parseable /json/version does not prove an attachable browser (R6).
	let browserVersion: WarmChromeCdpResult;
	try {
		browserVersion = await deps.cdpRoundTrip(
			webSocketDebuggerUrl,
			"Browser.getVersion",
		);
	} catch {
		throw fail(
			"invalid_cdp",
			"roundtrip_failed",
			"Browser.getVersion round-trip over the browser websocket failed.",
		);
	}
	const cdpUserAgent =
		typeof browserVersion.userAgent === "string" ? browserVersion.userAgent : "";
	// R6b: headless-new is shape-identical to headed; the UA is the only
	// reliable CDP tell.
	if (/headless/i.test(`${cdpUserAgent} ${httpUserAgent}`)) {
		throw fail(
			"wrong_browser",
			"headless_not_headed",
			"CDP User-Agent reports headless Chrome; Warm Chrome must be headed.",
			{ listener: redactListenerDetail(listener) },
		);
	}
	const observedBuild =
		typeof browserVersion.product === "string" && browserVersion.product !== ""
			? browserVersion.product
			: browserBanner;

	// 6. Default-context assertion (R6a): the proof must sit on the
	// persistent-profile default context, not an isolated/incognito one.
	let browserContexts: WarmChromeCdpResult;
	let targets: WarmChromeCdpResult;
	try {
		browserContexts = await deps.cdpRoundTrip(
			webSocketDebuggerUrl,
			"Target.getBrowserContexts",
		);
		targets = await deps.cdpRoundTrip(webSocketDebuggerUrl, "Target.getTargets");
	} catch {
		throw fail(
			"invalid_cdp",
			"roundtrip_failed",
			"Target round-trips over the browser websocket failed.",
		);
	}
	if (!hasDefaultContextPage(browserContexts, targets)) {
		throw fail(
			"wrong_browser",
			"isolated_context",
			"No page target lives on the persistent default browser context.",
			{ listener: redactListenerDetail(listener) },
		);
	}

	// 7. Profile posture: dedicated, persistent, owner-only, and resolved
	// under the dedicated user-data-dir (Chrome 136+ --profile-directory remap).
	const listenerData = { listener: redactListenerDetail(listener) };
	let profile: ProfileStat;
	try {
		profile = await runtime.statProfile(userDataDir);
	} catch {
		throw fail(
			"unsafe_profile",
			"invalid_profile_path",
			"Chrome profile directory could not be resolved.",
			listenerData,
		);
	}
		if (isDefaultChromeProfilePath(profile.realPath, runtime.env)) {
		throw await portOccupiedForeignError({
			input,
			runtime,
			reason: "json_answers_on_default_profile",
			message:
				"Listener profile resolves into the default Chrome profile; treating it as a foreign instance.",
			listener,
			fail,
		});
	}
	if (
		runtime.isTemporaryPath(userDataDir) ||
		runtime.isTemporaryPath(profile.realPath)
	) {
		throw fail(
			"unsafe_profile",
			"throwaway_profile",
			"Warm Chrome profile must be persistent, not a throwaway temporary directory.",
			listenerData,
		);
	}
	if (profile.mode !== "700") {
		throw fail(
			"unsafe_profile",
			"unsafe_profile_permissions",
			"Warm Chrome profile must be owner-only.",
			listenerData,
		);
	}
	const profileDirectory = readCommandFlagValue(
		parsedCommand.args,
		"--profile-directory",
	);
	if (profileDirectory === null) {
		throw fail(
			"profile_posture_unsafe",
			"controls_unproven",
			"Chrome active profile cannot be proven without an explicit --profile-directory.",
			listenerData,
		);
	}
	let resolvedProfile: ProfileStat;
	try {
		resolvedProfile = await runtime.statProfile(
			join(profile.realPath, profileDirectory),
		);
	} catch {
		throw fail(
			"unsafe_profile",
			"invalid_profile_path",
			"Chrome --profile-directory could not be resolved.",
			listenerData,
		);
	}
	if (
		resolvedProfile.realPath !== profile.realPath &&
		!resolvedProfile.realPath.startsWith(`${profile.realPath}/`)
	) {
		throw fail(
			"unsafe_profile",
			"profile_dir_remap",
			"Resolved profile path does not live under the dedicated user-data-dir.",
			listenerData,
		);
	}
	const activeProfileDir = resolvedProfile.realPath;
	if (input.profileInput !== undefined) {
		const providedPath = expandHome(input.profileInput, runtime.env);
			if (isDefaultChromeProfilePath(providedPath, runtime.env)) {
			throw fail(
				"unsafe_profile",
				"default_profile",
				"Warm Chrome cannot use the everyday default Chrome profile.",
			);
		}
		if (runtime.isTemporaryPath(providedPath)) {
			throw fail(
				"unsafe_profile",
				"throwaway_profile",
				"Warm Chrome profile must be persistent, not a throwaway temporary directory.",
			);
		}
		let provided: ProfileStat;
		try {
			provided = await runtime.statProfile(providedPath);
		} catch {
			throw fail(
				"unsafe_profile",
				"invalid_profile_path",
				"Provided profile directory does not exist.",
			);
		}
			if (isDefaultChromeProfilePath(provided.realPath, runtime.env)) {
			throw fail(
				"unsafe_profile",
				"default_profile",
				"Warm Chrome cannot use the everyday default Chrome profile.",
			);
		}
		if (provided.realPath !== profile.realPath) {
			throw fail(
				"listener_mismatch",
				"profile_mismatch",
				"Provided profile does not match the listener profile.",
				listenerData,
			);
		}
	}

	// 8. Credential-clean posture. The runtime owner reads only the active
	// profile's controls and a bounded `SELECT 1` from Login Data; this proof
	// receives redacted states only and never raw preferences or credential rows.
	const disableSyncSwitch = tokenizeCommandArgs(parsedCommand.args).includes(
		"--disable-sync",
	);
	const disableExtensionsSwitch = tokenizeCommandArgs(
		parsedCommand.args,
	).includes("--disable-extensions");
	let credentialPosture = await runtime.inspectCredentialPosture({
		activeProfileDir,
		syncDisabledByLaunch: disableSyncSwitch,
		extensionsDisabledByLaunch: disableExtensionsSwitch,
	});
	const observedEffective = await deps.observeEffectiveCredentialPosture({
		activeProfileDir,
		browserPid: listener.pid,
		port: input.port,
		webSocketDebuggerUrl,
		disableSyncSwitch,
		disableExtensionsSwitch,
	});
	const observedAtMs =
		observedEffective.observation === "running-chrome"
			? observedEffective.observer.observedAtMs
			: null;
	const nowMs = runtime.now();
	const effective =
		observedEffective.observation === "running-chrome" &&
		observedEffective.observer.browserPid === listener.pid &&
		observedEffective.observer.port === input.port &&
		observedEffective.observer.profileMatch === "exact" &&
		observedAtMs !== null &&
		observedAtMs <= nowMs &&
		nowMs - observedAtMs <= WARM_CHROME_EFFECTIVE_POSTURE_BUDGET_MS
			? observedEffective
			: ({ observation: "not-observed" } as const);
	credentialPosture = {
		...credentialPosture,
		disk: {
			...credentialPosture.disk,
			storedLogin:
				effective.observation === "running-chrome" &&
				effective.fillExposure === "no-source" &&
				credentialPosture.disk.storedLogin !== "present"
					? "live-observed-absent"
					: credentialPosture.disk.storedLogin,
		},
		effective,
	};
	const credentialPostureReason = resolveProfilePostureReason(
		credentialPosture,
	);
	if (credentialPostureReason !== null) {
		throw fail(
			"profile_posture_unsafe",
			credentialPostureReason,
			"Warm Chrome profile posture is not clean.",
			{
				credential_posture: projectCredentialPosture(credentialPosture),
			},
		);
	}

	// 9. Final consistency: the listener that answered the whole chain must
	// still be the listener on the port.
	let finalListener: ListenerProcess | null;
	try {
		finalListener = await runtime.findListener(input.port);
	} catch (error) {
		if (
			error instanceof WarmChromeRuntimeError &&
			error.code === "listener_uninspectable"
		) {
			throw fail(
				"listener_mismatch",
				"listener_missing",
				"CDP listener could not be re-inspected after verification.",
			);
		}
		throw error;
	}
	if (finalListener === null) {
		throw fail(
			"listener_mismatch",
			"listener_missing",
			"CDP listener disappeared during verification.",
		);
	}
	if (finalListener.pid !== listener.pid) {
		throw fail(
			"listener_mismatch",
			"pid_mismatch",
			"CDP listener pid changed during verification.",
			listenerData,
		);
	}

	// 10. Verified. The ok envelope is the only endpoint authority (R8) and
	// records the observed Chrome build (R17). The verbatim websocket URL is
	// exempt from redaction on this JSON channel only (R13).
	return {
		endpoint: input.endpoint,
		webSocketDebuggerUrl,
		browser: observedBuild,
		data: {
			contract_id: WARM_CHROME_CONTRACT_ID,
			schema_version: WARM_CHROME_SCHEMA_VERSION,
			ok: true,
			action: "browser_ready",
			command: input.command,
			endpoint: input.endpoint,
			port: input.port,
			browser: observedBuild,
			user_agent: cdpUserAgent === "" ? httpUserAgent : cdpUserAgent,
			web_socket_debugger_url: webSocketDebuggerUrl,
			browser_pid: listener.pid,
			profile_dir: profile.realPath,
			profile_owner: profile.owner,
			profile_permissions: profile.mode,
			credential_posture: projectCredentialPosture(credentialPosture),
		},
	};
}

export type ProfilePostureReason = Extract<
	WarmChromeCheckReason,
	| "save_control_enabled"
	| "autofill_control_enabled"
	| "sync_enabled"
	| "stored_login_present"
	| "save_prompt_observed"
	| "controls_unproven"
>;

export function resolveProfilePostureReason(
	posture: Awaited<ReturnType<WarmChromeRuntime["inspectCredentialPosture"]>>,
): ProfilePostureReason | null {
	const configurationReason = resolveProfileConfigurationReason(posture);
	if (configurationReason !== null) {
		return configurationReason;
	}
	if (posture.effective.observation !== "running-chrome") {
		return "controls_unproven";
	}
	if (posture.effective.savePrompt === "observed") {
		return "save_prompt_observed";
	}
	if (posture.effective.saveCapability === "enabled") {
		return "save_control_enabled";
	}
	if (posture.effective.fillExposure === "source-present") {
		return "stored_login_present";
	}
	if (posture.effective.syncState === "enabled") {
		return "sync_enabled";
	}
	if (
		posture.effective.saveCapability !== "disabled" ||
		posture.effective.fillExposure !== "no-source" ||
		posture.effective.syncState !== "disabled" ||
		posture.effective.savePrompt !== "suppressed"
	) {
		return "controls_unproven";
	}
	return null;
}

export function resolveProfileConfigurationReason(
	posture: Awaited<ReturnType<WarmChromeRuntime["inspectCredentialPosture"]>>,
): ProfilePostureReason | null {
	if (posture.disk.storedLogin === "present") {
		return "stored_login_present";
	}
	if (posture.disk.saveSetting === "enabled") {
		return "save_control_enabled";
	}
	if (posture.disk.autoSignInSetting === "enabled") {
		return "autofill_control_enabled";
	}
	if (posture.disk.syncSetting === "enabled") {
		return "sync_enabled";
	}
	if (
		posture.disk.saveSetting !== "disabled" ||
		posture.disk.autoSignInSetting !== "disabled" ||
		posture.disk.syncSetting !== "disabled" ||
		(posture.disk.storedLogin !== "absent" &&
			posture.disk.storedLogin !== "live-observed-absent") ||
		posture.process.disableSyncSwitch !== "present" ||
		posture.process.disableExtensionsSwitch !== "present"
	) {
		return "controls_unproven";
	}
	return null;
}

function projectCredentialPosture(
	posture: Awaited<ReturnType<WarmChromeRuntime["inspectCredentialPosture"]>>,
): Record<string, unknown> {
	const state = projectCredentialPostureState(posture);
	return {
		state,
		disk: {
			save_setting: posture.disk.saveSetting,
			auto_signin_setting: posture.disk.autoSignInSetting,
			sync_setting: posture.disk.syncSetting,
			stored_login: posture.disk.storedLogin,
		},
		process: {
			disable_sync_switch: posture.process.disableSyncSwitch,
			disable_extensions_switch: posture.process.disableExtensionsSwitch,
		},
		effective:
			posture.effective.observation === "not-observed"
				? { observation: "not-observed" }
				: {
						observation: "running-chrome",
						save_capability: posture.effective.saveCapability,
						fill_exposure: posture.effective.fillExposure,
						sync_state: posture.effective.syncState,
						save_prompt: posture.effective.savePrompt,
						observer: {
							source: posture.effective.observer.source,
							browser_pid: posture.effective.observer.browserPid,
							port: posture.effective.observer.port,
							profile_match: posture.effective.observer.profileMatch,
							observed_at_ms: posture.effective.observer.observedAtMs,
						},
					},
	};
}

function projectCredentialPostureState(
	posture: Awaited<ReturnType<WarmChromeRuntime["inspectCredentialPosture"]>>,
): "live-clean" | "configuration-only" | "unsafe" | "unproven" {
	if (
		posture.disk.storedLogin === "present" ||
		posture.disk.saveSetting === "enabled" ||
		posture.disk.autoSignInSetting === "enabled" ||
		posture.disk.syncSetting === "enabled" ||
		(posture.effective.observation === "running-chrome" &&
			(posture.effective.saveCapability === "enabled" ||
				posture.effective.fillExposure === "source-present" ||
				posture.effective.syncState === "enabled" ||
				posture.effective.savePrompt === "observed"))
	) {
		return "unsafe";
	}
	if (
		posture.disk.saveSetting !== "disabled" ||
		posture.disk.autoSignInSetting !== "disabled" ||
		posture.disk.syncSetting !== "disabled" ||
		(posture.disk.storedLogin !== "absent" &&
			posture.disk.storedLogin !== "live-observed-absent") ||
		posture.process.disableSyncSwitch !== "present" ||
		posture.process.disableExtensionsSwitch !== "present"
	) {
		return "unproven";
	}
	if (posture.effective.observation === "not-observed") {
		return "configuration-only";
	}
	if (
		posture.effective.saveCapability !== "disabled" ||
		posture.effective.fillExposure !== "no-source" ||
		posture.effective.syncState !== "disabled" ||
		posture.effective.savePrompt !== "suppressed"
	) {
		return "unproven";
	}
	return "live-clean";
}

/**
 * Build the `check` command handler (also serving the `status` alias).
 *
 * @param overrides - Proof-dep overrides; tests inject canned CDP results
 * @returns Handler for the cli.ts dispatch registry
 */
export function createCheckCommandHandler(
	overrides: Partial<WarmChromeProofDeps> = {},
): WarmChromeCommandHandler {
	const deps: WarmChromeProofDeps = { ...createDefaultProofDeps(), ...overrides };
	return async (invocation, runtime) => {
		const proof = await runWarmChromeCheckProof(
			{
				command: invocation.displayCommand,
				endpoint: invocation.endpoint,
				port: invocation.port,
				...(invocation.profileInput === undefined
					? {}
					: { profileInput: invocation.profileInput }),
			},
			runtime,
			deps,
		);
		const action = warmChromeRuntimeAction("use_verified_endpoint");
		return {
			data: proof.data,
			plain: [
				"browser_ready",
				`command=${invocation.displayCommand}`,
				`endpoint=${proof.endpoint}`,
				`port=${invocation.port}`,
				`browser=${proof.browser}`,
				`profile=${String(proof.data.profile_dir)}`,
			].join(" "),
			runtimeActions: [
				{
					...action,
					// R8: guidance carries the ACTUAL verified endpoint; consumers
					// never derive it from the 9222 convention.
					summary: `${action.summary} Verified endpoint: ${proof.endpoint}.`,
				},
			],
			continuation: { next_action_id: "use_verified_endpoint" },
		};
	};
}

type FailBuilder = (
	code: WarmChromeCheckErrorCode,
	reason: WarmChromeCheckReason,
	message: string,
	data?: Record<string, unknown>,
) => WarmChromeRuntimeError;

type AttachProbe =
	| { kind: "value"; value: unknown }
	| { kind: "error"; error: unknown }
	| { kind: "timeout" };

async function probeJsonVersion(
	endpoint: string,
	runtime: WarmChromeRuntime,
): Promise<AttachProbe> {
	return Promise.race([
		runtime.fetchJson(`${endpoint}/json/version`).then(
			(value): AttachProbe => ({ kind: "value", value }),
			(error): AttachProbe => ({ kind: "error", error }),
		),
		runtime
			.sleep(WARM_CHROME_ATTACH_TIMEOUT_MS)
			.then((): AttachProbe => ({ kind: "timeout" })),
	]);
}

// HTTP probe failed. Decide between "nothing listens", "pipe-only CDP",
// "listener speaks HTTP but serves no /json/version", and "foreign squatter".
async function classifyUnreachable(
	input: WarmChromeCheckProofInput,
	runtime: WarmChromeRuntime,
	probeError: unknown,
	fail: FailBuilder,
): Promise<WarmChromeRuntimeError> {
	let listener: ListenerProcess | null = null;
	try {
		listener = await runtime.findListener(input.port);
	} catch (error) {
		if (
			error instanceof WarmChromeRuntimeError &&
			error.code === "listener_uninspectable"
		) {
			// The endpoint probe failed AND the listener probe cannot attribute
			// the port (lsof blocked: EACCES/ENOENT). We cannot prove the port is
			// free, so this must NOT collapse to no_listener — that is the one
			// reason launch's gate treats as "safe to spawn". Fail closed with a
			// distinct reason that never licenses a spawn.
			return fail(
				"endpoint_unreachable",
				"probe_unavailable",
				"The CDP listener probe is unavailable, so the port cannot be proven free.",
			);
		}
		// An unexpected error reached this catch — a thrown fault, never a
		// no-listener null. It is not proof the port is free, so it must never
		// collapse to no_listener (launch's spawn-licensing reason). Rethrow,
		// mirroring resolveListener; the runtime_failure net owns the verdict.
		throw error;
	}
	if (listener !== null) {
		const parsed = parseProcessCommand(listener.command);
		if (classifyListenerBinary(parsed.executable) !== "real_google_chrome") {
			return portOccupiedForeignError({
				input,
				runtime,
				reason: "foreign_listener",
				message: "The requested CDP port is owned by a foreign process.",
				listener,
				fail,
			});
		}
		const args = tokenizeCommandArgs(parsed.args);
		if (args.includes("--remote-debugging-pipe")) {
			return fail(
				"endpoint_unreachable",
				"pipe_only_no_tcp",
				"Chrome runs pipe-only remote debugging; no TCP CDP listener answers.",
				{ listener: redactListenerDetail(listener, { env: runtime.env }) },
			);
		}
		if (isHttpStatusFailure(probeError)) {
			return fail(
				"invalid_cdp",
				"ws_only_no_http",
				"Listener answers HTTP but serves no /json/version; CDP appears websocket-only.",
				{ listener: redactListenerDetail(listener, { env: runtime.env }) },
			);
		}
		// An aborted/timed-out probe is a hang, not a CDP verdict on the
		// listener — it must classify as attach_timeout even with a real
		// Chrome listener present, never fall through to roundtrip_failed.
		if (isAbortError(probeError)) {
			return fail(
				"endpoint_unreachable",
				"attach_timeout",
				"The CDP endpoint accepted the connection but did not answer within the attach budget.",
			);
		}
		return fail(
			"invalid_cdp",
			"roundtrip_failed",
			"CDP endpoint failed while a real Google Chrome listener occupied the port.",
			{ listener: redactListenerDetail(listener, { env: runtime.env }) },
		);
	}
	if (isHttpStatusFailure(probeError)) {
		return portOccupiedForeignError({
			input,
			runtime,
			reason: "listener_uninspectable",
			message:
				"A CDP-like HTTP server answers on the port but no inspectable local listener owns it.",
			fail,
		});
	}
	// A fetch that aborted/timed out is a hang, not proof the port is free — it
	// must not license a spawn. (The default runtime's abort sits above the
	// attach budget so the proof's own timeout wins first, but an injected
	// fetchJson may still surface an AbortError here.)
	if (isAbortError(probeError)) {
		return fail(
			"endpoint_unreachable",
			"attach_timeout",
			"The CDP endpoint accepted the connection but did not answer within the attach budget.",
		);
	}
	if (!isConnectionRefusedError(probeError)) {
		return fail(
			"endpoint_unreachable",
			"probe_unavailable",
			"The endpoint probe failed without proving the CDP port is free.",
		);
	}
	return fail(
		"endpoint_unreachable",
		"no_listener",
		"No Chrome DevTools endpoint answered on the resolved CDP endpoint.",
	);
}

// AbortError / TimeoutError from an aborted fetch — a hang, distinct from a
// connection refusal.
function isAbortError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	);
}

function isConnectionRefusedError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	// The canonical errno field is the sturdy signal; the message regex keeps
	// matching injected fetchJson errors that carry only prose. This check
	// licenses a spawn (no_listener), so a miss only over-refuses — but it
	// must not depend on Bun's exact message wording alone.
	if ((error as NodeJS.ErrnoException).code === "ECONNREFUSED") return true;
	return /\b(?:ECONNREFUSED|connection refused|connect refused)\b/i.test(
		error.message,
	);
}

async function resolveListener(
	input: WarmChromeCheckProofInput,
	runtime: WarmChromeRuntime,
	fail: FailBuilder,
): Promise<ListenerProcess> {
	let listener: ListenerProcess | null;
	try {
		listener = await runtime.findListener(input.port);
	} catch (error) {
		if (
			error instanceof WarmChromeRuntimeError &&
			error.code === "listener_uninspectable"
		) {
			throw await uninspectableListenerError(input, runtime, fail);
		}
		throw error;
	}
	if (listener === null) {
		throw await uninspectableListenerError(input, runtime, fail);
	}
	return listener;
}

// CDP answers but no local listener can be attributed (lsof-invisible or
// probe-blocked): fail closed as a foreign occupation with the pid omitted.
async function uninspectableListenerError(
	input: WarmChromeCheckProofInput,
	runtime: WarmChromeRuntime,
	fail: FailBuilder,
): Promise<WarmChromeRuntimeError> {
	return portOccupiedForeignError({
		input,
		runtime,
		reason: "listener_uninspectable",
		message:
			"A CDP server answers on the port but no inspectable local listener owns it.",
		fail,
	});
}

async function portOccupiedForeignError(options: {
	input: WarmChromeCheckProofInput;
	runtime: WarmChromeRuntime;
	reason: Extract<
		WarmChromeCheckReason,
		"foreign_listener" | "json_answers_on_default_profile" | "listener_uninspectable"
	>;
	message: string;
	listener?: ListenerProcess;
	fail: FailBuilder;
}): Promise<WarmChromeRuntimeError> {
	// Suggested explicit port (R7), inline in the port-occupied probe: an
	// informational hint only — no spawn, no persistence, no rebinding. A
	// suggestion becomes usable solely via an explicit --port/--endpoint rerun
	// plus a successful proof.
	const suggested = await scanSuggestedExplicitPort(options.runtime, options.input.port);
	return options.fail("port_occupied_foreign", options.reason, options.message, {
		// This station has DECLARED the listener a foreign instance; redact it as
		// foreign (pid + basename only) so a real Chrome on the default profile
		// does not leak its user_data_dir into the envelope.
		...(options.listener
			? { listener: redactListenerDetail(options.listener, { forceForeign: true }) }
			: {}),
		...(suggested === undefined ? {} : { suggested_explicit_port: suggested }),
	});
}

async function scanSuggestedExplicitPort(
	runtime: WarmChromeRuntime,
	occupiedPort: string,
): Promise<number | undefined> {
	for (
		let candidate = WARM_CHROME_SUGGESTED_PORT_WINDOW.start;
		candidate <= WARM_CHROME_SUGGESTED_PORT_WINDOW.end;
		candidate += 1
	) {
		if (String(candidate) === occupiedPort) continue;
		let listener: ListenerProcess | null;
		try {
			listener = await runtime.findListener(String(candidate));
		} catch {
			// Freeness unproven for this candidate; never suggest it.
			continue;
		}
		if (listener === null) return candidate;
	}
	return undefined;
}

type ListenerBinaryClass =
	| "real_google_chrome"
	| "chrome_for_testing"
	| "chromium"
	| "electron_or_other"
	| "foreign";

function classifyListenerBinary(executable: string): ListenerBinaryClass {
	if (isRealGoogleChromeBinary(executable)) return "real_google_chrome";
	if (/chrome for testing|chrome-mac/i.test(executable)) {
		return "chrome_for_testing";
	}
	if (/chromium/i.test(executable)) return "chromium";
	if (
		/electron|slack|discord|visual studio code|code helper|microsoft edge|brave|vivaldi|opera/i.test(
			executable,
		)
	) {
		return "electron_or_other";
	}
	return "foreign";
}

function hasRemoteDebuggingPort(args: string, port: string): boolean {
	const tokens = tokenizeCommandArgs(args);
	return tokens.some((token, index) => {
		if (token === `--remote-debugging-port=${port}`) return true;
		return token === "--remote-debugging-port" && tokens[index + 1] === port;
	});
}

function hasDefaultContextPage(
	browserContexts: WarmChromeCdpResult,
	targets: WarmChromeCdpResult,
): boolean {
	// Real Chrome stamps default-context page targets with the same non-empty
	// GUID getBrowserContexts reports as defaultBrowserContextId; only pages
	// whose id is absent/empty or equal to that GUID are default-context. Any
	// other id — including one minted between the two snapshots — fails closed.
	const defaultContextId =
		typeof browserContexts.defaultBrowserContextId === "string" &&
		browserContexts.defaultBrowserContextId !== ""
			? browserContexts.defaultBrowserContextId
			: null;
	const targetInfos = Array.isArray(targets.targetInfos) ? targets.targetInfos : [];
	let sawPage = false;
	return (
		targetInfos.some((target) => {
			if (!isRecord(target) || target.type !== "page") return false;
			sawPage = true;
			const contextId = target.browserContextId;
			if (typeof contextId !== "string" || contextId === "") return true;
			return contextId === defaultContextId;
		}) || !sawPage
	);
}

// The default runtime's fetchJson throws `request failed: <status>` when the
// listener speaks HTTP but answers non-200 — the ws-only-config discriminator.
function isHttpStatusFailure(error: unknown): boolean {
	return error instanceof Error && /^request failed: \d+/.test(error.message);
}

function stringField(value: Record<string, unknown>, key: string): string | null {
	const field = value[key];
	if (typeof field !== "string" || field.trim() === "") return null;
	return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
