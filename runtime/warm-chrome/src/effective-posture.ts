const CDP_COMMAND_TIMEOUT_MS = 2_000;
const CDP_OPEN_TIMEOUT_MS = 2_000;

/**
 * Whole budget for one fresh running-Chrome posture observation.
 */
export const WARM_CHROME_EFFECTIVE_POSTURE_BUDGET_MS = 5_000;

/**
 * Effective credential posture observed inside the exact running Chrome.
 */
export type WarmChromeEffectiveCredentialPosture =
	| { observation: "not-observed" }
	| {
			observation: "running-chrome";
			saveCapability: "disabled" | "enabled" | "unproven";
			fillExposure: "no-source" | "source-present" | "unproven";
			syncState: "disabled" | "enabled" | "unproven";
			savePrompt: "suppressed" | "observed" | "unproven";
			observer: {
				source: "chrome-webui";
				browserPid: number;
				port: string;
				profileMatch: "exact";
				observedAtMs: number;
			};
		};

/**
 * Exact listener and profile facts the live observer must bind.
 */
export type WarmChromeEffectivePostureInput = {
	activeProfileDir: string;
	browserPid: number;
	port: string;
	webSocketDebuggerUrl: string;
	disableSyncSwitch: boolean;
	disableExtensionsSwitch: boolean;
};

/**
 * Bounded CDP session used by the live observer.
 */
export type WarmChromeCdpSession = {
	command: (
		method: string,
		params?: Record<string, unknown>,
		sessionId?: string,
	) => Promise<unknown>;
	close: () => void;
};

/**
 * Injectable system seams for deterministic observer tests.
 */
export type WarmChromeEffectivePostureObserverDeps = {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	openBrowserSession: (wsUrl: string) => Promise<WarmChromeCdpSession>;
};

/**
 * Observe only redacted effective state from Chrome-owned WebUI APIs.
 *
 * The page expressions reduce password metadata to a count inside Chrome.
 * Username, origin, password, and account fields never cross CDP.
 *
 * @param input - Exact running listener, profile, and launch switches
 * @param deps - CDP and time seams; defaults bind the live browser websocket
 * @returns Redacted effective posture or fail-closed not-observed
 */
export async function observeWarmChromeEffectivePosture(
	input: WarmChromeEffectivePostureInput,
	deps: WarmChromeEffectivePostureObserverDeps = {
		now: () => Date.now(),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		openBrowserSession,
	},
): Promise<WarmChromeEffectiveCredentialPosture> {
	const startedAtMs = deps.now();
	const deadlineMs = startedAtMs + WARM_CHROME_EFFECTIVE_POSTURE_BUDGET_MS;
	if (
		!isBoundBrowserWebSocket(input.webSocketDebuggerUrl, input.port) ||
		!input.disableSyncSwitch ||
		!input.disableExtensionsSwitch
	) {
		return { observation: "not-observed" };
	}

	let browser: WarmChromeCdpSession | undefined;
	try {
		browser = await deps.openBrowserSession(input.webSocketDebuggerUrl);
		const processInfo = await browser.command("SystemInfo.getProcessInfo");
		if (!hasExactBrowserProcess(processInfo, input.browserPid)) {
			return { observation: "not-observed" };
		}

		const profile = await evaluateHiddenWebUi(
			browser,
			"chrome://version/",
			profileExpression(input.activeProfileDir),
			deps,
			deadlineMs,
		);
		if (!isProfileObservation(profile) || !profile.profileMatches) {
			return { observation: "not-observed" };
		}

		const password = await evaluateHiddenWebUi(
			browser,
			"chrome://password-manager/settings",
			PASSWORD_POSTURE_EXPRESSION,
			deps,
			deadlineMs,
		);
		if (!isPasswordObservation(password)) {
			return { observation: "not-observed" };
		}
		if (deps.now() > deadlineMs) {
			return { observation: "not-observed" };
		}

		const syncState = password.syncingPasswords ? "enabled" : "disabled";
		const fillExposure =
			password.savedCount > 0 || password.syncingPasswords
				? "source-present"
				: password.savedCount === 0 &&
						password.autoSignInOff &&
						password.accountSignedOut
					? "no-source"
					: "unproven";

		return {
			observation: "running-chrome",
			saveCapability: password.saveOff ? "disabled" : "enabled",
			fillExposure,
			syncState,
			savePrompt: password.saveOff ? "suppressed" : "unproven",
			observer: {
				source: "chrome-webui",
				browserPid: input.browserPid,
				port: input.port,
				profileMatch: "exact",
				observedAtMs: deps.now(),
			},
		};
	} catch {
		return { observation: "not-observed" };
	} finally {
		browser?.close();
	}
}

