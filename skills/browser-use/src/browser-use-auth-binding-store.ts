import { randomBytes } from "node:crypto";
import {
	closeSync,
	constants as fsConstants,
	fstatSync,
	fsyncSync,
	lstatSync,
	readSync,
	realpathSync,
	writeSync,
} from "node:fs";
import { basename, join } from "node:path";
import type {
	BrowserUseItemBinding,
	BrowserUseResolvedAuthCandidate,
} from "./browser-use-auth-bindings";
import {
	secretShapeFindingOf,
	validateItemBindingShape,
} from "./browser-use-auth-bindings";
import type {
	BrowserUseAdmittedPaths,
} from "./browser-use-paths";

const CONTRACT = "browser-use.auth-binding-cache";
const SCHEMA_VERSION = "1";
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_CACHE_BYTES = 64 * 1024;
const DARWIN_O_CLOEXEC = 0x01000000;
const DESCRIPTOR_IO_SOURCE = join(
	import.meta.dir,
	"browser-use-auth-binding-io.c",
);
const RECORD_KEYS = [
	"contract",
	"schema_version",
	"generation_id",
	"activation_epoch",
	"auth_context_ref",
	"route_digest",
	"candidate_id",
	"candidate_digest",
	"binding",
] as const;

type BrowserUseAuthBindingCacheRecord = {
	contract: typeof CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	generation_id: string;
	activation_epoch: number;
	auth_context_ref: string;
	route_digest: string;
	candidate_id: string;
	candidate_digest: string;
	binding: BrowserUseItemBinding;
};

export type BrowserUseAuthBindingStoreFailure = {
	code:
		| "auth_binding_cache_invalid"
		| "auth_binding_cache_stale"
		| "auth_binding_cache_unavailable";
	message: string;
};

export type BrowserUseAuthBindingStore = {
	load(
		resolution: BrowserUseResolvedAuthCandidate,
	): Promise<
		| { ok: true; binding: BrowserUseItemBinding | null }
		| { ok: false; failure: BrowserUseAuthBindingStoreFailure }
	>;
	save(input: {
		resolution: BrowserUseResolvedAuthCandidate;
		binding: BrowserUseItemBinding;
	}): Promise<
		{ ok: true } | { ok: false; failure: BrowserUseAuthBindingStoreFailure }
	>;
	invalidate(
		resolution: BrowserUseResolvedAuthCandidate,
	): Promise<
		{ ok: true } | { ok: false; failure: BrowserUseAuthBindingStoreFailure }
	>;
};

function failure(
	code: BrowserUseAuthBindingStoreFailure["code"],
	message: string,
): { ok: false; failure: BrowserUseAuthBindingStoreFailure } {
	return { ok: false, failure: { code, message } };
}

function cleanBoundedString(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		secretShapeFindingOf(value) === undefined
	);
}

function isRecord(value: unknown): value is BrowserUseAuthBindingCacheRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);
	if (
		keys.length !== RECORD_KEYS.length ||
		RECORD_KEYS.some((key) => !keys.includes(key)) ||
		record.contract !== CONTRACT ||
		record.schema_version !== SCHEMA_VERSION ||
		!cleanBoundedString(record.generation_id) ||
		typeof record.activation_epoch !== "number" ||
		!Number.isSafeInteger(record.activation_epoch) ||
		record.activation_epoch < 1 ||
		!cleanBoundedString(record.auth_context_ref) ||
		!SHA256_HEX.test(String(record.route_digest)) ||
		!cleanBoundedString(record.candidate_id) ||
		!SHA256_HEX.test(String(record.candidate_digest)) ||
		validateItemBindingShape(record.binding).length > 0
	) {
		return false;
	}
	return true;
}

function recordOf(input: {
	resolution: BrowserUseResolvedAuthCandidate;
	binding: BrowserUseItemBinding;
}): BrowserUseAuthBindingCacheRecord | undefined {
	const { resolution, binding } = input;
	if (
		binding.service_id !== resolution.candidate.service_id ||
		binding.auth_context !== resolution.candidate.auth_context
	) {
		return undefined;
	}
	const record: BrowserUseAuthBindingCacheRecord = {
		contract: CONTRACT,
		schema_version: SCHEMA_VERSION,
		generation_id: resolution.generation_id,
		activation_epoch: resolution.activation_epoch,
		auth_context_ref: resolution.auth_context_ref,
		route_digest: resolution.route_digest,
		candidate_id: resolution.candidate.candidate_id,
		candidate_digest: resolution.candidate_digest,
		binding,
	};
	return isRecord(record) ? record : undefined;
}

