import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCliProcess } from "@side-quest/cli-command-facade/testing";
import {
	createCleanupRegistry,
	drainCleanup,
	makeTempDir,
	startFixtureServer,
} from "@side-quest/cli-test-fixtures";
import {
	PLAYWRIGHT_CDP_PINNED_VERSION,
	PLAYWRIGHT_CDP_SESSION_PREFIX,
} from "../src/adapters/playwright-cdp.ts";

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

const CLI_PATH = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const SRC_DIR = dirname(CLI_PATH);
const PACKAGE_ROOT = dirname(SRC_DIR);
const cleanup = createCleanupRegistry();

afterEach(() => {
	drainCleanup(cleanup);
});

function wrapperSource(): string {
	return `// @ts-nocheck
import { main } from ${JSON.stringify(CLI_PATH)};
import { spawnAdapterCommand } from ${JSON.stringify(join(SRC_DIR, "adapters/registry.ts"))};

const endpoint = process.env.FAKE_CDP_ENDPOINT;
const ws = process.env.FAKE_CDP_WS;
const executable = process.env.FAKE_PLAYWRIGHT_CLI;

const warmChromeMain = async (_argv, deps = {}) => {
	deps.stdout?.write(JSON.stringify({
		status: "ok",
		run_id: "playwright-process-proof",
		data: {
			contract_id: "warm-chrome.browser-entry",
			schema_version: "1",
			ok: true,
			action: "browser_ready",
			command: "check",
			endpoint,
			port: new URL(endpoint).port,
			browser: "Chrome/150.0.0.0",
			web_socket_debugger_url: ws,
			browser_pid: 4242,
			profile_dir: "/redacted/profile",
		},
	}) + String.fromCharCode(10));
	return 0;
};

const adapterRuntime = {
	env: process.env,
	resolveExecutable: command =>
		command === "playwright-cli"
			? { resolved: true, path: executable }
			: { resolved: false },
	runCommand: spawnAdapterCommand,
};

const exitCode = await main(process.argv.slice(2), {
	warmChromeMain,
	adapterRuntime,
});
process.exit(exitCode);
`;
}

function fakePlaywrightCliSource(): string {
	return `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const logPath = process.env.PLAYWRIGHT_FAKE_LOG;
const statePath = process.env.PLAYWRIGHT_FAKE_STATE;
appendFileSync(logPath, JSON.stringify(args) + String.fromCharCode(10));

if (args.includes("--version")) {
	console.log(${JSON.stringify(PLAYWRIGHT_CDP_PINNED_VERSION)});
	process.exit(0);
}
if (args[0] === "attach" && args.includes("--help")) {
	console.log("playwright-cli attach [name]");
	console.log("  --cdp                       connect to an existing browser via cdp endpoint url.");
	console.log('  --session                   session name (defaults to bound browser name or "default")');
	process.exit(0);
}
if (args[0] === "detach" && args.includes("--help")) {
	console.log("Detach from an attached browser");
	process.exit(0);
}
if (args[0] === "attach") {
	const endpoint = args.find(arg => arg.startsWith("--cdp="))?.slice("--cdp=".length);
	const session = args.find(arg => arg.startsWith("--session="))?.slice("--session=".length);
	if (!endpoint || !session)
		process.exit(7);
	const response = await fetch(endpoint + "/json/version");
	if (!response.ok)
		process.exit(8);
	writeFileSync(statePath, session);
	process.exit(0);
}
const session = args.find(arg => arg.startsWith("--session="))?.slice("--session=".length);
if (args.at(-1) === "snapshot") {
	// The snapshot must target the SAME named session the attach opened.
	if (!existsSync(statePath) || session !== readFileSync(statePath, "utf8"))
		process.exit(9);
	console.log("snapshot ok");
	process.exit(0);
}
if (args.at(-1) === "detach") {
	if (existsSync(statePath))
		unlinkSync(statePath);
	console.log("detached");
	process.exit(0);
}
console.error("implicit browser launch or unknown command");
process.exit(10);
`;
}

describe("playwright-cdp process-boundary attachment", () => {
	test("connect injects the verified endpoint, uses named attach/detach, and leaves the browser alive", async () => {
		const browser = startFixtureServer(cleanup, (request) => {
			const path = new URL(request.url).pathname;
			if (path === "/json/version") {
				return Response.json({
					Browser: "Chrome/150.0.0.0",
					webSocketDebuggerUrl: `ws://127.0.0.1:${browser.port}/devtools/browser/process-proof`,
				});
			}
			return new Response("alive");
		});
		const root = makeTempDir(cleanup, "browser-connect-playwright");
		const wrapper = join(root, "entry.ts");
		const executable = join(root, "playwright-cli");
		const logPath = join(root, "playwright.log");
		const statePath = join(root, "playwright.session");
		writeFileSync(wrapper, wrapperSource());
		writeFileSync(executable, fakePlaywrightCliSource());
		chmodSync(executable, 0o755);

		const endpoint = browser.url;
		const result = await runCliProcess({
			label: "playwright-cdp-process-proof",
			argv: [
				process.execPath,
				wrapper,
				"connect",
				"playwright-cdp",
				"--json",
				"--run-id",
				"playwright-process-proof",
			],
			cwd: PACKAGE_ROOT,
			timeoutMs: 20_000,
			env: {
				...process.env,
				FAKE_CDP_ENDPOINT: endpoint,
				FAKE_CDP_WS: `ws://127.0.0.1:${browser.port}/devtools/browser/process-proof`,
				FAKE_PLAYWRIGHT_CLI: executable,
				PLAYWRIGHT_FAKE_LOG: logPath,
				PLAYWRIGHT_FAKE_STATE: statePath,
			},
		});

		expect(result.exitCode, result.stderr).toBe(0);
		const envelope = JSON.parse(result.stdout) as {
			status: string;
			data: {
				attachment: {
					adapter_id: string;
					route: string;
					probe_executable: string;
				};
				endpoint: { http: string };
			};
		};
		expect(envelope.status).toBe("ok");
		expect(envelope.data.attachment).toEqual({
			adapter_id: "playwright-cdp",
			route: "explicit-cdp",
			probe_executable: executable,
		});
		expect(envelope.data.endpoint.http).toBe(endpoint);

		const commands = readFileSync(logPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as string[]);
		// Command SHAPES are fixed; the session token is derived per invocation.
		expect(commands[0]).toEqual(["--version"]);
		expect(commands[1]).toEqual(["attach", "--help"]);
		expect(commands[2]).toEqual(["detach", "--help"]);
		expect(commands[3]?.slice(0, 2)).toEqual(["attach", `--cdp=${endpoint}`]);
		expect(commands[4]?.[1]).toBe("snapshot");
		expect(commands[5]?.[1]).toBe("detach");

		// One derived session name threads through attach → snapshot → detach.
		const attachSession = sessionOf(commands[3] ?? []);
		expect(attachSession).toMatch(PROBE_SESSION_PATTERN);
		expect(sessionOf(commands[4] ?? [])).toBe(attachSession);
		expect(sessionOf(commands[5] ?? [])).toBe(attachSession);
		expect(commands.flat()).not.toContain("open");
		expect(commands.flat()).not.toContain("install-browser");

		const stillAlive = await fetch(`${endpoint}/alive`);
		expect(stillAlive.status).toBe(200);
		expect(await stillAlive.text()).toBe("alive");
	});
});
