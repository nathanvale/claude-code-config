// ---------------------------------------------------------------------------
// Browser Authentication provider (auth U3a PR1; R7, R8, R11, R16, R27;
// D5-D8 of the U3a contract spec).
//
// Composes the TokenRetrievalPort and the fenced lease primitive into the
// events U2's transaction already expects: `acquireLease` maps onto
// `lease-granted`/`lease-unavailable` (a store fault is blocked
// capability-loss — legal in both lease-request and sensitive-interval);
// the granted LeaseWriteClaim is the only custody token the run integration
// Port accepts; `prepareSecretFree` runs the R8-ordered secret-free gate
// (method admission, token gate, vault-scope proof, then EITHER the exact
// bound-item read OR one item discovery — never both, and never a rescan on
// the repair path); mid-sensitive-interval token failure is capability-loss
// because missing-token is illegal in that phase (D6); and `commitWithClaim`
// converts the run store's throwing commit path into typed refusals (D8)
// while passing fragments through verbatim — secret-shaped fragments still
// die in U2's own admission, never laundered here.
//
// No Date.now, no Math.random, no ambient environment reads: the ONLY
// credential capability is the injected Port (R7/R16). Every blocked outcome
// clones its continuation from BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE — this
// module never mints a continuation (R21).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import type { BrowserUseLaneAuthMethod } from "./browser-use-adapter-model";
import type { AgentBrowserAuthDeliveryContext } from "./browser-use-agent-browser";
import {
	type BrowserUseAuthContractDeps,
	commitAuthTransaction,
	createBrowserUseAuthContract,
} from "./browser-use-auth";
import type {
	BrowserUseDeliveryHook,
	BrowserUseTargetReproof,
	BrowserUseVerifiedTarget,
} from "./browser-use-confidential-field-delivery";
import {
	type BrowserUseAuthContext,
	type BrowserUseAuthLaneAdmission,
	type BrowserUseBindingRepairHint,
	type BrowserUseBindingStaleState,
	type BrowserUseImportCandidate,
	type BrowserUseItemBinding,
	type BrowserUseRedactedSelectionOption,
	type BrowserUseResolvedAuthCandidate,
	assessBindingMethod,
	assessBindingUsability,
	itemBindingsEqual,
	matchItemBinding,
	secretShapeFindingOf,
	validateItemBindingShape,
} from "./browser-use-auth-bindings";
import type { BrowserUseAuthBindingStore } from "./browser-use-auth-binding-store";
import {
	type BrowserUseAuthBlockedCause,
	type BrowserUseAuthContinuation,
	type BrowserUseAuthTransactionFragment,
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
} from "./browser-use-auth-model";
import type { BrowserUseAuthTransactionEvent } from "./browser-use-auth-transaction";
import {
	type LeaseHeartbeatResult,
	type LeaseProjection,
	type LeaseWriteClaim,
	acquireLease,
	heartbeatLease,
	releaseLease,
	validateStoredLeaseForWrite,
} from "./browser-use-locks";
import {
	type BrowserUseOpCredentialField,
	type BrowserUsePrincipalBoundBindingEvidence,
	type BrowserUseTokenRetrievalPort,
	type BrowserUseTokenRetrievalRejection,
	blockOfRetrievalRejection,
	proveVaultScope,
} from "./browser-use-op";
import type {
	BrowserUseRunIntegrationPort,
	BrowserUseSharedRun,
} from "./browser-use-run-model";
import {
	type RunStoreDeps,
	BrowserUseAuthCommitInfrastructureError,
	createRunIntegrationPort,
	leaseKeyForRun,
	loadSharedRun,
} from "./browser-use-runs";
import type { BrowserUseLeasePayload } from "./browser-use-schemas";

// --- Deps and factory ---------------------------------------------------------

/**
 * Injected seams. One `store` value serves both the run store and the lease
 * primitive — `RunStoreDeps` and `LeaseDeps` are structurally identical (D7).
 * The ApprovalBrokerPort is deliberately NOT a dep: the provider only
 * produces the blocked states whose continuations request grants.
 */
export type BrowserUseAuthProviderDeps = {
	store: RunStoreDeps;
	admission: Exclude<
		BrowserUseAuthLaneAdmission<BrowserUseTokenRetrievalPort>,
		{ kind: "blocked" }
	>;
	attestationByDigest: BrowserUseAuthContractDeps["attestationByDigest"];
	/** Host-lifetime cache; live OP evidence remains authority on every use. */
	bindingStore?: BrowserUseAuthBindingStore;
};

// --- Lease -> transaction-event mapping ---------------------------------------

/**
 * One lease interaction mapped onto the exact transaction event U2 admits in
 * phase `lease-request`: a granted lease carries the write claim; a held
 * lease is the resolvable `lease-unavailable` block; every store fault and
 * heartbeat rejection is blocked capability-loss (legal in both
 * `lease-request` and `sensitive-interval`) — never a throw.
 */
