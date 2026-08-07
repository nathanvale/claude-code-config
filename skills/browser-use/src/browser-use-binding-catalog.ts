import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BrowserUseBindingApprovalReceiptVerifier } from "./browser-use-auth-approval";
import {
	type BrowserUseBindingApprovalReceipt,
	type BrowserUseBindingResolutionKey,
	BROWSER_USE_BINDING_RESOLUTION_KEY_KEYS,
	isBrowserUseAuthContext,
	secretShapeFindingOf,
	validateBindingApprovalReceiptShape,
} from "./browser-use-auth-bindings";
import type { BrowserUsePlatformFs } from "./browser-use-paths";

type CatalogEntry = {
	key_digest: string;
	resolution_key: BrowserUseBindingResolutionKey;
	receipt_id: string;
};

type CatalogIndex = {
	contract: "browser-use.binding-catalog";
	schema_version: "1";
	generation: number;
	active: readonly CatalogEntry[];
};

export type BrowserUseBindingCatalogFailure = {
	ok: false;
	code:
		| "binding_catalog_unsafe"
		| "binding_catalog_corrupt"
		| "binding_catalog_busy"
		| "binding_receipt_invalid"
		| "binding_revision_conflict"
		| "binding_catalog_write_failed";
	message: string;
};

const INDEX_KEYS = ["contract", "schema_version", "generation", "active"] as const;
const ENTRY_KEYS = ["key_digest", "resolution_key", "receipt_id"] as const;
const SAFE_RECEIPT_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;

