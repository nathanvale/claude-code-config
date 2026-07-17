import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

export function isInsideOrEqual(root: string, path: string): boolean {
	const child = relative(resolve(root), resolve(path));
	return child === "" || (!isAbsolute(child) && !child.startsWith(".."));
}

export async function canonicalPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}

/** First existing parent of the destination whose canonical path escapes the anchor, if any. */
export async function unsafeExistingParent(rootAnchor: string, destination: string): Promise<string | undefined> {
	let current = dirname(destination);
	while (true) {
		if (await pathExists(current)) {
			let resolved: string;
			try {
				resolved = await realpath(current);
			} catch {
				return current;
			}
			if (!isInsideOrEqual(rootAnchor, resolved)) return current;
			if (resolve(resolved) === resolve(rootAnchor)) return undefined;
		}
		const parent = dirname(current);
		if (parent === current) return current;
		current = parent;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}