export type BrowserUseLeaseEventOutcome =
	| {
			granted: true;
			event: Extract<BrowserUseAuthTransactionEvent, { type: "lease-granted" }>;
			claim: LeaseWriteClaim;
			lease: BrowserUseLeasePayload;
	  }
	| {
			granted: false;
			event: Extract<BrowserUseAuthTransactionEvent, { type: "lease-unavailable" }>;
			blocked_cause: "lease-unavailable";
			continuation: BrowserUseAuthContinuation;
			holder: LeaseProjection;
	  }
	| {
			granted: false;
			event: { type: "blocked"; cause: "capability-loss" };
			blocked_cause: "capability-loss";
			continuation: BrowserUseAuthContinuation;
			message: string;
	  };

// --- Preparation surface types ------------------------------------------------

/** Input to the R8-ordered secret-free preparation gate. */
export type BrowserUseSecretFreePreparationInput = {
	service_id: string;
	auth_context: BrowserUseAuthContext;
	target_origins: readonly string[];
	login_path: string | null;
	method: BrowserUseLaneAuthMethod;
	/** Approved Item Binding, or null for first bind. */
	binding: BrowserUseItemBinding | null;
	candidate_hint: Pick<
		BrowserUseImportCandidate,
		"hint_item_id" | "legacy_vault_name"
	> | null;
};

/** The causes preparation may raise (all legal in secret-free-preparation). */
export type BrowserUsePreparationBlockedCause = Extract<
	BrowserUseAuthBlockedCause,
	| "missing-token"
	| "invalid-vault-scope"
	| "ambiguous-binding-selection"
	| "revoked-binding"
	| "unsupported-method"
	| "capability-loss"
>;

/** Projection-level block detail (PR2's CLI consumes it; never a fragment). */
export type BrowserUsePreparationBlockDetail =
	| { kind: "token"; rejection: BrowserUseTokenRetrievalRejection }
	| { kind: "vault-scope"; visible_count: number }
	| { kind: "selection"; selection: readonly BrowserUseRedactedSelectionOption[] }
	| {
			kind: "binding-repair";
			repair_hint: BrowserUseBindingRepairHint;
			stale_state: BrowserUseBindingStaleState | null;
	  }
	| { kind: "method" }
	| { kind: "capability"; message: string };

/** Preparation outcome: the transaction event, or one blocked state. */
export type BrowserUseSecretFreePreparationOutcome =
	| {
			ok: true;
			event: Extract<
				BrowserUseAuthTransactionEvent,
				{ type: "preparation-complete" }
			>;
			/** Null only for session-reuse. */
			binding: BrowserUseItemBinding | null;
	  }
	| {
			ok: false;
			event: { type: "blocked"; cause: BrowserUsePreparationBlockedCause };
			continuation: BrowserUseAuthContinuation;
			detail: BrowserUsePreparationBlockDetail;
	  };

/** Commit outcome: the U2 result verbatim, or one typed boundary refusal (D8). */
export type BrowserUseProviderCommitOutcome =
	| Awaited<ReturnType<typeof commitAuthTransaction>>
	| {
			ok: false;
			rejection: {
				code: "auth_commit_lease_rejected" | "auth_commit_store_faulted";
				message: string;
			};
	  };

/** The provider surface the U3a workflow composes. */
export type BrowserUseAuthProvider = {
	acquireSensitiveIntervalLease(input: {
		run: Pick<BrowserUseSharedRun, "environment_profile">;
		holder_id: string;
		ttl_ms: number;
		scope?: BrowserUseLeasePayload["scope"];
	}): Promise<BrowserUseLeaseEventOutcome>;
	heartbeatSensitiveIntervalLease(input: {
		lease: BrowserUseLeasePayload;
		ttl_ms: number;
	}): Promise<BrowserUseLeaseEventOutcome>;
	releaseSensitiveIntervalLease(input: {
		lease: BrowserUseLeasePayload;
	}): Promise<{ ok: true }>;
	integrationPortFor(claim: LeaseWriteClaim): BrowserUseRunIntegrationPort;
	prepareSecretFree(
		input: BrowserUseSecretFreePreparationInput,
	): Promise<BrowserUseSecretFreePreparationOutcome>;
	prepareGenerationBinding(input: {
		resolution: BrowserUseResolvedAuthCandidate;
		target_origins: readonly string[];
		login_path: string | null;
		method: BrowserUseLaneAuthMethod;
	}): Promise<BrowserUseSecretFreePreparationOutcome>;
	commitWithClaim(
		claim: LeaseWriteClaim,
		input: {
			run_id: string;
			expected_revision: number;
			fragment: BrowserUseAuthTransactionFragment;
		},
	): Promise<BrowserUseProviderCommitOutcome>;
	buildAgentBrowserDeliveryContext(
		input: BrowserUseDeliveryContextInput,
	): AgentBrowserAuthDeliveryContext;
};

