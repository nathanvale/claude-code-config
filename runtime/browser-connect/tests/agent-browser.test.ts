import { describe, expect, test } from "bun:test";
import {
	type AdapterCommandInput,
	type AdapterCommandResult,
	type AdapterRuntime,
	findAdapterDefinition,
	RELEASE_TIMEOUT_MS,
} from "../src/adapters/registry.ts";

const EXECUTABLE_PATH = "/opt/adapters/bin/agent-browser";
const SESSION_NAME = "browser-use-owned-session";

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