const PASSWORD_POSTURE_EXPRESSION = String.raw`
(async () => {
	try {
		const getPref = (key) =>
			new Promise((resolve) => chrome.settingsPrivate.getPref(key, resolve));
		const save = await getPref("credentials_enable_service");
		const autoSignIn = await getPref("credentials_enable_autosignin");
		const { sendWithPromise } = await import("chrome://resources/js/cr.js");
		const [accountInfo, syncInfo] = await Promise.all([
			sendWithPromise("GetAccountInfo"),
			sendWithPromise("GetSyncInfo"),
		]);
		const saved = await chrome.passwordsPrivate.getSavedPasswordList();
		return {
			ready: true,
			saveOff: save?.value === false,
			autoSignInOff: autoSignIn?.value === false,
			accountSignedOut:
				typeof accountInfo?.email === "string" &&
				accountInfo.email.length === 0,
			syncingPasswords: syncInfo?.isSyncingPasswords === true,
			savedCount: saved.length,
		};
	} catch {
		return { ready: false };
	}
})()
`;

function profileExpression(activeProfileDir: string): string {
	return String.raw`
(async () => {
	try {
		const { sendWithPromise } = await import("chrome://resources/js/cr.js");
		const paths = await sendWithPromise("requestPathInfo");
		return {
			ready: true,
			profileMatches: paths?.profilePath === ${JSON.stringify(activeProfileDir)},
		};
	} catch {
		return { ready: false };
	}
})()
`;
}

