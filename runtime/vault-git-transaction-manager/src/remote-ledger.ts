import { randomUUID } from "node:crypto";

import {
	VAULT_GIT_EVENT_TYPES,
	VAULT_GIT_LEDGER_REF,
	type VaultGitBlockerId,
	type VaultGitEventType,
	type VaultGitRetrySafety,
} from "./model.ts";
import type { VaultGitClockPort, VaultGitRemotePort } from "./ports.ts";

/** Exact remote branch used as the append-only lease sequencer. */
export { VAULT_GIT_LEDGER_REF } from "./model.ts";

/** Dependencies required by remote lease engine functions. */
export interface RemoteLedgerEngine {
	/** Sole Git execution boundary. */
	readonly git: VaultGitRemotePort;
	/** Explicit time source for lease diagnostics and commit timestamps. */
	readonly clock: VaultGitClockPort;
}

/** Stable lease state materialized by the current ledger generation. */
export interface RemoteLease {
	/** Opaque transaction correlation id. */
	readonly transactionId: string;
	/** Caller identity label bound at acquisition. */
	readonly actor: string;
	/** Host identity label bound at acquisition. */
	readonly host: string;
	/** Semantic event class bound at acquisition. */
	readonly event: VaultGitEventType;
	/** Repository-relative leaf paths owned by the transaction. */
	readonly ownedPaths: readonly string[];
	/** Local main head admitted at acquisition. */
	readonly localMainHead: string;
	/** Fetched upstream main head admitted at acquisition. */
	readonly remoteMainHead: string;
	/** Original lease start timestamp. */
	readonly acquiredAt: string;
	/** Diagnostic lease duration; never a takeover authority. */
	readonly leaseDurationMs: number;
	/** Whether the generation grants or records released authority. */
	readonly state: "held" | "released";
}

/** Input shared by acquisition and explicit operator takeover. */
export interface AcquireRemoteLeaseRequest {
	/** Named remote in the current clone. */
	readonly remote: string;
	/** Generation previously observed by this caller, or null for bootstrap. */
	readonly expectedGeneration: string | null;
	/** Non-secret caller identity. */
	readonly actor: string;
	/** Non-secret writer-host identity. */
	readonly host: string;
	/** Meaningful vault event. */
	readonly event: VaultGitEventType;
	/** Exact repository-relative paths this transaction may own. */
	readonly ownedPaths: readonly string[];
	/** Diagnostic age threshold; expiry never grants authority. */
	readonly leaseDurationMs: number;
	/** Matching recoverable receipt still awaiting publication. @defaultValue false */
	readonly pushPending?: boolean;
}

/** Input for read-only lease observation. */
export interface ObserveRemoteLedgerRequest {
	/** Named remote in the current clone. */
	readonly remote: string;
}

/** Input for generation and ownership fencing. */
export interface ValidateRemoteLeaseRequest {
	/** Named remote in the current clone. */
	readonly remote: string;
	/** Generation bound to the manager-owned phase. */
	readonly expectedGeneration: string;
	/** Opaque transaction id bound at acquisition. */
	readonly transactionId: string;
}

/** Input for an append-only release transition. */
export type ReleaseRemoteLeaseRequest = ValidateRemoteLeaseRequest;

/** Writer posture after a ledger decision. */
export type RemoteHostDisposition = "authoritative" | "quarantined";

/** Ledger-only recovery actions kept behind the future CLI wiring boundary. */
export type RemoteLedgerNextActionId =
	| "retry_remote"
	| "request_operator_takeover"
	| "preserve_local_edits"
	| "inspect_status";

/** One safe ledger continuation without private paths or shell text. */
export interface RemoteLedgerNextAction {
	/** Stable engine action id. */
	readonly id: RemoteLedgerNextActionId;
	/** Safe human-readable action meaning. */
	readonly summary: string;
}

/** Successful fetched ledger observation. */
export interface RemoteLedgerObservedResult {
	/** Read success marker. */
	readonly status: "observed";
	/** Current fencing generation, or null when the branch is absent. */
	readonly generation: string | null;
	/** Current lease state, or null before bootstrap. */
	readonly lease: RemoteLease | null;
}

