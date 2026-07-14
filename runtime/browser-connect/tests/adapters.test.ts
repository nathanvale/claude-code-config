import { describe, expect, test } from "bun:test";
import type { BrowserConnectVerifiedEndpoint } from "../src/model.ts";
import {
	AGENT_BROWSER_CDP_FLAG,
	AGENT_BROWSER_EXECUTABLE,
	AGENT_BROWSER_PINNED_VERSION,
	agentBrowserDefinition,
} from "../src/adapters/agent-browser.ts";
import {
	CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG,
	CHROME_DEVTOOLS_MCP_EXECUTABLE,
	CHROME_DEVTOOLS_MCP_PINNED_VERSION,
	chromeDevtoolsMcpDefinition,
} from "../src/adapters/chrome-devtools-mcp.ts";
import {
	type AdapterCommandInput,
	type AdapterCommandResult,
	type AdapterExecutableResolution,
	type AdapterRuntime,
	findAdapterDefinition,
	listAdapterDefinitions,
} from "../src/adapters/registry.ts";

const ENDPOINT: BrowserConnectVerifiedEndpoint = {
	http: "http://127.0.0.1:41337",
	ws: "ws://127.0.0.1:41337/devtools/browser/abc",
};

const RESOLVED_PATH = "/opt/adapters/bin/tool";

type CallLog = {
	commands: AdapterCommandInput[];
};

/**
 * Fake runtime — no real binaries, network, or Chrome (test constraint). The
 * `respond` callback shapes each command result by argv; `resolution` shapes
 * provenance resolution. The call log lets tests assert a probe was NEVER
 * invoked on a not-installed rejection.
 */
function fakeRuntime(options: {
	resolution?: AdapterExecutableResolution;
	respond?: (input: AdapterCommandInput) => AdapterCommandResult;
}): { runtime: AdapterRuntime; log: CallLog } {
	const log: CallLog = { commands: [] };
	const runtime: AdapterRuntime = {
		env: {},
		resolveExecutable: () =>
			options.resolution ?? { resolved: true, path: RESOLVED_PATH },
		runCommand: async (input) => {
			log.commands.push(input);
			return (
				options.respond?.(input) ?? {
					exitCode: 0,
					stdout: "",
					stderr: "",
				}
			);
		},
	};
	return { runtime, log };
}

const versionResponder =
	(version: string) =>
	(input: AdapterCommandInput): AdapterCommandResult => {
		if (input.args.includes("--version")) {
			return { exitCode: 0, stdout: version, stderr: "" };
		}
		return { exitCode: 0, stdout: "ok", stderr: "" };
	};

describe("registry", () => {
	test("ships exactly the two slice-one adapters, chrome-devtools-mcp first", () => {
		expect(listAdapterDefinitions().map((d) => d.id)).toEqual([
			"chrome-devtools-mcp",
			"agent-browser",
		]);
	});

	test("findAdapterDefinition resolves registered ids", () => {
		expect(findAdapterDefinition("chrome-devtools-mcp")?.id).toBe(
			"chrome-devtools-mcp",
		);
		expect(findAdapterDefinition("agent-browser")?.id).toBe("agent-browser");
	});

	test("unknown adapter → undefined (caller maps to adapter-unknown usage rejection)", () => {
		expect(findAdapterDefinition("playwright-mcp")).toBeUndefined();
		expect(findAdapterDefinition("")).toBeUndefined();
	});

	test("identity is separate from route — no adapter id encodes a route (R6)", () => {
		for (const definition of listAdapterDefinitions()) {
			for (const route of definition.routes) {
				expect(definition.id).not.toContain(route.route);
			}
		}
	});
});