/**
 * Everything the auth command supplies to route a sensitive-interval delivery
 * through the agent-browser lane (wave-4 delivery builder wiring_spec item 3):
 * the approved binding, the freshly proven VERIFIED TARGET, the lane's delivery
 * hook + target re-proof, and the per-ref field plan. `in_sensitive_interval`
 * MUST be true only between lease-granted and submission-dispatched — the
 * builder stamps it onto the context so the lane refuses a confidential fill
 * outside the sensitive interval exactly as it would without any context.
 */
export type BrowserUseDeliveryContextInput = {
	binding: BrowserUseItemBinding;
	target: BrowserUseVerifiedTarget;
	deliver: BrowserUseDeliveryHook;
	reproveTarget: BrowserUseTargetReproof;
	field_by_ref: Readonly<Record<string, BrowserUseOpCredentialField>>;
	/** True only inside the sensitive interval (post lease-granted, pre submit). */
	in_sensitive_interval: boolean;
};

/**
 * Bounded metadata-only facts consumed by composed authentication status.
 *
 * No identifiers cross this projection. A failed metadata call reports only a
 * typed blocked cause and leaves vault scope unevaluated.
 */
export type BrowserUseAuthMetadataStatus =
	| {
			ok: true;
			service_account: "active";
			vault_scope: "exactly-one" | "zero" | "multiple";
			proof_coordinates: BrowserUseAuthStatusProofCoordinates | null;
	  }
	| {
			ok: false;
			service_account: "active" | "invalid" | "unavailable";
			vault_scope: "not-evaluated";
			blocked_cause: BrowserUseAuthBlockedCause;
	  };

/** Opaque coordinates binding composed status proof to one captured lane. */
export type BrowserUseAuthStatusProofCoordinates = {
	lane_digest: string;
	principal_digest: string;
	vault_digest: string;
	profile_digest: string;
};

const AUTH_STATUS_PROFILE_ENVIRONMENT = "agent-chrome";
const AUTH_STATUS_PROFILE_NAME = "default";
const AUTH_STATUS_METADATA_ROW_LIMIT = 128;

function authStatusDigest(label: string, ...parts: readonly string[]): string {
	return createHash("sha256")
		.update([`browser-use.auth-status.${label}.v1`, ...parts].join("\0"))
		.digest("hex");
}

function hasExactMetadataKeys(
	value: unknown,
	keys: readonly string[],
): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function isBoundedOpaqueMetadataId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		!value.includes("\uFFFD") &&
		secretShapeFindingOf(value) === undefined
	);
}

function exactActiveIdentity(
	value: unknown,
): BrowserUsePrincipalBoundBindingEvidence["identity"] | undefined {
	if (
		!hasExactMetadataKeys(value, [
			"service_account_id",
			"state",
			"type",
		]) ||
		!isBoundedOpaqueMetadataId(value.service_account_id) ||
		value.state !== "ACTIVE" ||
		value.type !== "SERVICE_ACCOUNT"
	) {
		return undefined;
	}
	return {
		service_account_id: value.service_account_id,
		state: "ACTIVE",
		type: "SERVICE_ACCOUNT",
	};
}

function exactVaults(
	value: unknown,
): BrowserUsePrincipalBoundBindingEvidence["vaults"] | undefined {
	if (!Array.isArray(value) || value.length > AUTH_STATUS_METADATA_ROW_LIMIT) {
		return undefined;
	}
	const vaults: Array<{ vault_id: string }> = [];
	const seen = new Set<string>();
	for (const row of value) {
		if (
			!hasExactMetadataKeys(row, ["vault_id"]) ||
			!isBoundedOpaqueMetadataId(row.vault_id) ||
			seen.has(row.vault_id)
		) {
			return undefined;
		}
		seen.add(row.vault_id);
		vaults.push({ vault_id: row.vault_id });
	}
	return vaults;
}

function exactStatusBindingEvidence(value: unknown):
	| {
			identity: BrowserUsePrincipalBoundBindingEvidence["identity"];
			vaults: BrowserUsePrincipalBoundBindingEvidence["vaults"];
	  }
	| undefined {
	if (
		!hasExactMetadataKeys(value, ["identity", "vaults", "item_evidence"]) ||
		value.item_evidence !== null
	) {
		return undefined;
	}
	const identity = exactActiveIdentity(value.identity);
	const vaults = exactVaults(value.vaults);
	return identity === undefined || vaults === undefined
		? undefined
		: { identity, vaults };
}