/** Deterministic refusal shared by ledger operations. */
export interface RemoteLedgerRefusal {
	/** Refusal marker. */
	readonly status: "refused";
	/** Stable refusal reason. */
	readonly blocker: VaultGitBlockerId;
	/** Confirmed absence of change, or unknown remote completion after interruption. */
	readonly changedState: "none" | "partial";
	/** Retry posture selected from package vocabulary. */
	readonly retrySafety: VaultGitRetrySafety;
	/** One action that preserves caller work and policy. */
	readonly nextAction: RemoteLedgerNextAction;
	/** Caller host must not write after uncertain or stale authority. */
	readonly hostDisposition: RemoteHostDisposition;
	/** Optional non-authoritative lease-age evidence. */
	readonly diagnostics?: { readonly leaseAgeMs: number };
}

/** Complete read-only ledger observation outcome. */
export type RemoteLedgerObservation =
	| RemoteLedgerObservedResult
	| RemoteLedgerRefusal;

/** Successful lease acquisition or operator takeover. */
export interface RemoteLeaseAcquiredResult {
	/** Authority grant marker. */
	readonly status: "acquired";
	/** Newly appended commit generation. */
	readonly generation: string;
	/** Opaque transaction id repeated by write-capable phases. */
	readonly transactionId: string;
	/** Complete transaction binding recorded by the ledger. */
	readonly lease: RemoteLease;
	/** Remote ledger changed. */
	readonly changedState: "remote";
	/** Current host owns this exact generation. */
	readonly hostDisposition: "authoritative";
}

/** Successful append-only release transition. */
export interface RemoteLeaseReleasedResult {
	/** Release success marker. */
	readonly status: "released";
	/** Release commit generation. */
	readonly generation: string;
	/** Released transaction binding. */
	readonly transactionId: string;
	/** Remote ledger changed. */
	readonly changedState: "remote";
	/** Released caller no longer owns write authority. */
	readonly hostDisposition: "quarantined";
}

/** Successful fence validation before a write-capable phase. */
export interface RemoteLeaseValidResult {
	/** Fence success marker. */
	readonly status: "valid";
	/** Still-current generation. */
	readonly generation: string;
	/** Still-current lease binding. */
	readonly lease: RemoteLease;
	/** Validation itself changes no state. */
	readonly changedState: "none";
	/** Current host retains authority. */
	readonly hostDisposition: "authoritative";
}

/** Complete acquisition outcome. */
export type AcquireRemoteLeaseResult =
	| RemoteLeaseAcquiredResult
	| RemoteLedgerRefusal;

/** Complete release outcome. */
export type ReleaseRemoteLeaseResult =
	| RemoteLeaseReleasedResult
	| RemoteLedgerRefusal;

/** Complete fence-validation outcome. */
export type ValidateRemoteLeaseResult =
	| RemoteLeaseValidResult
	| RemoteLedgerRefusal;

interface LedgerDocument {
	readonly schema_version: 1;
	readonly operation: "acquire" | "operator_takeover" | "release";
	readonly previous_generation: string | null;
	readonly transitioned_at: string;
	readonly lease: {
		readonly transaction_id: string;
		readonly actor: string;
		readonly host: string;
		readonly event: VaultGitEventType;
		readonly owned_paths: readonly string[];
		readonly local_main_head: string;
		readonly remote_main_head: string;
		readonly acquired_at: string;
		readonly lease_duration_ms: number;
		readonly state: "held" | "released";
	};
}

/**
 * Fetch and validate the exact remote ledger generation.
 *
 * @param engine - Git and time boundaries
 * @param request - Remote selection
 * @returns Parsed ledger state or one safe refusal
 * @throws Never for transport or malformed remote data
 *
 * @example
 * ```typescript
 * const observed = await observeRemoteLedger(engine, { remote: "origin" })
 * ```
 */
export async function observeRemoteLedger(
	engine: RemoteLedgerEngine,
	request: ObserveRemoteLedgerRequest,
): Promise<RemoteLedgerObservation> {
	const read = await engine.git.readLedger(
		request.remote,
		VAULT_GIT_LEDGER_REF,
	);
	if (read.status === "failed") return remoteFailure(read.reason);
	if (!read.head) return { status: "observed", generation: null, lease: null };
	const document = parseLedgerDocument(
		read.head.content,
		read.head.parents,
		read.head.generation,
	);
	if (!document) {
		return refusal(
			"ledger_malformed",
			"operator_required",
			"request_operator_takeover",
			"Ask an operator to inspect and repair the remote ledger.",
		);
	}
	return {
		status: "observed",
		generation: read.head.generation,
		lease: fromDocument(document),
	};
}

