import { describe, expect, test } from "bun:test";
import type { BrowserConnectVerifiedEndpoint } from "../src/model.ts";
import { agentBrowserDefinition } from "../src/adapters/agent-browser.ts";
import {
	type AdapterCommandInput,
	type AdapterCommandResult,
	type AdapterRuntime,
	findAdapterDefinition,
	RELEASE_TIMEOUT_MS,
} from "../src/adapters/registry.ts";
import { agentBrowserReleaseResult } from "./agent-browser-release-fixture.ts";

const EXECUTABLE_PATH = "/opt/adapters/bin/agent-browser";
const SESSION_NAME = "browser-use-owned-session";
const ENDPOINT: BrowserConnectVerifiedEndpoint = {
	http: "http://127.0.0.1:41337",
	ws: "ws://127.0.0.1:41337/devtools/browser/abc",
};
const PROBE_SESSION_PATTERN =
	/^browser-connect-agent-browser-probe-\d+-[a-f0-9]{8}$/;

function runtimeWith(
	respond: (input: AdapterCommandInput) => AdapterCommandResult,
): {
	runtime: AdapterRuntime;
	commands: AdapterCommandInput[];
	delays: number[];
} {
	const commands: AdapterCommandInput[] = [];
	const delays: number[] = [];
	return {
		commands,
		delays,
		runtime: {
			env: {},
			resolveExecutable: () => ({ resolved: true, path: EXECUTABLE_PATH }),
			runCommand: async (input) => {
				commands.push(input);
				return respond(input);
			},
			wait: async (delayMs) => {
				delays.push(delayMs);
			},
		},
	};
}

function successfulProbeResponse(
	input: AdapterCommandInput,
): AdapterCommandResult {
	return (
		agentBrowserReleaseResult(EXECUTABLE_PATH, input) ??
		{ exitCode: 0, stdout: "cdp-url", stderr: "" }
	);
}

function probeSessionNameOf(commands: AdapterCommandInput[]): string {
	const probe = commands.find((command) => command.args.includes("cdp-url"));
	const sessionFlag = probe?.args.indexOf("--session") ?? -1;
	expect(sessionFlag).toBeGreaterThanOrEqual(0);
	const probeSessionName = probe?.args[sessionFlag + 1];
	expect(probeSessionName).toMatch(PROBE_SESSION_PATTERN);
	if (!probeSessionName) throw new Error("probe session name missing");
	return probeSessionName;
}

describe("agent-browser probeAttachment", () => {
	test("uses and releases a derived named session after probe success", async () => {
		const { runtime, commands } = runtimeWith(successfulProbeResponse);

		const result = await agentBrowserDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);

		expect(result.attached).toBe(true);
		const probe = commands.find((command) => command.args.includes("cdp-url"));
		const probeSessionName = probeSessionNameOf(commands);
		expect(probe?.args).not.toContain("--pin-tab");

		const release = commands.find((command) => command.args.includes("close"));
		expect(release?.args).toEqual([
			"--session",
			probeSessionName,
			"close",
			"--json",
		]);
		expect(release?.args).not.toContain("--cdp");
		expect(release?.env).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });
		expect(release?.timeoutMs).toBe(RELEASE_TIMEOUT_MS);
	});

	test("releases the derived named session after probe failure", async () => {
		const { runtime, commands } = runtimeWith((input) => {
			if (input.args.includes("cdp-url")) {
				return { exitCode: 2, stdout: "", stderr: "probe failed" };
			}
			return successfulProbeResponse(input);
		});

		const result = await agentBrowserDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);

		expect(result.attached).toBe(false);
		const probeSessionName = probeSessionNameOf(commands);
		expect(commands.find((command) => command.args.includes("close"))?.args).toEqual([
			"--session",
			probeSessionName,
			"close",
			"--json",
		]);
	});
});