function proofCoordinates(
	admission: Exclude<
		BrowserUseAuthLaneAdmission<BrowserUseTokenRetrievalPort>,
		{ kind: "blocked" }
	>,
	identity: BrowserUsePrincipalBoundBindingEvidence["identity"],
	vaultId: string,
): BrowserUseAuthStatusProofCoordinates {
	const laneDigest = authStatusDigest(
		"lane",
		admission.evidence.lane,
		admission.evidence.assurance,
		admission.evidence.native.verdict,
		...(admission.kind === "signed-admitted"
			? [admission.evidence.native.product_version]
			: [
					admission.evidence.environment.state,
					admission.evidence.environment.next_action,
				]),
	);
	const principalDigest = authStatusDigest(
		"principal",
		identity.service_account_id,
	);
	const vaultDigest = authStatusDigest("vault", vaultId);
	const profileDigest = authStatusDigest(
		"profile",
		AUTH_STATUS_PROFILE_ENVIRONMENT,
		AUTH_STATUS_PROFILE_NAME,
	);
	return {
		lane_digest: laneDigest,
		principal_digest: principalDigest,
		vault_digest: vaultDigest,
		profile_digest: profileDigest,
	};
}

/**
 * Inspect active principal and vault scope without exposing identifiers.
 *
 * The environment lane uses its principal-bound metadata batch. The signed
 * lane retains its executor-owned identity and vault calls. The narrowed port
 * type makes protected-field retrieval unavailable to this function.
 *
 * @param admission - One command-scoped admitted U4 lane snapshot
 * @returns Bounded identity and vault-scope status with no field values
 *
 * @example
 * ```typescript
 * const status = await inspectBrowserUseAuthMetadata(admission)
 * if (status.ok && status.vault_scope === "exactly-one") {
 *   // Continue composing read-only status evidence.
 * }
 * ```
 */
export async function inspectBrowserUseAuthMetadata(
	admission: Exclude<
		BrowserUseAuthLaneAdmission<BrowserUseTokenRetrievalPort>,
		{ kind: "blocked" }
	>,
): Promise<BrowserUseAuthMetadataStatus> {
	const tokenRetrieval: Pick<
		BrowserUseTokenRetrievalPort,
		"getBindingEvidence" | "getServiceAccountIdentity" | "listVaults"
	> = admission.tokenRetrieval;
	let identity: Awaited<
		ReturnType<BrowserUseTokenRetrievalPort["getServiceAccountIdentity"]>
	>;
	let vaults: Awaited<ReturnType<BrowserUseTokenRetrievalPort["listVaults"]>>;

	if (admission.kind === "environment-admitted") {
		if (tokenRetrieval.getBindingEvidence === undefined) {
			return {
				ok: false,
				service_account: "unavailable",
				vault_scope: "not-evaluated",
				blocked_cause: "capability-loss",
			};
		}
		const collected = await tokenRetrieval.getBindingEvidence({
			expected_vault_id: null,
			item_id: null,
		});
		if (!collected.ok) {
			const block = blockOfRetrievalRejection(collected.rejection);
			return {
				ok: false,
				service_account:
					collected.rejection.code === "output-shape-invalid"
						? "invalid"
						: "unavailable",
				vault_scope: "not-evaluated",
				blocked_cause: block.blocked_cause,
			};
		}
		const exact = exactStatusBindingEvidence(collected.evidence);
		if (exact === undefined) {
			return {
				ok: false,
				service_account: "invalid",
				vault_scope: "not-evaluated",
				blocked_cause: "capability-loss",
			};
		}
		identity = { ok: true, identity: exact.identity };
		vaults = { ok: true, vaults: exact.vaults };
	} else {
		identity = await tokenRetrieval.getServiceAccountIdentity();
		if (!identity.ok) {
			const block = blockOfRetrievalRejection(identity.rejection);
			return {
				ok: false,
				service_account:
					identity.rejection.code === "output-shape-invalid"
						? "invalid"
						: "unavailable",
				vault_scope: "not-evaluated",
				blocked_cause: block.blocked_cause,
			};
		}
		const exactIdentity = exactActiveIdentity(identity.identity);
		if (exactIdentity === undefined) {
			return {
				ok: false,
				service_account: "invalid",
				vault_scope: "not-evaluated",
				blocked_cause: "capability-loss",
			};
		}
		identity = { ok: true, identity: exactIdentity };
		vaults = await tokenRetrieval.listVaults();
	}

	if (!vaults.ok) {
		const block = blockOfRetrievalRejection(vaults.rejection);
		return {
			ok: false,
			service_account: "active",
			vault_scope: "not-evaluated",
			blocked_cause: block.blocked_cause,
		};
	}
	const exactListedVaults = exactVaults(vaults.vaults);
	if (exactListedVaults === undefined) {
		return {
			ok: false,
			service_account: "invalid",
			vault_scope: "not-evaluated",
			blocked_cause: "capability-loss",
		};
	}
	vaults = { ok: true, vaults: exactListedVaults };
	const onlyVault = vaults.vaults.length === 1 ? vaults.vaults[0] : undefined;
	return {
		ok: true,
		service_account: "active",
		vault_scope:
			vaults.vaults.length === 1
				? "exactly-one"
				: vaults.vaults.length === 0
					? "zero"
					: "multiple",
		proof_coordinates:
			onlyVault === undefined
				? null
				: proofCoordinates(admission, identity.identity, onlyVault.vault_id),
	};
}