function matchesResolution(
	record: BrowserUseAuthBindingCacheRecord,
	resolution: BrowserUseResolvedAuthCandidate,
): boolean {
	return (
		record.generation_id === resolution.generation_id &&
		record.activation_epoch === resolution.activation_epoch &&
		record.auth_context_ref === resolution.auth_context_ref &&
		record.route_digest === resolution.route_digest &&
		record.candidate_id === resolution.candidate.candidate_id &&
		record.candidate_digest === resolution.candidate_digest
	);
}

function bindingPathOf(
	paths: BrowserUseAdmittedPaths,
	candidateId: string,
): string | undefined {
	try {
		return paths.state.authBindingFile(candidateId);
	} catch {
		return undefined;
	}
}

type DescriptorRelativeIo = {
	open(path: string, flags: number, mode: number): number;
	openAt(directory: number, name: string, flags: number, mode: number): number;
	createAtExclusive(directory: number, name: string, mode: number): number;
	mkdirAt(directory: number, name: string, mode: number): number;
	renameAt(
		sourceDirectory: number,
		sourceName: string,
		targetDirectory: number,
		targetName: string,
	): number;
	unlinkAt(directory: number, name: string): number;
	errno(): number;
};

let descriptorRelativeIo: DescriptorRelativeIo | null | undefined;

function loadDescriptorRelativeIo(): DescriptorRelativeIo | null {
	if (descriptorRelativeIo !== undefined) return descriptorRelativeIo;
	if (process.platform !== "darwin") {
		descriptorRelativeIo = null;
		return descriptorRelativeIo;
	}
	try {
		const { cc, dlopen, FFIType, ptr, read } =
			require("bun:ffi") as typeof import("bun:ffi");
		const fixedOpenAt = cc({
			source: DESCRIPTOR_IO_SOURCE,
			symbols: {
				browser_use_openat_exclusive: {
					args: [FFIType.int, FFIType.ptr, FFIType.int, FFIType.int],
					returns: FFIType.int,
				},
			},
		});
		const library = dlopen("/usr/lib/libSystem.B.dylib", {
			open: {
				args: [FFIType.ptr, FFIType.int, FFIType.int],
				returns: FFIType.int,
			},
			openat: {
				args: [FFIType.int, FFIType.ptr, FFIType.int, FFIType.int],
				returns: FFIType.int,
			},
			mkdirat: {
				args: [FFIType.int, FFIType.ptr, FFIType.int],
				returns: FFIType.int,
			},
			renameat: {
				args: [
					FFIType.int,
					FFIType.ptr,
					FFIType.int,
					FFIType.ptr,
				],
				returns: FFIType.int,
			},
			unlinkat: {
				args: [FFIType.int, FFIType.ptr, FFIType.int],
				returns: FFIType.int,
			},
			__error: { args: [], returns: FFIType.ptr },
		});
		const cString = (value: string): Buffer => Buffer.from(`${value}\0`);
		descriptorRelativeIo = {
			open(path, flags, mode) {
				const bytes = cString(path);
				return library.symbols.open(ptr(bytes), flags, mode) as number;
			},
			openAt(directory, name, flags, mode) {
				const bytes = cString(name);
				return library.symbols.openat(
					directory,
					ptr(bytes),
					flags,
					mode,
				) as number;
			},
			createAtExclusive(directory, name, mode) {
				const bytes = cString(name);
				return fixedOpenAt.symbols.browser_use_openat_exclusive(
					directory,
					ptr(bytes),
					fsConstants.O_WRONLY |
						fsConstants.O_CREAT |
						fsConstants.O_EXCL |
						fsConstants.O_NOFOLLOW |
						DARWIN_O_CLOEXEC,
					mode,
				) as number;
			},
			mkdirAt(directory, name, mode) {
				const bytes = cString(name);
				return library.symbols.mkdirat(directory, ptr(bytes), mode) as number;
			},
			renameAt(sourceDirectory, sourceName, targetDirectory, targetName) {
				const source = cString(sourceName);
				const target = cString(targetName);
				return library.symbols.renameat(
					sourceDirectory,
					ptr(source),
					targetDirectory,
					ptr(target),
				) as number;
			},
			unlinkAt(directory, name) {
				const bytes = cString(name);
				return library.symbols.unlinkat(directory, ptr(bytes), 0) as number;
			},
			errno() {
				const pointer = library.symbols.__error();
				return pointer === null ? -1 : read.i32(pointer);
			},
		};
	} catch {
		descriptorRelativeIo = null;
	}
	return descriptorRelativeIo;
}