/**
 * Acquire one lease from the caller's observed generation.
 *
 * @param engine - Git and time boundaries
 * @param request - Main admission and transaction binding
 * @returns New fencing generation or a refusal with no canonical vault write
 * @throws When caller-owned binding input is structurally unsafe
 *
 * @example
 * ```typescript
 * const result = await acquireRemoteLease(engine, {
 *   remote: "origin", expectedGeneration: null, actor: "agent", host: "laptop",
 *   event: "note_created", ownedPaths: ["notes/a.md"], leaseDurationMs: 60000,
 * })
 * ```
 */
export async function acquireRemoteLease(
	engine: RemoteLedgerEngine,
	request: AcquireRemoteLeaseRequest,
): Promise<AcquireRemoteLeaseResult> {
	validateAcquireRequest(request);
	const main = await requireAlignedMain(
		engine,
		request.remote,
		request.pushPending ?? false,
	);
	if (main.status === "refused") return main;
	const observed = await observeRemoteLedger(engine, request);
	if (observed.status === "refused") return observed;
	const generationFence = requireExpectedGeneration(
		request.expectedGeneration,
		observed.generation,
	);
	if (generationFence) return generationFence;
	if (observed.lease?.state === "held") {
		const age = Math.max(
			0,
			engine.clock.now().getTime() - Date.parse(observed.lease.acquiredAt),
		);
		const stale = age >= observed.lease.leaseDurationMs;
		// Active contention is ordinary and retriable: the holder releases and
		// a later acquisition succeeds. Only a stale lease needs an operator.
		return stale
			? refusal(
					"lease_stale",
					"operator_required",
					"request_operator_takeover",
					"Ask an operator to decide whether to replace the current lease.",
					{ leaseAgeMs: age },
				)
			: refusal(
					"lease_active",
					"same_input_safe",
					"retry_remote",
					"Retry acquisition after the active lease releases.",
					{ leaseAgeMs: age },
				);
	}
	return appendHeldLease(
		engine,
		request,
		main.localHead,
		main.remoteHead,
		"acquire",
	);
}

/**
 * Replace a lease only through an explicit operator-authorized transition.
 *
 * @param engine - Git and time boundaries
 * @param request - Replacement binding and observed generation
 * @returns New fencing generation or a deterministic refusal
 * @throws When caller-owned binding input is structurally unsafe
 *
 * @example
 * ```typescript
 * const result = await takeOverRemoteLease(engine, request)
 * ```
 */
export async function takeOverRemoteLease(
	engine: RemoteLedgerEngine,
	request: AcquireRemoteLeaseRequest,
): Promise<AcquireRemoteLeaseResult> {
	validateAcquireRequest(request);
	if (request.expectedGeneration === null) {
		throw new Error("operator takeover requires one observed generation");
	}
	const main = await requireAlignedMain(
		engine,
		request.remote,
		request.pushPending ?? false,
	);
	if (main.status === "refused") return main;
	const observed = await observeRemoteLedger(engine, request);
	if (observed.status === "refused") return observed;
	const generationFence = requireExpectedGeneration(
		request.expectedGeneration,
		observed.generation,
	);
	if (generationFence) return generationFence;
	if (!observed.lease || observed.lease.state !== "held") {
		return refusal(
			"lease_owner_unknown",
			"operator_required",
			"request_operator_takeover",
			"Inspect the current ledger owner before replacing authority.",
		);
	}
	return appendHeldLease(
		engine,
		request,
		main.localHead,
		main.remoteHead,
		"operator_takeover",
	);
}

/**
 * Revalidate generation and transaction ownership before a write-capable phase.
 *
 * @param engine - Git and time boundaries
 * @param request - Previously granted generation and transaction id
 * @returns Current lease binding or a quarantining refusal
 * @throws Never for transport, generation, or ownership failures
 *
 * @example
 * ```typescript
 * const fence = await validateRemoteLease(engine, {
 *   remote: "origin", expectedGeneration: generation, transactionId,
 * })
 * ```
 */
