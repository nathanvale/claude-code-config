import { describe, expect, test } from "bun:test";

import {
	observeWarmChromeEffectivePosture,
	type WarmChromeCdpSession,
	type WarmChromeEffectivePostureObserverDeps,
} from "../src/effective-posture.ts";

const INPUT = {
	activeProfileDir: "/Users/warm/.agent-warm-profile/Default",
	browserPid: 4242,
	port: "9243",
	webSocketDebuggerUrl:
		"ws://127.0.0.1:9243/devtools/browser/warm-chrome-token",
	disableSyncSwitch: true,
	disableExtensionsSwitch: true,
} as const;

type ScriptOptions = {
	browserPid?: number;
	profileMatches?: boolean;
	saveOff?: boolean;
	autoSignInOff?: boolean;
	accountSignedOut?: boolean;
	syncingPasswords?: boolean;
	savedCount?: number;
	closeSuccess?: boolean;
};

function scriptedObserverDeps(
	options: ScriptOptions = {},
): WarmChromeEffectivePostureObserverDeps & {
	expressions: string[];
	targetUrls: string[];
} {
	let target = 0;
	const expressions: string[] = [];
	const targetUrls: string[] = [];
	const session: WarmChromeCdpSession = {
		command: async (method, params = {}) => {
			if (method === "SystemInfo.getProcessInfo") {
				return {
					processInfo: [
						{ type: "browser", id: options.browserPid ?? INPUT.browserPid },
					],
				};
			}
			if (method === "Target.createTarget") {
				if (typeof params.url === "string") targetUrls.push(params.url);
				target += 1;
				return { targetId: `target-${target}` };
			}
			if (method === "Target.attachToTarget") {
				return { sessionId: `session-${target}` };
			}
			if (method === "Target.closeTarget") {
				return { success: options.closeSuccess ?? true };
			}
			if (method === "Runtime.evaluate") {
				const expression =
					typeof params.expression === "string" ? params.expression : "";
				expressions.push(expression);
				if (expression.includes("document.readyState")) {
					return { result: { value: true } };
				}
				if (expression.includes("requestPathInfo")) {
					return {
						result: {
							value: {
								ready: true,
								profileMatches: options.profileMatches ?? true,
							},
						},
					};
				}
				if (expression.includes("getSavedPasswordList")) {
					return {
						result: {
							value: {
								ready: true,
								saveOff: options.saveOff ?? true,
								autoSignInOff: options.autoSignInOff ?? true,
								accountSignedOut: options.accountSignedOut ?? true,
								syncingPasswords: options.syncingPasswords ?? false,
								savedCount: options.savedCount ?? 0,
							},
						},
					};
				}
			}
			throw new Error(`unexpected CDP command: ${method}`);
		},
		close: () => undefined,
	};
	return {
		expressions,
		targetUrls,
		now: () => 1_000,
		sleep: async () => undefined,
		openBrowserSession: async () => session,
	};
}

describe("running-Chrome credential posture observer (U6)", () => {
	test("binds live no-source evidence to exact PID, profile, port, and time", async () => {
		const deps = scriptedObserverDeps();

		const posture = await observeWarmChromeEffectivePosture(INPUT, deps);

		expect(posture).toEqual({
			observation: "running-chrome",
			saveCapability: "disabled",
			fillExposure: "no-source",
			syncState: "disabled",
			savePrompt: "suppressed",
			observer: {
				source: "chrome-webui",
				browserPid: 4242,
				port: "9243",
				profileMatch: "exact",
				observedAtMs: 1_000,
			},
		});
		expect(deps.expressions.join("\n")).not.toContain(
			"requestPlaintextPassword",
		);
		expect(deps.expressions.join("\n")).toContain("GetAccountInfo");
		expect(deps.expressions.join("\n")).toContain("GetSyncInfo");
		expect(deps.targetUrls).toEqual([
			"chrome://version/",
			"chrome://password-manager/settings",
		]);
		expect(deps.expressions.join("\n")).not.toContain(
			"SyncSetupGetSyncStatus",
		);
	});

	test("wrong browser PID or profile identity fails closed", async () => {
		await expect(
			observeWarmChromeEffectivePosture(
				INPUT,
				scriptedObserverDeps({ browserPid: 9999 }),
			),
		).resolves.toEqual({ observation: "not-observed" });
		await expect(
			observeWarmChromeEffectivePosture(
				INPUT,
				scriptedObserverDeps({ profileMatches: false }),
			),
		).resolves.toEqual({ observation: "not-observed" });
	});

	test("a live saved credential reports source-present instead of clean", async () => {
		const posture = await observeWarmChromeEffectivePosture(
			INPUT,
			scriptedObserverDeps({ savedCount: 1 }),
		);

		expect(posture.observation).toBe("running-chrome");
		if (posture.observation === "running-chrome") {
			expect(posture.fillExposure).toBe("source-present");
		}
	});

	test("a signed-in account keeps zero saved rows unproven", async () => {
		const posture = await observeWarmChromeEffectivePosture(
			INPUT,
			scriptedObserverDeps({ accountSignedOut: false }),
		);

		expect(posture.observation).toBe("running-chrome");
		if (posture.observation === "running-chrome") {
			expect(posture.fillExposure).toBe("unproven");
			expect(posture.syncState).toBe("disabled");
		}
	});

	test("password sync reports source-present despite zero saved rows", async () => {
		const posture = await observeWarmChromeEffectivePosture(
			INPUT,
			scriptedObserverDeps({ syncingPasswords: true }),
		);

		expect(posture.observation).toBe("running-chrome");
		if (posture.observation === "running-chrome") {
			expect(posture.fillExposure).toBe("source-present");
			expect(posture.syncState).toBe("enabled");
		}
	});

	test("enabled auto sign-in keeps zero saved rows unproven", async () => {
		const posture = await observeWarmChromeEffectivePosture(
			INPUT,
			scriptedObserverDeps({ autoSignInOff: false }),
		);

		expect(posture.observation).toBe("running-chrome");
		if (posture.observation === "running-chrome") {
			expect(posture.fillExposure).toBe("unproven");
		}
	});

	test("target cleanup failure invalidates an otherwise clean observation", async () => {
		await expect(
			observeWarmChromeEffectivePosture(
				INPUT,
				scriptedObserverDeps({ closeSuccess: false }),
			),
		).resolves.toEqual({ observation: "not-observed" });
	});
});
