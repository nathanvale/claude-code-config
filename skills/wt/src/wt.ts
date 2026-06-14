#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import {
	type CliWriter,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	parseCliDiagnosticArgv,
	projectCommandDiscoveryTree,
	renderCommandUsage,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	cleanPreview,
	createWorktree,
	deleteWorktree,
	type GitRunner,
} from "../../../runtime/agent-worktree/src/index.ts";
import { wtContracts } from "./command-contract.ts";
import {
	WT_COLOR_PALETTE,
	WT_CONTRACT_ID,
	WT_SCHEMA_VERSION,
	type Registry,
	type WtColor,
} from "./model.ts";
import { isDrift, renderWorkspace, stampHeader } from "./wt-engine.ts";
import {
	listWorktrees,
	repoOwnerRootFor,
	type Runner,
	WtDiscoveryError,
	adaptRunner,
	parseRegistryText,
	workspacePathFor,
} from "./wt-discovery.ts";

const VERSION = "0.1.0";

/**
 * Runtime adapter for the filesystem, subprocess, and existence checks.
 *
 * Injected so the dispatcher's handlers run under test without touching real
 * files, spawning processes, or launching VS Code.
 */
export interface WtRuntime {
	/** Repo root the command operates on. */
	repoRoot: () => string;
	/** Read a UTF-8 file, or null when it does not exist. */
	readTextFile: (path: string) => Promise<string | null>;
	/** Write a UTF-8 file (creating parents as needed). */
	writeTextFile: (path: string, content: string) => Promise<void>;
	/** True when a path exists on disk. Backs focus probing. */
	pathExists: (path: string) => Promise<boolean>;
	/** Create a directory and parents when needed. */
	ensureDirectory: (path: string) => Promise<void>;
	/** True when stdin is an interactive TTY. */
	isInteractive: () => boolean;
	/** Subprocess runner for worktree discovery and delegation. */
	run: Runner;
	/** Launch VS Code on a workspace path; resolves false when the binary is absent. */
	launchCode: (workspacePath: string, codeBin?: string) => Promise<boolean>;
	/** Current epoch millis; injected so envelope durations are deterministic in tests. */
	now: () => number;
}

/**
 * Build the default runtime adapter backed by Bun's filesystem and spawn APIs.
 *
 * @param overrides - Hooks tests use to avoid real I/O
 * @returns A runtime adapter
 *
 * @example
 * ```typescript
 * const runtime = createDefaultRuntime({ repoRoot: () => "/code/my-repo" })
 * ```
 */
