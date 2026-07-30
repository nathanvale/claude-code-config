import { createHash } from "node:crypto";
import type {
	BrowserUseAdmittedPaths,
	BrowserUsePlatformFs,
} from "./browser-use-paths";
import {
	readBrowserUseAnchoredPrivateStateFile,
	writeBrowserUseAnchoredPrivateStateFile,
} from "./browser-use-auth-binding-store";

const CONTRACT = "browser-use.admin-authority-receipt";
const SCHEMA_VERSION = "1";
const AUTHORITY = "read-item-only";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MAX_RECEIPT_BYTES = 4 * 1024;
const RECEIPT_KEYS = [
	"contract",
	"schema_version",
	"authority",
	"lane_digest",
	"principal_digest",
	"vault_digest",
	"recorded_at_epoch_ms",
] as const;

export type BrowserUseAdminAuthorityCoordinates = {
	lane_digest: string;
	principal_digest: string;
	vault_digest: string;
};

type BrowserUseAdminAuthorityReceipt = {
	contract: typeof CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	authority: typeof AUTHORITY;
	lane_digest: string;
	principal_digest: string;
	vault_digest: string;
	recorded_at_epoch_ms: number;
};

export type BrowserUseAdminAuthorityReceiptStore = {
	inspect(
		coordinates: BrowserUseAdminAuthorityCoordinates,
	): Promise<
		| { state: "missing" | "invalid" | "unavailable" }
		| { state: "proven"; receipt_digest: string }
	>;
	record(
		coordinates: BrowserUseAdminAuthorityCoordinates,
	): Promise<
		| { ok: true; receipt_digest: string }
		| { ok: false; state: "invalid" | "unavailable" }
	>;
};

function exactKeys(value: Record<string, unknown>): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...RECEIPT_KEYS].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function validCoordinates(
	value: BrowserUseAdminAuthorityCoordinates,
): boolean {
	return (
		SHA256_HEX.test(value.lane_digest) &&
		SHA256_HEX.test(value.principal_digest) &&
		SHA256_HEX.test(value.vault_digest)
	);
}

function parseReceipt(raw: string): BrowserUseAdminAuthorityReceipt | undefined {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!exactKeys(value as Record<string, unknown>)
	) {
		return undefined;
	}
	const receipt = value as Record<string, unknown>;
	if (
		receipt.contract !== CONTRACT ||
		receipt.schema_version !== SCHEMA_VERSION ||
		receipt.authority !== AUTHORITY ||
		typeof receipt.lane_digest !== "string" ||
		typeof receipt.principal_digest !== "string" ||
		typeof receipt.vault_digest !== "string" ||
		!validCoordinates({
			lane_digest: receipt.lane_digest,
			principal_digest: receipt.principal_digest,
			vault_digest: receipt.vault_digest,
		}) ||
		typeof receipt.recorded_at_epoch_ms !== "number" ||
		!Number.isSafeInteger(receipt.recorded_at_epoch_ms) ||
		receipt.recorded_at_epoch_ms < 0
	) {
		return undefined;
	}
	return receipt as BrowserUseAdminAuthorityReceipt;
}

function digestOf(raw: string): string {
	return createHash("sha256").update(raw, "utf8").digest("hex");
}

function matches(
	receipt: BrowserUseAdminAuthorityReceipt,
	coordinates: BrowserUseAdminAuthorityCoordinates,
): boolean {
	return (
		receipt.lane_digest === coordinates.lane_digest &&
		receipt.principal_digest === coordinates.principal_digest &&
		receipt.vault_digest === coordinates.vault_digest
	);
}

async function readAdmittedReceipt(
	stateRoot: string,
	afterDirectoryOpenedForTest?: () => Promise<void>,
): Promise<
	| { state: "missing" | "invalid" | "unavailable" }
	| {
			state: "present";
			raw: string;
			receipt: BrowserUseAdminAuthorityReceipt;
	  }
> {
	const read = await readBrowserUseAnchoredPrivateStateFile({
		stateRoot,
		name: "admin-authority-receipt.json",
		exactMode: 0o600,
		afterDirectoryOpenedForTest,
	});
	if (read.status === "missing") return { state: "missing" };
	if (read.status === "refused") return { state: "invalid" };
	if (
		Buffer.byteLength(read.raw, "utf8") < 1 ||
		Buffer.byteLength(read.raw, "utf8") > MAX_RECEIPT_BYTES
	) {
		return { state: "invalid" };
	}
	const receipt = parseReceipt(read.raw);
	return receipt === undefined
		? { state: "invalid" }
		: { state: "present", raw: read.raw, receipt };
}

/**
 * Build the owner-only, secret-free human authority receipt store.
 *
 * The receipt attests only that an authorized human confirmed the standing
 * principal has read-item-only authority over the one visible vault. A lane,
 * principal, or vault change invalidates it.
 */
export function createBrowserUseAdminAuthorityReceiptStore(input: {
	fs: BrowserUsePlatformFs;
	paths: BrowserUseAdmittedPaths;
	clock: () => number;
	/** @internal Deterministic ancestor-swap probe after the state fd opens. */
	afterDirectoryOpenedForTest?: () => Promise<void>;
}): BrowserUseAdminAuthorityReceiptStore {
	const stateRoot = input.paths.resolution.roots.state;
	return {
		async inspect(coordinates) {
			if (!validCoordinates(coordinates)) return { state: "invalid" };
			const standing = await readAdmittedReceipt(
				stateRoot,
				input.afterDirectoryOpenedForTest,
			);
			if (standing.state !== "present") return standing;
			return matches(standing.receipt, coordinates)
				? {
						state: "proven",
						receipt_digest: digestOf(standing.raw),
					}
				: { state: "invalid" };
		},
		async record(coordinates) {
			const recordedAt = input.clock();
			if (
				!validCoordinates(coordinates) ||
				!Number.isSafeInteger(recordedAt) ||
				recordedAt < 0
			) {
				return { ok: false, state: "invalid" };
			}
			const standing = await readAdmittedReceipt(
				stateRoot,
				input.afterDirectoryOpenedForTest,
			);
			if (standing.state === "unavailable") {
				return { ok: false, state: standing.state };
			}
			const receipt: BrowserUseAdminAuthorityReceipt = {
				contract: CONTRACT,
				schema_version: SCHEMA_VERSION,
				authority: AUTHORITY,
				lane_digest: coordinates.lane_digest,
				principal_digest: coordinates.principal_digest,
				vault_digest: coordinates.vault_digest,
				recorded_at_epoch_ms: recordedAt,
			};
			const raw = `${JSON.stringify(receipt)}\n`;
			const written = await writeBrowserUseAnchoredPrivateStateFile({
				stateRoot,
				name: "admin-authority-receipt.json",
				contents: raw,
				exactMode: 0o600,
				replaceRefused: true,
				afterDirectoryOpenedForTest:
					input.afterDirectoryOpenedForTest,
			});
			return written.status === "written"
				? { ok: true, receipt_digest: digestOf(raw) }
				: { ok: false, state: "unavailable" };
		},
	};
}