export async function validateRemoteLease(
	engine: RemoteLedgerEngine,
	request: ValidateRemoteLeaseRequest,
): Promise<ValidateRemoteLeaseResult> {
	const observed = await observeRemoteLedger(engine, request);
	if (observed.status === "refused") return observed;
	const generationFence = requireExpectedGeneration(
		request.expectedGeneration,
		observed.generation,
	);
	if (generationFence) return generationFence;
	if (
		!observed.lease ||
		observed.lease.state !== "held" ||
		observed.lease.transactionId !== request.transactionId
	) {
		return refusal(
			"lease_owner_unknown",
			"operator_required",
			"request_operator_takeover",
			"Ask an operator to inspect current lease ownership.",
		);
	}
	return {
		status: "valid",
		generation: request.expectedGeneration,
		lease: observed.lease,
		changedState: "none",
		hostDisposition: "authoritative",
	};
}

/**
 * Append a release only while generation and transaction ownership remain current.
 *
 * @param engine - Git and time boundaries
 * @param request - Previously granted generation and transaction id
 * @returns Release generation or a quarantining refusal
 * @throws Never for transport, generation, or ownership failures
 *
 * @example
 * ```typescript
 * const released = await releaseRemoteLease(engine, {
 *   remote: "origin", expectedGeneration: generation, transactionId,
 * })
 * ```
 */
export async function releaseRemoteLease(
	engine: RemoteLedgerEngine,
	request: ReleaseRemoteLeaseRequest,
): Promise<ReleaseRemoteLeaseResult> {
	const validated = await validateRemoteLease(engine, request);
	if (validated.status === "refused") return validated;
	const timestamp = engine.clock.now().toISOString();
	const document = toDocument(
		{ ...validated.lease, state: "released" },
		"release",
		request.expectedGeneration,
		timestamp,
	);
	const appended = await engine.git.appendLedgerCommit({
		remote: request.remote,
		ledgerRef: VAULT_GIT_LEDGER_REF,
		expectedGeneration: request.expectedGeneration,
		content: `${JSON.stringify(document, null, 2)}\n`,
		message: `vault-ledger: release ${request.transactionId}`,
		author: validated.lease.actor,
		timestamp,
	});
	if (appended.status === "refused") return appendFailure(appended.reason);
	return {
		status: "released",
		generation: appended.generation,
		transactionId: request.transactionId,
		changedState: "remote",
		hostDisposition: "quarantined",
	};
}

async function appendHeldLease(
	engine: RemoteLedgerEngine,
	request: AcquireRemoteLeaseRequest,
	localMainHead: string,
	remoteMainHead: string,
	operation: "acquire" | "operator_takeover",
): Promise<AcquireRemoteLeaseResult> {
	const timestamp = engine.clock.now().toISOString();
	const lease: RemoteLease = {
		transactionId: `txn_${randomUUID().replaceAll("-", "")}`,
		actor: request.actor,
		host: request.host,
		event: request.event,
		ownedPaths: [...request.ownedPaths],
		localMainHead,
		remoteMainHead,
		acquiredAt: timestamp,
		leaseDurationMs: request.leaseDurationMs,
		state: "held",
	};
	const document = toDocument(
		lease,
		operation,
		request.expectedGeneration,
		timestamp,
	);
	const appended = await engine.git.appendLedgerCommit({
		remote: request.remote,
		ledgerRef: VAULT_GIT_LEDGER_REF,
		expectedGeneration: request.expectedGeneration,
		content: `${JSON.stringify(document, null, 2)}\n`,
		message: `vault-ledger: ${operation} ${lease.transactionId}`,
		author: request.actor,
		timestamp,
	});
	if (appended.status === "refused") return appendFailure(appended.reason);
	return {
		status: "acquired",
		generation: appended.generation,
		transactionId: lease.transactionId,
		lease,
		changedState: "remote",
		hostDisposition: "authoritative",
	};
}

async function requireAlignedMain(
	engine: RemoteLedgerEngine,
	remote: string,
	pushPending: boolean,
): Promise<
	| {
			readonly status: "aligned";
			readonly localHead: string;
			readonly remoteHead: string;
	  }
	| RemoteLedgerRefusal
