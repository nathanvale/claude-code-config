import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import type { BrowserConnectVerifiedEndpoint } from "../src/model.ts";
import {
	PLAYWRIGHT_CDP_ATTACH_HELP_LINES,
	PLAYWRIGHT_CDP_DETACH_HELP_LINE,
	PLAYWRIGHT_CDP_DIST_INTEGRITY,
	PLAYWRIGHT_CDP_EXECUTABLE,
	PLAYWRIGHT_CDP_PINNED_VERSION,
	PLAYWRIGHT_CDP_RELEASE_URL,
	PLAYWRIGHT_CDP_SESSION_PREFIX,
	playwrightCdpDefinition,
} from "../src/adapters/playwright-cdp.ts";
import {
	type AdapterCommandInput,
	type AdapterCommandResult,
	type AdapterRuntime,
	findAdapterDefinition,
	listAdapterDefinitions,
} from "../src/adapters/registry.ts";

const ENDPOINT: BrowserConnectVerifiedEndpoint = {
	http: "http://127.0.0.1:41337",
	ws: "ws://127.0.0.1:41337/devtools/browser/verified",
};
const EXECUTABLE_PATH = "/opt/adapters/bin/playwright-cli";

/** Per-invocation probe session: fixed prefix + pid + short random token. */
const PROBE_SESSION_PATTERN = new RegExp(
	`^${PLAYWRIGHT_CDP_SESSION_PREFIX}-\\d+-[0-9a-f]{8}$`,
);

/** Extract the value of the `--session=<name>` token from a command's argv. */
function sessionOf(args: readonly string[]): string | undefined {
	return args
		.find((arg) => arg.startsWith("--session="))
		?.slice("--session=".length);
}

function runtimeWith(
	respond: (input: AdapterCommandInput) => AdapterCommandResult,
): { runtime: AdapterRuntime; commands: AdapterCommandInput[] } {
	const commands: AdapterCommandInput[] = [];
	return {
		commands,
		runtime: {
			env: {},
			resolveExecutable: (command) =>
				command === PLAYWRIGHT_CDP_EXECUTABLE
					? { resolved: true, path: EXECUTABLE_PATH }
					: { resolved: false },
			runCommand: async (input) => {
				commands.push(input);
				return respond(input);
			},
		},
	};
}

function successfulResponse(input: AdapterCommandInput): AdapterCommandResult {
	if (input.args.includes("--version")) {
		return {
			exitCode: 0,
			stdout: `${PLAYWRIGHT_CDP_PINNED_VERSION}\n`,
			stderr: "",
		};
	}
	if (input.args[0] === "attach" && input.args.includes("--help")) {
		return {
			exitCode: 0,
			stdout: `${PLAYWRIGHT_CDP_ATTACH_HELP_LINES.join("\n")}\n`,
			stderr: "",
		};
	}
	if (input.args[0] === "detach" && input.args.includes("--help")) {
		return {
			exitCode: 0,
			stdout: `${PLAYWRIGHT_CDP_DETACH_HELP_LINE}\n`,
			stderr: "",
		};
	}
	return { exitCode: 0, stdout: "ok\n", stderr: "" };
}

