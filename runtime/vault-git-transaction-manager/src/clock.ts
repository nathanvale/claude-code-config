import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { VaultGitRuntimePort } from "./ports.ts";

/** Production runtime identity options. */
export interface NodeVaultGitRuntimeOptions {
	/** Explicit non-secret actor label. */
	readonly actor: string;
	/** Explicit non-secret host label. */
	readonly host: string;
}

/**
 * Create the production clock, identity, randomness, and interruption adapter.
 *
 * @param options - Explicit actor and host labels
 * @returns Runtime port with ambient wall clock and cryptographic ids
 */
export function createNodeVaultGitRuntime(
	options: NodeVaultGitRuntimeOptions,
): VaultGitRuntimePort {
	assertOneLine(options.actor, "actor");
	assertOneLine(options.host, "host");
	return {
		now: () => new Date(),
		actor: () => options.actor,
		host: () => options.host,
		newReceiptId: () => `receipt_${randomUUID().replaceAll("-", "")}`,
		interrupt: () => undefined,
	};
}

/**
 * Read capability bytes from one inherited descriptor.
 *
 * @param descriptor - Numeric inherited file descriptor
 * @returns Exact capability bytes
 */
export async function readInheritedCapability(
	descriptor: number,
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(descriptor) || descriptor < 3) {
		throw new Error("capability descriptor must be an inherited descriptor");
	}
	const bytes = await readFile(`/dev/fd/${descriptor}`);
	if (bytes.byteLength === 0) throw new Error("capability descriptor was empty");
	return new Uint8Array(bytes);
}

function assertOneLine(value: string, field: string): void {
	if (value.trim().length === 0 || /[\r\n\0]/.test(value)) {
		throw new Error(`${field} must be one non-empty line`);
	}
}
