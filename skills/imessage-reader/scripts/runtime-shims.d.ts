declare class Buffer extends Uint8Array {
	static from(
		data: string | ArrayLike<number> | Uint8Array,
		encoding?: string,
	): Buffer;
	static concat(list: readonly (Uint8Array | Buffer)[]): Buffer;
	static isBuffer(value: unknown): value is Buffer;
	subarray(start: number, end?: number): Buffer;
	toString(encoding?: string): string;
	indexOf(search: string | Uint8Array | Buffer): number;
}

declare const process: {
	env: Record<string, string | undefined>;
	argv: string[];
	exit(code?: number): never;
};

declare module "bun:sqlite" {
	export default class Database {
		constructor(path: string, options?: { readonly?: boolean });
		prepare(sql: string): {
			all(...params: unknown[]): unknown[];
			get(...params: unknown[]): unknown;
		};
		close(): void;
	}
}

declare module "bun:test" {
	type Matcher<T> = {
		toBe(expected: unknown): void;
		toEqual(expected: unknown): void;
		toBeTruthy(): void;
		toContain(expected: unknown): void;
		toHaveLength(expected: number): void;
		toBeNull(): void;
		toBeGreaterThan(expected: number): void;
	};

	export function describe(name: string, fn: () => void): void;
	export function test(name: string, fn: () => void): void;
	export function afterEach(fn: () => void): void;
	export function expect<T>(value: T): Matcher<T>;
}

declare module "node:fs" {
	export function readdirSync(path: string): string[];
	export function existsSync(path: string): boolean;
	export function mkdirSync(
		path: string,
		options?: { recursive?: boolean },
	): string | undefined;
	export function writeFileSync(
		path: string,
		data: string,
		encoding?: string,
	): void;
	export function mkdtempSync(prefix: string): string;
	export function readFileSync(path: string, encoding: string): string;
	export function rmSync(
		path: string,
		options?: { recursive?: boolean; force?: boolean },
	): void;
}

declare module "node:path" {
	export function join(...parts: string[]): string;
	export function dirname(path: string): string;
	export function basename(path: string): string;
}

declare module "node:os" {
	export function homedir(): string;
	export function tmpdir(): string;
}

declare module "node:util" {
	export function parseArgs(options: {
		args?: string[];
		strict?: boolean;
		options?: Record<string, { type: "string" | "boolean"; default?: unknown }>;
	}): { values: Record<string, unknown> };
}
