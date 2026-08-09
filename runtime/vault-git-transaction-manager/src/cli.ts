#!/usr/bin/env bun

import { readFile, realpath } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type CliWriter,
	type CommandFacadeResultContract,
	type RuntimeActionGuidance,
	CliUsageError,
	createCliRepairStateRuntimeError,
	createCliRetryRuntimeError,
	createCliRuntimeError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	createCliUsageRuntimeError,
	createCommandResultData,
	parseCliDiagnosticArgv,
	parseCliDiagnosticFallbackArgv,
	renderCommandUsage,
	usageError,
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
} from "./command-contract.ts";
import { createNodeVaultGitRuntime, readInheritedCapability } from "./clock.ts";
import type {
	VaultGitEngineResult,
	VaultGitTransactionEngine,
} from "./engine.ts";
import { createVaultGitTransactionEngine } from "./engine.ts";
import {
	createGitAdapter,
	createGitRepositoryAdapter,
	createNodeProcessPort,
	createVaultOwnedCheckPort,
} from "./git-adapter.ts";
import {
	createVaultGitLifecycleResult,
	type VaultGitLifecycleResultPayload,
	type VaultGitNextActionId,
} from "./model.ts";
import type { VaultGitProcessPort, VaultGitRuntimePort } from "./ports.ts";
import type {
	VaultGitDoctorResult,
} from "./doctor.ts";
import type { VaultGitRepairResult } from "./repair.ts";
import {
	createReceiptStore,
	launchCapabilityProcess,
	launchDoctorTokenProcess,
	type VaultGitCapabilityLaunchResult,
	type VaultGitCapabilityRole,
	type VaultGitReceiptStore,
} from "./store.ts";

const CLI_PATH = fileURLToPath(import.meta.url);
const DEFAULT_REMOTE = "origin";
const DEFAULT_REPOSITORY_IDENTITY = "configured-super-vault";
const DEFAULT_LEASE_DURATION_MS = 15 * 60_000;
const DEFAULT_TIMEOUTS = {
	fetchMs: 15_000,
	pushMs: 30_000,
	localMs: 15_000,
} as const;

/** Complete live CLI composition over the U2-U5 owners. */
export interface VaultGitCliComposition {
	readonly engine: VaultGitTransactionEngine;
	readonly store: VaultGitReceiptStore;
	readonly runtime: VaultGitRuntimePort;
	readonly repositoryPath: string;
	readonly remote: string;
	readonly leaseDurationMs: number;
}

/** Explicit production composition input. */
export interface VaultGitCliCompositionInput {
	readonly repositoryPath: string;
	readonly checkRepositoryPath: string;
	readonly stateRoot: string;
	readonly repositoryIdentity: string;
	readonly actor: string;
	readonly host: string;
	readonly remote?: string;
	readonly leaseDurationMs?: number;
	readonly process?: VaultGitProcessPort;
	readonly runtime?: VaultGitRuntimePort;
}