> {
	const inspected = await engine.git.inspectMain(remote);
	if (inspected.status === "failed") return remoteFailure(inspected.reason);
	if (
		inspected.alignment === "aligned" &&
		inspected.localHead !== null &&
		inspected.localHead === inspected.remoteHead &&
		!pushPending
	) {
		return {
			status: "aligned",
			localHead: inspected.localHead,
			remoteHead: inspected.remoteHead,
		};
	}
	const blocker: VaultGitBlockerId = pushPending
		? "push_pending"
		: inspected.alignment === "behind"
			? "main_behind"
			: inspected.alignment === "ahead"
				? "main_ahead"
				: inspected.alignment === "diverged"
					? "main_diverged"
					: "vault_unconfigured";
	return refusal(
		blocker,
		inspected.alignment === "ahead" && !pushPending
			? "operator_required"
			: "same_input_unsafe",
		inspected.alignment === "ahead" && !pushPending
			? "request_operator_takeover"
			: "inspect_status",
		pushPending
			? "Inspect and recover the pending publication before admission."
			: inspected.alignment === "ahead"
				? "Ask an operator to reconcile unpublished main history."
				: "Inspect main alignment before retrying admission.",
	);
}

function requireExpectedGeneration(
	expected: string | null,
	actual: string | null,
): RemoteLedgerRefusal | null {
	if (expected === actual) return null;
	return refusal(
		"lease_generation_stale",
		"operator_required",
		"preserve_local_edits",
		"Preserve local edits and ask an operator to inspect the newer lease.",
	);
}

function appendFailure(
	reason:
		| "remote_moved"
		| "remote_unavailable"
		| "remote_state_unknown"
		| "timed_out",
): RemoteLedgerRefusal {
	if (reason === "remote_moved") {
		return refusal(
			"remote_moved",
			"operator_required",
			"preserve_local_edits",
			"Preserve local edits and inspect the winning ledger generation.",
		);
	}
	// A timed-out append leaves the remote outcome unknown: the pushed
	// packfile may still land after the adapter's re-read, so the refusal
	// must not claim changedState "none" or same-input retry safety.
	if (reason === "remote_state_unknown" || reason === "timed_out") {
		return refusal(
			"remote_unavailable",
			"operator_required",
			"preserve_local_edits",
			"Preserve local edits and ask an operator to verify the remote ledger.",
			undefined,
			"partial",
		);
	}
	return remoteFailure(reason);
}

function remoteFailure(
	reason: "remote_unavailable" | "timed_out" | "remote_main_missing",
): RemoteLedgerRefusal {
	return refusal(
		"remote_unavailable",
		"same_input_unsafe",
		"retry_remote",
		reason === "timed_out"
			? "Retry the remote operation after checking connectivity."
			: "Check remote availability, then retry the operation.",
	);
}

function refusal(
	blocker: VaultGitBlockerId,
	retrySafety: VaultGitRetrySafety,
	actionId: RemoteLedgerNextActionId,
	summary: string,
	diagnostics?: { readonly leaseAgeMs: number },
	changedState: "none" | "partial" = "none",
): RemoteLedgerRefusal {
	return {
		status: "refused",
		blocker,
		changedState,
		retrySafety,
		nextAction: { id: actionId, summary },
		hostDisposition: "quarantined",
		...(diagnostics ? { diagnostics } : {}),
	};
}

function toDocument(
	lease: RemoteLease,
	operation: LedgerDocument["operation"],
	previousGeneration: string | null,
	transitionedAt: string,
): LedgerDocument {
	return {
		schema_version: 1,
		operation,
		previous_generation: previousGeneration,
		transitioned_at: transitionedAt,
		lease: {
			transaction_id: lease.transactionId,
			actor: lease.actor,
			host: lease.host,
			event: lease.event,
			owned_paths: [...lease.ownedPaths],
			local_main_head: lease.localMainHead,
			remote_main_head: lease.remoteMainHead,
			acquired_at: lease.acquiredAt,
			lease_duration_ms: lease.leaseDurationMs,
			state: lease.state,
		},
	};
}

function fromDocument(document: LedgerDocument): RemoteLease {
	return {
		transactionId: document.lease.transaction_id,
		actor: document.lease.actor,
		host: document.lease.host,
		event: document.lease.event,
		ownedPaths: [...document.lease.owned_paths],
		localMainHead: document.lease.local_main_head,
		remoteMainHead: document.lease.remote_main_head,
		acquiredAt: document.lease.acquired_at,
		leaseDurationMs: document.lease.lease_duration_ms,
		state: document.lease.state,
	};
}