describe("agent-browser releaseSession", () => {
	test("registry release closes without --cdp and verifies the owned name is absent", async () => {
		const definition = findAdapterDefinition("agent-browser");
		expect(definition?.releaseSession).toBeFunction();
		if (!definition?.releaseSession) throw new Error("releaseSession missing");

		const { runtime, commands } = runtimeWith((input) => {
			if (input.args.includes("close")) {
				return {
					exitCode: 0,
					stdout: JSON.stringify({ success: true }),
					stderr: "",
				};
			}
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					success: true,
					data: { sessions: ["foreign-session"] },
				}),
				stderr: "",
			};
		});

		const result = await definition.releaseSession(runtime, {
			sessionName: SESSION_NAME,
		});

		expect(result).toEqual({ released: true });
		expect([commands[0]?.command, ...commands[0]!.args]).toEqual([
			EXECUTABLE_PATH,
			"--session",
			SESSION_NAME,
			"close",
			"--json",
		]);
		expect(commands[0]?.args).not.toContain("--cdp");
		expect(commands[0]?.env).toEqual({ MCPORTER_NO_KEEPALIVE: "*" });
		expect(commands[0]?.timeoutMs).toBe(RELEASE_TIMEOUT_MS);
		expect(commands[1]?.args).toEqual(["session", "list", "--json"]);
	});

	test("re-reads inventory until the owned name is absent", async () => {
		const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
		if (!releaseSession) throw new Error("releaseSession missing");
		let inventoryReads = 0;
		const { runtime, commands, delays } = runtimeWith((input) => {
			if (input.args.includes("close")) {
				return {
					exitCode: 0,
					stdout: JSON.stringify({ success: true }),
					stderr: "",
				};
			}
			inventoryReads += 1;
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					success: true,
					data: {
						sessions:
							inventoryReads === 1 ? [SESSION_NAME] : ["foreign-session"],
					},
				}),
				stderr: "",
			};
		});

		expect(await releaseSession(runtime, { sessionName: SESSION_NAME })).toEqual({
			released: true,
		});
		expect(commands.filter((call) => call.args.includes("list"))).toHaveLength(2);
		expect(delays).toEqual([1000]);
	});

	test("gives later release commands only the aggregate deadline remaining", async () => {
		const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
		if (!releaseSession) throw new Error("releaseSession missing");
		let nowMs = 0;
		let inventoryReads = 0;
		const { runtime, commands, delays } = runtimeWith((input) => {
			if (input.args.includes("close")) {
				nowMs += 5000;
				return {
					exitCode: 0,
					stdout: JSON.stringify({ success: true }),
					stderr: "",
				};
			}
			inventoryReads += 1;
			nowMs += 2000;
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					success: true,
					data: {
						sessions:
							inventoryReads === 1 ? [SESSION_NAME] : ["foreign-session"],
					},
				}),
				stderr: "",
			};
		});
		runtime.now = () => nowMs;
		runtime.wait = async (delayMs) => {
			delays.push(delayMs);
			nowMs += delayMs;
		};

		expect(await releaseSession(runtime, { sessionName: SESSION_NAME })).toEqual({
			released: true,
		});
		expect(commands.map((command) => command.timeoutMs)).toEqual([
			RELEASE_TIMEOUT_MS,
			25_000,
			22_000,
		]);
		expect(delays).toEqual([1000]);
	});

	test("stops the settle loop when the aggregate release deadline is exhausted", async () => {
		const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
		if (!releaseSession) throw new Error("releaseSession missing");
		let nowMs = 0;
		const { runtime, commands, delays } = runtimeWith((input) => {
			if (input.args.includes("close")) {
				nowMs += 29_500;
				return {
					exitCode: 0,
					stdout: JSON.stringify({ success: true }),
					stderr: "",
				};
			}
			nowMs += 500;
			return {
				exitCode: 0,
				stdout: JSON.stringify({
					success: true,
					data: { sessions: [SESSION_NAME] },
				}),
				stderr: "",
			};
		});
		runtime.now = () => nowMs;

		expect(await releaseSession(runtime, { sessionName: SESSION_NAME })).toMatchObject({
			released: false,
			cause: "still-present",
		});
		expect(commands.map((command) => command.timeoutMs)).toEqual([
			RELEASE_TIMEOUT_MS,
			500,
		]);
		expect(delays).toEqual([]);
	});

	test("returns still-present after the six-read settle budget is exhausted", async () => {
		const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
		if (!releaseSession) throw new Error("releaseSession missing");
		const { runtime, commands, delays } = runtimeWith((input) => ({
			exitCode: 0,
			stdout: input.args.includes("close")
				? JSON.stringify({ success: true })
				: JSON.stringify({
						success: true,
						data: { sessions: [SESSION_NAME, "foreign-session"] },
					}),
			stderr: "",
		}));

		const result = await releaseSession(runtime, { sessionName: SESSION_NAME });

		expect(result).toMatchObject({
			released: false,
			cause: "still-present",
		});
		expect(commands.filter((call) => call.args.includes("list"))).toHaveLength(6);
		expect(delays).toEqual([1000, 1000, 1000, 1000, 1000]);
	});

	for (const failure of [
		{
			label: "non-zero close",
			result: { exitCode: 7, stdout: "", stderr: "close failed" },
		},
		{
			label: "timed-out close",
			result: { exitCode: 1, stdout: "", stderr: "", timedOut: true },
		},
	] as const) {
		test(`${failure.label} returns command-failed without reading inventory`, async () => {
			const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
			if (!releaseSession) throw new Error("releaseSession missing");
			const { runtime, commands } = runtimeWith(() => failure.result);

			expect(
				await releaseSession(runtime, { sessionName: SESSION_NAME }),
			).toMatchObject({ released: false, cause: "command-failed" });
			expect(commands).toHaveLength(1);
		});
	}

	test("unparseable close output returns invalid-response", async () => {
		const releaseSession = findAdapterDefinition("agent-browser")?.releaseSession;
		if (!releaseSession) throw new Error("releaseSession missing");
		const { runtime, commands } = runtimeWith(() => ({
			exitCode: 0,
			stdout: "not-json",
			stderr: "",
		}));

		expect(await releaseSession(runtime, { sessionName: SESSION_NAME })).toMatchObject({
			released: false,
			cause: "invalid-response",
		});
		expect(commands).toHaveLength(1);
	});
});