type AnchoredDirectory =
	| { status: "admitted"; descriptor: number }
	| { status: "missing" }
	| { status: "refused" };

export type BrowserUsePrivateBindingFileMetadata = {
	is_file: boolean;
	uid: number;
	mode: number;
	nlink: number;
	size: number;
};

/** Pure descriptor-metadata admission used by the store and adversarial tests. */
export function isPrivateBindingFileMetadataAdmitted(
	metadata: BrowserUsePrivateBindingFileMetadata,
	expectedUid: number | undefined,
): boolean {
	return (
		metadata.is_file &&
		expectedUid !== undefined &&
		metadata.uid === expectedUid &&
		(metadata.mode & 0o077) === 0 &&
		metadata.nlink === 1 &&
		metadata.size <= MAX_CACHE_BYTES
	);
}

function openAnchoredStateDirectory(
	stateRoot: string,
	expectedUid: number | undefined,
): AnchoredDirectory {
	const io = loadDescriptorRelativeIo();
	if (io === null || expectedUid === undefined) return { status: "refused" };
	let initial: ReturnType<typeof lstatSync>;
	let canonical: string;
	try {
		initial = lstatSync(stateRoot);
		if (
			initial.isSymbolicLink() ||
			!initial.isDirectory() ||
			initial.uid !== expectedUid ||
			(initial.mode & 0o777) !== 0o700
		) {
			return { status: "refused" };
		}
		canonical = realpathSync(stateRoot);
	} catch {
		return { status: "refused" };
	}
	let current = io.open(
		"/",
		fsConstants.O_RDONLY |
			fsConstants.O_DIRECTORY |
			DARWIN_O_CLOEXEC,
		0,
	);
	if (current < 0) return { status: "refused" };
	let retained = false;
	try {
		for (const component of canonical.split("/").filter(Boolean)) {
			const next = io.openAt(
				current,
				component,
				fsConstants.O_RDONLY |
					fsConstants.O_DIRECTORY |
					fsConstants.O_NOFOLLOW |
					DARWIN_O_CLOEXEC,
				0,
			);
			if (next < 0) return { status: "refused" };
			closeSync(current);
			current = next;
		}
		const state = fstatSync(current);
		if (
			!state.isDirectory() ||
			state.dev !== initial.dev ||
			state.ino !== initial.ino ||
			state.uid !== expectedUid ||
			(state.mode & 0o777) !== 0o700
			) {
				return { status: "refused" };
			}
		retained = true;
		return { status: "admitted", descriptor: current };
	} catch {
		return { status: "refused" };
	} finally {
		if (!retained) closeSync(current);
	}
}