function parseLedgerDocument(
	content: string | null,
	parents: readonly string[],
	generation: string,
): LedgerDocument | null {
	if (content === null || !isObjectId(generation) || parents.length > 1)
		return null;
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		return null;
	}
	if (!isRecord(value) || !isRecord(value.lease)) return null;
	const lease = value.lease;
	const previousGeneration = value.previous_generation;
	if (
		value.schema_version !== 1 ||
		!isOperation(value.operation) ||
		(typeof previousGeneration !== "string" && previousGeneration !== null) ||
		!isIsoDate(value.transitioned_at) ||
		!isOpaqueTransactionId(lease.transaction_id) ||
		!isOneLine(lease.actor) ||
		!isOneLine(lease.host) ||
		!VAULT_GIT_EVENT_TYPES.includes(lease.event as VaultGitEventType) ||
		!Array.isArray(lease.owned_paths) ||
		!lease.owned_paths.every(isOwnedPath) ||
		!isObjectId(lease.local_main_head) ||
		!isObjectId(lease.remote_main_head) ||
		!isIsoDate(lease.acquired_at) ||
		!Number.isSafeInteger(lease.lease_duration_ms) ||
		(lease.lease_duration_ms as number) <= 0 ||
		(lease.state !== "held" && lease.state !== "released") ||
		(value.operation === "release"
			? lease.state !== "released"
			: lease.state !== "held")
	) {
		return null;
	}
	if (
		(parents.length === 0 && previousGeneration !== null) ||
		(parents.length === 1 && previousGeneration !== parents[0]) ||
		(parents.length === 0 && value.operation !== "acquire")
	) {
		return null;
	}
	// Explicit construction: a future LedgerDocument field fails this compile
	// until the guard list above learns to validate it.
	return {
		schema_version: value.schema_version,
		operation: value.operation,
		previous_generation: previousGeneration,
		transitioned_at: value.transitioned_at,
		lease: {
			transaction_id: lease.transaction_id,
			actor: lease.actor,
			host: lease.host,
			event: lease.event as VaultGitEventType,
			owned_paths: lease.owned_paths.filter(isOwnedPath),
			local_main_head: lease.local_main_head,
			remote_main_head: lease.remote_main_head,
			acquired_at: lease.acquired_at,
			lease_duration_ms: lease.lease_duration_ms as number,
			state: lease.state,
		},
	};
}

function validateAcquireRequest(request: AcquireRemoteLeaseRequest): void {
	if (!isOneLine(request.actor) || !isOneLine(request.host)) {
		throw new Error("actor and host must each be one non-empty line");
	}
	if (!VAULT_GIT_EVENT_TYPES.includes(request.event)) {
		throw new Error("event must use package vocabulary");
	}
	if (
		request.ownedPaths.length === 0 ||
		!request.ownedPaths.every(isOwnedPath)
	) {
		throw new Error("owned paths must be repository-relative leaf paths");
	}
	if (
		!Number.isSafeInteger(request.leaseDurationMs) ||
		request.leaseDurationMs <= 0
	) {
		throw new Error("lease duration must be one positive integer");
	}
	if (
		request.expectedGeneration !== null &&
		!isObjectId(request.expectedGeneration)
	) {
		throw new Error("expected generation must be one complete object id");
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperation(value: unknown): value is LedgerDocument["operation"] {
	return (
		value === "acquire" || value === "operator_takeover" || value === "release"
	);
}

function isObjectId(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{40,64}$/.test(value);
}

function isOpaqueTransactionId(value: unknown): value is string {
	return typeof value === "string" && /^txn_[0-9a-f]{32}$/.test(value);
}

function isOneLine(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.trim().length > 0 &&
		!/[\r\n\0]/.test(value)
	);
}

function isOwnedPath(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.startsWith("/"))
		return false;
	const segments = value.split("/");
	if (segments[0] === ".git") return false;
	return segments.every(
		(segment) => segment.length > 0 && segment !== "." && segment !== "..",
	);
}

function isIsoDate(value: unknown): value is string {
	return (
		typeof value === "string" &&
		!Number.isNaN(Date.parse(value)) &&
		new Date(value).toISOString() === value
	);
}
