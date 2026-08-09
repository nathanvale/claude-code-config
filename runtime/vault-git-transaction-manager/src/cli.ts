#!/usr/bin/env bun

import {
	type CliWriter,
	type RuntimeActionGuidance,
	CliUsageError,
	createCliRepairStateRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	VAULT_GIT_COMMANDS,
	parseVaultGitInvocation,
	projectVaultGitCommandDiscoveryTree,
	type ParsedVaultGitInvocation,
	type VaultGitCommand,
	vaultGitActions,
	vaultGitContracts,
	vaultGitMutatingCommands,
} from "./command-contract.ts";
import {
	createVaultGitLifecycleResult,
	type VaultGitLifecycleResultPayload,
	type VaultGitNextActionId,
} from "./model.ts";

const runtimeActions = vaultGitActions.map((action) => ({
	id: action.id,
	summary: action.summary,
	side_effects: action.sideEffects,
})) satisfies readonly RuntimeActionGuidance[];

/** Optional CLI dependencies used by tests and embedded callers. */
export interface VaultGitCliOptions {
	/** Primary output writer. */
	readonly stdout?: CliWriter;
	/** Diagnostic output writer. */
	readonly stderr?: CliWriter;
	/** Clock seam for deterministic envelope durations. */
	readonly now?: () => number;
}

/** Captured in-process CLI result. */
export interface VaultGitCliRun {
	/** Process exit code. */
	readonly exitCode: number;
	/** Captured stdout. */
	readonly stdout: string;
	/** Captured stderr. */
	readonly stderr: string;
}

/** Render bounded root help from the live facade contracts. */
export function renderVaultGitHelp(): string {
	return [
		"vault-git - transact and repair the configured Super-vault safely",
		"",
		"Usage:",
		"  vault-git",
		...VAULT_GIT_COMMANDS.map(
			(command) => `  ${vaultGitContracts[command].usage[0] ?? command}`,
		),
		"",
		"No arguments show a read-only dashboard with one next safe action.",
	].join("\n");
}

