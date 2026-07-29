import { createHash } from "node:crypto";
import { join } from "node:path";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Small catalog I/O seam shared by the build adapter and platform filesystem.
 *
 * The shape is intentionally compatible with the corresponding
 * {@link BrowserUsePlatformFs} methods without importing the platform owner.
 */
export type BrowserUseCatalogDigestPort = {
	/** Return the entry kind without following symlinks. */
	lstat(
		path: string,
	): Promise<
		| { kind: "file" | "directory" | "symlink" | "other" }
		| undefined
	>;
	/** List one directory's immediate entry names. */
	readDirectory(path: string): Promise<readonly string[]>;
	/** Hash one file's exact bytes as lowercase sha256 hex. */
	hashFile(path: string): Promise<string>;
};

/**
 * One catalog file bound to its root-independent path and exact byte digest.
 */
export type BrowserUseShippedCatalogFile = {
	/** Slash-separated path relative to the catalog root. */
	relativePath: string;
	/** Lowercase sha256 of the exact file bytes. */
	fileSha256: string;
};

/**
 * Collect every regular catalog file without following symlinks.
 *
 * @param root - Absolute or adapter-owned catalog root
 * @param port - Directory, stat, and exact-file-hash operations
 * @returns Files sorted by slash-separated relative path
 * @throws When the root is absent, an entry is not a file/directory, or a file
 * hash is not lowercase sha256
 *
 * @example
 * ```typescript
 * const files = await shippedCatalogFiles(runbooksRoot, platformFs);
 * ```
 */
export async function shippedCatalogFiles(
	root: string,
	port: BrowserUseCatalogDigestPort,
): Promise<readonly BrowserUseShippedCatalogFile[]> {
	const rootStat = await port.lstat(root);
	if (rootStat?.kind !== "directory") {
		throw new Error(`Shipped catalog root is not a directory: ${root}`);
	}

	const files: BrowserUseShippedCatalogFile[] = [];

	async function visit(
		directory: string,
		relativeParts: readonly string[],
	): Promise<void> {
		const children = [...(await port.readDirectory(directory))].sort();
		for (const child of children) {
			if (
				child.length === 0 ||
				child === "." ||
				child === ".." ||
				child.includes("/") ||
				child.includes("\\")
			) {
				throw new Error(`Shipped catalog entry name is unsafe: ${child}`);
			}
			const path = join(directory, child);
			const stat = await port.lstat(path);
			const childRelativeParts = [...relativeParts, child];
			if (stat?.kind === "directory") {
				await visit(path, childRelativeParts);
				continue;
			}
			if (stat?.kind !== "file") {
				throw new Error(
					`Shipped catalog entry is not a regular file: ${childRelativeParts.join("/")}`,
				);
			}
			const fileSha256 = await port.hashFile(path);
			if (!SHA256_HEX.test(fileSha256)) {
				throw new Error(
					`Shipped catalog file hash is not lowercase sha256: ${childRelativeParts.join("/")}`,
				);
			}
			files.push({
				relativePath: childRelativeParts.join("/"),
				fileSha256,
			});
		}
	}

	await visit(root, []);
	files.sort(({ relativePath: left }, { relativePath: right }) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	return files;
}

/**
 * Hash a collected catalog file list with the shipped manifest algorithm.
 *
 * @param files - Root-independent path and exact-file-hash pairs
 * @returns Lowercase sha256 of sorted tuple JSON
 *
 * @example
 * ```typescript
 * const digest = shippedCatalogDigestFromFiles([
 *   { relativePath: "service/flow/runbook.json", fileSha256 },
 * ]);
 * ```
 */
export function shippedCatalogDigestFromFiles(
	files: readonly BrowserUseShippedCatalogFile[],
): string {
	const sorted = [...files].sort(
		({ relativePath: left }, { relativePath: right }) =>
			left < right ? -1 : left > right ? 1 : 0,
	);
	return createHash("sha256")
		.update(
			JSON.stringify(
				sorted.map(({ relativePath, fileSha256 }) => [
					relativePath,
					fileSha256,
				]),
			),
			"utf8",
		)
		.digest("hex");
}

/**
 * Bind every shipped catalog file to one root-independent digest.
 *
 * Recursively collects files without following symlinks, sorts their
 * slash-separated relative paths, hashes each file's exact bytes, then hashes
 * the UTF-8 JSON encoding of `[relativePath, fileSha256]` tuples.
 *
 * @example
 * ```typescript
 * const digest = await shippedCatalogDigest(runbooksRoot, platformFs);
 * ```
 */
export async function shippedCatalogDigest(
	root: string,
	port: BrowserUseCatalogDigestPort,
): Promise<string> {
	return shippedCatalogDigestFromFiles(await shippedCatalogFiles(root, port));
}
