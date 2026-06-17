import { existsSync, readFileSync } from "node:fs";

export type StorybookDoctorRuntime = {
	readonly cwd: () => string;
	readonly fileExists: (path: string) => boolean;
	readonly readTextFile: (path: string) => string;
	readonly fetch: (url: string, options?: RequestInit) => Promise<Response>;
	readonly lookupPortOwner: (port: number) => PortOwnerInfo | null;
	readonly commandExists: (name: string) => boolean;
	readonly execCommand: (
		cmd: string,
		args: readonly string[],
		options?: { cwd?: string; timeout?: number },
	) => Promise<ExecResult>;
	readonly now: () => number;
	readonly getEnv: (name: string) => string | undefined;
};

export type PortOwnerInfo = {
	readonly pid: number;
	readonly command: string;
};

export type ExecResult = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export function createDefaultStorybookDoctorRuntime(
	overrides: Partial<StorybookDoctorRuntime> = {},
): StorybookDoctorRuntime {
	return {
		cwd: () => process.cwd(),
		fileExists: (path) => existsSync(path),
		readTextFile: (path) => readFileSync(path, "utf8"),
		fetch: (url, options) => globalThis.fetch(url, options),
		lookupPortOwner: (port) => lookupPortOwnerDefault(port),
		commandExists: (name) => commandExistsDefault(name),
		execCommand: (cmd, args, options) =>
			execCommandDefault(cmd, args, options),
		now: () => Date.now(),
		getEnv: (name) => process.env[name],
		...overrides,
	};
}

function lookupPortOwnerDefault(port: number): PortOwnerInfo | null {
	try {
		const result = Bun.spawnSync(["lsof", "-ti", `TCP:${port}`, "-sTCP:LISTEN"]);
		const stdout = result.stdout.toString().trim();
		if (!stdout || result.exitCode !== 0) return null;
		const pid = Number.parseInt(stdout.split("\n")[0], 10);
		if (Number.isNaN(pid)) return null;
		const ps = Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="]);
		const command = ps.stdout.toString().trim() || "unknown";
		return { pid, command };
	} catch {
		return null;
	}
}

function commandExistsDefault(name: string): boolean {
	try {
		const result = Bun.spawnSync(["which", name]);
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

async function execCommandDefault(
	cmd: string,
	args: readonly string[],
	options?: { cwd?: string; timeout?: number },
): Promise<ExecResult> {
	const proc = Bun.spawn([cmd, ...args], {
		cwd: options?.cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const timeout = options?.timeout ?? 30_000;
	const timer = setTimeout(() => proc.kill(), timeout);
	try {
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;
		return { exitCode, stdout, stderr };
	} finally {
		clearTimeout(timer);
	}
}
