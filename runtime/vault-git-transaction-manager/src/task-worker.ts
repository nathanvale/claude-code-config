import { readInheritedCapability } from "./clock.ts";
import type {
	VaultGitEngineResult,
	VaultGitTransactionEngine,
} from "./engine.ts";
import {
	parseVaultGitTaskWorkerAcknowledgement,
	parseVaultGitTaskWorkerAcknowledgementResult,
	type VaultGitTaskWorkerAcknowledgementInput,
	type VaultGitTaskWorkerAcknowledgementResult,
} from "./task-state.ts";

/** Launch-winner input for one acknowledged engine completion. */
export interface VaultGitTaskWorkerInput {
	readonly launch: "winner";
	readonly taskId: string;
	readonly launchGeneration: string;
	readonly capabilityDescriptor: number;
	readonly transactionId: string;
	readonly remote: string;
	readonly summary?: string;
}

/** Capability-free result from one acknowledged worker completion. */
export interface VaultGitTaskWorkerResult {
	readonly status: "engine-result";
	readonly taskId: string;
	readonly result: VaultGitEngineResult;
}

/** Dependencies for the acknowledgement-to-engine composition seam. */
export interface VaultGitTaskWorkerOptions {
	/** Existing transaction engine, the sole canonical mutation owner. */
	readonly engine: Pick<VaultGitTransactionEngine, "complete">;
	/** Return `transitioned` only when this call wins the exact durable CAS. */
	readonly acknowledge: (
		input: VaultGitTaskWorkerAcknowledgementInput,
	) => Promise<VaultGitTaskWorkerAcknowledgementResult>;
	/** Existing inherited-descriptor capability custody adapter. */
	readonly readCapability?: (descriptor: number) => Promise<Uint8Array>;
	/** Start observational progress only after the exact durable acknowledgement. */
	readonly onAcknowledged?: (
		acknowledgement: VaultGitTaskWorkerAcknowledgementInput,
	) => void;
	/** Injected acknowledgement clock. */
	readonly now?: () => Date;
}

/** One bounded background-worker composition. */
export interface VaultGitTaskWorker {
	/** Acknowledge one launch winner, then delegate completion to the engine. */
	run(input: VaultGitTaskWorkerInput): Promise<VaultGitTaskWorkerResult>;
}

/**
 * Create the fenced acknowledgement-to-engine worker composition.
 *
 * @param options - Durable acknowledgement, capability custody, and engine ports
 * @returns Worker that cannot enter capability custody before acknowledgement
 */
export function createVaultGitTaskWorker(
	options: VaultGitTaskWorkerOptions,
): VaultGitTaskWorker {
	const readCapability = options.readCapability ?? readInheritedCapability;
	const now = options.now ?? (() => new Date());
	return Object.freeze({
		async run(
			input: VaultGitTaskWorkerInput,
		): Promise<VaultGitTaskWorkerResult> {
			const expected = parseVaultGitTaskWorkerAcknowledgement({
				schemaVersion: 1,
				taskId: input.taskId,
				launchGeneration: input.launchGeneration,
				acknowledgedAt: now().toISOString(),
			});
			const acknowledgementResult =
				parseVaultGitTaskWorkerAcknowledgementResult(
				await options.acknowledge({
					taskId: expected.taskId,
					launchGeneration: expected.launchGeneration,
					acknowledgedAt: expected.acknowledgedAt,
				}),
			);
			if (acknowledgementResult.status !== "transitioned") {
				throw new Error(
					`task worker acknowledgement not transitioned: ${acknowledgementResult.status}`,
				);
			}
			const acknowledgement = parseVaultGitTaskWorkerAcknowledgement(
				acknowledgementResult.acknowledgement,
			);
			if (
				acknowledgement.taskId !== expected.taskId ||
				acknowledgement.launchGeneration !== expected.launchGeneration
			) {
				throw new Error("task worker acknowledgement mismatch");
			}
			options.onAcknowledged?.(acknowledgement);
			const capability = await readCapability(input.capabilityDescriptor);
			const result = await options.engine.complete({
				transactionId: input.transactionId,
				remote: input.remote,
				capability,
				summary: input.summary,
			});
			return Object.freeze({
				status: "engine-result" as const,
				taskId: input.taskId,
				result,
			});
		},
	});
}
