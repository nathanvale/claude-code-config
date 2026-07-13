import { lstat, mkdir, readlink, realpath, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { SetupDomainResult, SetupFinding } from "./model.ts";

export const STARTUP_LINKS = [
	{ destination: ".claude/CLAUDE.md", source: "CLAUDE.md" },
	{ destination: ".claude/AGENTS.md", source: "AGENTS.md" },
	{ destination: ".claude/context", source: "context" },
	{ destination: ".claude/rules", source: "rules" },
	{ destination: ".claude/commands", source: "commands" },
	{ destination: ".claude/agents", source: "agents" },
	{ destination: ".claude/runbooks", source: "runbooks" },
	{ destination: ".claude/hooks", source: "hooks" },
	{ destination: ".claude/hooks.json", source: "hooks.json" },
	{ destination: ".claude/settings.json", source: "settings.json" },
	{ destination: ".claude/.mcp.json", source: ".mcp.json" },
	{ destination: ".codex/AGENTS.md", source: "AGENTS.md" },
	{ destination: ".config/context", source: "context" },
] as const;

export interface StartupOperation {
	readonly destination: string;
	readonly source: string;
	readonly action: "create" | "relink";
}

export interface StartupTopologyPlan {
	readonly domain: "startup";
	readonly homeRoot: string;
	readonly operations: readonly StartupOperation[];
	readonly findings: readonly SetupFinding[];
	readonly preserved: readonly string[];
}

export async function inspectStartupTopology(sourceRoot: string, homeDir: string): Promise<StartupTopologyPlan> {
	const operations: StartupOperation[] = [];
	const findings: SetupFinding[] = [];
	const preserved: string[] = [];
	const homeRoot = await canonical(homeDir);
	for (const entry of STARTUP_LINKS) {
		const unsafe = await unsafeExistingParent(homeRoot, join(homeDir, entry.destination));
		if (unsafe) {
			findings.push({ id: "unsafe_root", owner: "setup.startup", path: unsafe, summary: "Startup parent escapes the selected home.", repair: "human_repair" });
			return { domain: "startup", homeRoot, operations: [], findings, preserved: STARTUP_LINKS.map((item) => join(homeDir, item.destination)) };
		}
	}
	for (const entry of STARTUP_LINKS) {
		const source = join(sourceRoot, entry.source);
		const destination = join(homeDir, entry.destination);
		if (!(await exists(source))) {
			findings.push({ id: "source_missing", owner: "setup.startup", path: source, summary: `Startup source is missing: ${entry.source}.`, repair: "human_repair" });
			preserved.push(destination);
			continue;
		}
		const shape = await pathShape(destination);
		if (shape === "missing") {
			operations.push({ destination, source, action: "create" });
			continue;
		}
		if (shape === "symlink") {
			const target = await resolvedLink(destination);
			if (target === await canonical(source)) continue;
			findings.push({ id: "foreign_symlink", owner: "external", path: destination, summary: "Foreign startup symlink is preserved.", repair: "human_repair" });
			preserved.push(destination);
			continue;
		}
		findings.push({ id: "real_entry", owner: "external", path: destination, summary: "Real startup entry is preserved.", repair: "human_repair" });
		preserved.push(destination);
	}
	return { domain: "startup", homeRoot, operations, findings, preserved };
}

export async function applyStartupTopology(
	plan: StartupTopologyPlan,
	options: { beforeSymlink?: (destination: string) => Promise<void> } = {},
): Promise<SetupDomainResult> {
	const applied: string[] = [];
	const failed: string[] = [];
	const deferred: string[] = [];
	for (let index = 0; index < plan.operations.length; index += 1) {
		const operation = plan.operations[index];
		if (!operation) continue;
		try {
			if (await unsafeExistingParent(plan.homeRoot, operation.destination)) throw new Error("unsafe_root");
			if (!(await exists(operation.source)) || await pathShape(operation.destination) !== (operation.action === "create" ? "missing" : "symlink")) throw new Error("concurrent_change");
			await mkdir(dirname(operation.destination), { recursive: true });
			if (await unsafeExistingParent(plan.homeRoot, operation.destination)) throw new Error("unsafe_root");
			if (operation.action === "relink") await rm(operation.destination);
			await options.beforeSymlink?.(operation.destination);
			if (await unsafeExistingParent(plan.homeRoot, operation.destination)) throw new Error("unsafe_root");
			if (await pathShape(operation.destination) !== "missing") throw new Error("concurrent_change");
			await symlink(resolve(operation.source), operation.destination);
			applied.push(operation.destination);
		} catch {
			failed.push(operation.destination);
			deferred.push(...plan.operations.slice(index + 1).map((item) => item.destination));
			break;
		}
	}
	return { domain: "startup", planned: plan.operations.map((item) => item.destination), applied, deferred, preserved: plan.preserved, failed };
}

export async function removableStartupLinks(sourceRoot: string, homeDir: string): Promise<readonly string[]> {
	const paths: string[] = [];
	for (const entry of STARTUP_LINKS) {
		const destination = join(homeDir, entry.destination);
		if (await pathShape(destination) === "symlink" && await resolvedLink(destination) === await canonical(resolve(sourceRoot, entry.source))) paths.push(destination);
	}
	return paths;
}

async function canonical(path: string): Promise<string> {
	try { return await realpath(path); } catch { return resolve(path); }
}

async function unsafeExistingParent(homeRoot: string, destination: string): Promise<string | undefined> {
	let current = dirname(destination);
	while (true) {
		if (await exists(current)) {
			const resolved = await canonical(current);
			if (!inside(homeRoot, resolved)) return current;
			if (resolve(resolved) === resolve(homeRoot)) return undefined;
		}
		if (resolve(current) === resolve(homeRoot)) return undefined;
		const parent = dirname(current);
		if (parent === current) return current;
		current = parent;
	}
}

function inside(root: string, path: string): boolean {
	const child = relative(resolve(root), resolve(path));
	return child === "" || (!child.startsWith("..") && !child.startsWith("/"));
}

async function exists(path: string): Promise<boolean> {
	try { await lstat(path); return true; } catch { return false; }
}

async function pathShape(path: string): Promise<"missing" | "symlink" | "entry"> {
	try { return (await lstat(path)).isSymbolicLink() ? "symlink" : "entry"; } catch { return "missing"; }
}

async function resolvedLink(path: string): Promise<string> {
	const raw = await readlink(path);
	const target = isAbsolute(raw) ? raw : resolve(dirname(path), raw);
	try { return await realpath(target); } catch { return resolve(target); }
}