function fail(
	code: BrowserUseBindingCatalogFailure["code"],
	message: string,
): BrowserUseBindingCatalogFailure {
	return { ok: false, code, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function resolutionKeyIsValid(value: unknown): value is BrowserUseBindingResolutionKey {
	if (!isObject(value) || !exactKeys(value, BROWSER_USE_BINDING_RESOLUTION_KEY_KEYS)) return false;
	for (const key of ["binding_ref", "service_id", "environment", "profile"] as const) {
		const field = value[key];
		if (typeof field !== "string" || field.length === 0 || secretShapeFindingOf(field) !== undefined) return false;
	}
	return isBrowserUseAuthContext(value.auth_context);
}

function resolutionDigestOf(key: BrowserUseBindingResolutionKey): string {
	return createHash("sha256")
		.update(JSON.stringify(BROWSER_USE_BINDING_RESOLUTION_KEY_KEYS.map((field) => key[field])))
		.digest("hex");
}

function indexOf(value: unknown): CatalogIndex | undefined {
	if (!isObject(value) || !exactKeys(value, INDEX_KEYS)) return undefined;
	if (
		value.contract !== "browser-use.binding-catalog" ||
		value.schema_version !== "1" ||
		typeof value.generation !== "number" ||
		!Number.isSafeInteger(value.generation) ||
		value.generation < 0 ||
		!Array.isArray(value.active)
	) return undefined;
	const entries: CatalogEntry[] = [];
	const digests = new Set<string>();
	for (const candidate of value.active) {
		if (
			!isObject(candidate) ||
			!exactKeys(candidate, ENTRY_KEYS) ||
			typeof candidate.key_digest !== "string" ||
			!/^[0-9a-f]{64}$/.test(candidate.key_digest) ||
			!resolutionKeyIsValid(candidate.resolution_key) ||
			candidate.key_digest !== resolutionDigestOf(candidate.resolution_key) ||
			typeof candidate.receipt_id !== "string" ||
			!SAFE_RECEIPT_ID.test(candidate.receipt_id) ||
			digests.has(candidate.key_digest)
		) return undefined;
		digests.add(candidate.key_digest);
		entries.push(candidate as CatalogEntry);
	}
	return {
		contract: "browser-use.binding-catalog",
		schema_version: "1",
		generation: value.generation,
		active: entries,
	};
}

function emptyIndex(): CatalogIndex {
	return {
		contract: "browser-use.binding-catalog",
		schema_version: "1",
		generation: 0,
		active: [],
	};
}

function errorCode(error: unknown): string | undefined {
	return isObject(error) && typeof error.code === "string" ? error.code : undefined;
}

export function createBindingCatalog(deps: {
	fs: BrowserUsePlatformFs;
	root: string;
	verifier: BrowserUseBindingApprovalReceiptVerifier;
}) {
	const receiptsDir = join(deps.root, "receipts");
	const indexFile = join(deps.root, "active.json");
	const lockFile = join(deps.root, "catalog.lock");

	async function admitDirectory(path: string): Promise<boolean> {
		await deps.fs.mkdir(path, { recursive: true, mode: 0o700 });
		const stat = await deps.fs.lstat(path);
		return stat?.kind === "directory" && stat.mode === 0o700;
	}

	async function ensureLayout(): Promise<BrowserUseBindingCatalogFailure | undefined> {
		try {
			if (!(await admitDirectory(deps.root)) || !(await admitDirectory(receiptsDir))) {
				return fail("binding_catalog_unsafe", "the private binding catalog directory failed owner-only admission.");
			}
			return undefined;
		} catch {
			return fail("binding_catalog_unsafe", "the private binding catalog layout could not be admitted.");
		}
	}

	async function loadIndex(): Promise<{ ok: true; index: CatalogIndex } | BrowserUseBindingCatalogFailure> {
		const layout = await ensureLayout();
		if (layout !== undefined) return layout;
		try {
			const stat = await deps.fs.lstat(indexFile);
			if (stat === undefined) return { ok: true, index: emptyIndex() };
			if (stat.kind !== "file" || stat.mode !== 0o600) {
				return fail("binding_catalog_unsafe", "the binding catalog index failed private-file admission.");
			}
			const parsed = indexOf(JSON.parse(await deps.fs.readTextFile(indexFile)));
			return parsed === undefined
				? fail("binding_catalog_corrupt", "the binding catalog index failed exact-shape admission.")
				: { ok: true, index: parsed };
		} catch {
			return fail("binding_catalog_corrupt", "the binding catalog index could not be read.");
		}
	}

	async function loadReceipt(receiptId: string): Promise<
		| { ok: true; receipt: BrowserUseBindingApprovalReceipt }
		| BrowserUseBindingCatalogFailure
	> {
		if (!SAFE_RECEIPT_ID.test(receiptId)) return fail("binding_receipt_invalid", "the active receipt id is invalid.");
		const path = join(receiptsDir, `${receiptId}.json`);
		try {
			const stat = await deps.fs.lstat(path);
			if (stat?.kind !== "file" || stat.mode !== 0o600) {
				return fail("binding_catalog_unsafe", "the active binding receipt failed private-file admission.");
			}
			const parsed: unknown = JSON.parse(await deps.fs.readTextFile(path));
			if (validateBindingApprovalReceiptShape(parsed).length > 0) {
				return fail("binding_receipt_invalid", "the active binding receipt failed exact-shape admission.");
			}
			const verified = deps.verifier.verify(parsed);
			return verified.ok
				? { ok: true, receipt: parsed as BrowserUseBindingApprovalReceipt }
				: fail("binding_receipt_invalid", `the active binding receipt failed offline verification (${verified.code}).`);
		} catch {
			return fail("binding_receipt_invalid", "the active binding receipt could not be read.");
		}
	}

	async function publishReceipt(receipt: BrowserUseBindingApprovalReceipt): Promise<BrowserUseBindingCatalogFailure | undefined> {
		const contents = `${JSON.stringify(receipt)}\n`;
		const destination = join(receiptsDir, `${receipt.receipt_id}.json`);
		const staging = join(receiptsDir, `.${receipt.receipt_id}.staged`);
		try {
			await deps.fs.unlink(staging).catch(() => {});
			await deps.fs.writeFileDurable(staging, contents, 0o600);
			try {
				await deps.fs.linkFileNoReplace(staging, destination);
			} catch (error) {
				if (errorCode(error) !== "EEXIST") throw error;
				if ((await deps.fs.readTextFile(destination)) !== contents) {
					return fail("binding_revision_conflict", "the immutable receipt id already names different bytes.");
				}
			}
			await deps.fs.syncDirectory(receiptsDir);
			return undefined;
		} catch {
			return fail("binding_catalog_write_failed", "the immutable binding receipt could not be published.");
		} finally {
			await deps.fs.unlink(staging).catch(() => {});
		}
	}

	async function writeIndex(index: CatalogIndex, receiptId: string): Promise<BrowserUseBindingCatalogFailure | undefined> {
		const staging = join(deps.root, `.active-${receiptId}.staged`);
		try {
			await deps.fs.unlink(staging).catch(() => {});
			await deps.fs.writeFileDurable(staging, `${JSON.stringify(index)}\n`, 0o600);
			await deps.fs.rename(staging, indexFile);
			await deps.fs.syncDirectory(deps.root);
			return undefined;
		} catch {
			return fail("binding_catalog_write_failed", "the fenced active binding selection could not be published.");
		} finally {
			await deps.fs.unlink(staging).catch(() => {});
		}
	}

	return {
		async commit(receipt: BrowserUseBindingApprovalReceipt): Promise<{ ok: true } | BrowserUseBindingCatalogFailure> {
			if (validateBindingApprovalReceiptShape(receipt).length > 0 || !deps.verifier.verify(receipt).ok || !SAFE_RECEIPT_ID.test(receipt.receipt_id)) {
				return fail("binding_receipt_invalid", "the proposed binding receipt failed admission or offline verification.");
			}
			const layout = await ensureLayout();
			if (layout !== undefined) return layout;
			try {
				await deps.fs.createExclusive(lockFile, `${receipt.receipt_id}\n`, 0o600);
			} catch (error) {
				return errorCode(error) === "EEXIST"
					? fail("binding_catalog_busy", "another binding catalog writer owns the mutation fence.")
					: fail("binding_catalog_write_failed", "the binding catalog mutation fence could not be acquired.");
			}
			try {
				const loaded = await loadIndex();
				if (!loaded.ok) return loaded;
				const digest = resolutionDigestOf(receipt.resolution_key);
				const currentEntry = loaded.index.active.find((entry) => entry.key_digest === digest);
				if (currentEntry === undefined) {
					if (receipt.binding.binding_revision !== 1 || receipt.predecessor_receipt_id !== null || receipt.disposition !== "approved") {
						return fail("binding_revision_conflict", "a first binding revision must be approved revision 1 with no predecessor.");
					}
				} else {
					const current = await loadReceipt(currentEntry.receipt_id);
					if (!current.ok) return current;
					if (
						receipt.predecessor_receipt_id !== current.receipt.receipt_id ||
						receipt.binding.binding_revision !== current.receipt.binding.binding_revision + 1
					) return fail("binding_revision_conflict", "the receipt does not advance the exact active predecessor revision.");
				}
				const publishFailure = await publishReceipt(receipt);
				if (publishFailure !== undefined) return publishFailure;
				const next: CatalogIndex = {
					...loaded.index,
					generation: loaded.index.generation + 1,
					active: [
						...loaded.index.active.filter((entry) => entry.key_digest !== digest),
						{ key_digest: digest, resolution_key: receipt.resolution_key, receipt_id: receipt.receipt_id },
					].sort((left, right) => left.key_digest.localeCompare(right.key_digest)),
				};
				const writeFailure = await writeIndex(next, receipt.receipt_id);
				return writeFailure ?? { ok: true };
			} finally {
				await deps.fs.unlink(lockFile).catch(() => {});
				await deps.fs.syncDirectory(deps.root).catch(() => {});
			}
		},

		async resolve(key: BrowserUseBindingResolutionKey) {
			const loaded = await loadIndex();
			if (!loaded.ok) return loaded;
			const entry = loaded.index.active.find((candidate) => candidate.key_digest === resolutionDigestOf(key));
			if (entry === undefined) return { ok: true as const, status: "missing" as const };
			const loadedReceipt = await loadReceipt(entry.receipt_id);
			if (!loadedReceipt.ok) return loadedReceipt;
			return loadedReceipt.receipt.disposition === "revoked"
				? { ok: true as const, status: "revoked" as const, revision: loadedReceipt.receipt.binding.binding_revision }
				: { ok: true as const, status: "active" as const, receipt_id: loadedReceipt.receipt.receipt_id, binding: loadedReceipt.receipt.binding };
		},

		async list() {
			const loaded = await loadIndex();
			if (!loaded.ok) return loaded;
			const bindings = [];
			for (const entry of loaded.index.active) {
				const loadedReceipt = await loadReceipt(entry.receipt_id);
				if (!loadedReceipt.ok) return loadedReceipt;
				bindings.push({
					...entry.resolution_key,
					revision: loadedReceipt.receipt.binding.binding_revision,
					status: loadedReceipt.receipt.disposition === "approved" ? "active" as const : "revoked" as const,
				});
			}
			return { ok: true as const, bindings };
		},
	};
}
