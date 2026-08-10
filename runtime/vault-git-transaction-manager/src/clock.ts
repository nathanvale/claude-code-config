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
 * @throws {Error} When the actor or host label is empty or spans lines
 *
 * @example
 * ```typescript
 * const runtime = createNodeVaultGitRuntime({ actor: "agent-a", host: "laptop" })
 * const receiptId = runtime.newReceiptId()
 * ```
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
 * @param timeoutMs - Hard read deadline; a descriptor that never delivers
 * bytes fails with a clear error instead of hanging the caller forever
 * @returns Exact capability bytes
 * @throws {Error} When the descriptor is below 3 or the timeout is not positive
 * @throws {Error} When the read times out or the descriptor delivers zero bytes
 *
 * @example
 * ```typescript
 * const index = process.argv.indexOf("--capability-fd")
 * const capability = await readInheritedCapability(Number(process.argv[index + 1]))
 * ```
 */
export async function readInheritedCapability(
	descriptor: number,
	timeoutMs = 5_000,
): Promise<Uint8Array> {
	if (!Number.isSafeInteger(descriptor) || descriptor < 3) {
		throw new Error("capability descriptor must be an inherited descriptor");
	}
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error("capability read timeout must be positive");
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new Error("capability descriptor read timed out"));
		}, timeoutMs);
	});
	try {
		const bytes = await Promise.race([
			readFile(`/dev/fd/${descriptor}`),
			deadline,
		]);
		if (bytes.byteLength === 0) throw new Error("capability descriptor was empty");
		return new Uint8Array(bytes);
	} finally {
		clearTimeout(timer);
	}
}

function assertOneLine(value: string, field: string): void {
	if (value.trim().length === 0 || /[\r\n\0]/.test(value)) {
		throw new Error(`${field} must be one non-empty line`);
	}
}