describe("chrome-devtools-mcp definition", () => {
	test("declares explicit-cdp verified-live and ui-consent documented (lesson 0003)", () => {
		const routes = chromeDevtoolsMcpDefinition.routes;
		expect(routes).toContainEqual({
			route: "explicit-cdp",
			evidence: "verified-live",
			implemented: true,
		});
		expect(routes).toContainEqual({
			route: "ui-consent",
			evidence: "documented",
			implemented: false,
		});
	});

	test("injection produces exact argv array (no shell strings)", () => {
		const injection = chromeDevtoolsMcpDefinition.inject(ENDPOINT);
		expect(injection.argv).toEqual([
			CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG,
			ENDPOINT.http,
		]);
		expect(Array.isArray(injection.argv)).toBe(true);
		expect(injection.env).toBeUndefined();
	});

	test("installed + version match → provenance installed with pinned version", async () => {
		const { runtime } = fakeRuntime({
			respond: versionResponder(CHROME_DEVTOOLS_MCP_PINNED_VERSION),
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result).toEqual({
			installed: true,
			executablePath: RESOLVED_PATH,
			version: CHROME_DEVTOOLS_MCP_PINNED_VERSION,
		});
	});

	test("unresolvable path → adapter-not-installed, NEVER a probe", async () => {
		const { runtime, log } = fakeRuntime({
			resolution: { resolved: false },
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.failureClass).toBe("adapter-not-installed");
		}
		// No command ran at all — not even a version read, never a probe.
		expect(log.commands.length).toBe(0);
	});

	test("version mismatch → adapter-not-installed, never a probe or handoff", async () => {
		const { runtime, log } = fakeRuntime({
			respond: versionResponder("1.4.0"),
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.failureClass).toBe("adapter-not-installed");
			expect(result.detail).toContain("does not match pinned");
		}
		// Only the version read ran — the probe (--browser-url / --list-tabs) never did.
		const probed = log.commands.some((c) =>
			c.args.includes(CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG),
		);
		expect(probed).toBe(false);
	});

	test("missing binary (exit 127) on version read → adapter-not-installed, never a probe", async () => {
		const { runtime, log } = fakeRuntime({
			respond: () => ({
				exitCode: 127,
				stdout: "",
				stderr: "chrome-devtools-mcp: command not found",
			}),
		});
		const result = await chromeDevtoolsMcpDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		const probed = log.commands.some((c) =>
			c.args.includes(CHROME_DEVTOOLS_MCP_BROWSER_URL_FLAG),
		);
		expect(probed).toBe(false);
	});

	test("probe success → attached with evidence naming the probe executable (R4)", async () => {
		const { runtime, log } = fakeRuntime({
			respond: () => ({ exitCode: 0, stdout: "tabs", stderr: "" }),
		});
		const result = await chromeDevtoolsMcpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(true);
		if (result.attached) {
			expect(result.attachment).toEqual({
				adapter_id: "chrome-devtools-mcp",
				route: "explicit-cdp",
				probe_executable: RESOLVED_PATH,
			});
		}
		// The probe ran through the adapter's own executable with the injected endpoint.
		const probeCall = log.commands.at(-1);
		expect(probeCall?.command).toBe(RESOLVED_PATH);
		expect(probeCall?.args).toContain(ENDPOINT.http);
	});

	test("probe non-zero exit → attachment-failed with evidence", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 3, stdout: "", stderr: "cannot reach cdp" }),
		});
		const result = await chromeDevtoolsMcpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.failureClass).toBe("attachment-failed");
			expect(result.detail).toContain("exited 3");
		}
	});

	test("probe timeout → attachment-failed", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 1, stdout: "", stderr: "", timedOut: true }),
		});
		const result = await chromeDevtoolsMcpDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.failureClass).toBe("attachment-failed");
			expect(result.detail).toContain("timed out");
		}
	});

	test("executable + pinned version constants stay stable", () => {
		expect(chromeDevtoolsMcpDefinition.executable).toBe(
			CHROME_DEVTOOLS_MCP_EXECUTABLE,
		);
		expect(chromeDevtoolsMcpDefinition.pinnedVersion).toBe(
			CHROME_DEVTOOLS_MCP_PINNED_VERSION,
		);
	});
});

describe("agent-browser definition (non-MCP seam)", () => {
	test("declares explicit-cdp verified-live only", () => {
		expect(agentBrowserDefinition.routes).toEqual([
			{ route: "explicit-cdp", evidence: "verified-live", implemented: true },
		]);
	});

	test("injection produces exact --cdp <ws> argv array (no shell strings)", () => {
		const injection = agentBrowserDefinition.inject(ENDPOINT);
		expect(injection.argv).toEqual([AGENT_BROWSER_CDP_FLAG, ENDPOINT.ws]);
		expect(Array.isArray(injection.argv)).toBe(true);
	});

	test("installed + version match → provenance installed", async () => {
		const { runtime } = fakeRuntime({
			respond: versionResponder(AGENT_BROWSER_PINNED_VERSION),
		});
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result).toEqual({
			installed: true,
			executablePath: RESOLVED_PATH,
			version: AGENT_BROWSER_PINNED_VERSION,
		});
	});

	test("unresolvable path → adapter-not-installed, NEVER a probe", async () => {
		const { runtime, log } = fakeRuntime({ resolution: { resolved: false } });
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		if (!result.installed) {
			expect(result.failureClass).toBe("adapter-not-installed");
		}
		expect(log.commands.length).toBe(0);
	});

	test("version mismatch → adapter-not-installed, never a probe", async () => {
		const { runtime, log } = fakeRuntime({
			respond: versionResponder("0.30.0"),
		});
		const result = await agentBrowserDefinition.checkProvenance(runtime);
		expect(result.installed).toBe(false);
		const probed = log.commands.some((c) =>
			c.args.includes(AGENT_BROWSER_CDP_FLAG),
		);
		expect(probed).toBe(false);
	});

	test("probe success → attached naming the probe executable", async () => {
		const { runtime, log } = fakeRuntime({
			respond: () => ({ exitCode: 0, stdout: "snapshot", stderr: "" }),
		});
		const result = await agentBrowserDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(true);
		if (result.attached) {
			expect(result.attachment.adapter_id).toBe("agent-browser");
			expect(result.attachment.probe_executable).toBe(RESOLVED_PATH);
		}
		const probeCall = log.commands.at(-1);
		expect(probeCall?.command).toBe(RESOLVED_PATH);
		expect(probeCall?.args).toContain(ENDPOINT.ws);
	});

	test("probe non-zero exit → attachment-failed", async () => {
		const { runtime } = fakeRuntime({
			respond: () => ({ exitCode: 2, stdout: "", stderr: "no cdp" }),
		});
		const result = await agentBrowserDefinition.probeAttachment(
			runtime,
			ENDPOINT,
			"explicit-cdp",
		);
		expect(result.attached).toBe(false);
		if (!result.attached) {
			expect(result.failureClass).toBe("attachment-failed");
		}
	});

	test("executable + pinned version constants stay stable", () => {
		expect(agentBrowserDefinition.executable).toBe(AGENT_BROWSER_EXECUTABLE);
		expect(agentBrowserDefinition.pinnedVersion).toBe(
			AGENT_BROWSER_PINNED_VERSION,
		);
	});
});