async function evaluateHiddenWebUi(
	browser: WarmChromeCdpSession,
	url: string,
	expression: string,
	deps: Pick<WarmChromeEffectivePostureObserverDeps, "now" | "sleep">,
	deadlineMs: number,
): Promise<unknown> {
	const created = await browser.command("Target.createTarget", {
		url,
		hidden: true,
		background: true,
	});
	const targetId = readString(created, "targetId");
	if (targetId === null) return null;
	let cleanupSucceeded = false;
	let observedValue: unknown = null;
	try {
		const attached = await browser.command("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		const sessionId = readString(attached, "sessionId");
		if (sessionId !== null) {
			for (
				let attempt = 0;
				attempt < 40 && deps.now() <= deadlineMs;
				attempt += 1
			) {
				const ready = await browser.command(
					"Runtime.evaluate",
					{
						expression: "document.readyState === 'complete'",
						returnByValue: true,
					},
					sessionId,
				);
				if (readRuntimeValue(ready) === true) {
					const observed = await browser.command(
						"Runtime.evaluate",
						{
							expression,
							awaitPromise: true,
							returnByValue: true,
						},
						sessionId,
					);
					const value = readRuntimeValue(observed);
					if (isRecord(value) && value.ready === true) {
						observedValue = value;
						break;
					}
				}
				await deps.sleep(50);
			}
		}
	} finally {
		try {
			const closed = await browser.command("Target.closeTarget", { targetId });
			cleanupSucceeded = readBoolean(closed, "success") === true;
		} catch {
			cleanupSucceeded = false;
		}
	}
	return cleanupSucceeded ? observedValue : null;
}

function isBoundBrowserWebSocket(wsUrl: string, port: string): boolean {
	try {
		const url = new URL(wsUrl);
		return (
			url.protocol === "ws:" &&
			url.hostname === "127.0.0.1" &&
			url.port === port &&
			url.pathname.startsWith("/devtools/browser/")
		);
	} catch {
		return false;
	}
}

function hasExactBrowserProcess(value: unknown, expectedPid: number): boolean {
	if (!isRecord(value) || !Array.isArray(value.processInfo)) return false;
	const browsers = value.processInfo.filter(
		(process) => isRecord(process) && process.type === "browser",
	);
	return (
		browsers.length === 1 &&
		browsers[0]?.id === expectedPid &&
		Number.isSafeInteger(expectedPid) &&
		expectedPid > 0
	);
}

function isProfileObservation(
	value: unknown,
): value is { ready: true; profileMatches: boolean } {
	return (
		hasExactKeys(value, ["ready", "profileMatches"]) &&
		value.ready === true &&
		typeof value.profileMatches === "boolean"
	);
}

function isPasswordObservation(value: unknown): value is {
	ready: true;
	saveOff: boolean;
	autoSignInOff: boolean;
	accountSignedOut: boolean;
	syncingPasswords: boolean;
	savedCount: number;
} {
	return (
		hasExactKeys(value, [
			"ready",
			"saveOff",
			"autoSignInOff",
			"accountSignedOut",
			"syncingPasswords",
			"savedCount",
		]) &&
		value.ready === true &&
		typeof value.saveOff === "boolean" &&
		typeof value.autoSignInOff === "boolean" &&
		typeof value.accountSignedOut === "boolean" &&
		typeof value.syncingPasswords === "boolean" &&
		Number.isSafeInteger(value.savedCount) &&
		(value.savedCount as number) >= 0
	);
}

function readRuntimeValue(value: unknown): unknown {
	if (!isRecord(value) || "exceptionDetails" in value) return undefined;
	const result = value.result;
	return isRecord(result) ? result.value : undefined;
}

function readString(value: unknown, key: string): string | null {
	if (!isRecord(value)) return null;
	const candidate = value[key];
	return typeof candidate === "string" && candidate !== "" ? candidate : null;
}

function readBoolean(value: unknown, key: string): boolean | null {
	if (!isRecord(value)) return null;
	const candidate = value[key];
	return typeof candidate === "boolean" ? candidate : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<K extends string>(
	value: unknown,
	keys: readonly K[],
): value is Record<K, unknown> {
	if (!isRecord(value)) return false;
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function openBrowserSession(wsUrl: string): Promise<WarmChromeCdpSession> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let nextId = 0;
		const pending = new Map<
			number,
			{
				resolve: (value: unknown) => void;
				reject: (error: Error) => void;
				timer: ReturnType<typeof setTimeout>;
			}
		>();
		let socket: WebSocket;
		const rejectAll = (message: string) => {
			for (const entry of pending.values()) {
				clearTimeout(entry.timer);
				entry.reject(new Error(message));
			}
			pending.clear();
		};
		const openTimer = setTimeout(() => {
			if (settled) return;
			settled = true;
			socket.close();
			reject(new Error("CDP observer websocket open timed out."));
		}, CDP_OPEN_TIMEOUT_MS);
		try {
			socket = new WebSocket(wsUrl);
		} catch (error) {
			clearTimeout(openTimer);
			reject(
				error instanceof Error
					? error
					: new Error("CDP observer websocket failed."),
			);
			return;
		}
		socket.addEventListener("open", () => {
			if (settled) return;
			settled = true;
			clearTimeout(openTimer);
			resolve({
				command: (method, params = {}, sessionId) => {
					const id = ++nextId;
					return new Promise((commandResolve, commandReject) => {
						const timer = setTimeout(() => {
							pending.delete(id);
							commandReject(
								new Error(`CDP observer ${method} timed out.`),
							);
						}, CDP_COMMAND_TIMEOUT_MS);
						pending.set(id, {
							resolve: commandResolve,
							reject: commandReject,
							timer,
						});
						socket.send(
							JSON.stringify({
								id,
								method,
								params,
								...(sessionId === undefined ? {} : { sessionId }),
							}),
						);
					});
				},
				close: () => {
					rejectAll("CDP observer session closed.");
					socket.close();
				},
			});
		});
		socket.addEventListener("message", (event) => {
			let message: unknown;
			try {
				message = JSON.parse(String(event.data));
			} catch {
				return;
			}
			if (!isRecord(message) || typeof message.id !== "number") return;
			const entry = pending.get(message.id);
			if (entry === undefined) return;
			pending.delete(message.id);
			clearTimeout(entry.timer);
			if (isRecord(message.error)) {
				entry.reject(new Error("CDP observer command failed."));
			} else {
				entry.resolve(message.result);
			}
		});
		socket.addEventListener("error", () => {
			if (!settled) {
				settled = true;
				clearTimeout(openTimer);
				reject(new Error("CDP observer websocket failed."));
			}
			rejectAll("CDP observer websocket failed.");
		});
		socket.addEventListener("close", () => {
			rejectAll("CDP observer websocket closed.");
		});
	});
}
