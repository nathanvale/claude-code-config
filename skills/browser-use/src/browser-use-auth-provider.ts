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

import type { BrowserUseLaneAuthMethod } from "./browser-use-adapter-model";
import {
	type BrowserUseAuthContractDeps,
	commitAuthTransaction,
	createBrowserUseAuthContract,
} from "./browser-use-auth";
import {
	type BrowserUseAuthContext,
	type BrowserUseBindingRepairHint,
	type BrowserUseBindingStaleState,
	type BrowserUseImportCandidate,
	type BrowserUseItemBinding,
	type BrowserUseRedactedSelectionOption,
	assessBindingMethod,
	assessBindingUsability,
	matchItemBinding,
	secretShapeFindingOf,
	validateItemBindingShape,
} from "./browser-use-auth-bindings";
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
	type BrowserUseSecretHandle,
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
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	attestationByDigest: BrowserUseAuthContractDeps["attestationByDigest"];
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
	retrieveCredentialField(input: {
		binding: BrowserUseItemBinding;
		field: BrowserUseOpCredentialField;
	}): Promise<
		| { ok: true; handle: BrowserUseSecretHandle }
		| {
				ok: false;
				event: { type: "blocked"; cause: "capability-loss" };
				continuation: BrowserUseAuthContinuation;
				rejection: BrowserUseTokenRetrievalRejection;
		  }
	>;
	commitWithClaim(
		claim: LeaseWriteClaim,
		input: {
			run_id: string;
			expected_revision: number;
			fragment: BrowserUseAuthTransactionFragment;
		},
	): Promise<BrowserUseProviderCommitOutcome>;
};

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

		// Gate 2 — token gate: a Port rejection blocks before ANY discovery.
		const vaults = await deps.tokenRetrieval.listVaults();
		if (!vaults.ok) return retrievalBlock(vaults.rejection, repairHint);

		// Gate 3 — vault-scope proof (R8/AE2): 0 or 2+ visible vaults fail
		// before item discovery is ever reached.
		const scope = proveVaultScope(vaults.vaults);
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
			// Gate 4 — exact bound-item read (R11): never a rescan, never an
			// auto-selected replacement.
			const read = await deps.tokenRetrieval.getLoginItem({
				vault_id: input.binding.vault_id,
				item_id: input.binding.item_id,
			});
			if (!read.ok) {
				if (read.rejection.code === "item-missing") {
					const usability = assessBindingUsability(input.binding, { item: null });
					if (!usability.usable) {
						return preparationBlock(
							usability.blocked_cause,
							usability.continuation,
							{
								kind: "binding-repair",
								repair_hint: repairHint,
								stale_state: usability.stale_state,
							},
						);
					}
					// A usable binding over an absent item is unrepresentable;
					// fail closed on the repair path.
					return preparationBlock(
						"revoked-binding",
						continuationOf("revoked-binding"),
						{ kind: "binding-repair", repair_hint: repairHint, stale_state: null },
					);
				}
				return retrievalBlock(read.rejection, repairHint);
			}
			const usability = assessBindingUsability(input.binding, { item: read.item });
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
		const listed = await deps.tokenRetrieval.listLoginItems({
			vault_id: scope.vault_id,
		});
		if (!listed.ok) return retrievalBlock(listed.rejection, repairHint);
		const match = matchItemBinding({
			service_id: input.service_id,
			auth_context: input.auth_context,
			target_origins: input.target_origins,
			login_path: input.login_path,
			vault_id: scope.vault_id,
			items: listed.items,
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

		async retrieveCredentialField(input) {
			// AE2 tail: the injected binding must pass shape admission before it
			// can reach the Port and shape an op invocation.
			const refusal = bindingAdmissionFailure(input.binding);
			if (refusal !== null) {
				return {
					ok: false,
					event: { type: "blocked", cause: "capability-loss" },
					continuation: continuationOf("capability-loss"),
					rejection: { code: "binding-shape-invalid", message: refusal },
				};
			}
			const fetched = await deps.tokenRetrieval.fetchCredentialField(input);
			if (fetched.ok) return { ok: true, handle: fetched.handle };
			// D6: missing-token is illegal in phase sensitive-interval; every
			// mid-interval retrieval failure is capability-loss.
			return {
				ok: false,
				event: { type: "blocked", cause: "capability-loss" },
				continuation: continuationOf("capability-loss"),
				rejection: fetched.rejection,
			};
		},

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
				// Classify on the raw message; embed only a screened one — a
				// secret-shaped store detail is withheld entirely, mirroring the
				// op module's sanitizedFailureMessage posture.
				const message =
					raw.length === 0 || secretShapeFindingOf(raw) !== undefined
						? "auth commit failure detail withheld; the reported detail was secret-shaped."
						: raw;
				if (raw.startsWith("auth commit lease rejected")) {
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
	};
}
