import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export type FilePreImage =
	| { kind: "absent" }
	| { kind: "file"; sha256: string; size: number; mode: number };

export function fingerprintValue(value: unknown): string {
	return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export async function captureFilePreImage(path: string): Promise<FilePreImage> {
	try {
		const metadata = await stat(path);
		if (!metadata.isFile()) throw new Error("Pre-image target must be a file.");
		const content = await readFile(path);
		return {
			kind: "file",
			sha256: createHash("sha256").update(content).digest("hex"),
			size: metadata.size,
			mode: metadata.mode & 0o777,
		};
	} catch (error) {
		if (isMissingFileError(error)) return { kind: "absent" };
		throw error;
	}
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([key, entry]) => [key, normalize(entry)]),
		);
	}
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return value;
	}
	throw new Error("Fingerprint input must be finite JSON data.");
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}