// --- Internal helpers ---------------------------------------------------------

/** Structured clone of the one code-owned continuation for a cause (R21). */
function continuationOf(cause: BrowserUseAuthBlockedCause): BrowserUseAuthContinuation {
	return structuredClone(BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation);
}

/** `holder_id -> holderId` per the LeaseWriteClaim shape. */
function claimOf(lease: BrowserUseLeasePayload): LeaseWriteClaim {
	return {
		fencing_token: lease.fencing_token,
		activation_epoch: lease.activation_epoch,
		holderId: lease.holder_id,
	};
}

function leaseEventOutcomeOf(result: LeaseHeartbeatResult): BrowserUseLeaseEventOutcome {
	if (result.ok) {
		return {
			granted: true,
			event: { type: "lease-granted" },
			claim: claimOf(result.lease),
			lease: result.lease,
		};
	}
	if (result.code === "lease_held") {
		return {
			granted: false,
			event: { type: "lease-unavailable" },
			blocked_cause: "lease-unavailable",
			continuation: continuationOf("lease-unavailable"),
			holder: result.holder,
		};
	}
	// lease_store_failed and every heartbeat rejection (fencing/epoch stale,
	// expired, missing): the capability is gone mid-protocol, not resolvable
	// by waiting — blocked capability-loss in both admitting phases.
	return {
		granted: false,
		event: { type: "blocked", cause: "capability-loss" },
		blocked_cause: "capability-loss",
		continuation: continuationOf("capability-loss"),
		message: result.message,
	};
}

function preparationBlock(
	cause: BrowserUsePreparationBlockedCause,
	continuation: BrowserUseAuthContinuation,
	detail: BrowserUsePreparationBlockDetail,
): BrowserUseSecretFreePreparationOutcome {
	return {
		ok: false,
		event: { type: "blocked", cause },
		continuation: structuredClone(continuation),
		detail,
	};
}

function preparationComplete(
	binding: BrowserUseItemBinding | null,
): BrowserUseSecretFreePreparationOutcome {
	return { ok: true, event: { type: "preparation-complete" }, binding };
}

// AE2 tail: a caller-injected Item Binding is untrusted cache data — a direct
// cache edit must fail validateItemBindingShape admission fail-closed before
// any gate or Port call. The refusal names the first issue code only (a
// closed vocabulary), never a path, so an attacker-chosen key name or value
// can never echo.
function bindingAdmissionFailure(binding: unknown): string | null {
	const issues = validateItemBindingShape(binding);
	const first = issues[0];
	if (first === undefined) return null;
	return `the injected item binding failed shape admission (${first.code}).`;
}

// Map one Port rejection onto its blocked state via the op module's single
// owner, then attach the projection detail the cause warrants.
function retrievalBlock(
	rejection: BrowserUseTokenRetrievalRejection,
	repairHint: BrowserUseBindingRepairHint,
): BrowserUseSecretFreePreparationOutcome {
	const block = blockOfRetrievalRejection(rejection);
	switch (block.blocked_cause) {
		case "capability-loss":
			return preparationBlock(block.blocked_cause, block.continuation, {
				kind: "capability",
				message: rejection.message,
			});
		case "unsupported-method":
			return preparationBlock(block.blocked_cause, block.continuation, {
				kind: "method",
			});
		case "revoked-binding":
			return preparationBlock(block.blocked_cause, block.continuation, {
				kind: "binding-repair",
				repair_hint: repairHint,
				stale_state: null,
			});
		default:
			return preparationBlock(block.blocked_cause, block.continuation, {
				kind: "token",
				rejection,
			});
	}
}

// --- Factory ------------------------------------------------------------------

/**
 * Create the auth provider over one injected deps value. All methods return
 * typed outcomes; missing native capability is a LEGAL blocked state with an
 * existing cause-table continuation, never a throw.
 *
 * @param deps - Injected store, token-retrieval Port, attestation lookup
 * @returns The provider surface
 */