/** Optional CLI dependencies used by tests and embedded callers. */
export interface VaultGitCliOptions {
	/** Primary output writer. */
	readonly stdout?: CliWriter;
	/** Diagnostic output writer. */
	readonly stderr?: CliWriter;
	/** Clock seam for deterministic envelope durations. */
	readonly now?: () => number;
	/** Precomposed live runtime. */
	readonly composition?: VaultGitCliComposition;
	/** Lazy configured-vault composition seam. */
	readonly resolveComposition?: () => Promise<VaultGitCliComposition | null>;
	/** Capability FD reader seam. */
	readonly readCapability?: (descriptor: number) => Promise<Uint8Array>;
	/** Disable the public-to-internal FD launcher in in-process tests. */
	readonly launchPrivate?: boolean;
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

/**
 * Compose repository, checker, ledger, receipt, clock, and engine owners.
 *
 * @param input - Explicit configured-vault identity and process seams
 * @returns Same-root production composition
 * @throws {Error} When repository and check roots resolve differently
 *
 * @example
 * ```typescript
 * const composition = await createVaultGitCliComposition({
 *   repositoryPath: vaultRoot,
 *   checkRepositoryPath: vaultRoot,
 *   stateRoot,
 *   repositoryIdentity: "configured-vault",
 *   actor: "operator",
 *   host: "laptop",
 * })
 * ```
 */
export async function createVaultGitCliComposition(
	input: VaultGitCliCompositionInput,
): Promise<VaultGitCliComposition> {
	const [repositoryPath, checkRepositoryPath] = await Promise.all([
		realpath(input.repositoryPath),
		realpath(input.checkRepositoryPath),
	]);
	if (repositoryPath !== checkRepositoryPath) {
		throw new Error(
			"vault repository and vault-owned check must resolve to the same root",
		);
	}
	const processPort = input.process ?? createNodeProcessPort();
	const runtime =
		input.runtime ??
		createNodeVaultGitRuntime({ actor: input.actor, host: input.host });
	const timeouts = { ...DEFAULT_TIMEOUTS };
	const repository = createGitRepositoryAdapter({
		repositoryPath,
		repositoryIdentity: input.repositoryIdentity,
		process: processPort,
		timeouts,
	});
	const check = createVaultOwnedCheckPort({
		repositoryPath: checkRepositoryPath,
		process: processPort,
		timeoutMs: DEFAULT_TIMEOUTS.localMs,
	});
	const git = createGitAdapter({ repositoryPath, process: processPort, timeouts });
	const store = createReceiptStore({
		stateRoot: input.stateRoot,
		repositoryIdentity: input.repositoryIdentity,
	});
	const engine = createVaultGitTransactionEngine({
		store,
		repository,
		ledger: { git, clock: runtime },
		runtime,
		repositoryIdentity: input.repositoryIdentity,
		check,
	});
	return {
		engine,
		store,
		runtime,
		repositoryPath,
		remote: input.remote ?? DEFAULT_REMOTE,
		leaseDurationMs: input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
	};
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
export async function main(
	argv: readonly string[],
	options: VaultGitCliOptions = {},
): Promise<number> {
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
		if (
			helpCommand &&
			VAULT_GIT_COMMANDS.includes(helpCommand as VaultGitCommand)
		) {
			stdout.write(
				renderCommandUsage(vaultGitContracts[helpCommand as VaultGitCommand]),
			);
		} else {
			stdout.write(`${renderVaultGitHelp()}\n`);
		}
		return 0;
	}

	let invocation: ParsedVaultGitInvocation;
	try {
		invocation = parseVaultGitInvocation(args);
		validateInvocation(invocation);
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

	if (invocation.command === "commands") {
		return emitDiscovery({
			invocation,
			stdout,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}

	let composition: VaultGitCliComposition | null;
	try {
		composition =
			options.composition ??
			(await (options.resolveComposition ?? resolveDefaultComposition)());
	} catch {
		composition = null;
	}
	if (!composition) {
		return emitUnconfigured({
			invocation,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}

	try {
		if (
			options.launchPrivate !== false &&
			invocation.capabilityFd === undefined &&
			needsPrivateLaunch(invocation)
		) {
			const launched = await launchPrivateInvocation(
				composition,
				invocation,
				args,
				diagnostics.options.runId,
			);
			if (launched) {
				stdout.write(launched.stdout);
				stderr.write(launched.stderr);
				return launched.timedOut ? 1 : (launched.exitCode ?? 1);
			}
		}

		const result = await executeInvocation(
			invocation,
			composition,
			options.readCapability ?? readInheritedCapability,
		);
		return emitRuntimeResult({
			invocation,
			result,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	} catch {
		return emitUnexpectedFailure({
			invocation,
			stdout,
			stderr,
			runId: diagnostics.options.runId,
			startedAt: diagnostics.options.startedAtMs,
			now,
		});
	}
}

/** Run the CLI with captured writers and deterministic run correlation. */
export async function runVaultGitForTest(
	argv: readonly string[],
	options: {
		readonly runId?: string;
		readonly composition?: VaultGitCliComposition;
		readonly readCapability?: (descriptor: number) => Promise<Uint8Array>;
		readonly launchPrivate?: boolean;
	} = {},
): Promise<VaultGitCliRun> {
	const stdout = new BufferWriter();
	const stderr = new BufferWriter();
	const runId = options.runId ?? "vault-git-test";
	const exitCode = await main(["--run-id", runId, ...argv], {
		stdout,
		stderr,
		now: () => 0,
		resolveComposition: async () => null,
		...(options.composition ? { composition: options.composition } : {}),
		...(options.readCapability
			? { readCapability: options.readCapability }
			: {}),
		...(options.launchPrivate === undefined
			? {}
			: { launchPrivate: options.launchPrivate }),
	});
	return { exitCode, stdout: stdout.toString(), stderr: stderr.toString() };
}

async function resolveDefaultComposition(): Promise<VaultGitCliComposition | null> {
	const repositoryPath =
		process.env.VAULT_GIT_REPOSITORY_PATH ??
		(await resolveConfiguredVaultRoot(process.env.VAULT_GIT_CONFIG_PATH));
	if (!repositoryPath) return null;
	const stateRoot =
		process.env.VAULT_GIT_STATE_ROOT ??
		process.env.XDG_STATE_HOME ??
		join(homedir(), ".local", "state");
	return createVaultGitCliComposition({
		repositoryPath,
		checkRepositoryPath:
			process.env.VAULT_GIT_CHECK_REPOSITORY_PATH ?? repositoryPath,
		stateRoot,
		repositoryIdentity:
			process.env.VAULT_GIT_REPOSITORY_IDENTITY ??
			DEFAULT_REPOSITORY_IDENTITY,
		actor: process.env.VAULT_GIT_ACTOR ?? process.env.USER ?? "operator",
		host: process.env.VAULT_GIT_HOST ?? hostname(),
		remote: process.env.VAULT_GIT_REMOTE ?? DEFAULT_REMOTE,
	});
}

async function resolveConfiguredVaultRoot(
	explicitConfigPath?: string,
): Promise<string | null> {
	const configPath =
		explicitConfigPath ??
		join(
			process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
			"context",
			"vault.md",
		);
	const source = await readFile(configPath, "utf8").catch(() => null);
	if (!source) return null;
	for (const line of source.split(/\r?\n/)) {
		const match = line.match(
			/^\s*(?:[-*]\s*)?(?:configured\s+)?vault\s+root\s*:\s*[`"']?(.+?)[`"']?\s*$/i,
		);
		const candidate = match?.[1]?.trim();
		if (candidate && isAbsolute(candidate)) return candidate;
	}
	return null;
}

function validateInvocation(invocation: ParsedVaultGitInvocation): void {
	if (invocation.transactionId && !/^txn_[0-9a-f]{32}$/.test(invocation.transactionId)) {
		throw usageError("--transaction-id must be an opaque vault transaction id");
	}
	if (invocation.command === "begin") {
		if (!invocation.event) throw usageError("begin requires --event");
		if (invocation.paths.length === 0) throw usageError("begin requires --path");
	}
	if (invocation.command === "join") {
		if (!invocation.transactionId) throw usageError("join requires --transaction-id");
		if (invocation.paths.length === 0) throw usageError("join requires --path");
	}
	if (invocation.command === "complete") {
		if (!invocation.transactionId) throw usageError("complete requires --transaction-id");
		if (!invocation.summary) throw usageError("complete requires --summary");
	}
	if (invocation.command === "repair") {
		if (!invocation.transactionId) {
			throw usageError("repair requires --transaction-id");
		}
		if (
			invocation.repairAction === "stale-lease-takeover" &&
			!invocation.priorWriterStopped
		) {
			throw usageError(
				"repair stale-lease-takeover requires --prior-writer-stopped",
			);
		}
	}
}

function needsPrivateLaunch(invocation: ParsedVaultGitInvocation): boolean {
	return ["join", "complete", "repair"].includes(invocation.command);
}

async function launchPrivateInvocation(
	composition: VaultGitCliComposition,
	invocation: ParsedVaultGitInvocation,
	args: readonly string[],
	runId: string,
): Promise<VaultGitCapabilityLaunchResult | null> {
	const loaded = await composition.store.load();
	if (loaded.status !== "loaded") return null;
	const childArgs = [CLI_PATH, "--run-id", runId, ...args];
	if (invocation.repairAction === "stale-lease-takeover") {
		const doctor = await composition.engine.doctor({
			transactionId: invocation.transactionId,
			issueTakeoverToken: true,
		});
		if (
			doctor.repairAction !== "stale-lease-takeover" ||
			!doctor.transactionId ||
			!doctor.ledgerGeneration ||
			!doctor.takeoverTokenIssued
		) {
			return null;
		}
		return launchDoctorTokenProcess(composition.store, {
			transactionId: doctor.transactionId,
			ledgerGeneration: doctor.ledgerGeneration,
			command: process.execPath,
			args: childArgs,
			cwd: composition.repositoryPath,
			timeoutMs: DEFAULT_TIMEOUTS.pushMs,
		});
	}
	const role: VaultGitCapabilityRole =
		invocation.command === "join" ? "join" : "owner";
	return launchCapabilityProcess(composition.store, {
		receiptId: loaded.receipt.receiptId,
		role,
		command: process.execPath,
		args: childArgs,
		cwd: composition.repositoryPath,
		timeoutMs: DEFAULT_TIMEOUTS.pushMs,
	});
}

type RuntimeResult =
	| { readonly kind: "engine"; readonly value: VaultGitEngineResult }
	| { readonly kind: "doctor"; readonly value: VaultGitDoctorResult }
	| { readonly kind: "repair"; readonly value: VaultGitRepairResult }
	| { readonly kind: "unavailable"; readonly blocker: "runtime_unavailable" };

async function executeInvocation(
	invocation: ParsedVaultGitInvocation,
	composition: VaultGitCliComposition,
	readCapability: (descriptor: number) => Promise<Uint8Array>,
): Promise<RuntimeResult> {
	switch (invocation.command) {
		case "begin":
			return {
				kind: "engine",
				value: await composition.engine.begin({
					event: requirePresent(invocation.event, "begin event"),
					requestedPaths: invocation.paths,
					remote: composition.remote,
					leaseDurationMs: composition.leaseDurationMs,
				}),
			};
		case "join":
			return {
				kind: "engine",
				value: await composition.engine.join({
					transactionId: requirePresent(
						invocation.transactionId,
						"join transaction",
					),
					requestedPaths: invocation.paths,
					remote: composition.remote,
					capability: await readInvocationCapability(
						invocation.capabilityFd,
						readCapability,
					),
				}),
			};
		case "complete":
			return {
				kind: "engine",
				value: await composition.engine.complete({
					transactionId: requirePresent(
						invocation.transactionId,
						"complete transaction",
					),
					remote: composition.remote,
					capability: await readInvocationCapability(
						invocation.capabilityFd,
						readCapability,
					),
					summary: invocation.summary,
				}),
			};
		case "status":
		case "preview":
			return { kind: "engine", value: await composition.engine.inspect() };
		case "doctor":
			return {
				kind: "doctor",
				value: await composition.engine.doctor({
					transactionId: invocation.transactionId,
					issueTakeoverToken: false,
				}),
			};
		case "repair": {
			const action = requirePresent(invocation.repairAction, "repair action");
			const privateBytes = await readInvocationCapability(
				invocation.capabilityFd,
				readCapability,
			);
			let expectedLedgerGeneration: string | undefined;
			if (action === "stale-lease-takeover") {
				const doctor = await composition.engine.doctor({
						transactionId: invocation.transactionId,
						issueTakeoverToken: false,
					});
				if (
					doctor.repairAction === "stale-lease-takeover" &&
					doctor.ledgerGeneration
				) {
					const proof = await composition.store.readDoctorProof(
						requirePresent(invocation.transactionId, "repair transaction"),
						doctor.ledgerGeneration,
					);
					expectedLedgerGeneration = proof.ledgerGeneration;
				}
			}
			return {
				kind: "repair",
				value: await composition.engine.repair({
					action,
					transactionId: invocation.transactionId,
					remote: composition.remote,
					...(action === "stale-lease-takeover"
						? {
							doctorToken: privateBytes,
							expectedLedgerGeneration,
							priorWriterStopped: invocation.priorWriterStopped,
						}
						: { capability: privateBytes }),
				}),
			};
		}
		case "tidy":
		case "janitor":
			return { kind: "unavailable", blocker: "runtime_unavailable" };
		case "commands":
			throw new Error("commands is handled before runtime composition");
	}
}

function requirePresent<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`${label} is unavailable`);
	return value;
}

async function readInvocationCapability(
	descriptor: number | undefined,
	readCapability: (descriptor: number) => Promise<Uint8Array>,
): Promise<Uint8Array> {
	return descriptor === undefined
		? new Uint8Array()
		: readCapability(descriptor);
}

function emitDiscovery(input: EmitContext & {
	readonly invocation: ParsedVaultGitInvocation;
}): number {
	const payload = createVaultGitLifecycleResult({
		command: "commands",
		outcome: "discovered",
		phase: "unavailable",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_safe",
		blockers: [],
		next_action: action("inspect_commands"),
	});
	const data = createCommandResultData(vaultGitContracts.commands, {
		...payload,
		commands: projectVaultGitCommandDiscoveryTree().commands,
	});
	writeJsonEnvelope(
		input.stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: input.runId,
			data,
			runtime_actions: [runtimeAction(payload.next_action)],
			continuation: { next_action_id: payload.next_action.id },
		}),
		envelopeRuntime(input),
	);
	return 0;
}

function emitUnconfigured(input: EmitContext & {
	readonly invocation: ParsedVaultGitInvocation;
	readonly stderr: CliWriter;
}): number {
	const readOnly = ["status", "preview", "doctor"].includes(
		input.invocation.command,
	);
	const payload = createVaultGitLifecycleResult({
		command: input.invocation.command,
		outcome: readOnly ? "read_only" : "refused",
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_unsafe",
		blockers: ["vault_unconfigured"],
		next_action: action("inspect_configured_vault"),
	});
	return emitPayload({
		...input,
		payload,
		success: readOnly,
		errorCode: "vault_unconfigured",
	});
}

function emitRuntimeResult(input: EmitContext & {
	readonly invocation: ParsedVaultGitInvocation;
	readonly result: RuntimeResult;
	readonly stderr: CliWriter;
}): number {
	const payload = payloadForRuntime(input.invocation.command, input.result);
	const success =
		input.result.kind === "engine"
			? input.result.value.status !== "refused"
			: input.result.kind === "doctor"
				? true
				: input.result.kind === "repair"
					? input.result.value.status === "repaired"
					: false;
	const errorCode = payload.blockers[0] ?? "runtime_unavailable";
	return emitPayload({ ...input, payload, success, errorCode });
}

function payloadForRuntime(
	command: VaultGitCommand,
	result: RuntimeResult,
): VaultGitLifecycleResultPayload {
	if (result.kind === "unavailable") {
		return createVaultGitLifecycleResult({
			command,
			outcome: "refused",
			phase: "blocked",
			write_permission: "denied",
			changed_state: "none",
			retry_safety: "same_input_unsafe",
			blockers: [result.blocker],
			next_action: action("wait_for_runtime"),
		});
	}
	if (result.kind === "engine") {
		const value = result.value;
		const outcome =
			value.status === "inspected"
				? "read_only"
				: value.status === "advanced"
					? "advanced"
					: value.status;
		return createVaultGitLifecycleResult({
			command,
			outcome,
			phase: value.phase,
			write_permission: value.writePermission,
			changed_state: value.changedState,
			retry_safety: value.retrySafety,
			blockers: value.blocker ? [value.blocker] : [],
			transaction_id: value.transactionId,
			transaction_state: value.state,
			next_action: action(value.nextAction.id, value.nextAction.summary),
		});
	}
	if (result.kind === "doctor") {
		const value = result.value;
		return createVaultGitLifecycleResult({
			command,
			outcome: "read_only",
			phase: value.phase,
			write_permission: "denied",
			changed_state: value.changedState,
			retry_safety: value.retrySafety,
			blockers: value.blocker ? [value.blocker] : [],
			transaction_id: value.transactionId,
			transaction_state: value.state,
			repair_action: value.repairAction,
			finding: value.finding,
			next_action: action(value.nextAction.id, value.nextAction.summary),
		});
	}
	const value = result.value;
	return createVaultGitLifecycleResult({
		command,
		outcome: value.status,
		phase: value.phase,
		write_permission: value.status === "repaired" ? "owner" : "denied",
		changed_state: value.changedState,
		retry_safety: value.retrySafety,
		blockers: value.blocker ? [value.blocker] : [],
		transaction_state: value.state,
		repair_action: value.action,
		next_action: action(value.nextAction.id, value.nextAction.summary),
	});
}

interface EmitContext {
	readonly stdout: CliWriter;
	readonly runId: string;
	readonly startedAt: number;
	readonly now: () => number;
}

function emitPayload(input: EmitContext & {
	readonly invocation: ParsedVaultGitInvocation;
	readonly stderr: CliWriter;
	readonly payload: VaultGitLifecycleResultPayload;
	readonly success: boolean;
	readonly errorCode: string;
}): number {
	const data = createCommandResultData(
		vaultGitContracts[input.invocation.command] as {
			readonly resultContract: CommandFacadeResultContract;
		},
		input.payload,
	);
	const runtime = runtimeAction(input.payload.next_action);
	if (input.invocation.json) {
		const envelope = input.success
			? createCliRuntimeSuccessEnvelope({
					run_id: input.runId,
					data,
					runtime_actions: [runtime],
					continuation: { next_action_id: input.payload.next_action.id },
				})
			: createCliRuntimeErrorEnvelope({
					run_id: input.runId,
					process_exit_code: 1,
					error: runtimeError(
						input.runId,
						input.errorCode,
						input.payload.retry_safety,
					),
					data,
					runtime_actions: [runtime],
					continuation: { next_action_id: input.payload.next_action.id },
				});
		writeJsonEnvelope(input.stdout, envelope, envelopeRuntime(input));
	} else if (input.success) {
		input.stdout.write(renderLifecycleResult(input.payload));
	} else {
		input.stderr.write(renderLifecycleResult(input.payload));
	}
	return input.success ? 0 : 1;
}

function runtimeError(
	runId: string,
	code: string,
	retrySafety: VaultGitLifecycleResultPayload["retry_safety"],
) {
	const common = {
		run_id: runId,
		code,
		message: `The transaction runtime refused this command with ${code}.`,
		exit_code: 1,
	} as const;
	if (retrySafety === "same_input_safe") {
		return createCliRetryRuntimeError(common);
	}
	if (retrySafety === "operator_required") {
		return createCliRuntimeError({
			...common,
			recoverability: "contact_support",
			retryable: false,
		});
	}
	return createCliRepairStateRuntimeError(common);
}

function action(id: VaultGitNextActionId, summary?: string) {
	const declared = vaultGitActions.find((candidate) => candidate.id === id);
	return {
		id,
		summary:
			summary ?? declared?.summary ?? `Continue with the ${id.replaceAll("_", " ")} action.`,
	};
}

function runtimeAction(input: {
	readonly id: VaultGitNextActionId;
	readonly summary: string;
}): RuntimeActionGuidance {
	const declared = vaultGitActions.find(({ id }) => id === input.id);
	return {
		id: input.id,
		summary: input.summary,
		side_effects: declared?.sideEffects ?? ["read", "check"],
	};
}

function envelopeRuntime(input: EmitContext) {
	return {
		runId: input.runId,
		durationMs: Math.max(0, input.now() - input.startedAt),
	};
}

function renderLifecycleResult(result: VaultGitLifecycleResultPayload): string {
	return [
		`command: ${result.command}`,
		`outcome: ${result.outcome}`,
		`phase: ${result.phase}`,
		`write_permission: ${result.write_permission}`,
		`changed_state: ${result.changed_state}`,
		`retry_safety: ${result.retry_safety}`,
		...(result.transaction_id ? [`transaction_id: ${result.transaction_id}`] : []),
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
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "same_input_safe",
		blockers: [],
		next_action: {
			id: "change_input",
			summary: repairUsageSummary(input.argv),
		},
	});
	const data = createCommandResultData(vaultGitContracts.status, payload);
	if (input.argv.includes("--json")) {
		const next = runtimeAction(payload.next_action);
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
				runtime_actions: [next],
				continuation: { next_action_id: "change_input" },
			}),
			envelopeRuntime(input),
		);
	} else {
		input.stderr.write(`${message}\nnext: change_input\n`);
	}
	return 2;
}

function repairUsageSummary(argv: readonly string[]): string {
	return argv[0] === "repair"
		? "Choose one engine-owned repair action from the command help."
		: "Correct the command arguments and retry parsing.";
}

function emitUnexpectedFailure(input: EmitContext & {
	readonly invocation: ParsedVaultGitInvocation;
	readonly stderr: CliWriter;
}): number {
	input.stderr.write(
		"vault-git: unexpected runtime failure; inspect the run correlation\n",
	);
	const payload = createVaultGitLifecycleResult({
		command: input.invocation.command,
		outcome: "refused",
		phase: "blocked",
		write_permission: "denied",
		changed_state: "none",
		retry_safety: "operator_required",
		blockers: ["human_required"],
		next_action: action("inspect_status"),
	});
	return emitPayload({
		...input,
		payload,
		success: false,
		errorCode: "unexpected_runtime_failure",
	});
}

/** Redact rejected tokens from structured usage errors. */
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
	process.exit(await main(Bun.argv.slice(2)));
}
