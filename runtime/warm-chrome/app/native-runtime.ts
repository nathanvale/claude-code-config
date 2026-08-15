#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

import { main } from "../src/cli.ts";
import {
	createDefaultRuntime,
	REAL_GOOGLE_CHROME_BINARY,
	type LaunchChromeInput,
	type SpawnedChrome,
	type WarmChromeRuntime,
} from "../src/runtime.ts";

const NATIVE_LAUNCH_TIMEOUT_MS = 20_000;
const TERMINATE_GRACE_MS = 2_000;

type NativeLaunchResult = {
	status: "launched";
	browser_pid: number;
	launch_mode: "launch_services";
};

type NativeRuntimeDeps = {
	launchServicesPath?: string;
	launchChrome?: (input: LaunchChromeInput) => Promise<number>;
};

function launchServicesPath(): string {
	return join(dirname(process.execPath), "chrome-launch-services");
}

function chromeLaunchArguments(input: LaunchChromeInput): string[] {
	return [
		"--chrome",
		input.chromeBin,
		"--port",
		input.port,
		"--profile",
		input.profileDir,
		"--profile-directory",
		input.profileDirectory,
		"--startup-url",
		input.startupUrl,
	];
}

async function launchChromeWithHelper(
	helperPath: string,
	input: LaunchChromeInput,
): Promise<number> {
	const child = spawn(helperPath, chromeLaunchArguments(input), {
		stdio: ["ignore", "pipe", "ignore"],
	});
	const output = child.stdout;
	if (output === null) throw new Error("native launcher stdout unavailable");
	let source = "";
	output.setEncoding("utf8");
	output.on("data", (chunk: string) => {
		if (source.length <= 8_192) source += chunk;
	});
	const exitCode = await new Promise<number>((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("native launcher timed out"));
		}, NATIVE_LAUNCH_TIMEOUT_MS);
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timeout);
			resolve(code ?? 20);
		});
	});
	if (exitCode !== 0 || source.length > 8_192) {
		throw new Error("native launcher failed");
	}
	const parsed: unknown = JSON.parse(source);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		(parsed as Partial<NativeLaunchResult>).status !== "launched" ||
		(parsed as Partial<NativeLaunchResult>).launch_mode !== "launch_services" ||
		!Number.isSafeInteger((parsed as Partial<NativeLaunchResult>).browser_pid) ||
		Number((parsed as Partial<NativeLaunchResult>).browser_pid) <= 0
	) {
		throw new Error("native launcher returned an invalid result");
	}
	return Number((parsed as NativeLaunchResult).browser_pid);
}

async function processCommand(pid: number): Promise<string | null> {
	const child = Bun.spawn(["/bin/ps", "-p", String(pid), "-o", "command="], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	const [exitCode, source] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
	]);
	if (exitCode !== 0) return null;
	return source.trim();
}

function commandMatchesLaunch(command: string, input: LaunchChromeInput): boolean {
	return (
		(command === REAL_GOOGLE_CHROME_BINARY ||
			command.startsWith(`${REAL_GOOGLE_CHROME_BINARY} --`)) &&
		command.includes(`--user-data-dir=${input.profileDir}`) &&
		command.includes(`--remote-debugging-port=${input.port}`)
	);
}

async function processIsAlive(pid: number): Promise<boolean> {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

async function waitForExit(pid: number, budgetMs: number): Promise<boolean> {
	const deadline = Date.now() + budgetMs;
	while (Date.now() < deadline) {
		if (!(await processIsAlive(pid))) return true;
		await Bun.sleep(50);
	}
	return !(await processIsAlive(pid));
}

async function terminateOwnedChrome(
	pid: number,
	input: LaunchChromeInput,
): Promise<boolean> {
	const command = await processCommand(pid);
	if (command === null) return true;
	if (!commandMatchesLaunch(command, input)) return false;
	try {
		process.kill(pid, "SIGTERM");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
	if (await waitForExit(pid, TERMINATE_GRACE_MS)) return true;
	const commandBeforeKill = await processCommand(pid);
	if (commandBeforeKill === null) return true;
	if (!commandMatchesLaunch(commandBeforeKill, input)) return false;
	try {
		process.kill(pid, "SIGKILL");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
	return waitForExit(pid, TERMINATE_GRACE_MS);
}

/**
 * Build the installed-app runtime that delegates Chrome process creation to
 * macOS Launch Services while retaining Warm Chrome proof and race ownership.
 *
 * @param deps - Native launch overrides for focused tests
 * @returns Warm Chrome runtime with one Launch Services spawn seam
 *
 * @example
 * ```typescript
 * const runtime = createNativeRuntime({ launchChrome: async () => 4242 })
 * ```
 */
export function createNativeRuntime(deps: NativeRuntimeDeps = {}): WarmChromeRuntime {
	const helperPath = deps.launchServicesPath ?? launchServicesPath();
	const launchChrome =
		deps.launchChrome ??
		((input: LaunchChromeInput) => launchChromeWithHelper(helperPath, input));
	return createDefaultRuntime({
		spawnChrome: async (input): Promise<SpawnedChrome> => {
			const pid = await launchChrome(input);
			return {
				pid,
				kill: () => terminateOwnedChrome(pid, input),
			};
		},
	});
}

if (import.meta.main) {
	process.exitCode = await main(process.argv.slice(2), {
		runtime: createNativeRuntime(),
	});
}