export function createBrowserUseAuthProvider(
	deps: BrowserUseAuthProviderDeps,
): BrowserUseAuthProvider {
	const tokenRetrieval = deps.admission.tokenRetrieval;

	async function collectBindingEvidence(input: {
		expected_vault_id: string | null;
		item_id: string | null;
	}): Promise<
		| { ok: true; evidence: BrowserUsePrincipalBoundBindingEvidence }
		| { ok: false; rejection: BrowserUseTokenRetrievalRejection }
	> {
		if (deps.admission.kind === "environment-admitted") {
			if (tokenRetrieval.getBindingEvidence === undefined) {
				return {
					ok: false,
					rejection: {
						code: "capability-missing",
						message:
							"the environment token lane cannot collect principal-bound binding evidence.",
					},
				};
			}
			return tokenRetrieval.getBindingEvidence(input);
		}

		// The signed-native lane retains its existing executor-owned proof path.
		// Its native product owns principal consistency; the environment lane's
		// lower-assurance descriptor batch is neither available nor required.
		const identity = await tokenRetrieval.getServiceAccountIdentity();
		if (!identity.ok) return identity;
		const vaults = await tokenRetrieval.listVaults();
		if (!vaults.ok) return vaults;
		let itemEvidence: BrowserUsePrincipalBoundBindingEvidence["item_evidence"] =
			null;
		if (vaults.vaults.length === 1) {
			const liveVault = vaults.vaults[0];
			if (
				liveVault !== undefined &&
				(input.expected_vault_id === null ||
					input.expected_vault_id === liveVault.vault_id)
			) {
				if (input.item_id === null) {
					const listed = await tokenRetrieval.listLoginItems({
						vault_id: liveVault.vault_id,
					});
					if (!listed.ok) return listed;
					itemEvidence = { kind: "list", items: listed.items };
				} else {
					const item = await tokenRetrieval.getLoginItem({
						vault_id: liveVault.vault_id,
						item_id: input.item_id,
					});
					if (!item.ok) return item;
					itemEvidence = { kind: "exact", item: item.item };
				}
			}
		}
		return {
			ok: true,
			evidence: {
				identity: identity.identity,
				vaults: vaults.vaults,
				item_evidence: itemEvidence,
			},
		};
	}

	function integrationPortFor(claim: LeaseWriteClaim): BrowserUseRunIntegrationPort {
		return createRunIntegrationPort(
			deps.store,
			createBrowserUseAuthContract({
				attestationByDigest: deps.attestationByDigest,
			}),
			claim,
		);
	}

	async function prepareSecretFree(
		input: BrowserUseSecretFreePreparationInput,
	): Promise<BrowserUseSecretFreePreparationOutcome> {
		const repairHint: BrowserUseBindingRepairHint = {
			legacy_vault_name: input.candidate_hint?.legacy_vault_name ?? null,
		};

		// Gate 0 — binding shape admission (AE2 tail): a cache-edited binding
		// fails closed here with zero Port calls; nothing downstream ever sees
		// an unvalidated injected binding.
		if (input.binding !== null) {
			const refusal = bindingAdmissionFailure(input.binding);
			if (refusal !== null) {
				return preparationBlock(
					"capability-loss",
					continuationOf("capability-loss"),
					{ kind: "capability", message: refusal },
				);
			}
		}

		// Gate 1 — method admission. session-reuse completes with zero Port
		// calls; user-presence is unsupported-method in preparation (D5, R13);
		// an existing binding must list the method. A first bind with
		// password/otp defers admission to the live-matched binding below.
		if (
			input.method === "session-reuse" ||
			input.method === "user-presence" ||
			input.binding !== null
		) {
			const admitted = assessBindingMethod(input.binding, input.method);
			if (!admitted.ok) {
				return preparationBlock(admitted.blocked_cause, admitted.continuation, {
					kind: "method",
				});
			}
			if (input.method === "session-reuse") return preparationComplete(null);
		}

		// Gates 2-5 execute under one native-held token descriptor. Separate OP
		// processes may run inside that supervisor, but token-path replacement
		// cannot compose principal A with vault or item evidence from principal B.
		if (
			deps.admission.kind === "environment-admitted" &&
			tokenRetrieval.getBindingEvidence === undefined
		) {
			return preparationBlock(
				"capability-loss",
				continuationOf("capability-loss"),
				{
					kind: "capability",
					message:
						"the environment token lane cannot collect principal-bound binding evidence.",
				},
			);
		}
		const collected = await collectBindingEvidence({
			expected_vault_id: input.binding?.vault_id ?? null,
			item_id: input.binding?.item_id ?? null,
		});
		if (!collected.ok) return retrievalBlock(collected.rejection, repairHint);
		const { identity, vaults, item_evidence: itemEvidence } = collected.evidence;
		if (
			input.binding !== null &&
			input.binding.service_account_id !==
				identity.service_account_id
		) {
			return preparationBlock(
				"capability-loss",
				continuationOf("capability-loss"),
				{
					kind: "capability",
					message: "the live service-account identity changed.",
				},
			);
		}

		// Gate 3 — vault-scope proof (R8/AE2): 0 or 2+ visible vaults fail
		// before item discovery is ever reached.
		const scope = proveVaultScope(vaults);
		if (!scope.ok) {
			return preparationBlock("invalid-vault-scope", scope.continuation, {
				kind: "vault-scope",
				visible_count: scope.visible_count,
			});
		}

		if (input.binding !== null) {
			// Gate 4 pre-check — Gate 3 proved exactly ONE visible vault, and
			// that proof is the only authority an op read may act under: a
			// binding naming any other vault is stale against the proven grant
			// (mirrors assessBindingUsability's vault-mismatch => "moved") and
			// fails closed on the repair path WITHOUT issuing a Port read
			// outside the proven scope.
			if (input.binding.vault_id !== scope.vault_id) {
				return preparationBlock(
					"revoked-binding",
					continuationOf("revoked-binding"),
					{ kind: "binding-repair", repair_hint: repairHint, stale_state: "moved" },
				);
			}
			if (itemEvidence?.kind !== "exact") {
				return preparationBlock(
					"capability-loss",
					continuationOf("capability-loss"),
					{
						kind: "capability",
						message:
							"the principal-bound evidence omitted the exact bound item.",
					},
				);
			}
			const usability = assessBindingUsability(input.binding, {
				item: itemEvidence.item,
			});
			if (!usability.usable) {
				return preparationBlock(usability.blocked_cause, usability.continuation, {
					kind: "binding-repair",
					repair_hint: repairHint,
					stale_state: usability.stale_state,
				});
			}
			return preparationComplete(usability.binding);
		}

		// Gate 5 — first bind: one discovery, then the single-owner match
		// policy. The hint ranks; it never authorizes (SD1).
		if (itemEvidence?.kind !== "list") {
			return preparationBlock(
				"capability-loss",
				continuationOf("capability-loss"),
				{
					kind: "capability",
					message:
						"the principal-bound evidence omitted login-item discovery.",
				},
			);
		}
		const match = matchItemBinding({
			service_id: input.service_id,
			service_account_id: identity.service_account_id,
			auth_context: input.auth_context,
			target_origins: input.target_origins,
			login_path: input.login_path,
			vault_id: scope.vault_id,
			items: itemEvidence.items,
			hint: input.candidate_hint,
		});
		if (match.kind === "bound") {
			const admitted = assessBindingMethod(match.binding, input.method);
			if (!admitted.ok) {
				return preparationBlock(admitted.blocked_cause, admitted.continuation, {
					kind: "method",
				});
			}
			return preparationComplete(match.binding);
		}
		if (match.kind === "missing-item") {
			return preparationBlock(match.blocked_cause, match.continuation, {
				kind: "binding-repair",
				repair_hint: match.repair_hint,
				stale_state: null,
			});
		}
		if (match.kind === "ambiguous-selection") {
			return preparationBlock(match.blocked_cause, match.continuation, {
				kind: "selection",
				selection: match.selection,
			});
		}
		// match_input_invalid is a composition bug, not a user state; fail
		// closed as capability-loss so the transaction still has a legal block.
		return preparationBlock("capability-loss", continuationOf("capability-loss"), {
			kind: "capability",
			message: match.rejection.message,
		});
	}

	async function prepareGenerationBinding(input: {
		resolution: BrowserUseResolvedAuthCandidate;
		target_origins: readonly string[];
		login_path: string | null;
		method: BrowserUseLaneAuthMethod;
	}): Promise<BrowserUseSecretFreePreparationOutcome> {
		if (deps.bindingStore === undefined) {
			return preparationBlock(
				"capability-loss",
				continuationOf("capability-loss"),
				{
					kind: "capability",
					message: "the host binding cache is unavailable.",
				},
			);
		}
			const loaded = await deps.bindingStore.load(input.resolution);
			if (!loaded.ok) {
				if (loaded.failure.code === "auth_binding_cache_stale") {
					const invalidated = await deps.bindingStore.invalidate(
						input.resolution,
					);
					if (!invalidated.ok) {
						return preparationBlock(
							"capability-loss",
							continuationOf("capability-loss"),
							{
								kind: "capability",
								message: invalidated.failure.message,
							},
						);
					}
					return preparationBlock(
						"revoked-binding",
						continuationOf("revoked-binding"),
						{
							kind: "binding-repair",
							repair_hint: {
								legacy_vault_name:
									input.resolution.candidate.legacy_vault_name,
							},
							stale_state: null,
						},
					);
				} else {
					return preparationBlock(
						"capability-loss",
						continuationOf("capability-loss"),
						{ kind: "capability", message: loaded.failure.message },
					);
				}
			}
			const cachedBinding = loaded.binding;
			// Host cache is a hint, never selection authority. Always repeat the
			// unique live match so zero/multiple candidates cannot be bypassed.
			const prepared = await prepareSecretFree({
				service_id: input.resolution.candidate.service_id,
				auth_context: input.resolution.candidate.auth_context,
				target_origins: input.target_origins,
				login_path: input.login_path,
				method: input.method,
				binding: null,
				candidate_hint: {
					hint_item_id: input.resolution.candidate.hint_item_id,
					legacy_vault_name:
						input.resolution.candidate.legacy_vault_name,
				},
			});
			if (!prepared.ok || prepared.binding === null) return prepared;
			if (
				cachedBinding !== null &&
				!itemBindingsEqual(cachedBinding, prepared.binding)
			) {
				const invalidated = await deps.bindingStore.invalidate(
					input.resolution,
				);
				if (!invalidated.ok) {
					return preparationBlock(
						"capability-loss",
						continuationOf("capability-loss"),
						{
							kind: "capability",
							message: invalidated.failure.message,
						},
					);
				}
				return preparationBlock(
					"revoked-binding",
					continuationOf("revoked-binding"),
					{
						kind: "binding-repair",
						repair_hint: {
							legacy_vault_name:
								input.resolution.candidate.legacy_vault_name,
						},
						stale_state:
							cachedBinding.item_revision !==
							prepared.binding.item_revision
								? "revision-changed"
								: "moved",
					},
				);
			}
			if (cachedBinding !== null) return prepared;
			const saved = await deps.bindingStore.save({
				resolution: input.resolution,
				binding: prepared.binding,
		});
		if (!saved.ok) {
			return preparationBlock(
				"capability-loss",
				continuationOf("capability-loss"),
				{ kind: "capability", message: saved.failure.message },
			);
		}
		return prepared;
	}

	return {
		async acquireSensitiveIntervalLease(input) {
			return leaseEventOutcomeOf(
				await acquireLease(deps.store, {
					key: leaseKeyForRun(input.run),
					holderId: input.holder_id,
					ttlMs: input.ttl_ms,
					scope: input.scope,
				}),
			);
		},

		async heartbeatSensitiveIntervalLease(input) {
			return leaseEventOutcomeOf(
				await heartbeatLease(deps.store, input.lease, { ttlMs: input.ttl_ms }),
			);
		},

		async releaseSensitiveIntervalLease(input) {
			return await releaseLease(deps.store, input.lease);
		},

		integrationPortFor,

			prepareSecretFree,
			prepareGenerationBinding,

			async commitWithClaim(claim, input) {
			// Common-path pre-check: a stale claim gets a typed refusal without
			// entering the Port's throwing critical section (D8).
			const loaded = await loadSharedRun(deps.store, input.run_id);
			if (!loaded.ok) {
				return {
					ok: false,
					rejection: {
						code: "auth_commit_store_faulted",
						message: `auth commit could not load the run (${loaded.code}).`,
					},
				};
			}
			const gate = await validateStoredLeaseForWrite(deps.store, {
				key: leaseKeyForRun(loaded.run),
				presented: claim,
			});
			if (!gate.ok) {
				if (gate.code === "lease_store_failed") {
					return {
						ok: false,
						rejection: { code: "auth_commit_store_faulted", message: gate.message },
					};
				}
				return {
					ok: false,
					rejection: {
						code: "auth_commit_lease_rejected",
						message: `auth commit lease rejected (${gate.code}).`,
					},
				};
			}
			// The fragment passes through VERBATIM: no rewrite, no laundering —
			// a secret-shaped fragment dies in U2's own admission path.
			try {
				return await commitAuthTransaction(integrationPortFor(claim), input);
			} catch (error) {
				const raw =
					error instanceof Error
						? error.message
						: "auth commit failed for an unclassified reason.";
				// Embed only a screened message — a secret-shaped store detail is
				// withheld entirely, mirroring the op module's
				// sanitizedFailureMessage posture.
				const message =
					raw.length === 0 || secretShapeFindingOf(raw) !== undefined
						? "auth commit failure detail withheld; the reported detail was secret-shaped."
						: raw;
				// Typed classification (the #259 coded-error debt): the Port's
				// infrastructure error carries its machine `kind`; wording is
				// display data. Anything else that throws is a store fault.
				if (
					error instanceof BrowserUseAuthCommitInfrastructureError &&
					error.kind === "lease-rejected"
				) {
					return {
						ok: false,
						rejection: { code: "auth_commit_lease_rejected", message },
					};
				}
				return {
					ok: false,
					rejection: { code: "auth_commit_store_faulted", message },
				};
			}
		},

		buildAgentBrowserDeliveryContext(input): AgentBrowserAuthDeliveryContext {
			// wiring_spec item 3: the transaction supplies the VerifiedTarget and the
			// provider supplies the TokenRetrievalPort (the injected Port is the ONLY
			// credential capability, R7/R16). The context routes a confidential fill
			// through deliverConfidentialFields ONLY inside the sensitive interval;
			// outside it, in_sensitive_interval is false and the lane's typed refusal
			// stands unchanged. No secret material flows through this context — the
			// port yields opaque handles only.
			return {
				in_sensitive_interval: input.in_sensitive_interval,
				binding: input.binding,
				target: input.target,
				tokenRetrieval,
				deliver: input.deliver,
				reproveTarget: input.reproveTarget,
				field_by_ref: input.field_by_ref,
			};
		},
	};
}
