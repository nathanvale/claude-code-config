import { createHash } from "node:crypto";
import { join } from "node:path";
import type { BrowserAdapterId } from "./discovery-model";
import { candidateIdOf } from "./browser-use-core";
import {
	acquireLease,
	heartbeatLease,
	releaseLease,
	type LeaseDeps,
} from "./browser-use-locks";
import type { RunStoreDeps } from "./browser-use-runs";
import type { BrowserUseLeasePayload } from "./browser-use-schemas";
import {
	type StoreFailure,
	readDurableFile,
	withExclusiveFileLock,
	writeDurableFile,
} from "./browser-use-store";

const CONTRACT = "browser-use.browser-custody";
const SCHEMA_VERSION = "1";
const PRIVATE_DIRECTORY_MODE = 0o700;
const LOCK_STALE_AFTER_MS = 10_000;
const MAX_REGISTRY_BYTES = 1024 * 1024;

/** Target-scoped operation classes governed by one atomic Target Lease. */
export type TargetOperation = "read" | "action" | "close" | "adopt";

/** Browser-wide mutations that must serialize through the single Browser Lane. */
export type BrowserWideMutation =
	| "capture"
	| "device-scale"
	| "domain-policy"
	| "viewport";

/** Exact first-ownership evidence admitted before a target can be leased. */
export type TargetOwnershipEvidence =
	| {
			kind: "adapter-creation-receipt";
			adapter_id: BrowserAdapterId;
			run_id: string;
			raw_target_id: string;
	  }
	| {
			kind: "explicit-adoption";
			adapter_id: BrowserAdapterId;
			run_id: string;
			raw_target_id: string;
			target_envelope_id: string;
			target_candidate_id: string;
			target_candidate_identity:
				| { kind: "adapter-page-id"; raw_adapter_page_id: string }
				| { kind: "cdp-target-id" };
	  };

/** Atomic target-operation lease bound to one Browser authority and run. */
export type TargetOperationLease = {
	contract: typeof CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	authority_id: string;
	target_ref: string;
	run_id: string;
	adapter_id: BrowserAdapterId;
	operation: TargetOperation;
	lease: BrowserUseLeasePayload;
};

/** Exclusive Browser-wide mutation lease bound to one Browser authority. */
export type BrowserLaneLease = {
	contract: typeof CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	authority_id: string;
	run_id: string;
	mutation: BrowserWideMutation;
	lease: BrowserUseLeasePayload;
};

/** Stable typed refusal codes returned by the custody owner. */
export type BrowserCustodyRefusalCode =
	| "browser_authority_changed"
	| "browser_lane_held"
	| "browser_lane_lost"
	| "browser_lane_store_failed"
	| "target_lease_held"
	| "target_lease_lost"
	| "target_lease_store_failed"
	| "target_owned_by_other_run"
	| "target_ownership_evidence_invalid"
	| "target_unowned";

/** Target Lease acquisition outcome. */
export type TargetOperationLeaseResult =
	| { ok: true; lease: TargetOperationLease; first_ownership: boolean }
	| { ok: false; code: BrowserCustodyRefusalCode; message: string };

/** Browser Lane acquisition outcome. */
export type BrowserLaneLeaseResult =
	| { ok: true; lease: BrowserLaneLease }
	| { ok: false; code: BrowserCustodyRefusalCode; message: string };

/** Target Lease renewal outcome. */
export type TargetOperationLeaseHeartbeatResult =
	| { ok: true; lease: TargetOperationLease }
	| { ok: false; code: BrowserCustodyRefusalCode; message: string };

/** Browser Lane renewal outcome. */
export type BrowserLaneLeaseHeartbeatResult =
	| { ok: true; lease: BrowserLaneLease }
	| { ok: false; code: BrowserCustodyRefusalCode; message: string };

type TargetBinding = {
	owner_run_id: string | null;
	status: "owned" | "released";
	adapters: BrowserAdapterId[];
	expires_at_epoch_ms: number;
	revision: number;
};

type CustodyRegistry = {
	contract: typeof CONTRACT;
	schema_version: typeof SCHEMA_VERSION;
	authority_id: string;
	revision: number;
	targets: Record<string, TargetBinding>;
};