function openAnchoredBindingsDirectory(
	stateRoot: string,
	expectedUid: number | undefined,
	create: boolean,
): AnchoredDirectory {
	const io = loadDescriptorRelativeIo();
	const state = openAnchoredStateDirectory(stateRoot, expectedUid);
	if (io === null || state.status !== "admitted") return state;
	try {
		let bindings = io.openAt(
			state.descriptor,
			"auth-bindings",
			fsConstants.O_RDONLY |
				fsConstants.O_DIRECTORY |
				fsConstants.O_NOFOLLOW |
				DARWIN_O_CLOEXEC,
			0,
		);
		if (bindings < 0 && io.errno() === 2 && !create) {
			return { status: "missing" };
		}
		if (bindings < 0 && create) {
			if (io.mkdirAt(state.descriptor, "auth-bindings", 0o700) !== 0) {
				return { status: "refused" };
			}
			bindings = io.openAt(
				state.descriptor,
				"auth-bindings",
				fsConstants.O_RDONLY |
					fsConstants.O_DIRECTORY |
					fsConstants.O_NOFOLLOW |
					DARWIN_O_CLOEXEC,
				0,
			);
		}
		if (bindings < 0) return { status: "refused" };
		const directory = fstatSync(bindings);
		if (
			!directory.isDirectory() ||
			directory.uid !== expectedUid ||
			(directory.mode & 0o777) !== 0o700
		) {
			closeSync(bindings);
			return { status: "refused" };
		}
		return { status: "admitted", descriptor: bindings };
	} catch {
		return { status: "refused" };
	} finally {
		closeSync(state.descriptor);
	}
}

function readPrivateBindingFile(
	directory: number,
	name: string,
	expectedUid: number | undefined,
	exactMode?: number,
	):
	| { status: "present"; raw: string }
	| { status: "missing" }
	| { status: "refused" } {
	const io = loadDescriptorRelativeIo();
	if (io === null) return { status: "refused" };
	const descriptor = io.openAt(
		directory,
		name,
		fsConstants.O_RDONLY |
			fsConstants.O_NONBLOCK |
			fsConstants.O_NOFOLLOW |
			DARWIN_O_CLOEXEC,
		0,
	);
	if (descriptor < 0) {
		return io.errno() === 2 ? { status: "missing" } : { status: "refused" };
	}
	try {
		const stat = fstatSync(descriptor);
		if (!isPrivateBindingFileMetadataAdmitted(
			{
				is_file: stat.isFile(),
				uid: stat.uid,
				mode: stat.mode,
				nlink: stat.nlink,
				size: stat.size,
			},
			expectedUid,
		) || (exactMode !== undefined && (stat.mode & 0o777) !== exactMode)) {
			return { status: "refused" };
		}
		const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_CACHE_BYTES + 1));
		let offset = 0;
		while (offset < bytes.length) {
			const received = readSync(
				descriptor,
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (received === 0) break;
			offset += received;
		}
		if (offset > MAX_CACHE_BYTES) return { status: "refused" };
		return { status: "present", raw: bytes.subarray(0, offset).toString("utf8") };
	} catch {
		return { status: "refused" };
	} finally {
		closeSync(descriptor);
	}
}

