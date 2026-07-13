import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { SetupDomainResult, SetupFinding } from "./model.ts";

export interface HookOperation { readonly source: string; readonly destination: string }
export interface HookTopologyPlan {
	readonly domain: "hooks";
	readonly operations: readonly HookOperation[];
	readonly findings: readonly SetupFinding[];
	readonly preserved: readonly string[];
}

export type HookDirectoryReader = (path: string) => Promise<string[]>;

export async function resolveGitHookPath(repoRoot: string): Promise<string> {
	const child = Bun.spawnSync(["git", "-C", repoRoot, "rev-parse", "--git-path", "hooks"], { stdout: "pipe", stderr: "pipe" });
	if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr).trim() || "Git hook path is unavailable.");
	const path = new TextDecoder().decode(child.stdout).trim();
	return isAbsolute(path) ? path : resolve(repoRoot, path);
}

export async function inspectHookTopology(
	sourceDir: string,
	destinationDir: string,
	readDirectory: HookDirectoryReader = async (path) => readdir(path),
): Promise<HookTopologyPlan> {
	const operations: HookOperation[] = [];
	const findings: SetupFinding[] = [];
	const preserved: string[] = [];
	let names: string[] = [];
	try {
		names = await readDirectory(sourceDir);
	} catch (error) {
		findings.push(hookSourceFinding(sourceDir, error));
		return { domain: "hooks", operations, findings, preserved };
	}
	for (const name of names.sort()) {
		const source = join(sourceDir, name);
		const destination = join(destinationDir, name);
		if (!(await isRegular(source))) continue;
		const shape = await destinationShape(destination);
		if (shape === "missing") operations.push({ source, destination });
		else if (shape === "file" && await equalFiles(source, destination)) {
			// Equal bytes prove Setup ownership; executable repair is safe.
			const mode = (await lstat(destination)).mode;
			if ((mode & 0o111) === 0) operations.push({ source, destination });
		} else {
			findings.push({ id: "hook_unhealthy", owner: "external", path: destination, summary: "Differing or linked Git hook is preserved.", repair: "repair_hooks" });
			preserved.push(destination);
		}
	}
	return { domain: "hooks", operations, findings, preserved };
}

export async function applyHookTopology(
	plan: HookTopologyPlan,
	options: { beforeCopy?: (destination: string) => Promise<void> } = {},
): Promise<SetupDomainResult> {
	const applied: string[] = [];
	const failed: string[] = [];
	const deferred: string[] = [];
	for (let index = 0; index < plan.operations.length; index += 1) {
		const operation = plan.operations[index];
		if (!operation) continue;
		try {
			const shape = await destinationShape(operation.destination);
			if (shape !== "missing" && !(shape === "file" && await equalFiles(operation.source, operation.destination))) throw new Error("concurrent_change");
			await mkdir(dirname(operation.destination), { recursive: true });
			await options.beforeCopy?.(operation.destination);
			const fresh = await destinationShape(operation.destination);
			if (shape === "missing" ? fresh !== "missing" : !(fresh === "file" && await equalFiles(operation.source, operation.destination))) throw new Error("concurrent_change");
			if (fresh === "missing") await copyFile(operation.source, operation.destination, constants.COPYFILE_EXCL);
			await chmod(operation.destination, 0o755);
			applied.push(operation.destination);
		} catch {
			failed.push(operation.destination);
			deferred.push(...plan.operations.slice(index + 1).map((item) => item.destination));
			break;
		}
	}
	return { domain: "hooks", planned: plan.operations.map((item) => item.destination), applied, deferred, preserved: plan.preserved, failed };
}

async function destinationShape(path: string): Promise<"missing" | "file" | "other"> {
	try { const stat = await lstat(path); return stat.isFile() && !stat.isSymbolicLink() ? "file" : "other"; } catch { return "missing"; }
}
async function isRegular(path: string): Promise<boolean> { try { return (await lstat(path)).isFile(); } catch { return false; } }
async function equalFiles(left: string, right: string): Promise<boolean> { try { return Buffer.compare(await readFile(left), await readFile(right)) === 0; } catch { return false; } }

function hookSourceFinding(path: string, error: unknown): SetupFinding {
	const code = errorCode(error);
	const summary = code === "ENOENT"
		? "Git hook source directory is missing."
		: code === "EACCES" || code === "EPERM"
			? "Git hook source directory is unreadable."
			: code === "ENOTDIR"
				? "Git hook source path is not a directory."
				: "Git hook source directory could not be inspected.";
	return {
		id: "hook_unhealthy",
		owner: "setup.hooks",
		path,
		summary,
		why: error instanceof Error ? error.message : String(error),
		repair: "repair_hooks",
	};
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}