/** Run the vault-git CLI and return its process exit code. */
export function main(
	argv: readonly string[],
	options: VaultGitCliOptions = {},
): number {
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const now = options.now ?? Date.now;
	let diagnostics: ReturnType<typeof parseCliDiagnosticArgv>;
	try {
		diagnostics = parseCliDiagnosticArgv(argv);
	} catch (error) {
		const fallback = parseCliDiagnosticFallbackArgv(argv);
		return emitUsageFailure({
			error,
			argv,
			stdout,
			stderr,
			runId: fallback.options.runId,
			startedAt: fallback.options.startedAtMs,
			now,
		});
	}

	const args = diagnostics.argv;
	if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
		const helpCommand = args[0] === "help" ? args[1] : args[0];
		if (helpCommand && VAULT_GIT_COMMANDS.includes(helpCommand as VaultGitCommand)) {
			stdout.write(renderCommandUsage(vaultGitContracts[helpCommand as VaultGitCommand]));
		} else {
			stdout.write(`${renderVaultGitHelp()}\n`);
		}
		return 0;
	}

	let invocation: ParsedVaultGitInvocation;
	try {
		invocation = parseVaultGitInvocation(args);
	} catch (error) {
		return emitUsageFailure({
			error,
			argv: args,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}

	const mutating = vaultGitMutatingCommands.has(invocation.command);
	const nextAction = mutating
		? "inspect_status"
		: invocation.command === "commands"
			? "inspect_commands"
			: "wait_for_runtime";
	const outcome = mutating
		? "unavailable"
		: invocation.command === "commands"
			? "discovered"
			: "read_only";
	const payload = createResultPayload(invocation.command, outcome, nextAction);
	const data = invocation.command === "commands"
		? createCommandResultData(vaultGitContracts.commands, {
				...payload,
				commands: projectVaultGitCommandDiscoveryTree().commands,
			})
		: createCommandResultData(vaultGitContracts[invocation.command], payload);
	const action = runtimeActions.find(({ id }) => id === nextAction);
	if (!action) throw new Error(`Missing runtime action: ${nextAction}`);
	const envelopeOptions = {
		run_id: diagnostics.options.runId,
		data,
		runtime_actions: [action],
		continuation: { next_action_id: nextAction },
	} as const;

	if (mutating) {
		const envelope = createCliRuntimeErrorEnvelope({
			...envelopeOptions,
			process_exit_code: 1,
			error: createCliRepairStateRuntimeError({
				run_id: diagnostics.options.runId,
				code: "runtime_unavailable",
				message: "The mutating transaction runtime is not available in this scaffold.",
				exit_code: 1,
			}),
		});
		if (invocation.json) {
			writeJsonEnvelope(stdout, envelope, {
				runId: diagnostics.options.runId,
				durationMs: Math.max(0, now() - diagnostics.options.startedAtMs),
			});
		} else {
			stderr.write(renderLifecycleResult(payload));
		}
		return 1;
	}

	const envelope = createCliRuntimeSuccessEnvelope(envelopeOptions);
	if (invocation.json) {
		writeJsonEnvelope(stdout, envelope, {
			runId: diagnostics.options.runId,
			durationMs: Math.max(0, now() - diagnostics.options.startedAtMs),
		});
	} else {
		stdout.write(renderLifecycleResult(payload));
	}
	return 0;
}

/** Run the CLI with captured writers and deterministic run correlation. */
export function runVaultGitForTest(
	argv: readonly string[],
	options: { readonly runId?: string } = {},
): VaultGitCliRun {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const runId = options.runId ?? "vault-git-test";
	const exitCode = main(["--run-id", runId, ...argv], {
		stdout,
		stderr,
		now: () => 0,
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

function createResultPayload(
	command: VaultGitCommand,
	outcome: "read_only" | "discovered" | "unavailable",
	nextAction: VaultGitNextActionId,
): VaultGitLifecycleResultPayload {
	const action = vaultGitActions.find(({ id }) => id === nextAction);
	if (!action) throw new Error(`Missing action summary: ${nextAction}`);
	return createVaultGitLifecycleResult({
		command,
		outcome,
		phase: "unavailable",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_safe",
		blockers: ["runtime_unavailable"],
		next_action: { id: nextAction, summary: action.summary },
	});
}

function renderLifecycleResult(result: VaultGitLifecycleResultPayload): string {
	return [
		`command: ${result.command}`,
		`outcome: ${result.outcome}`,
		`phase: ${result.phase}`,
		`write_permission: ${result.write_permission}`,
		`changed_state: ${result.changed_state}`,
		`retry_safety: ${result.retry_safety}`,
		`blockers: ${result.blockers.join(", ")}`,
		`next: ${result.next_action.id}`,
		"",
	].join("\n");
}

function emitUsageFailure(input: {
	error: unknown;
	argv: readonly string[];
	stdout: CliWriter;
	stderr: CliWriter;
	runId: string;
	startedAt: number;
	now: () => number;
}): number {
	const message =
		input.error instanceof CliUsageError || input.error instanceof Error
			? input.error.message
			: String(input.error);
	const payload = createVaultGitLifecycleResult({
		command: commandFromArgv(input.argv),
		outcome: "invalid_usage",
		phase: "unavailable",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_safe",
		blockers: ["runtime_unavailable"],
		next_action: {
			id: "change_input",
			summary: "Correct the command arguments and retry parsing.",
		},
	});
	const data = createCommandResultData(vaultGitContracts[payload.command], payload);
	if (input.argv.some((arg) => arg === "--json" || arg.startsWith("--json="))) {
		const action = runtimeActions.find(({ id }) => id === "change_input");
		if (!action) throw new Error("Missing change_input action");
		writeJsonEnvelope(
			input.stdout,
			createCliRuntimeErrorEnvelope({
				run_id: input.runId,
				process_exit_code: 2,
				error: createCliUsageRuntimeError({
					run_id: input.runId,
					code: "invalid_usage",
					message: toStructuredUsageMessage(message),
				}),
				data,
				runtime_actions: [action],
				continuation: { next_action_id: "change_input" },
			}),
			{
				runId: input.runId,
				durationMs: Math.max(0, input.now() - input.startedAt),
			},
		);
	} else {
		input.stderr.write(`${message}\nnext: change_input\n`);
	}
	return 2;
}

/**
 * Redact user-supplied tokens so structured usage errors never leak local paths.
 * Plain stderr keeps the original message for the human who typed the value.
 */
function toStructuredUsageMessage(message: string): string {
	const withoutRejectedValue = message.replace(/\s*\(got: .*\)$/, "");
	if (/[\\/]/.test(withoutRejectedValue)) {
		return "Invalid command usage; run help for the accepted commands and flags.";
	}
	return withoutRejectedValue;
}

function commandFromArgv(argv: readonly string[]): VaultGitCommand {
	const candidate = argv[0];
	if (candidate === undefined || candidate.startsWith("-")) return "status";
	return VAULT_GIT_COMMANDS.includes(candidate as VaultGitCommand)
		? (candidate as VaultGitCommand)
		: "status";
}

class BufferWriter implements CliWriter {
	private readonly chunks: string[] = [];

	write(chunk: string): true {
		this.chunks.push(chunk);
		return true;
	}

	toString(): string {
		return this.chunks.join("");
	}
}

if (import.meta.main) {
	try {
		process.exit(main(Bun.argv.slice(2)));
	} catch {
		console.error("vault-git: unexpected runtime failure; run doctor for diagnostics");
		process.exit(1);
	}
}