function writePrivateBindingFile(
	directory: number,
	name: string,
	expectedOwnerUid: number | undefined,
	contents: string,
	exactMode?: number,
): boolean {
	const io = loadDescriptorRelativeIo();
	if (io === null) return false;
	const existing = readPrivateBindingFile(
		directory,
		name,
		expectedOwnerUid,
		exactMode,
	);
	if (existing.status === "refused") return false;

	const tempName = `${name}.tmp-${randomBytes(16).toString("hex")}`;
	const tempDescriptor = io.createAtExclusive(directory, tempName, 0o600);
	if (tempDescriptor < 0) return false;
	let tempOpen = true;
	let published = false;
	try {
		const tempStat = fstatSync(tempDescriptor);
		if (
			!tempStat.isFile() ||
			expectedOwnerUid === undefined ||
			tempStat.uid !== expectedOwnerUid ||
			(tempStat.mode & 0o777) !== 0o600 ||
			tempStat.nlink !== 1
		) {
			return false;
		}
		const bytes = Buffer.from(contents);
		let offset = 0;
		while (offset < bytes.length) {
			offset += writeSync(
				tempDescriptor,
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
		}
		fsyncSync(tempDescriptor);
		closeSync(tempDescriptor);
		tempOpen = false;
		if (io.renameAt(directory, tempName, directory, name) !== 0) return false;
		published = true;
		fsyncSync(directory);
		return true;
	} catch {
		return false;
	} finally {
		if (tempOpen) closeSync(tempDescriptor);
		if (!published) io.unlinkAt(directory, tempName);
	}
}

export type BrowserUseAnchoredPrivateStateFileRead =
	| { status: "present"; raw: string }
	| { status: "missing" }
	| { status: "refused" };

function safePrivateStateLeaf(name: string): boolean {
	return (
		name !== "" &&
		name === basename(name) &&
		name !== "." &&
		name !== ".." &&
		!name.includes("\0")
	);
}

/**
 * Read one private state leaf through a descriptor anchored to the admitted
 * state-directory inode. Ancestor and leaf swaps cannot redirect the read.
 */
export async function readBrowserUseAnchoredPrivateStateFile(input: {
	stateRoot: string;
	name: string;
	expectedOwnerUid?: number;
	exactMode?: number;
	afterDirectoryOpenedForTest?: () => Promise<void>;
}): Promise<BrowserUseAnchoredPrivateStateFileRead> {
	if (!safePrivateStateLeaf(input.name)) return { status: "refused" };
	const expectedOwnerUid = input.expectedOwnerUid ?? process.getuid?.();
	const directory = openAnchoredStateDirectory(
		input.stateRoot,
		expectedOwnerUid,
	);
	if (directory.status !== "admitted") return directory;
	try {
		await input.afterDirectoryOpenedForTest?.();
		return readPrivateBindingFile(
			directory.descriptor,
			input.name,
			expectedOwnerUid,
			input.exactMode,
		);
	} catch {
		return { status: "refused" };
	} finally {
		closeSync(directory.descriptor);
	}
}

/**
 * Durably replace one private state leaf through its anchored directory.
 *
 * `replaceRefused` is reserved for a separately challenged repair command. It
 * unlinks only the exact anchored leaf; directories and ancestor redirects
 * remain refused.
 */
export async function writeBrowserUseAnchoredPrivateStateFile(input: {
	stateRoot: string;
	name: string;
	contents: string;
	expectedOwnerUid?: number;
	exactMode?: number;
	replaceRefused?: boolean;
	afterDirectoryOpenedForTest?: () => Promise<void>;
}): Promise<{ status: "written" | "refused" }> {
	if (
		!safePrivateStateLeaf(input.name) ||
		Buffer.byteLength(input.contents, "utf8") > MAX_CACHE_BYTES
	) {
		return { status: "refused" };
	}
	const expectedOwnerUid = input.expectedOwnerUid ?? process.getuid?.();
	const directory = openAnchoredStateDirectory(
		input.stateRoot,
		expectedOwnerUid,
	);
	if (directory.status !== "admitted") return { status: "refused" };
	try {
		await input.afterDirectoryOpenedForTest?.();
		if (input.replaceRefused) {
			const standing = readPrivateBindingFile(
				directory.descriptor,
				input.name,
				expectedOwnerUid,
				input.exactMode,
			);
			if (standing.status === "refused") {
				const io = loadDescriptorRelativeIo();
				if (
					io === null ||
					io.unlinkAt(directory.descriptor, input.name) !== 0
				) {
					return { status: "refused" };
				}
				fsyncSync(directory.descriptor);
			}
		}
		return writePrivateBindingFile(
			directory.descriptor,
			input.name,
			expectedOwnerUid,
			input.contents,
			input.exactMode,
		)
			? { status: "written" }
			: { status: "refused" };
	} catch {
		return { status: "refused" };
	} finally {
		closeSync(directory.descriptor);
	}
}

/**
 * Persist host-lifetime, secret-free binding cache. The cache is never live
 * authority: each command re-proves its captured generation, active principal,
 * one-vault scope, exact item identity, and item revision before use.
 */
export function createBrowserUseAuthBindingStore(deps: {
	paths: BrowserUseAdmittedPaths;
	expectedOwnerUid?: number;
	/** @internal Deterministic race probe after the binding-directory fd opens. */
	afterDirectoryOpenedForTest?: () => Promise<void>;
}): BrowserUseAuthBindingStore {
	const expectedOwnerUid = deps.expectedOwnerUid ?? process.getuid?.();
	const stateRoot = deps.paths.resolution.roots.state;
	return {
		async load(resolution) {
			const path = bindingPathOf(
				deps.paths,
				resolution.candidate.candidate_id,
			);
			if (path === undefined) {
				return failure(
					"auth_binding_cache_invalid",
					"the auth binding cache coordinate is invalid.",
				);
			}
			const directory = openAnchoredBindingsDirectory(
				stateRoot,
				expectedOwnerUid,
				false,
			);
			if (directory.status === "missing") {
				return { ok: true, binding: null };
			}
			if (directory.status === "refused") {
				return failure(
					"auth_binding_cache_unavailable",
					"the host binding cache path failed private-directory admission.",
				);
			}
			const read = readPrivateBindingFile(
				directory.descriptor,
				basename(path),
				expectedOwnerUid,
			);
			closeSync(directory.descriptor);
			if (read.status === "missing") {
				return { ok: true, binding: null };
			}
			if (read.status === "refused") {
				return failure(
					"auth_binding_cache_unavailable",
					"the host binding cache file failed private-file admission.",
				);
			}
			let value: unknown;
			try {
				value = JSON.parse(read.raw);
			} catch {
				return failure(
					"auth_binding_cache_invalid",
					"the host binding cache is not valid JSON.",
				);
			}
			if (!isRecord(value)) {
				return failure(
					"auth_binding_cache_invalid",
					"the host binding cache failed shape admission.",
				);
			}
			if (!matchesResolution(value, resolution)) {
				return failure(
					"auth_binding_cache_stale",
					"the host binding cache does not match the captured auth generation.",
				);
			}
			return { ok: true, binding: value.binding };
		},

		async save(input) {
			const record = recordOf(input);
			if (record === undefined) {
				return failure(
					"auth_binding_cache_invalid",
					"the binding does not match its captured auth candidate.",
				);
			}
			const path = bindingPathOf(
				deps.paths,
				input.resolution.candidate.candidate_id,
			);
			if (path === undefined) {
				return failure(
					"auth_binding_cache_invalid",
					"the auth binding cache coordinate is invalid.",
				);
			}
			const directory = openAnchoredBindingsDirectory(
				stateRoot,
				expectedOwnerUid,
				true,
			);
			if (directory.status !== "admitted") {
				return failure(
					"auth_binding_cache_unavailable",
					"the host binding cache path failed private-directory admission.",
				);
			}
			try {
				await deps.afterDirectoryOpenedForTest?.();
			} catch {
				closeSync(directory.descriptor);
				return failure(
					"auth_binding_cache_unavailable",
					"the host binding cache race probe failed.",
				);
			}
			const written = writePrivateBindingFile(
				directory.descriptor,
				basename(path),
				expectedOwnerUid,
				`${JSON.stringify(record)}\n`,
			);
			closeSync(directory.descriptor);
			return written
				? { ok: true }
				: failure(
						"auth_binding_cache_unavailable",
						"the host binding cache could not be committed durably.",
					);
		},

		async invalidate(resolution) {
			const path = bindingPathOf(
				deps.paths,
				resolution.candidate.candidate_id,
			);
			if (path === undefined) {
				return failure(
					"auth_binding_cache_invalid",
					"the auth binding cache coordinate is invalid.",
				);
			}
			const directory = openAnchoredBindingsDirectory(
				stateRoot,
				expectedOwnerUid,
				false,
			);
			if (directory.status === "missing") return { ok: true };
			if (directory.status === "refused") {
				return failure(
					"auth_binding_cache_unavailable",
					"the host binding cache path failed private-directory admission.",
				);
			}
			try {
				const read = readPrivateBindingFile(
					directory.descriptor,
					basename(path),
					expectedOwnerUid,
				);
				if (read.status === "missing") return { ok: true };
				if (read.status === "refused") {
					return failure(
						"auth_binding_cache_unavailable",
						"the host binding cache file failed private-file admission.",
					);
				}
				const io = loadDescriptorRelativeIo();
				if (
					io === null ||
					io.unlinkAt(directory.descriptor, basename(path)) !== 0
				) {
					return failure(
						"auth_binding_cache_unavailable",
						"the stale host binding cache could not be invalidated.",
					);
				}
				fsyncSync(directory.descriptor);
				return { ok: true };
			} catch {
				return failure(
					"auth_binding_cache_unavailable",
					"the stale host binding cache could not be invalidated.",
				);
			} finally {
				closeSync(directory.descriptor);
			}
		},
	};
}
