import {
	chmod,
	mkdtemp,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import {
	type BrowserUseRuntime,
	createDefaultBrowserUseRuntime,
} from "./browser-use-runtime";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";

const cleanupPaths: string[] = [];
type LaunchChromeInput = Parameters<BrowserUseRuntime["spawnChrome"]>[0];

export async function cleanupWarmRuntimePaths(): Promise<void> {
	await Promise.all(
		cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
}

export async function warmRuntime(input: {
	port?: string;
	commandResponses?: Record<string, McporterCommandResult[]>;
	listener?: false | "after-spawn" | { pid: number; command: string };
	endpointReady?: "always" | "after-spawn";
} = {}): Promise<{
	runtime: BrowserUseRuntime;
	calls: McporterCommandInput[];
	spawnChromeCalls: LaunchChromeInput[];
}> {
	const port = input.port ?? "9222";
	const home = await makeDir();
	const profile = await makeProfile(0o700);
	const calls: McporterCommandInput[] = [];
	const spawnChromeCalls: LaunchChromeInput[] = [];
	const defaultListener = { pid: 12345, command: chromeCommand({ port, profile }) };
	const listener = input.listener ?? defaultListener;
	const endpointReady = input.endpointReady ?? "always";
	const responses = input.commandResponses ?? {
		"mcporter config get chrome-devtools --json": [okCommand(configStdout(port))],
		"mcporter call chrome-devtools.list_pages --args {} --output json": [
			okCommand(JSON.stringify({ pages: [{ id: "page-1" }] })),
		],
	};

	const runtime = createDefaultBrowserUseRuntime({
		env: { HOME: home, BROWSER_USE_PROFILE_DIR: profile },
		platform: "darwin",
		now: (() => {
			let now = 1_000;
			return () => {
				now += 17;
				return now;
			};
		})(),
		fetchJson: async (url) => {
			if (endpointReady === "after-spawn" && spawnChromeCalls.length === 0) {
				throw new Error(`endpoint not ready: ${url}`);
			}
			if (url.endsWith("/json/version")) return cdpVersion(port);
			if (url.endsWith("/json/list")) return [{ id: "page-1" }];
			throw new Error(`unexpected URL: ${url}`);
		},
		findListener: async () => {
			if (listener === false) return null;
			if (listener === "after-spawn") {
				return spawnChromeCalls.length > 0 ? defaultListener : null;
			}
			return listener;
		},
		currentUser: async () => String(userInfo().uid),
		statProfile: async (path) => {
			const realPath = await realpath(path);
			const info = await stat(realPath);
			if (!info.isDirectory()) throw new Error("not a directory");
			return {
				realPath,
				mode: (info.mode & 0o777).toString(8),
				owner: String(info.uid),
			};
		},
		ensureProfileDir: async (path) => path,
		chmod: async () => {},
		writeTextFile: async (path, content) => {
			await writeFile(path, content, "utf-8");
		},
		spawnChrome: async (launch) => {
			spawnChromeCalls.push(launch);
		},
		sleep: async () => {},
		isTemporaryPath: () => false,
		cwd: await makeDir(),
		readTextFile: async () => {
			throw new Error("unexpected native config read");
		},
		runCommand: async (command) => {
			calls.push(command);
			const key = commandVector(command);
			const queue = responses[key];
			const response = queue?.shift();
			if (!response) throw new Error(`unexpected command: ${key}`);
			return response;
		},
		readStdin: async () => "",
		ensureDirectory: async () => {},
	});

	return { runtime, calls, spawnChromeCalls };
}

export function okCommand(stdout: string): McporterCommandResult {
	return { exitCode: 0, stdout, stderr: "" };
}

export function configStdout(port: string): string {
	return JSON.stringify({
		args: ["chrome-devtools-mcp", "--browserUrl", `http://127.0.0.1:${port}`],
	});
}

export function commandVector(input: McporterCommandInput): string {
	return [input.command, ...input.args].join(" ");
}

async function makeDir(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "browser-use-warm-"));
	cleanupPaths.push(path);
	return path;
}

async function makeProfile(mode: number): Promise<string> {
	const path = await makeDir();
	await chmod(path, mode);
	return path;
}

function cdpVersion(port: string): Record<string, string> {
	return {
		Browser: "Chrome/136.0.0.0",
		"User-Agent": "Mozilla/5.0 Chrome/136.0.0.0",
		webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/test-browser`,
	};
}

function chromeCommand(input: { port: string; profile: string }): string {
	return `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=${input.port} --user-data-dir=${input.profile} --no-first-run`;
}