describe("playwright-cdp Adapter Definition", () => {
	test("registry adds only the Playwright CLI lane id playwright-cdp", () => {
		expect(listAdapterDefinitions().map((definition) => definition.id)).toEqual([
			"chrome-devtools-mcp",
			"agent-browser",
			"playwright-cdp",
		]);
		expect(findAdapterDefinition("playwright-cdp")).toBe(playwrightCdpDefinition);
		expect(findAdapterDefinition("chrome-devtools-cli")).toBeUndefined();
	});

	test("pins the exact release and injects only the verified HTTP endpoint into named attach", () => {
		expect(playwrightCdpDefinition.pinnedVersion).toBe("0.1.17");
		expect(
			playwrightCdpDefinition.installPolicy.safeUpgradeTransitions,
		).toEqual([]);
		expect(playwrightCdpDefinition.routes).toEqual([
			{ route: "explicit-cdp", evidence: "verified-live", implemented: true },
		]);
		expect(playwrightCdpDefinition.inject(ENDPOINT)).toEqual({
			argv: [
				"attach",
				`--cdp=${ENDPOINT.http}`,
				`--session=${PLAYWRIGHT_CDP_SESSION_PREFIX}`,
			],
		});
		expect(playwrightCdpDefinition.inject(ENDPOINT).argv).not.toContain("open");
		expect(playwrightCdpDefinition.inject(ENDPOINT).argv).not.toContain(
			"install-browser",
		);
	});

	test("releaseSession detaches the caller-owned named session", async () => {
		const releaseSession = findAdapterDefinition("playwright-cdp")?.releaseSession;
		expect(releaseSession).toBeFunction();
		if (!releaseSession) throw new Error("releaseSession missing");
		const { runtime, commands } = runtimeWith(successfulResponse);

		expect(
			await releaseSession(runtime, { sessionName: "browser-use-owned-session" }),
		).toEqual({ released: true });
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({
			command: EXECUTABLE_PATH,
			args: ["--session=browser-use-owned-session", "detach"],
		});
	});

	test("absent executable fails provenance before any command", async () => {
		const commands: AdapterCommandInput[] = [];
		const runtime: AdapterRuntime = {
			env: {},
			resolveExecutable: () => ({ resolved: false }),
			runCommand: async (input) => {
				commands.push(input);
				return successfulResponse(input);
			},
		};
		const provenance = await playwrightCdpDefinition.checkProvenance(runtime);
		expect(provenance).toMatchObject({
			installed: false,
			failureClass: "adapter-not-installed",
			cause: "executable_absent",
		});
		expect(commands).toEqual([]);
	});

	test("wrong version fails provenance before help or attachment", async () => {
		const { runtime, commands } = runtimeWith(() => ({
			exitCode: 0,
			stdout: "0.1.16\n",
			stderr: "",
		}));
		const provenance = await playwrightCdpDefinition.checkProvenance(runtime);
		expect(provenance).toMatchObject({
			installed: false,
			failureClass: "adapter-not-installed",
			cause: "version_mismatch",
			observedVersion: "0.1.16",
		});
		expect(commands.map((command) => command.args)).toEqual([["--version"]]);
	});

	test("release provenance and the committed lockfile agree on the exact npm artifact", async () => {
		expect(PLAYWRIGHT_CDP_RELEASE_URL).toBe(
			"https://github.com/microsoft/playwright-cli/releases/tag/v0.1.17",
		);
		expect(PLAYWRIGHT_CDP_DIST_INTEGRITY).toBe(
			"sha512-VBw6y3p8eqOqmjKg07IkWSPGKJkpIhMRNDFI6DOYsDD6fAfcI1XYEWMLWyhSZQ0B/Oc2KN49eq4XqE64PUPHBg==",
		);
		const lock = JSON.parse(
			await readFile(
				playwrightCdpDefinition.installPolicy.integritySource.lockfilePath,
				"utf8",
			),
		) as {
			packages: Record<
				string,
				{ version?: string; integrity?: string; resolved?: string }
			>;
		};
		expect(lock.packages["node_modules/@playwright/cli"]).toMatchObject({
			version: PLAYWRIGHT_CDP_PINNED_VERSION,
			integrity: PLAYWRIGHT_CDP_DIST_INTEGRITY,
			resolved:
				"https://registry.npmjs.org/@playwright/cli/-/cli-0.1.17.tgz",
		});
	});

	test("exact version and pinned attach/detach help reach named attach, snapshot, and detach", async () => {
		const { runtime, commands } = runtimeWith(successfulResponse);
		const provenance = await playwrightCdpDefinition.checkProvenance(runtime);
		expect(provenance).toEqual({
			installed: true,
			executablePath: EXECUTABLE_PATH,
			version: PLAYWRIGHT_CDP_PINNED_VERSION,
		});

		const result = await playwrightCdpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result).toEqual({
			attached: true,
			attachment: {
				adapter_id: "playwright-cdp",
				route: "explicit-cdp",
				probe_executable: EXECUTABLE_PATH,
			},
			evidence:
				"playwright-cli attached to the verified CDP endpoint, snapshotted read-only, and detached without closing the browser.",
		});
		const probeCommands = commands.slice(1).map((command) => command.args);
		// The two help probes and the attach/snapshot/detach command SHAPES are
		// fixed; the session token inside them is derived per invocation.
		expect(probeCommands[0]).toEqual(["attach", "--help"]);
		expect(probeCommands[1]).toEqual(["detach", "--help"]);
		expect(probeCommands[2]?.slice(0, 2)).toEqual([
			"attach",
			`--cdp=${ENDPOINT.http}`,
		]);
		expect(probeCommands[3]?.[1]).toBe("snapshot");
		expect(probeCommands[4]?.[1]).toBe("detach");

		// Same derived session name threads through attach, snapshot, and detach.
		const attachSession = sessionOf(probeCommands[2] ?? []);
		expect(attachSession).toMatch(PROBE_SESSION_PATTERN);
		expect(sessionOf(probeCommands[3] ?? [])).toBe(attachSession);
		expect(sessionOf(probeCommands[4] ?? [])).toBe(attachSession);
	});

	test("help drift fails closed before attach or implicit browser launch", async () => {
		const { runtime, commands } = runtimeWith((input) => {
			if (input.args[0] === "attach" && input.args.includes("--help")) {
				return { exitCode: 0, stdout: "changed help\n", stderr: "" };
			}
			return successfulResponse(input);
		});
		const result = await playwrightCdpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.cause).toBe("probe_failed");
			expect(result.detail).toContain("help contract drifted");
		}
		expect(commands.map((command) => command.args)).toEqual([
			["attach", "--help"],
		]);
	});

	test("detach help drift fails closed before creating a session", async () => {
		const { runtime, commands } = runtimeWith((input) => {
			if (input.args[0] === "detach" && input.args.includes("--help")) {
				return { exitCode: 0, stdout: "changed detach help\n", stderr: "" };
			}
			return successfulResponse(input);
		});
		const result = await playwrightCdpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.detail).toContain("detach help contract drifted");
		}
		expect(commands.map((command) => command.args)).toEqual([
			["attach", "--help"],
			["detach", "--help"],
		]);
	});

	test("failed attach still performs best-effort named detach", async () => {
		const { runtime, commands } = runtimeWith((input) => {
			if (input.args[0] === "attach" && !input.args.includes("--help")) {
				return { exitCode: 4, stdout: "", stderr: "attach failed" };
			}
			return successfulResponse(input);
		});
		const result = await playwrightCdpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		const detachArgs = commands.at(-1)?.args ?? [];
		expect(detachArgs[1]).toBe("detach");
		expect(sessionOf(detachArgs)).toMatch(PROBE_SESSION_PATTERN);
	});

	test("snapshot failure still detaches the named session", async () => {
		const { runtime, commands } = runtimeWith((input) => {
			if (input.args.at(-1) === "snapshot") {
				return { exitCode: 3, stdout: "", stderr: "snapshot failed" };
			}
			return successfulResponse(input);
		});
		const result = await playwrightCdpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		const detachArgs = commands.at(-1)?.args ?? [];
		expect(detachArgs[1]).toBe("detach");
		// Detach reuses the SAME derived session the attach opened.
		const attachSession = sessionOf(
			commands.find(
				(command) =>
					command.args[0] === "attach" && !command.args.includes("--help"),
			)?.args ?? [],
		);
		expect(attachSession).toMatch(PROBE_SESSION_PATTERN);
		expect(sessionOf(detachArgs)).toBe(attachSession);
	});

	test("detach failure prevents a verified handoff", async () => {
		const { runtime } = runtimeWith((input) => {
			if (input.args.at(-1) === "detach" && !input.args.includes("--help")) {
				return { exitCode: 5, stdout: "", stderr: "detach failed" };
			}
			return successfulResponse(input);
		});
		const result = await playwrightCdpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.cause).toBe("probe_failed");
			expect(result.detail).toContain("named detach exited 5");
		}
	});
});