type RegistryRead =
	| { status: "missing" }
	| { status: "present"; registry: CustodyRegistry }
	| { status: "invalid" };

function hash(parts: readonly string[]): string {
	return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * Derive the opaque identity of one verified Agent Chrome Browser authority.
 *
 * @param input - Verified logical Browser identity and endpoint forms
 * @returns A stable opaque authority digest
 */
export function browserAuthorityIdOf(input: {
	environmentName: string;
	environmentProfile: string;
	endpointHttp: string;
	endpointWs: string;
}): string {
	return hash([
		"browser-authority",
		input.environmentName,
		input.environmentProfile,
		input.endpointHttp,
		input.endpointWs,
	]);
}

/**
 * Redact a canonical CDP target id into a durable registry key.
 *
 * @param rawTargetId - Exact CDP target id held only in process memory
 * @returns An opaque target reference safe for durable state
 * @throws {TypeError} When the target id is empty or unbounded
 */
export function targetRefOf(rawTargetId: string): string {
	if (rawTargetId.length === 0 || rawTargetId.length > 512) {
		throw new TypeError("raw target id must be bounded and non-empty");
	}
	return hash(["browser-target", rawTargetId]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAdapterId(value: unknown): value is BrowserAdapterId {
	return (
		value === "agent-browser" ||
		value === "chrome-devtools-mcp" ||
		value === "playwright-cdp"
	);
}

function parseRegistry(raw: string): CustodyRegistry | undefined {
	if (Buffer.byteLength(raw, "utf8") > MAX_REGISTRY_BYTES) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (
		!isRecord(value) ||
		value.contract !== CONTRACT ||
		value.schema_version !== SCHEMA_VERSION ||
		typeof value.authority_id !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.authority_id) ||
		typeof value.revision !== "number" ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		!isRecord(value.targets)
	) {
		return undefined;
	}
	const targets: Record<string, TargetBinding> = {};
	for (const [targetRef, rawBinding] of Object.entries(value.targets)) {
		if (
			!/^[a-f0-9]{64}$/.test(targetRef) ||
			!isRecord(rawBinding) ||
			(rawBinding.status !== "owned" && rawBinding.status !== "released") ||
			!(rawBinding.owner_run_id === null || typeof rawBinding.owner_run_id === "string") ||
			!Array.isArray(rawBinding.adapters) ||
			!rawBinding.adapters.every(isAdapterId) ||
			typeof rawBinding.expires_at_epoch_ms !== "number" ||
			!Number.isSafeInteger(rawBinding.expires_at_epoch_ms) ||
			rawBinding.expires_at_epoch_ms < 0 ||
			typeof rawBinding.revision !== "number" ||
			!Number.isSafeInteger(rawBinding.revision) ||
			rawBinding.revision < 1
		) {
			return undefined;
		}
		targets[targetRef] = {
			owner_run_id: rawBinding.owner_run_id,
			status: rawBinding.status,
			adapters: [...new Set(rawBinding.adapters)],
			expires_at_epoch_ms: rawBinding.expires_at_epoch_ms,
			revision: rawBinding.revision,
		};
	}
	return {
		contract: CONTRACT,
		schema_version: SCHEMA_VERSION,
		authority_id: value.authority_id,
		revision: value.revision,
		targets,
	};
}

function registryPaths(deps: RunStoreDeps) {
	const directory = join(deps.paths.resolution.roots.state, "browser-custody");
	return {
		directory,
		record: join(directory, "registry.json"),
		lock: join(deps.paths.runtime.locksDir, "browser-custody.lock"),
	};
}

async function ensureRegistryDirectories(
	deps: RunStoreDeps,
	directory: string,
): Promise<boolean> {
	try {
		await deps.fs.mkdir(directory, {
			recursive: true,
			mode: PRIVATE_DIRECTORY_MODE,
		});
		await deps.fs.mkdir(deps.paths.runtime.locksDir, {
			recursive: true,
			mode: PRIVATE_DIRECTORY_MODE,
		});
		return true;
	} catch {
		return false;
	}
}

async function readRegistry(
	deps: RunStoreDeps,
	path: string,
): Promise<RegistryRead> {
	const read = await readDurableFile(deps.fs, path);
	if (read.status === "missing") return { status: "missing" };
	if (read.status === "unreadable") return { status: "invalid" };
	const registry = parseRegistry(read.raw);
	return registry === undefined
		? { status: "invalid" }
		: { status: "present", registry };
}

function emptyRegistry(authorityId: string): CustodyRegistry {
	return {
		contract: CONTRACT,
		schema_version: SCHEMA_VERSION,
		authority_id: authorityId,
		revision: 0,
		targets: {},
	};
}

function storeFailure(failure?: StoreFailure): Extract<
	TargetOperationLeaseResult,
	{ ok: false }
> {
	return {
		ok: false,
		code: "target_lease_store_failed",
		message:
			failure === undefined
				? "Target Lease state could not be prepared."
				: `Target Lease state could not be updated (${failure.code}).`,
	};
}

function evidenceMatches(
	evidence: TargetOwnershipEvidence | undefined,
	runId: string,
	adapterId: BrowserAdapterId,
	rawTargetId: string,
): boolean {
	if (
		evidence === undefined ||
		evidence.run_id !== runId ||
		evidence.raw_target_id !== rawTargetId
	) {
		return false;
	}
	return evidence.kind === "explicit-adoption"
		? evidence.adapter_id === adapterId &&
			/^[a-f0-9]{32}$/.test(evidence.target_envelope_id) &&
			/^[a-f0-9]{24}$/.test(evidence.target_candidate_id) &&
			(evidence.target_candidate_identity.kind === "cdp-target-id" ||
				(evidence.target_candidate_identity.raw_adapter_page_id.length > 0 &&
					evidence.target_candidate_identity.raw_adapter_page_id.length <= 512)) &&
			candidateIdOf(
				evidence.target_envelope_id,
				evidence.target_candidate_identity.kind === "cdp-target-id"
					? ["cdp_target_id", rawTargetId]
					: [
							"adapter_page_id",
							evidence.target_candidate_identity.raw_adapter_page_id,
						],
			) === evidence.target_candidate_id
		: evidence.adapter_id === adapterId;
}

async function bindOrAuthorizeTarget(
	deps: RunStoreDeps,
	input: {
		authorityId: string;
		runId: string;
		adapterId: BrowserAdapterId;
			rawTargetId: string;
			ttlMs: number;
			ownershipEvidence?: TargetOwnershipEvidence;
	},
): Promise<
	| { ok: true; firstOwnership: boolean }
	| Extract<TargetOperationLeaseResult, { ok: false }>
> {
	const paths = registryPaths(deps);
	if (!(await ensureRegistryDirectories(deps, paths.directory))) {
		return storeFailure();
	}
	const targetRef = targetRefOf(input.rawTargetId);
	const outcome = await withExclusiveFileLock<
		| { ok: true; firstOwnership: boolean }
		| Extract<TargetOperationLeaseResult, { ok: false }>
	>(
		deps.fs,
		{
			lockPath: paths.lock,
			holderId: `browser-custody-${input.runId}`,
			staleAfterMs: LOCK_STALE_AFTER_MS,
			clock: deps.clock,
		},
		async () => {
			const read = await readRegistry(deps, paths.record);
			if (read.status === "invalid") return storeFailure();
			let registry =
				read.status === "missing"
					? emptyRegistry(input.authorityId)
					: read.registry;
			if (registry.authority_id !== input.authorityId) {
				const now = deps.clock();
				if (
					Object.values(registry.targets).some(
						(binding) =>
							binding.status === "owned" &&
							binding.expires_at_epoch_ms > now,
					)
				) {
					return {
						ok: false,
						code: "browser_authority_changed",
						message:
							"Agent Chrome Browser authority changed while Target Leases remain owned.",
					};
				}
				registry = emptyRegistry(input.authorityId);
			}
			const now = deps.clock();
			const expiresAt = now + input.ttlMs;
			const current = registry.targets[targetRef];
			if (
				current?.status === "owned" &&
				current.expires_at_epoch_ms > now
			) {
				if (current.owner_run_id !== input.runId) {
					return {
						ok: false,
						code: "target_owned_by_other_run",
						message: "The exact Browser target is owned by another run.",
					};
				}
				if (
					!current.adapters.includes(input.adapterId) ||
					current.expires_at_epoch_ms !== expiresAt
				) {
					const next: CustodyRegistry = {
						...registry,
						revision: registry.revision + 1,
						targets: {
							...registry.targets,
								[targetRef]: {
									...current,
									adapters: current.adapters.includes(input.adapterId)
										? current.adapters
										: [...current.adapters, input.adapterId],
									expires_at_epoch_ms: expiresAt,
								revision: current.revision + 1,
							},
						},
					};
					const written = await writeDurableFile(deps.fs, {
						path: paths.record,
						contents: `${JSON.stringify(next)}\n`,
					});
					if (!written.ok) return storeFailure(written.failure);
				}
				return { ok: true, firstOwnership: false };
			}
			if (
				!evidenceMatches(
					input.ownershipEvidence,
					input.runId,
					input.adapterId,
					input.rawTargetId,
				)
			) {
				return {
					ok: false,
					code: "target_ownership_evidence_invalid",
					message:
						"First ownership requires an exact adapter creation receipt or explicit adoption receipt.",
				};
			}
			const nextRevision = (current?.revision ?? 0) + 1;
			const next: CustodyRegistry = {
				...registry,
				revision: registry.revision + 1,
				targets: {
					...registry.targets,
					[targetRef]: {
							owner_run_id: input.runId,
							status: "owned",
							adapters: [input.adapterId],
							expires_at_epoch_ms: expiresAt,
						revision: nextRevision,
					},
				},
			};
			const written = await writeDurableFile(deps.fs, {
				path: paths.record,
				contents: `${JSON.stringify(next)}\n`,
			});
			return written.ok
				? { ok: true, firstOwnership: true }
				: storeFailure(written.failure);
		},
	);
	return !outcome.ok && "failure" in outcome
		? storeFailure(outcome.failure)
		: outcome;
}

/**
 * Acquire exclusive operation custody for one canonical CDP target.
 *
 * @param deps - Admitted Browser Use durable-store dependencies
 * @param input - Browser authority, run, adapter, target, operation, and evidence
 * @returns An atomic Target Lease or one typed refusal
 */
export async function acquireTargetOperationLease(
	deps: RunStoreDeps,
	input: {
		authorityId: string;
		runId: string;
		adapterId: BrowserAdapterId;
		rawTargetId: string;
		operation: TargetOperation;
		ttlMs: number;
		ownershipEvidence?: TargetOwnershipEvidence;
	},
): Promise<TargetOperationLeaseResult> {
	const targetRef = targetRefOf(input.rawTargetId);
	const operationLease = await acquireLease(deps, {
		key: `browser-target-operation:${input.authorityId}:${targetRef}`,
		holderId: `browser-target-run:${input.runId}`,
		ttlMs: input.ttlMs,
		scope: { target_id: targetRef },
	});
	if (!operationLease.ok) {
		return {
			ok: false,
			code:
				operationLease.code === "lease_held"
					? "target_lease_held"
					: "target_lease_store_failed",
			message:
				operationLease.code === "lease_held"
					? operationLease.continuation.summary
					: operationLease.message,
		};
	}
	const binding = await bindOrAuthorizeTarget(deps, input);
	if (!binding.ok) {
		await releaseLease(deps, operationLease.lease);
		return binding;
	}
	return {
		ok: true,
		first_ownership: binding.firstOwnership,
		lease: {
			contract: CONTRACT,
			schema_version: SCHEMA_VERSION,
			authority_id: input.authorityId,
			target_ref: targetRef,
			run_id: input.runId,
			adapter_id: input.adapterId,
			operation: input.operation,
			lease: operationLease.lease,
		},
	};
}

/**
 * Release one exact operation lease without changing any Browser target.
 *
 * @param deps - Durable lease dependencies
 * @param lease - Exact lease returned by acquisition
 * @returns Confirmation that the operation lease was removed
 */
export async function releaseTargetOperationLease(
	deps: LeaseDeps,
	lease: TargetOperationLease,
): Promise<{ ok: true }> {
	return await releaseLease(deps, lease.lease);
}

async function extendTargetBinding(
	deps: RunStoreDeps,
	input: {
		lease: TargetOperationLease;
		ttlMs: number;
	},
): Promise<
	| { ok: true }
	| Extract<TargetOperationLeaseHeartbeatResult, { ok: false }>
> {
	const paths = registryPaths(deps);
	if (!(await ensureRegistryDirectories(deps, paths.directory))) {
		return storeFailure();
	}
	const outcome = await withExclusiveFileLock<
		| { ok: true }
		| Extract<TargetOperationLeaseHeartbeatResult, { ok: false }>
	>(
		deps.fs,
		{
			lockPath: paths.lock,
			holderId: `browser-custody-heartbeat-${input.lease.run_id}`,
			staleAfterMs: LOCK_STALE_AFTER_MS,
			clock: deps.clock,
		},
		async () => {
			const read = await readRegistry(deps, paths.record);
			if (read.status !== "present") return storeFailure();
			if (read.registry.authority_id !== input.lease.authority_id) {
				return {
					ok: false,
					code: "browser_authority_changed",
					message:
						"Agent Chrome Browser authority changed while the Target Lease was active.",
				};
			}
			const binding = read.registry.targets[input.lease.target_ref];
			if (
				binding?.status !== "owned" ||
				binding.owner_run_id !== input.lease.run_id ||
				!binding.adapters.includes(input.lease.adapter_id)
			) {
				return {
					ok: false,
					code: "target_lease_lost",
					message:
						"The exact Browser target is no longer owned by this run and adapter.",
				};
			}
			const next: CustodyRegistry = {
				...read.registry,
				revision: read.registry.revision + 1,
				targets: {
					...read.registry.targets,
					[input.lease.target_ref]: {
						...binding,
						expires_at_epoch_ms: deps.clock() + input.ttlMs,
						revision: binding.revision + 1,
					},
				},
			};
			const written = await writeDurableFile(deps.fs, {
				path: paths.record,
				contents: `${JSON.stringify(next)}\n`,
			});
			return written.ok ? { ok: true } : storeFailure(written.failure);
		},
	);
	return !outcome.ok && "failure" in outcome
		? storeFailure(outcome.failure)
		: outcome;
}

/**
 * Renew one held Target Lease and its durable target ownership window.
 *
 * @param deps - Admitted Browser Use durable-store dependencies
 * @param lease - Exact Target Lease returned by acquisition or prior heartbeat
 * @param input - New bounded TTL window
 * @returns The renewed Target Lease or one typed loss/store refusal
 */
export async function heartbeatTargetOperationLease(
	deps: RunStoreDeps,
	lease: TargetOperationLease,
	input: { ttlMs: number },
): Promise<TargetOperationLeaseHeartbeatResult> {
	const renewed = await heartbeatLease(deps, lease.lease, input);
	if (!renewed.ok) {
		return {
			ok: false,
			code:
				renewed.code === "lease_store_failed"
					? "target_lease_store_failed"
					: "target_lease_lost",
			message:
				"message" in renewed
					? renewed.message
					: "The exact Target Lease is no longer held by this run.",
		};
	}
	const extended = await extendTargetBinding(deps, { lease, ttlMs: input.ttlMs });
	if (!extended.ok) {
		await releaseLease(deps, renewed.lease);
		return extended;
	}
	return { ok: true, lease: { ...lease, lease: renewed.lease } };
}

/**
 * Release every durable target binding owned by one completed run.
 *
 * @param deps - Admitted Browser Use durable-store dependencies
 * @param runId - Exact completed run id
 * @returns The number of released bindings or one typed store refusal
 */
export async function releaseRunTargetOwnership(
	deps: RunStoreDeps,
	runId: string,
): Promise<{ ok: true; released: number } | Extract<TargetOperationLeaseResult, { ok: false }>> {
	const paths = registryPaths(deps);
	if (!(await ensureRegistryDirectories(deps, paths.directory))) {
		return storeFailure();
	}
	const outcome = await withExclusiveFileLock<
		{ ok: true; released: number } | Extract<TargetOperationLeaseResult, { ok: false }>
	>(
		deps.fs,
		{
			lockPath: paths.lock,
			holderId: `browser-custody-release-${runId}`,
			staleAfterMs: LOCK_STALE_AFTER_MS,
			clock: deps.clock,
		},
		async () => {
			const read = await readRegistry(deps, paths.record);
			if (read.status === "invalid") return storeFailure();
			if (read.status === "missing") return { ok: true, released: 0 };
			let released = 0;
			const targets = Object.fromEntries(
				Object.entries(read.registry.targets).map(([targetRef, binding]) => {
					if (binding.status !== "owned" || binding.owner_run_id !== runId) {
						return [targetRef, binding];
					}
					released += 1;
					return [
						targetRef,
						{
							...binding,
								owner_run_id: null,
								status: "released" as const,
								expires_at_epoch_ms: deps.clock(),
							revision: binding.revision + 1,
						},
					];
				}),
			);
			if (released === 0) return { ok: true, released: 0 };
			const written = await writeDurableFile(deps.fs, {
				path: paths.record,
				contents: `${JSON.stringify({
					...read.registry,
					revision: read.registry.revision + 1,
					targets,
				})}\n`,
			});
			return written.ok
				? { ok: true, released }
				: storeFailure(written.failure);
		},
	);
	return !outcome.ok && "failure" in outcome
		? storeFailure(outcome.failure)
		: outcome;
}

/**
 * Acquire the exclusive Browser-wide mutation lane.
 *
 * @param deps - Durable lease dependencies
 * @param input - Browser authority, run, mutation class, and bounded TTL
 * @returns The Browser Lane lease or one typed refusal
 */
export async function acquireBrowserLaneLease(
	deps: LeaseDeps,
	input: {
		authorityId: string;
		runId: string;
		mutation: BrowserWideMutation;
		ttlMs: number;
	},
): Promise<BrowserLaneLeaseResult> {
	const acquired = await acquireLease(deps, {
		key: `browser-lane:${input.authorityId}`,
		holderId: `browser-lane-run:${input.runId}`,
		ttlMs: input.ttlMs,
	});
	if (!acquired.ok) {
		return {
			ok: false,
			code:
				acquired.code === "lease_held"
					? "browser_lane_held"
					: "browser_lane_store_failed",
			message:
				acquired.code === "lease_held"
					? acquired.continuation.summary
					: acquired.message,
		};
	}
	return {
		ok: true,
		lease: {
			contract: CONTRACT,
			schema_version: SCHEMA_VERSION,
			authority_id: input.authorityId,
			run_id: input.runId,
			mutation: input.mutation,
			lease: acquired.lease,
		},
	};
}

/**
 * Release one exact Browser Lane lease.
 *
 * @param deps - Durable lease dependencies
 * @param lease - Exact Browser Lane lease returned by acquisition
 * @returns Confirmation that the Browser Lane lease was removed
 */
export async function releaseBrowserLaneLease(
	deps: LeaseDeps,
	lease: BrowserLaneLease,
): Promise<{ ok: true }> {
	return await releaseLease(deps, lease.lease);
}

/**
 * Renew the exclusive Browser Lane without changing its Browser authority.
 *
 * @param deps - Durable lease dependencies
 * @param lease - Exact Browser Lane lease returned by acquisition or heartbeat
 * @param input - New bounded TTL window
 * @returns The renewed Browser Lane lease or one typed loss/store refusal
 */
export async function heartbeatBrowserLaneLease(
	deps: LeaseDeps,
	lease: BrowserLaneLease,
	input: { ttlMs: number },
): Promise<BrowserLaneLeaseHeartbeatResult> {
	const renewed = await heartbeatLease(deps, lease.lease, input);
	if (!renewed.ok) {
		return {
			ok: false,
			code:
				renewed.code === "lease_store_failed"
					? "browser_lane_store_failed"
					: "browser_lane_lost",
			message:
				"message" in renewed
					? renewed.message
					: "The exclusive Browser Lane is no longer held by this run.",
		};
	}
	return { ok: true, lease: { ...lease, lease: renewed.lease } };
}
