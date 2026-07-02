import type { Stats } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { SkillFeedbackRuntime } from "./runtime-contract";

/**
 * Read path metadata while treating a missing path as an expected optional case.
 *
 * @param path - Filesystem path to inspect.
 * @param runtime - Runtime filesystem adapter.
 * @returns File metadata when present, otherwise `undefined` for `ENOENT`.
 * @throws Non-`ENOENT` runtime errors from `lstatPath`.
 *
 * @example
 * ```typescript
 * const stats = await lstatOptional(reportPath, runtime)
 * if (!stats) return "missing"
 * ```
 */
export async function lstatOptional(
	path: string,
	runtime: SkillFeedbackRuntime,
): Promise<Stats | undefined> {
	try {
		return await runtime.lstatPath(path);
	} catch (error) {
		if (isNodeErrorCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

/**
 * Resolve a path without letting realpath failures escape a safety check.
 *
 * @param path - Filesystem path to resolve.
 * @param runtime - Runtime filesystem adapter.
 * @returns The resolved path, or `undefined` when resolution fails.
 *
 * @example
 * ```typescript
 * const realPath = await safeRealpath(candidate.path, runtime)
 * if (!realPath) return "unsafe"
 * ```
 */
export async function safeRealpath(
	path: string,
	runtime: SkillFeedbackRuntime,
): Promise<string | undefined> {
	try {
		return await runtime.realpathPath(path);
	} catch {
		return undefined;
	}
}

/**
 * Check that filesystem permissions do not include any unsafe mode bits.
 *
 * @param stats - File metadata to inspect.
 * @param unsafeMask - Permission bits that make the path unsafe.
 * @returns `true` when none of the unsafe bits are present.
 *
 * @example
 * ```typescript
 * if (!hasPrivateMode(stats, 0o077)) return "unsafe"
 * ```
 */
export function hasPrivateMode(stats: Stats, unsafeMask: number): boolean {
	return (stats.mode & unsafeMask) === 0;
}

/**
 * Test whether a resolved child path stays under a resolved parent path.
 *
 * @param parent - Resolved parent path.
 * @param child - Resolved child path.
 * @param options - Set `allowSame` when the parent itself is a valid target.
 * @returns `true` when the child is contained by the parent.
 *
 * @example
 * ```typescript
 * isContainedPath(repoRoot, inboxPath)
 * isContainedPath(repoRoot, repoRoot, { allowSame: true })
 * ```
 */
export function isContainedPath(
	parent: string,
	child: string,
	options: { allowSame?: boolean } = {},
): boolean {
	const childRelativePath = relative(parent, child);
	if (childRelativePath === "") return options.allowSame === true;
	return (
		!childRelativePath.startsWith("..") &&
		!isAbsolute(childRelativePath)
	);
}

/**
 * Check a thrown Node-style error code without assuming an Error subclass.
 *
 * @param error - Unknown caught value.
 * @param code - Node error code to match.
 * @returns `true` when the caught value exposes that code.
 *
 * @example
 * ```typescript
 * if (isNodeErrorCode(error, "ENOENT")) return undefined
 * ```
 */
export function isNodeErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

/**
 * Check whether an error represents filesystem permission denial.
 *
 * @param error - Unknown caught value.
 * @returns `true` for `EACCES` or `EPERM`.
 *
 * @example
 * ```typescript
 * if (isPermissionErrorCode(error)) markSkippedUnsafePath(...)
 * ```
 */
export function isPermissionErrorCode(error: unknown): boolean {
	return isNodeErrorCode(error, "EACCES") || isNodeErrorCode(error, "EPERM");
}