export function createDefaultRuntime(overrides: Partial<WtRuntime> = {}): WtRuntime {
	return {
		repoRoot: () => process.cwd(),
		readTextFile: async (path) => {
			try {
				return await Bun.file(path).text();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
		},
		writeTextFile: (path, content) => Bun.write(path, content).then(() => undefined),
		pathExists: (path) => Bun.file(path).exists(),
		ensureDirectory: (path) => mkdir(path, { recursive: true }).then(() => undefined),
		isInteractive: () => Boolean(process.stdin.isTTY),
		run: async (args, options = {}) => {
			const proc = Bun.spawn([...args], {
				cwd: options.cwd,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			const code = await proc.exited;
			return { ok: code === 0, stdout, stderr, code };
		},
		launchCode: async (workspacePath, codeBin = "code") => {
			try {
				const proc = Bun.spawn([codeBin, workspacePath], { stdout: "ignore", stderr: "ignore" });
				return (await proc.exited) === 0;
			} catch {
				return false;
			}
		},
		now: () => Date.now(),
		...overrides,
	};
}

/**
 * Render the repo's workspace and apply the drift gate before writing.
 *
 * Reads the registry and live worktrees, renders the workspace, then refuses to
 * overwrite a file that was edited since the last render unless `force` is set.
 * The gate holds in both interactive and non-interactive sessions; `--force` is
 * the only override. This is the product's core safety rule.
 *
 * @param runtime - Injected I/O adapter
 * @param force - Overwrite a drift-detected workspace
 * @returns A discriminated result: written, drift-blocked, or a discovery error
 */
export async function syncWorkspace(
	runtime: WtRuntime,
	force: boolean,
): Promise<
	| { kind: "written"; path: string }
	| { kind: "drift_blocked"; path: string }
	| { kind: "error"; code: string; message: string }
> {
	const repoRoot = runtime.repoRoot();
	let ownerRoot = repoRoot;
	let registry: Registry;
	let worktrees: Awaited<ReturnType<typeof listWorktrees>>;
	try {
		worktrees = await listWorktrees(repoRoot, runtime.run);
		ownerRoot = repoOwnerRootFor(worktrees, repoRoot);
		registry = await loadRegistryFromRuntime(runtime, ownerRoot);
	} catch (error) {
		if (error instanceof WtDiscoveryError) {
			return { kind: "error", code: error.code, message: error.message };
		}
		throw error;
	}
	const workspacePath = workspacePathFor(ownerRoot);

	const wip = registry.defaults?.wip ? expandHome(registry.defaults.wip) : null;
	if (wip) {
		registry = {
			...registry,
			defaults: {
				...registry.defaults,
				wip,
			},
		};
	}

	const existing = await runtime.readTextFile(workspacePath);
	if (existing !== null && isDrift(existing) && !force) {
		return { kind: "drift_blocked", path: workspacePath };
	}

	if (wip) {
		try {
			await runtime.ensureDirectory(wip);
		} catch {
			return {
				kind: "error",
				code: "write_failed",
				message: "Could not create the WIP scratch folder.",
			};
		}
	}

	// Pre-resolve focus-folder existence async (the engine's probe is sync), so
	// guessFocus can probe `<worktree>/skills/<stem>` without an async boundary.
	const probes = worktrees.map((worktree) => {
		const stem = worktree.branch.includes("/")
			? worktree.branch.slice(worktree.branch.indexOf("/") + 1)
			: worktree.branch;
		const candidate = `skills/${stem.replace(/^harden-/, "").replace(/-(refactor|harden|fix|feat|wip)$/, "")}`;
		return { worktreePath: worktree.path, candidate };
	});
	const probed = new Set<string>();
	const probeResults = await Promise.all(
		probes.map((probe) => runtime.pathExists(`${probe.worktreePath}/${probe.candidate}`)),
	);
	for (const [index, found] of probeResults.entries()) {
		if (found) {
			const probe = probes[index];
			probed.add(`${probe.worktreePath}::${probe.candidate}`);
		}
	}
	const workspace = renderWorkspace(registry, worktrees, (worktreePath, subfolder) =>
		probed.has(`${worktreePath}::${subfolder}`),
	);
	try {
		await runtime.writeTextFile(workspacePath, stampHeader(workspace));
	} catch {
		return {
			kind: "error",
			code: "write_failed",
			message: "Could not write the workspace file.",
		};
	}
	return { kind: "written", path: workspacePath };
}

/**
 * Persist a single branch preference into the registry, then re-render.
 *
 * Parse and write failures are caught and returned as structured `error`
 * results so a malformed `wt.config.json` or an I/O failure surfaces as a
 * facade envelope instead of an uncaught exception escaping `runCommand`.
 *
 * @param runtime - Injected I/O adapter
 * @param branch - Branch whose pref is being set
 * @param mutate - Applies the change to the branch's prefs in place
 * @param force - Passed through to the drift gate on the follow-up render
 * @returns The sync result after the registry write, or an `error` result when
 *   the registry is unreadable or the write fails
 */
export async function setPrefAndSync(
	runtime: WtRuntime,
	branch: string,
	mutate: (prefs: Record<string, unknown>) => void,
	force: boolean,
): Promise<Awaited<ReturnType<typeof syncWorkspace>>> {
	const repoRoot = runtime.repoRoot();
	let ownerRoot = repoRoot;
	try {
		const worktrees = await listWorktrees(repoRoot, runtime.run);
		ownerRoot = repoOwnerRootFor(worktrees, repoRoot);
	} catch (error) {
		if (error instanceof WtDiscoveryError) {
			return { kind: "error", code: error.code, message: error.message };
		}
		throw error;
	}
	const registryPath = `${ownerRoot}/wt.config.json`;
	const existing = await runtime.readTextFile(registryPath);
	let registry: Registry;
	try {
		registry = parseRegistryText(existing);
	} catch {
		return {
			kind: "error",
			code: "registry_unreadable",
			message: "wt.config.json is not valid JSON.",
		};
	}
	const prefs = (registry.branches[branch] ?? {}) as Record<string, unknown>;
	mutate(prefs);
	registry.branches[branch] = prefs as Registry["branches"][string];
	try {
		await runtime.writeTextFile(registryPath, `${JSON.stringify(registry, null, "\t")}\n`);
	} catch {
		return {
			kind: "error",
			code: "write_failed",
			message: "Could not write the registry file.",
		};
	}
	return syncWorkspace(runtime, force);
}

/**
 * Validate a color name against the fixed palette.
 *
 * @param value - User-supplied color token
 * @returns The validated color, or null when unknown
 */
export function validateColor(value: string): WtColor | null {
	return (WT_COLOR_PALETTE as readonly string[]).includes(value) ? (value as WtColor) : null;
}

/**
 * Pure command outcome: either success data or a structured failure.
 *
 * runCommand returns this instead of a facade envelope so the whole verb
 * surface is testable without diagnostics context or writers; main() converts
 * it into the facade envelope at the I/O edge.
 */
export type CommandResult =
	| { ok: true; data: Record<string, unknown> }
	| {
			ok: false;
			code: string;
			message: string;
			action: string;
			exitCode: number;
			recoverability: "change_input" | "repair_state";
	  };

/**
 * Success data carried inside the facade envelope for a render outcome.
 *
 * @param action - The verb that produced this result
 * @param workspacePath - Path to the rendered workspace
 * @returns A success data object
 * @internal
 */
function renderSuccessData(action: string, workspacePath: string): Record<string, unknown> {
	return {
		contract_id: WT_CONTRACT_ID,
		schema_version: WT_SCHEMA_VERSION,
		action,
		workspace_path: workspacePath,
		changed_state: "written",
		next_safe_action: "Reload the VS Code window to pick up the rendered workspace.",
	};
}

/**
 * Convert a sync outcome into a CommandResult.
 *
 * Drift-blocked maps to exit 3 with `repair_state` recoverability; discovery
 * errors map to exit 1. Hints stay prose-only -- the real recovery command
 * lives in docs/git/worktree.md, never inlined.
 *
 * @param action - The verb that triggered the sync
 * @param outcome - The sync result
 * @returns The command result
 * @internal
 */
function fromSync(
	action: string,
	outcome: Awaited<ReturnType<typeof syncWorkspace>>,
): CommandResult {
	if (outcome.kind === "written") {
		return { ok: true, data: renderSuccessData(action, outcome.path) };
	}
	if (outcome.kind === "drift_blocked") {
		return {
			ok: false,
			code: "drift_blocked",
			message: "The workspace was edited since the last render; refusing to overwrite.",
			action: "Review the diff, port real edits into wt.config.json, then rerun with --force.",
			exitCode: 3,
			recoverability: "repair_state",
		};
	}
	return {
		ok: false,
		code: outcome.code,
		message: outcome.message,
		action: "Inspect worktree and registry state, resolve the failure, then retry.",
		exitCode: 1,
		recoverability: "repair_state",
	};
}

/**
 * A usage failure: bad arguments or an unknown color, mapped to exit 2.
 *
 * @param code - Package-owned diagnostic code
 * @param message - Human-readable failure description
 * @param action - Prose-only repair hint
 * @returns A failing command result
 * @internal
 */
function usageFailure(code: string, message: string, action: string): CommandResult {
	return { ok: false, code, message, action, exitCode: 2, recoverability: "change_input" };
}

/**
 * Parsed wt invocation: the verb plus its positional arguments and flags.
 */
export interface ParsedInvocation {
	command: string;
	positionals: string[];
	force: boolean;
	noInput?: boolean;
	repoRoot?: string;
	parseError?: CommandResult;
}

/**
 * Parse a diagnostic-stripped argv into a verb, positionals, and the force flag.
 *
 * @param argv - argv tail with diagnostic flags already removed
 * @returns The parsed invocation
 *
 * @example
 * ```typescript
 * parseInvocation(["color", "codex/x", "blue"])
 * // → { command: "color", positionals: ["codex/x", "blue"], force: false }
 * ```
 */
export function parseInvocation(argv: readonly string[]): ParsedInvocation {
	const positionals: string[] = [];
	let force = false;
	let noInput = false;
	let repoRoot: string | undefined;
	let command = "";
	const usedFlags = new Set<string>();
	const fail = (message: string): ParsedInvocation => ({
		command,
		positionals,
		force,
		noInput,
		repoRoot,
		parseError: usageFailure("usage_error", message, "Review the command help and retry."),
	});
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--force") {
			force = true;
			usedFlags.add(arg);
		} else if (arg === "--no-input") {
			noInput = true;
			usedFlags.add(arg);
		} else if (arg === "--json") {
			// --json selects output mode; wt always emits JSON envelopes.
			usedFlags.add(arg);
		} else if (arg === "--repo") {
			usedFlags.add(arg);
			const value = argv[i + 1];
			if (!value || value.startsWith("--")) {
				return fail("--repo needs a path value.");
			}
			repoRoot = value;
			i += 1;
		} else if (arg.startsWith("--")) {
			return fail(`Unknown flag '${arg}'.`);
		} else if (command === "") {
			command = arg;
		} else {
			positionals.push(arg);
		}
	}
	if (command in wtContracts) {
		const allowed = new Set(Object.keys(wtContracts[command as keyof typeof wtContracts].flags));
		for (const flag of usedFlags) {
			if (!allowed.has(flag)) {
				return fail(`Flag '${flag}' is not accepted by wt ${command}.`);
			}
		}
	}
	return { command, positionals, force, noInput, repoRoot };
}

/**
 * Route a parsed invocation to its handler and return a pure CommandResult.
 *
 * Owns verb routing and result shape; delegates all I/O to the injected
 * runtime, so the entire command surface is testable without spawning
 * processes or touching disk.
 *
 * @param invocation - The parsed verb and flags
 * @param runtime - Injected I/O adapter
 * @returns The command result
 */
export async function runCommand(
	invocation: ParsedInvocation,
	runtime: WtRuntime,
): Promise<CommandResult> {
	const { command, positionals, force } = invocation;
	if (invocation.parseError) {
		return invocation.parseError;
	}

	switch (command) {
		case "sync":
			return fromSync("sync", await syncWorkspace(runtime, force));

		case "focus": {
			const [branch, subfolder] = positionals;
			if (!branch || !subfolder) {
				return usageFailure(
					"usage_error",
					"focus needs <branch> and <subfolder>.",
					"Rerun as: wt focus <branch> <subfolder>.",
				);
			}
			return fromSync(
				"focus",
				await setPrefAndSync(runtime, branch, (prefs) => {
					prefs.focus = subfolder;
				}, force),
			);
		}

		case "color": {
			const [branch, color] = positionals;
			if (!branch || !color) {
				return usageFailure(
					"usage_error",
					"color needs <branch> and <color>.",
					"Rerun as: wt color <branch> <color>.",
				);
			}
			const validated = validateColor(color);
			if (validated === null) {
				return usageFailure(
					"unknown_color",
					`Unknown color '${color}'. Allowed: ${WT_COLOR_PALETTE.join(", ")}.`,
					"Rerun with a color from the allowed palette.",
				);
			}
			return fromSync(
				"color",
				await setPrefAndSync(runtime, branch, (prefs) => {
					prefs.color = validated;
				}, force),
			);
		}

		case "new":
		case "rm": {
			if (command === "rm" && !force && (invocation.noInput || !runtime.isInteractive())) {
				return usageFailure(
					"usage_error",
					`${command} needs an explicit force flag in non-interactive runs.`,
					"Retry with explicit confirmation, or run interactively.",
				);
			}
			const [branch] = positionals;
			if (!branch) {
				return usageFailure(
					"usage_error",
					`${command} needs <branch>.`,
					`Rerun as: wt ${command} <branch>.`,
				);
			}
			const lifecycle =
				command === "new"
					? await createWorktree({
							cwd: runtime.repoRoot(),
							run: adaptRunner(runtime.run),
							branch,
							dryRun: false,
							runId: `wt-${runtime.now()}`,
						})
					: await deleteWorktree({
							cwd: runtime.repoRoot(),
							run: adaptRunner(runtime.run),
							branch,
							dryRun: false,
							force,
							deleteBranch: false,
							runId: `wt-${runtime.now()}`,
						});
			if (lifecycle.failureRef || lifecycle.changedState === "partial" || lifecycle.changedState === "unknown") {
				return {
					ok: false,
					code: "agent_worktree_failed",
					message: "Shared worktree runtime reported an incomplete lifecycle result.",
					action: "Inspect worktree state with agent-worktree, then retry.",
					exitCode: 1,
					recoverability: "repair_state",
				};
			}
			return fromSync(command, await syncWorkspace(runtime, force));
		}

		case "clean": {
			const preview = await cleanPreview({
				cwd: runtime.repoRoot(),
				run: adaptRunner(runtime.run),
			});
			return {
				ok: true,
				data: {
					contract_id: WT_CONTRACT_ID,
					schema_version: WT_SCHEMA_VERSION,
					action: "clean_preview",
					changed_state: "none",
					preview,
					next_safe_action: "Review cleanup candidates before pruning.",
				},
			};
		}

		case "open": {
			const [name] = positionals;
			let registry: Registry = { branches: {} };
			let ownerRoot = runtime.repoRoot();
			try {
				const worktrees = await listWorktrees(runtime.repoRoot(), runtime.run);
				ownerRoot = repoOwnerRootFor(worktrees, runtime.repoRoot());
			} catch {
				ownerRoot = runtime.repoRoot();
			}
			try {
				registry = await loadRegistryFromRuntime(runtime, ownerRoot);
			} catch {
				return {
					ok: false,
					code: "registry_unreadable",
					message: "wt.config.json exists but is not valid JSON.",
					action: "Repair the registry JSON, then retry.",
					exitCode: 1,
					recoverability: "repair_state",
				};
			}
			if (!name) {
				return {
					ok: true,
					data: {
							contract_id: WT_CONTRACT_ID,
							schema_version: WT_SCHEMA_VERSION,
							action: "list_workspaces",
							workspace: workspacePathFor(ownerRoot),
						},
					};
				}
			const workspacePath = workspaceTargetFor(ownerRoot, name);
			const launched = await runtime.launchCode(workspacePath, registry.defaults?.codeBin);
			if (!launched) {
				return usageFailure(
					"code_not_found",
					"Could not launch VS Code; `code` was not found on PATH.",
					"Install the `code` shell command, or set defaults.codeBin in wt.config.json.",
				);
			}
			return {
				ok: true,
				data: {
					contract_id: WT_CONTRACT_ID,
					schema_version: WT_SCHEMA_VERSION,
					action: "open_workspace",
					launched: true,
					workspace_path: workspacePath,
				},
			};
		}

		case "commands":
			return {
				ok: true,
				data: {
					contract_id: WT_CONTRACT_ID,
					schema_version: WT_SCHEMA_VERSION,
					...projectCommandDiscoveryTree([
						["sync", wtContracts.sync],
						["focus", wtContracts.focus],
						["color", wtContracts.color],
						["open", wtContracts.open],
						["new", wtContracts.new],
						["rm", wtContracts.rm],
						["clean", wtContracts.clean],
						["commands", wtContracts.commands],
					]),
				},
			};

		default:
			return usageFailure(
				"usage_error",
				`Unknown command '${command || "(none)"}'.`,
				"Run with --help to see available commands.",
			);
	}
}

/**
 * CLI entry point: parse argv, run the command, emit the JSON envelope, exit.
 *
 * @param argv - Process argv tail (after the executable name)
 * @param options - Optional runtime and writers for tests
 * @returns The process exit code
 *
 * @example
 * ```typescript
 * const code = await main(["sync", "--json"], { runtime })
 * ```
 */
export async function main(
	argv: readonly string[],
	options: { runtime?: WtRuntime; stdout?: CliWriter; stderr?: CliWriter } = {},
): Promise<number> {
	const runtime = options.runtime ?? createDefaultRuntime();
	const stdout = options.stdout ?? process.stdout;

	if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
		const command = argv.find((a) => a in wtContracts) as keyof typeof wtContracts | undefined;
		stdout.write(renderCommandUsage(wtContracts[command ?? "sync"]));
		return 0;
	}
	if (argv.includes("--version")) {
		stdout.write(`wt ${VERSION}\n`);
		return 0;
	}

	const parsedDiagnostics = parseCliDiagnosticArgv(argv);
	const runId = parsedDiagnostics.options.runId;
	const startedAtMs = parsedDiagnostics.options.startedAtMs;
	const invocation = parseInvocation(parsedDiagnostics.argv);
	const runtimeForInvocation = invocation.repoRoot
		? createRepoRuntime(runtime, invocation.repoRoot)
		: runtime;
	const result = await runCommand(invocation, runtimeForInvocation);
	const durationMs = runtime.now() - startedAtMs;

	if (result.ok) {
		writeJsonEnvelope(
			stdout,
			createCliRuntimeSuccessEnvelope({ run_id: runId, data: result.data }),
			{ runId, durationMs },
		);
		return 0;
	}

	writeJsonEnvelope(
		stdout,
		createCliRuntimeErrorEnvelope({
			run_id: runId,
			process_exit_code: result.exitCode,
			error: {
				run_id: runId,
				code: result.code,
				message: result.message,
				exit_code: result.exitCode,
				severity: "error",
				recoverability: result.recoverability,
				retryable: false,
				hint: { action: result.recoverability, summary: result.action },
			},
			data: {
				contract_id: WT_CONTRACT_ID,
				schema_version: WT_SCHEMA_VERSION,
				changed_state: "none",
				next_safe_action: result.action,
			},
		}),
		{ runId, durationMs },
	);
	return result.exitCode;
}

function createRepoRuntime(runtime: WtRuntime, repoRoot: string): WtRuntime {
	return {
		...runtime,
		repoRoot: () => repoRoot,
	};
}

async function loadRegistryFromRuntime(runtime: WtRuntime, repoRoot = runtime.repoRoot()): Promise<Registry> {
	return parseRegistryText(await runtime.readTextFile(`${repoRoot}/wt.config.json`));
}

function workspaceTargetFor(currentRepoRoot: string, name: string): string {
	if (name.endsWith(".code-workspace")) {
		return name;
	}
	if (isAbsolute(name)) {
		return workspacePathFor(name);
	}
	return workspacePathFor(join(dirname(currentRepoRoot), name));
}

function expandHome(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

if (import.meta.main) {
	main(process.argv.slice(2)).then((code) => {
		process.exit(code);
	});
}
