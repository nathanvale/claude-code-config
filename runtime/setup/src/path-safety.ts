import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

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
