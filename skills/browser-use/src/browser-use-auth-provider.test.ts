import { afterAll, describe, expect, test } from "bun:test";
import { dirname } from "node:path";
import {
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
	type BrowserUseAuthTransactionFragment,
	validateAuthFragmentShape,
} from "./browser-use-auth-model";
import {
	type BrowserUseAuthProvider,
	type BrowserUseAuthProviderDeps,
	type BrowserUseLeaseEventOutcome,
	type BrowserUseSecretFreePreparationOutcome,
	createBrowserUseAuthProvider,
} from "./browser-use-auth-provider";
import type { BrowserUseResolvedAuthCandidate } from "./browser-use-auth-bindings";
import type { BrowserUseAuthBindingStore } from "./browser-use-auth-binding-store";
import { applyAuthTransition } from "./browser-use-auth-transaction";
import {
	acquireLease,
	advanceActivationEpoch,
	leaseRecordPath,
} from "./browser-use-locks";
import {
	type BrowserUsePlatformFs,
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import { createOpTokenRetrievalPort } from "./browser-use-op";
import type {
	BrowserUseAuthRunContinuation,
	BrowserUseSharedRun,
} from "./browser-use-run-model";
import {
	type RunStoreDeps,
	createSharedRun,
	leaseKeyForRun,
	loadSharedRun,
} from "./browser-use-runs";
import type { BrowserUseLeasePayload } from "./browser-use-schemas";

// =========================================================================
// Browser Authentication provider proof (auth U3a PR1; R7/R11/R16/R27, D5-D8).
//
// Seam proof: lease results map onto the exact transaction events U2 already
// admits (lease-granted / lease-unavailable / blocked capability-loss); the
// granted claim drives the run integration Port; the R8-ordered secret-free
// preparation gate blocks with the existing cause-table continuations before
// any wider discovery runs (token gate before vault proof before item reads,
// repair paths never rescan); mid-interval token loss is capability-loss,
// never missing-token (D6); and commitWithClaim converts the run store's
// throwing commit path into typed refusals (D8) without laundering fragments.
// =========================================================================

const TTL_MS = 5_000;
const ENVIRONMENT_PROFILE = {
	environment: "agent-chrome",
	profile: "default",
} as const;

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) {
		disposable.dispose();
	}
});

// --- Deps builders ----------------------------------------------------------

async function makeStoreDeps(
	clock: () => number,
	fsOverride?: BrowserUsePlatformFs,
): Promise<RunStoreDeps> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = fsOverride ?? createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return { fs, paths: opened.paths, clock };
}

type TokenPort = BrowserUseAuthProviderDeps["admission"]["tokenRetrieval"];
type PreparationInput = Parameters<BrowserUseAuthProvider["prepareSecretFree"]>[0];
type ItemBinding = NonNullable<PreparationInput["binding"]>;
type VaultItemEvidence = Extract<
	Awaited<ReturnType<TokenPort["getLoginItem"]>>,
	{ ok: true }
>["item"];

type TokenPortScript = {
	bindingEvidenceAvailable?: boolean;
	getServiceAccountIdentity?:
		| {
				ok: true;
				identity: {
					service_account_id: string;
					state: "ACTIVE";
					type: "SERVICE_ACCOUNT";
				};
		  }
		| readonly {
				ok: true;
				identity: {
					service_account_id: string;
					state: "ACTIVE";
					type: "SERVICE_ACCOUNT";
				};
		  }[];
	listVaults?: Awaited<ReturnType<TokenPort["listVaults"]>>;
	listLoginItems?: Awaited<ReturnType<TokenPort["listLoginItems"]>>;
	getLoginItem?: Awaited<ReturnType<TokenPort["getLoginItem"]>>;
	fetchCredentialField?: Awaited<ReturnType<TokenPort["fetchCredentialField"]>>;
};

function environmentAdmission(
	port: TokenPort,
): BrowserUseAuthProviderDeps["admission"] {
	return {
		kind: "environment-admitted",
		evidence: {
			lane: "environment-injected-op",
			assurance: "lower-assurance",
			native: { verdict: "native-capability-absent" },
			environment: {
				state: "ready",
				next_action: "validate-service-account",
			},
		},
		tokenRetrieval: port,
	};
}

// In-memory Port closure with per-method call counting (spec test idiom).
function makeTokenPort(script: TokenPortScript = {}): {
	port: TokenPort;
	calls: {
		getServiceAccountIdentity: number;
		listVaults: number;
		listLoginItems: number;
		getLoginItem: number;
		fetchCredentialField: number;
	};
	total(): number;
} {
	const calls = {
		getServiceAccountIdentity: 0,
		listVaults: 0,
		listLoginItems: 0,
		getLoginItem: 0,
		fetchCredentialField: 0,
	};
	const getServiceAccountIdentity = async () => {
		calls.getServiceAccountIdentity += 1;
		const scripted = script.getServiceAccountIdentity;
		if (Array.isArray(scripted)) {
			return (
				scripted[calls.getServiceAccountIdentity - 1] ??
				scripted.at(-1) ?? {
					ok: true as const,
					identity: {
						service_account_id: "service-account-1",
						state: "ACTIVE" as const,
						type: "SERVICE_ACCOUNT" as const,
					},
				}
			);
		}
		return (
			scripted ?? {
				ok: true as const,
				identity: {
					service_account_id: "service-account-1",
					state: "ACTIVE" as const,
					type: "SERVICE_ACCOUNT" as const,
				},
			}
		);
	};
	const listVaults = async () => {
		calls.listVaults += 1;
		return script.listVaults ?? { ok: true, vaults: [{ vault_id: "vault-1" }] };
	};
	const listLoginItems = async () => {
		calls.listLoginItems += 1;
		return script.listLoginItems ?? { ok: true, items: [] };
	};
	const getLoginItem = async () => {
		calls.getLoginItem += 1;
		return (
			script.getLoginItem ?? {
				ok: false as const,
				rejection: {
					code: "item-missing" as const,
					message: "the bound item is absent from the token-scoped vault.",
				},
			}
		);
	};
	const port = {
		async getBindingEvidence(input) {
			const identity = await getServiceAccountIdentity();
			if (!identity.ok) return identity;
			const vaults = await listVaults();
			if (!vaults.ok) return vaults;
			if (vaults.vaults.length !== 1) {
				return {
					ok: true as const,
					evidence: {
						identity: identity.identity,
						vaults: vaults.vaults,
						item_evidence: null,
					},
				};
			}
			const liveVault = vaults.vaults[0];
			if (
				liveVault === undefined ||
				(input.expected_vault_id !== null &&
					input.expected_vault_id !== liveVault.vault_id)
			) {
				return {
					ok: true as const,
					evidence: {
						identity: identity.identity,
						vaults: vaults.vaults,
						item_evidence: null,
					},
				};
			}
			if (input.item_id !== null) {
				const item = await getLoginItem();
				if (!item.ok) return item;
				return {
					ok: true as const,
					evidence: {
						identity: identity.identity,
						vaults: vaults.vaults,
						item_evidence: { kind: "exact" as const, item: item.item },
					},
				};
			}
			const items = await listLoginItems();
			if (!items.ok) return items;
			return {
				ok: true as const,
				evidence: {
					identity: identity.identity,
					vaults: vaults.vaults,
					item_evidence: { kind: "list" as const, items: items.items },
				},
			};
		},
		getServiceAccountIdentity,
		listVaults,
		listLoginItems,
		getLoginItem,
		async fetchCredentialField() {
			calls.fetchCredentialField += 1;
			return (
				script.fetchCredentialField ?? {
					ok: false,
					rejection: {
						code: "token-revoked",
						message: "the service-account token was revoked.",
					},
				}
			);
		},
	} satisfies TokenPort;
	return {
		port,
		calls,
		total: () =>
			calls.getServiceAccountIdentity +
			calls.listVaults +
			calls.listLoginItems +
			calls.getLoginItem +
			calls.fetchCredentialField,
	};
}

async function makeProvider(
	script: TokenPortScript = {},
	bindingStore?: BrowserUseAuthBindingStore,
): Promise<{
	provider: BrowserUseAuthProvider;
	store: RunStoreDeps;
	calls: ReturnType<typeof makeTokenPort>["calls"];
	total(): number;
	clock: ReturnType<typeof fixedClock>;
}> {
	const clock = fixedClock();
	const store = await makeStoreDeps(clock.now);
	const { port, calls, total } = makeTokenPort(script);
	if (script.bindingEvidenceAvailable === false) {
		delete port.getBindingEvidence;
	}
	const provider = createBrowserUseAuthProvider({
		store,
		admission: environmentAdmission(port),
		attestationByDigest: () => undefined,
		...(bindingStore === undefined ? {} : { bindingStore }),
	});
	return { provider, store, calls, total, clock };
}

// --- Fixture builders (canonical U2 values) ---------------------------------

function baseRun(
	overrides: Partial<BrowserUseSharedRun> = {},
): Omit<BrowserUseSharedRun, "revision"> {
	return {
		run_id: "run-1",
		state: "awaiting-auth",
		task_intent: "routine-automation",
		environment_profile: { ...ENVIRONMENT_PROFILE },
		adapter_id: "agent-browser",
		handoff_evidence_id: "evidence-1",
		mutation_dispatched: false,
		artifacts: [],
		continuation: {
			next_action_id: "continue-auth-transaction",
			summary: "The authentication transaction is mid-flight; continue it.",
		},
		...overrides,
	};
}

function baseFragment(
	overrides: Partial<BrowserUseAuthTransactionFragment> = {},
): BrowserUseAuthTransactionFragment {
	return {
		schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
		fragment_revision: 2,
		phase: "secret-free-preparation",
		status: "active",
		method: "password",
		method_step: null,
		binding: {
			run_id: "run-1",
			handoff_evidence_id: "evidence-1",
			lane_id: "agent-browser",
			environment: "agent-chrome",
			profile: "default",
			service_id: "oncore",
			auth_context: "timesheet",
			origin: "https://portal.example.com",
			target_id: "target-1",
			page_id: "page-1",
			frame_id: "frame-1",
		},
		attempt: {
			budget_key: "oncore::timesheet::https://portal.example.com",
			limit: 3,
			consumed: 0,
		},
		submission_started: false,
		external_effect: "none",
		submit_outcome: null,
		blocked_cause: null,
		continuation: null,
		terminal_outcome: null,
		identity_basis: null,
		identity_basis_digest: null,
		attestation_digest: null,
		fresh_until_epoch_ms: null,
		...overrides,
	};
}

function blockedLeaseFragment(): BrowserUseAuthTransactionFragment {
	return baseFragment({
		phase: "lease-request",
		status: "blocked",
		blocked_cause: "lease-unavailable",
		continuation: {
			...BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["lease-unavailable"].continuation,
		},
	});
}

function authContinuation(
	overrides: Partial<BrowserUseAuthRunContinuation> = {},
): BrowserUseAuthRunContinuation {
	return {
		schema_version: "1",
		kind: "auth",
		continuation_id: "continuation-1",
		run_id: "run-1",
		state: "pending",
		reason: "login-required",
		required_actor: "agent",
		safe_to_retry: false,
		checkpoint: "before-auth-delivery",
		expires_at_epoch_ms: 10_000,
		resume_action: {
			command: "run",
			args: ["resume", "--run", "run-1", "--json"],
		},
		bindings: {
			generation_id: "generation-1",
			activation_epoch: 2,
			route_digest: "a".repeat(64),
			lane_id: "agent-browser",
			adapter_id: "agent-browser",
			handoff_evidence_id: "evidence-1",
			environment: "agent-chrome",
			profile: "default",
			target_binding_id: "target-binding-1",
			expected_identity: {
				subject_ref: "subject-1",
				account_ref: "account-1",
				tenant_ref: "tenant-1",
			},
		},
		next_action_id: "resume-auth-continuation",
		summary: "Resume the exact authentication continuation.",
		...overrides,
	};
}

function basePreparationInput(
	overrides: Partial<PreparationInput> = {},
): PreparationInput {
	return {
		service_id: "oncore",
		auth_context: "interactive-login",
		target_origins: ["https://portal.example.com"],
		login_path: null,
		method: "password",
		binding: null,
		candidate_hint: null,
		...overrides,
	};
}

function baseBinding(overrides: Partial<ItemBinding> = {}): ItemBinding {
	return {
		service_id: "oncore",
		service_account_id: "service-account-1",
		auth_context: "interactive-login",
		allowed_origins: ["https://portal.example.com"],
		allowed_login_paths: [],
		vault_id: "vault-1",
		item_id: "item-1",
		item_revision: 7,
		allowed_auth_methods: ["password", "otp"],
		binding_revision: 1,
		...overrides,
	};
}

function baseEvidence(
	overrides: Partial<VaultItemEvidence> = {},
): VaultItemEvidence {
	return {
		item_id: "item-1",
		vault_id: "vault-1",
		item_revision: 7,
		origins: ["https://portal.example.com"],
		login_paths: [],
		supported_methods: ["password", "otp"],
		state: "active",
		...overrides,
	};
}

function baseResolution(
	overrides: Partial<BrowserUseResolvedAuthCandidate> = {},
): BrowserUseResolvedAuthCandidate {
	return {
		generation_id: "generation-a",
		activation_epoch: 4,
		auth_context_ref: "oncore-session",
		route_digest: "a".repeat(64),
		candidate_digest: "b".repeat(64),
		candidate: {
			candidate_id: "candidate-oncore",
			service_id: "oncore",
			auth_context: "interactive-login",
			legacy_context_prose: null,
			hint_item_id: null,
			proposed_origins: ["https://portal.example.com"],
			legacy_vault_name: null,
			provenance: "legacy-auth-pointer",
		},
		...overrides,
	};
}

// --- Narrowing helpers (fail loudly on the wrong variant) --------------------

function expectGranted(outcome: BrowserUseLeaseEventOutcome) {
	if (!outcome.granted) {
		throw new Error(`expected a granted lease, got ${outcome.blocked_cause}`);
	}
	return outcome;
}

function expectLeaseUnavailable(outcome: BrowserUseLeaseEventOutcome) {
	if (outcome.granted || outcome.blocked_cause !== "lease-unavailable") {
		throw new Error("expected a lease-unavailable outcome");
	}
	return outcome;
}

function expectLeaseCapabilityLoss(outcome: BrowserUseLeaseEventOutcome) {
	if (outcome.granted || outcome.blocked_cause !== "capability-loss") {
		throw new Error("expected a capability-loss lease outcome");
	}
	return outcome;
}

function expectPreparationBlocked(outcome: BrowserUseSecretFreePreparationOutcome) {
	if (outcome.ok) throw new Error("expected a blocked preparation outcome");
	return outcome;
}

// --- Lease result -> transaction event mapping -------------------------------

describe("acquireSensitiveIntervalLease (lease -> event mapping)", () => {
	test("a live foreign lease maps to the lease-unavailable event with the table continuation", async () => {
		const { provider, store } = await makeProvider();
		const seeded = await acquireLease(store, {
			key: leaseKeyForRun({ environment_profile: ENVIRONMENT_PROFILE }),
			holderId: "other-holder",
			ttlMs: TTL_MS,
		});
		expect(seeded.ok).toBe(true);

		const outcome = expectLeaseUnavailable(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		expect(outcome.event).toEqual({ type: "lease-unavailable" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["lease-unavailable"].continuation,
		);
		// Structured clone, never the shared table row itself.
		expect(outcome.continuation).not.toBe(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["lease-unavailable"].continuation,
		);
		expect(outcome.holder.holder_id).toBe("other-holder");
		expect(outcome.holder.live).toBe(true);

		// The transaction admits the event on a lease-request fragment and the
		// blocked fragment passes shape validation (fragment invariant intact).
		const applied = applyAuthTransition(
			baseFragment({ phase: "lease-request" }),
			outcome.event,
		);
		expect(applied.ok).toBe(true);
		if (applied.ok) {
			expect(applied.fragment.status).toBe("blocked");
			expect(applied.fragment.blocked_cause).toBe("lease-unavailable");
			expect(validateAuthFragmentShape(applied.fragment)).toEqual([]);
		}
	});

	test("a corrupt lease record (lease_store_failed) maps to blocked capability-loss, never a throw", async () => {
		const { provider, store } = await makeProvider();
		const key = leaseKeyForRun({ environment_profile: ENVIRONMENT_PROFILE });
		const recordPath = leaseRecordPath(store.paths, key);
		await store.fs.mkdir(dirname(recordPath), { recursive: true, mode: 0o700 });
		await store.fs.writeFileDurable(recordPath, "not a lease record", 0o600);

		const outcome = expectLeaseCapabilityLoss(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "capability-loss" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["capability-loss"].continuation,
		);
		expect(outcome.message.length).toBeGreaterThan(0);

		const applied = applyAuthTransition(
			baseFragment({ phase: "lease-request" }),
			outcome.event,
		);
		expect(applied.ok).toBe(true);
	});

	test("a granted lease yields the claim that drives the integration Port", async () => {
		const { provider, store } = await makeProvider();
		const created = await createSharedRun(store, baseRun());
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error("unreachable");

		const outcome = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: created.run,
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		expect(outcome.event).toEqual({ type: "lease-granted" });
		expect(outcome.claim).toEqual({
			fencing_token: outcome.lease.fencing_token,
			activation_epoch: outcome.lease.activation_epoch,
			holderId: outcome.lease.holder_id,
		});
		expect(outcome.lease.holder_id).toBe("auth-transaction");

		// The event advances a lease-request fragment into the sensitive interval.
		const applied = applyAuthTransition(
			baseFragment({ phase: "lease-request" }),
			outcome.event,
		);
		expect(applied.ok).toBe(true);
		if (applied.ok) expect(applied.fragment.phase).toBe("sensitive-interval");

		// The claim gates the durable commit for the run behind leaseKeyForRun.
		const committed = await provider.commitWithClaim(outcome.claim, {
			run_id: "run-1",
			expected_revision: 1,
			fragment: baseFragment(),
			continuation: authContinuation(),
		});
		expect(committed.ok).toBe(true);
		if (committed.ok && "run" in committed) {
			expect(committed.run.revision).toBe(2);
			expect(committed.run.continuation).toEqual(authContinuation());
		}
	});
});

describe("heartbeat/release (sensitive-interval custody)", () => {
	test("a fresh claim heartbeats to a granted outcome", async () => {
		const { provider } = await makeProvider();
		const acquired = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		const extended = expectGranted(
			await provider.heartbeatSensitiveIntervalLease({
				lease: acquired.lease,
				ttl_ms: TTL_MS,
			}),
		);
		expect(extended.claim.holderId).toBe("auth-transaction");
	});

	test("every heartbeat failure maps to blocked capability-loss; release is always ok", async () => {
		const { provider, store, clock } = await makeProvider();

		// lease_fencing_stale: a tampered claim never silently extends.
		const fencing = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: {
					environment_profile: { environment: "agent-chrome", profile: "hb-fencing" },
				},
				holder_id: "holder-fencing",
				ttl_ms: TTL_MS,
			}),
		);
		const fencingStale = expectLeaseCapabilityLoss(
			await provider.heartbeatSensitiveIntervalLease({
				lease: { ...fencing.lease, fencing_token: fencing.lease.fencing_token + 1 },
				ttl_ms: TTL_MS,
			}),
		);
		expect(fencingStale.event).toEqual({ type: "blocked", cause: "capability-loss" });

		// lease_epoch_stale: an epoch advance fences the pre-advance holder.
		const epoch = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: {
					environment_profile: { environment: "agent-chrome", profile: "hb-epoch" },
				},
				holder_id: "holder-epoch",
				ttl_ms: TTL_MS,
			}),
		);
		const advanced = await advanceActivationEpoch(store, { expectedEpoch: 1 });
		expect(advanced.ok).toBe(true);
		const epochStale = expectLeaseCapabilityLoss(
			await provider.heartbeatSensitiveIntervalLease({
				lease: epoch.lease,
				ttl_ms: TTL_MS,
			}),
		);
		expect(epochStale.event).toEqual({ type: "blocked", cause: "capability-loss" });

		// lease_expired: past the ttl the claim is dead.
		const expiring = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: {
					environment_profile: { environment: "agent-chrome", profile: "hb-expired" },
				},
				holder_id: "holder-expired",
				ttl_ms: TTL_MS,
			}),
		);
		clock.advance(TTL_MS + 1);
		const expired = expectLeaseCapabilityLoss(
			await provider.heartbeatSensitiveIntervalLease({
				lease: expiring.lease,
				ttl_ms: TTL_MS,
			}),
		);
		expect(expired.event).toEqual({ type: "blocked", cause: "capability-loss" });

		// lease_missing: no durable record backs the claim.
		const fabricated: BrowserUseLeasePayload = {
			key: leaseKeyForRun({
				environment_profile: { environment: "agent-chrome", profile: "hb-missing" },
			}),
			holder_id: "holder-missing",
			fencing_token: 1,
			activation_epoch: 1,
			acquired_at_epoch_ms: 1_000,
			heartbeat_at_epoch_ms: 1_000,
			expires_at_epoch_ms: 999_000,
			recovered_from: null,
			scope: {},
		};
		const missing = expectLeaseCapabilityLoss(
			await provider.heartbeatSensitiveIntervalLease({
				lease: fabricated,
				ttl_ms: TTL_MS,
			}),
		);
		expect(missing.event).toEqual({ type: "blocked", cause: "capability-loss" });
		expect(missing.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["capability-loss"].continuation,
		);

		// Release is idempotent for live, expired, and fabricated leases alike.
		expect(await provider.releaseSensitiveIntervalLease({ lease: fencing.lease })).toEqual(
			{ ok: true },
		);
		expect(await provider.releaseSensitiveIntervalLease({ lease: fencing.lease })).toEqual(
			{ ok: true },
		);
		expect(
			await provider.releaseSensitiveIntervalLease({ lease: expiring.lease }),
		).toEqual({ ok: true });
		expect(
			await provider.releaseSensitiveIntervalLease({ lease: fabricated }),
		).toEqual({ ok: true });
	});
});

// --- prepareSecretFree gate order (R8/R11, AE2, D5) --------------------------

describe("prepareSecretFree gate order", () => {
	test("signed admission exact-binding proof uses item-get and never item-list", async () => {
		const store = await makeStoreDeps(fixedClock().now);
		const calls: string[] = [];
		const port = createOpTokenRetrievalPort({
			token_handle_id: "signed-token-handle",
			async execute(spec) {
				calls.push(spec.argv.slice(0, 3).join(" "));
				if (spec.argv[1] === "user") {
					return {
						kind: "json-evidence",
						value: {
							id: "service-account-1",
							state: "ACTIVE",
							type: "SERVICE_ACCOUNT",
						},
					};
				}
				if (spec.argv[1] === "vault") {
					return { kind: "json-evidence", value: [{ id: "vault-1" }] };
				}
				return {
					kind: "json-evidence",
					value: {
						id: "item-1",
						version: 7,
						vault: { id: "vault-1" },
						category: "LOGIN",
						urls: [{ href: "https://portal.example.com" }],
					},
				};
			},
		});
		const provider = createBrowserUseAuthProvider({
			store,
			admission: {
				kind: "signed-admitted",
				evidence: {
					lane: "signed-native",
					assurance: "signed-native",
					native: { verdict: "admitted", product_version: "1.0.0" },
				},
				tokenRetrieval: port,
			},
			attestationByDigest: () => undefined,
		});

		const outcome = await provider.prepareSecretFree(
			basePreparationInput({ binding: baseBinding() }),
		);
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.binding?.service_account_id).toBe("service-account-1");
		expect(outcome.binding?.item_id).toBe("item-1");
		expect(calls).toEqual(["op user get", "op vault list", "op item get"]);
		expect(calls).not.toContain("op item list");
	});

	test("signed admission preserves a typed exact-item failure", async () => {
		const store = await makeStoreDeps(fixedClock().now);
		const calls: string[] = [];
		const port = createOpTokenRetrievalPort({
			token_handle_id: "signed-token-handle",
			async execute(spec) {
				calls.push(spec.argv.slice(0, 3).join(" "));
				if (spec.argv[1] === "user") {
					return {
						kind: "json-evidence",
						value: {
							id: "service-account-1",
							state: "ACTIVE",
							type: "SERVICE_ACCOUNT",
						},
					};
				}
				if (spec.argv[1] === "vault") {
					return { kind: "json-evidence", value: [{ id: "vault-1" }] };
				}
				return {
					kind: "op-failure",
					failure: {
						code: "item-missing",
						message: "the bound item is absent.",
					},
				};
			},
		});
		const provider = createBrowserUseAuthProvider({
			store,
			admission: {
				kind: "signed-admitted",
				evidence: {
					lane: "signed-native",
					assurance: "signed-native",
					native: { verdict: "admitted", product_version: "1.0.0" },
				},
				tokenRetrieval: port,
			},
			attestationByDigest: () => undefined,
		});

		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({ binding: baseBinding() }),
			),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "revoked-binding" });
		expect(outcome.detail).toMatchObject({
			kind: "binding-repair",
			stale_state: null,
		});
		expect(calls).toEqual(["op user get", "op vault list", "op item get"]);
	});

	test("a token failure blocks as missing-token before any discovery call", async () => {
		const { provider, calls } = await makeProvider({
			listVaults: {
				ok: false,
				rejection: { code: "token-invalid", message: "the token is invalid." },
			},
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({ binding: baseBinding() }),
			),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "missing-token" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["missing-token"].continuation,
		);
		expect(outcome.detail).toEqual({
			kind: "token",
			rejection: { code: "token-invalid", message: "the token is invalid." },
		});
		expect(calls.listVaults).toBe(1);
		expect(calls.listLoginItems).toBe(0);
		expect(calls.getLoginItem).toBe(0);
		expect(calls.fetchCredentialField).toBe(0);
	});

	test("two visible vaults block as invalid-vault-scope before item discovery (AE2)", async () => {
		const { provider, calls } = await makeProvider({
			listVaults: {
				ok: true,
				vaults: [{ vault_id: "vault-1" }, { vault_id: "vault-2" }],
			},
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({ binding: baseBinding() }),
			),
		);
		expect(outcome.event).toEqual({
			type: "blocked",
			cause: "invalid-vault-scope",
		});
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["invalid-vault-scope"].continuation,
		);
		expect(outcome.detail).toEqual({ kind: "vault-scope", visible_count: 2 });
		expect(calls.listLoginItems).toBe(0);
		expect(calls.getLoginItem).toBe(0);
	});

	test("a missing bound item repairs, never rescans (R11)", async () => {
		const { provider, calls } = await makeProvider({
			getLoginItem: {
				ok: false,
				rejection: {
					code: "item-missing",
					message: "the bound item is absent from the token-scoped vault.",
				},
			},
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({
					binding: baseBinding(),
					candidate_hint: { hint_item_id: null, legacy_vault_name: "Old Vault" },
				}),
			),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "revoked-binding" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["revoked-binding"].continuation,
		);
		if (outcome.detail.kind !== "binding-repair") {
			throw new Error("expected a binding-repair detail");
		}
		// The legacy vault name travels as a module-result repair hint only —
		// never inside the fragment continuation (D2).
		expect(outcome.detail.repair_hint).toEqual({ legacy_vault_name: "Old Vault" });
		expect(JSON.stringify(outcome.continuation)).not.toContain("Old Vault");
		expect(calls.getLoginItem).toBe(1);
		expect(calls.listLoginItems).toBe(0);
	});

	test("a binding naming a vault outside the proven scope blocks revoked-binding with zero item reads", async () => {
		// Gate 3 proves vault-1 is the ONLY visible vault; a binding pointing
		// anywhere else must fail closed on the repair path BEFORE any op read
		// escapes the proven scope.
		const { provider, calls } = await makeProvider();
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({
					binding: baseBinding({ vault_id: "vault-elsewhere" }),
					candidate_hint: { hint_item_id: null, legacy_vault_name: "Old Vault" },
				}),
			),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "revoked-binding" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["revoked-binding"].continuation,
		);
		if (outcome.detail.kind !== "binding-repair") {
			throw new Error("expected a binding-repair detail");
		}
		expect(outcome.detail.stale_state).toBe("moved");
		expect(outcome.detail.repair_hint).toEqual({ legacy_vault_name: "Old Vault" });
		// The scope proof ran, but NO item read or rescan ever left the
		// proven vault: the mismatch blocks before the Port is consulted.
		expect(calls.listVaults).toBe(1);
		expect(calls.getLoginItem).toBe(0);
		expect(calls.listLoginItems).toBe(0);
		expect(calls.fetchCredentialField).toBe(0);
	});

	test("a usable existing binding completes preparation via the exact read", async () => {
		const { provider, calls } = await makeProvider({
			getLoginItem: { ok: true, item: baseEvidence() },
		});
		const outcome = await provider.prepareSecretFree(
			basePreparationInput({ binding: baseBinding() }),
		);
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			expect(outcome.event).toEqual({ type: "preparation-complete" });
			expect(outcome.binding).not.toBeNull();
		}
		expect(calls.getLoginItem).toBe(1);
		expect(calls.listLoginItems).toBe(0);
	});

	test("session-reuse short-circuits with zero Port calls", async () => {
		const { provider, total } = await makeProvider();
		const outcome = await provider.prepareSecretFree(
			basePreparationInput({ method: "session-reuse" }),
		);
		expect(outcome).toEqual({
			ok: true,
			event: { type: "preparation-complete" },
			binding: null,
		});
		expect(total()).toBe(0);
	});

	test("user-presence blocks as unsupported-method in preparation; user-presence-required is illegal there (D5)", async () => {
		const { provider, total } = await makeProvider();
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({ method: "user-presence" }),
			),
		);
		expect(outcome.event).toEqual({
			type: "blocked",
			cause: "unsupported-method",
		});
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["unsupported-method"].continuation,
		);
		expect(total()).toBe(0);

		// The transaction admits the provider's event from preparation...
		const admitted = applyAuthTransition(baseFragment(), outcome.event);
		expect(admitted.ok).toBe(true);

		// ...and rejects a hand-built user-presence-required block in that phase,
		// proving D5 is forced by the phase table, not stylistic.
		const rejected = applyAuthTransition(baseFragment(), {
			type: "blocked",
			cause: "user-presence-required",
		});
		expect(rejected.ok).toBe(false);
		if (!rejected.ok) {
			expect(rejected.rejection.code).toBe("auth_blocked_cause_illegal");
		}
	});

	test("an edited cached binding fails shape admission with zero Port calls (AE2)", async () => {
		const { provider, total } = await makeProvider();
		const edited = {
			...baseBinding(),
			password: "hunter2-sentinel",
		} as unknown as ItemBinding;
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(basePreparationInput({ binding: edited })),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "capability-loss" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["capability-loss"].continuation,
		);
		if (outcome.detail.kind !== "capability") {
			throw new Error("expected a capability detail");
		}
		expect(outcome.detail.message).toContain("binding_key_set_invalid");
		expect(JSON.stringify(outcome)).not.toContain("hunter2-sentinel");
		expect(total()).toBe(0);

		// A secret-shaped item_id also fails admission before any Port call.
		const secretOutcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({
					binding: baseBinding({ item_id: "op://Private/GitHub/password" }),
				}),
			),
		);
		expect(secretOutcome.event).toEqual({
			type: "blocked",
			cause: "capability-loss",
		});
		expect(JSON.stringify(secretOutcome)).not.toContain("op://");
		expect(total()).toBe(0);
	});

	test("an ambient OP_SERVICE_ACCOUNT_TOKEN is inert (R7/R16)", async () => {
		// Mutates process-global env with a finally-restore: safe only while
		// this file's tests run serially (bun:test default). A concurrent
		// runner would leak the sentinel across tests.
		const sentinel = "ambient-op-token-sentinel-9f2c";
		const script: TokenPortScript = {
			listVaults: {
				ok: false,
				rejection: { code: "token-invalid", message: "the token is invalid." },
			},
		};
		const unseeded = await makeProvider(script);
		const baseline = await unseeded.provider.prepareSecretFree(
			basePreparationInput(),
		);
		const previous = process.env.OP_SERVICE_ACCOUNT_TOKEN;
		process.env.OP_SERVICE_ACCOUNT_TOKEN = sentinel;
		try {
			const seededProvider = await makeProvider(script);
			const seeded = await seededProvider.provider.prepareSecretFree(
				basePreparationInput(),
			);
			expect(seeded).toEqual(baseline);
			expect(JSON.stringify(seeded)).not.toContain(sentinel);
		} finally {
			if (previous === undefined) {
				delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
			} else {
				process.env.OP_SERVICE_ACCOUNT_TOKEN = previous;
			}
		}
	});

	test("caller identity never changes preparation outcomes (R27)", async () => {
		const script: TokenPortScript = {
			getLoginItem: { ok: true, item: baseEvidence() },
		};
		const a = await makeProvider(script);
		const b = await makeProvider(script);
		expectGranted(
			await a.provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "holder-a",
				ttl_ms: TTL_MS,
			}),
		);
		expectGranted(
			await b.provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "holder-b",
				ttl_ms: TTL_MS,
			}),
		);
		const input = basePreparationInput({ binding: baseBinding() });
		const outcomeA = await a.provider.prepareSecretFree(input);
		const outcomeB = await b.provider.prepareSecretFree(input);
		expect(outcomeA).toEqual(outcomeB);
	});
});

// --- prepareSecretFree Gate 5: first bind (SD1/SD6 at the provider seam) -----

describe("prepareSecretFree first bind (Gate 5)", () => {
	test("captured candidate loads and saves the host binding without field retrieval", async () => {
		const calls = { load: 0, save: 0, invalidate: 0 };
		const bindingStore: BrowserUseAuthBindingStore = {
			async load() {
				calls.load += 1;
				return { ok: true, binding: null };
			},
			async save() {
				calls.save += 1;
				return { ok: true };
			},
			async invalidate() {
				calls.invalidate += 1;
				return { ok: true };
			},
		};
		const { provider, calls: opCalls } = await makeProvider(
			{
				listLoginItems: { ok: true, items: [baseEvidence()] },
			},
			bindingStore,
		);
		const resolution: BrowserUseResolvedAuthCandidate = {
			generation_id: "generation-a",
			activation_epoch: 4,
			auth_context_ref: "oncore-session",
			route_digest: "a".repeat(64),
			candidate_digest: "b".repeat(64),
			candidate: {
				candidate_id: "candidate-oncore",
				service_id: "oncore",
				auth_context: "interactive-login",
				legacy_context_prose: null,
				hint_item_id: null,
				proposed_origins: ["https://portal.example.com"],
				legacy_vault_name: null,
				provenance: "legacy-auth-pointer",
			},
		};
		const outcome = await provider.prepareGenerationBinding({
			resolution,
			target_origins: ["https://portal.example.com"],
			login_path: null,
			method: "password",
		});
		expect(outcome.ok).toBe(true);
		expect(calls).toEqual({ load: 1, save: 1, invalidate: 0 });
		expect(opCalls.getServiceAccountIdentity).toBe(1);
		expect(opCalls.listLoginItems).toBe(1);
		expect(opCalls.getLoginItem).toBe(0);
		expect(opCalls.fetchCredentialField).toBe(0);
	});

	test("stale generation cache blocks once, invalidates, then replaces after fresh proof", async () => {
		const calls = { load: 0, save: 0, invalidate: 0 };
		let stalePresent = true;
		const bindingStore: BrowserUseAuthBindingStore = {
			async load() {
				calls.load += 1;
				return stalePresent
					? {
							ok: false,
							failure: {
								code: "auth_binding_cache_stale",
								message: "the cached generation is stale.",
							},
						}
					: { ok: true, binding: null };
			},
			async save() {
				calls.save += 1;
				return { ok: true };
			},
			async invalidate() {
				calls.invalidate += 1;
				stalePresent = false;
				return { ok: true };
			},
		};
		const { provider, calls: opCalls } = await makeProvider(
			{ listLoginItems: { ok: true, items: [baseEvidence()] } },
			bindingStore,
		);

		const input = {
			resolution: baseResolution({
				generation_id: "generation-b",
				activation_epoch: 5,
			}),
			target_origins: ["https://portal.example.com"],
			login_path: null,
			method: "password" as const,
		};
		const outcome = await provider.prepareGenerationBinding(input);

		expect(outcome).toMatchObject({
			ok: false,
			event: { type: "blocked", cause: "revoked-binding" },
		});
		const repaired = await provider.prepareGenerationBinding(input);
		expect(repaired.ok).toBe(true);
		expect(calls).toEqual({ load: 2, save: 1, invalidate: 1 });
		expect(opCalls.getServiceAccountIdentity).toBe(1);
		expect(opCalls.listLoginItems).toBe(1);
		expect(opCalls.getLoginItem).toBe(0);
	});

	test("an unchanged live binding is not rewritten", async () => {
		const calls = { load: 0, save: 0, invalidate: 0 };
		const bindingStore: BrowserUseAuthBindingStore = {
			async load() {
				calls.load += 1;
				return { ok: true, binding: baseBinding() };
			},
			async save() {
				calls.save += 1;
				return { ok: true };
			},
			async invalidate() {
				calls.invalidate += 1;
				return { ok: true };
			},
		};
		const { provider } = await makeProvider(
			{ listLoginItems: { ok: true, items: [baseEvidence()] } },
			bindingStore,
		);

		const outcome = await provider.prepareGenerationBinding({
			resolution: baseResolution(),
			target_origins: ["https://portal.example.com"],
			login_path: null,
			method: "password",
		});

		expect(outcome.ok).toBe(true);
		expect(calls).toEqual({ load: 1, save: 0, invalidate: 0 });
	});

	test("a forged cached item cannot bypass fresh ambiguity detection", async () => {
		const calls = { load: 0, save: 0, invalidate: 0 };
		const bindingStore: BrowserUseAuthBindingStore = {
			async load() {
				calls.load += 1;
				return { ok: true, binding: baseBinding({ item_id: "item-2" }) };
			},
			async save() {
				calls.save += 1;
				return { ok: true };
			},
			async invalidate() {
				calls.invalidate += 1;
				return { ok: true };
			},
		};
		const { provider, calls: opCalls } = await makeProvider(
			{
				listLoginItems: {
					ok: true,
					items: [baseEvidence(), baseEvidence({ item_id: "item-2" })],
				},
			},
			bindingStore,
		);
		const outcome = await provider.prepareGenerationBinding({
			resolution: {
				generation_id: "generation-a",
				activation_epoch: 4,
				auth_context_ref: "oncore-session",
				route_digest: "a".repeat(64),
				candidate_digest: "b".repeat(64),
				candidate: {
					candidate_id: "candidate-oncore",
					service_id: "oncore",
					auth_context: "interactive-login",
					legacy_context_prose: null,
					hint_item_id: null,
					proposed_origins: ["https://portal.example.com"],
					legacy_vault_name: null,
					provenance: "legacy-auth-pointer",
				},
			},
			target_origins: ["https://portal.example.com"],
			login_path: null,
			method: "password",
		});
		expect(outcome).toMatchObject({
			ok: false,
			event: { type: "blocked", cause: "ambiguous-binding-selection" },
		});
		expect(calls).toEqual({ load: 1, save: 0, invalidate: 0 });
		expect(opCalls.listLoginItems).toBe(1);
		expect(opCalls.getLoginItem).toBe(0);
	});

	test("a stale cached binding blocks once, invalidates, then converges from fresh live proof", async () => {
		const calls = { load: 0, save: 0, invalidate: 0 };
		let stalePresent = true;
		const bindingStore: BrowserUseAuthBindingStore = {
			async load() {
				calls.load += 1;
				return {
					ok: true,
					binding: stalePresent
						? baseBinding({ item_id: "item-forged" })
						: null,
				};
			},
			async save() {
				calls.save += 1;
				return { ok: true };
			},
			async invalidate() {
				calls.invalidate += 1;
				stalePresent = false;
				return { ok: true };
			},
		};
		const { provider } = await makeProvider(
			{ listLoginItems: { ok: true, items: [baseEvidence()] } },
			bindingStore,
		);
		const outcome = await provider.prepareGenerationBinding({
			resolution: {
				generation_id: "generation-a",
				activation_epoch: 4,
				auth_context_ref: "oncore-session",
				route_digest: "a".repeat(64),
				candidate_digest: "b".repeat(64),
				candidate: {
					candidate_id: "candidate-oncore",
					service_id: "oncore",
					auth_context: "interactive-login",
					legacy_context_prose: null,
					hint_item_id: null,
					proposed_origins: ["https://portal.example.com"],
					legacy_vault_name: null,
					provenance: "legacy-auth-pointer",
				},
			},
			target_origins: ["https://portal.example.com"],
			login_path: null,
			method: "password",
		});
		expect(outcome).toMatchObject({
			ok: false,
			event: { type: "blocked", cause: "revoked-binding" },
			detail: { kind: "binding-repair" },
		});
		const repaired = await provider.prepareGenerationBinding({
			resolution: {
				generation_id: "generation-a",
				activation_epoch: 4,
				auth_context_ref: "oncore-session",
				route_digest: "a".repeat(64),
				candidate_digest: "b".repeat(64),
				candidate: {
					candidate_id: "candidate-oncore",
					service_id: "oncore",
					auth_context: "interactive-login",
					legacy_context_prose: null,
					hint_item_id: null,
					proposed_origins: ["https://portal.example.com"],
					legacy_vault_name: null,
					provenance: "legacy-auth-pointer",
				},
			},
			target_origins: ["https://portal.example.com"],
			login_path: null,
			method: "password",
		});
		expect(repaired.ok).toBe(true);
		expect(calls).toEqual({ load: 2, save: 1, invalidate: 1 });
	});

	test("one principal-bound evidence call supplies identity, vault scope, and first binding", async () => {
		const { provider, calls } = await makeProvider({
			listLoginItems: { ok: true, items: [baseEvidence()] },
		});
		const outcome = await provider.prepareSecretFree(basePreparationInput());
		expect(outcome.ok).toBe(true);
		if (outcome.ok) {
			expect(outcome.event).toEqual({ type: "preparation-complete" });
			expect(outcome.binding).toMatchObject({
				service_account_id: "service-account-1",
			});
			expect(outcome.binding?.item_id).toBe("item-1");
			expect(outcome.binding?.vault_id).toBe("vault-1");
		}
		expect(calls.getServiceAccountIdentity).toBe(1);
		expect(calls.listVaults).toBe(1);
		expect(calls.listLoginItems).toBe(1);
		expect(calls.getLoginItem).toBe(0);
		expect(calls.fetchCredentialField).toBe(0);
	});

	test("a lane without principal-bound evidence blocks before discovery", async () => {
		const { provider, calls } = await makeProvider({
			bindingEvidenceAvailable: false,
			listLoginItems: { ok: true, items: [baseEvidence()] },
		});
		const outcome = await provider.prepareSecretFree(basePreparationInput());
		expect(outcome).toMatchObject({
			ok: false,
			event: { type: "blocked", cause: "capability-loss" },
			detail: { kind: "capability" },
		});
		expect(calls.getServiceAccountIdentity).toBe(0);
		expect(calls.listVaults).toBe(0);
		expect(calls.listLoginItems).toBe(0);
		expect(calls.getLoginItem).toBe(0);
		expect(calls.fetchCredentialField).toBe(0);
	});

	test("principal-bound evidence from another account cannot validate a cached binding", async () => {
		const { provider, calls } = await makeProvider({
			getServiceAccountIdentity: {
				ok: true,
				identity: {
					service_account_id: "service-account-2",
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
			},
			getLoginItem: { ok: true, item: baseEvidence() },
		});
		const outcome = await provider.prepareSecretFree(
			basePreparationInput({ binding: baseBinding() }),
		);
		expect(outcome).toMatchObject({
			ok: false,
			event: { type: "blocked", cause: "capability-loss" },
			detail: { kind: "capability" },
		});
		expect(calls.getServiceAccountIdentity).toBe(1);
		expect(calls.listVaults).toBe(1);
		expect(calls.getLoginItem).toBe(1);
		expect(calls.fetchCredentialField).toBe(0);
	});

	test("two matching items block ambiguous-binding-selection with the redacted ranked list", async () => {
		const { provider, calls } = await makeProvider({
			listLoginItems: {
				ok: true,
				items: [baseEvidence(), baseEvidence({ item_id: "item-2" })],
			},
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(basePreparationInput()),
		);
		expect(outcome.event).toEqual({
			type: "blocked",
			cause: "ambiguous-binding-selection",
		});
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["ambiguous-binding-selection"]
				.continuation,
		);
		expect(outcome.detail).toEqual({
			kind: "selection",
			selection: [
				{
					item_id: "item-1",
					rank: 1,
					hinted: false,
					matched_origin: "https://portal.example.com",
				},
				{
					item_id: "item-2",
					rank: 2,
					hinted: false,
					matched_origin: "https://portal.example.com",
				},
			],
		});
		expect(calls.listLoginItems).toBe(1);
	});

	test("zero matches block revoked-binding carrying the legacy hint outside the continuation (SD6)", async () => {
		const { provider, calls } = await makeProvider({
			listLoginItems: { ok: true, items: [] },
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({
					candidate_hint: {
						hint_item_id: null,
						legacy_vault_name: "Old Personal",
					},
				}),
			),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "revoked-binding" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["revoked-binding"].continuation,
		);
		if (outcome.detail.kind !== "binding-repair") {
			throw new Error("expected a binding-repair detail");
		}
		expect(outcome.detail.repair_hint).toEqual({
			legacy_vault_name: "Old Personal",
		});
		expect(JSON.stringify(outcome.continuation)).not.toContain("Old Personal");
		expect(calls.listLoginItems).toBe(1);
	});

	test("a matched binding that excludes the requested method blocks unsupported-method", async () => {
		const { provider, calls } = await makeProvider({
			listLoginItems: {
				ok: true,
				items: [baseEvidence({ supported_methods: ["password"] })],
			},
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(basePreparationInput({ method: "otp" })),
		);
		expect(outcome.event).toEqual({
			type: "blocked",
			cause: "unsupported-method",
		});
		expect(outcome.detail).toEqual({ kind: "method" });
		expect(calls.listLoginItems).toBe(1);
	});

	test("a discovery rejection routes through the op blocked mapping", async () => {
		const { provider } = await makeProvider({
			listLoginItems: {
				ok: false,
				rejection: {
					code: "token-revoked",
					message: "the service-account token was revoked.",
				},
			},
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(basePreparationInput()),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "missing-token" });
		expect(outcome.continuation).toEqual(
			BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["missing-token"].continuation,
		);
	});

	test("broken composition input fails closed as capability-loss (match_input_invalid)", async () => {
		const { provider } = await makeProvider({
			listLoginItems: { ok: true, items: [] },
		});
		const outcome = expectPreparationBlocked(
			await provider.prepareSecretFree(
				basePreparationInput({
					target_origins: ["https://portal.example.com/login"],
				}),
			),
		);
		expect(outcome.event).toEqual({ type: "blocked", cause: "capability-loss" });
		if (outcome.detail.kind !== "capability") {
			throw new Error("expected a capability detail");
		}
	});
});

// --- Mid-interval retrieval (D6) ---------------------------------------------

describe("credential retrieval authority", () => {
	test("the U5 provider exposes no raw-binding field retrieval surface", async () => {
		const { provider } = await makeProvider();
		expect(provider).not.toHaveProperty("retrieveCredentialField");
	});
});

// --- commitWithClaim boundary (D8) -------------------------------------------

describe("commitWithClaim (throw -> typed refusal, D8)", () => {
	test("malformed runtime checkpoint input returns a typed refusal without writing", async () => {
		const { provider, store } = await makeProvider();
		const created = await createSharedRun(store, baseRun());
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error("unreachable");
		const granted = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: created.run,
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		const malformedFragment = {
			schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
			binding: null,
		} as unknown as BrowserUseAuthTransactionFragment;
		const fragmentResult = await provider.commitWithClaim(granted.claim, {
			run_id: "run-1",
			expected_revision: 1,
			fragment: malformedFragment,
		});
		expect(fragmentResult.ok).toBe(false);
		if (!fragmentResult.ok) {
			expect(fragmentResult.rejection.code).toBe("auth_fragment_invalid");
		}
		const continuationResult = await provider.commitWithClaim(granted.claim, {
			run_id: "run-1",
			expected_revision: 1,
			fragment: baseFragment(),
			continuation: {
				...authContinuation(),
				bindings: null,
			} as unknown as BrowserUseAuthRunContinuation,
		});
		expect(continuationResult.ok).toBe(false);
		if (!continuationResult.ok) {
			expect(continuationResult.rejection.code).toBe(
				"auth_fragment_not_committable",
			);
		}
		const loaded = await loadSharedRun(store, "run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.revision).toBe(1);
	});

	test("continuation generation, epoch, and target authority must match the loaded run", async () => {
		const { provider, store } = await makeProvider();
		const created = await createSharedRun(
			store,
			baseRun({
				task_intent: "runbook-execution",
				runbook_target_binding: {
					schema_version: "1",
					mode: "automatic",
					binding_id: "target-binding-1",
				},
				runbook_progress: {
					schema_version: "1",
					service_id: "oncore",
					flow_id: "fill-timesheet",
					runbook_version: "1.0.0",
					next_step: 0,
					total_steps: 2,
				},
				run_execution_binding: {
					schema_version: "1",
					generation_id: "generation-1",
					activation_epoch: 2,
					service_id: "oncore",
					flow_id: "fill-timesheet",
					runbook_version: "1.0.0",
					runbook_digest: "b".repeat(64),
					action_registry_digest: "c".repeat(64),
					normalized_input_digest: "d".repeat(64),
					item_key_digest: "e".repeat(64),
					target_scope: "https://portal.example.com",
					postcondition: { id: "saved", summary: "Draft saved." },
				},
			}),
		);
		expect(created.ok).toBe(true);
		if (!created.ok) throw new Error("unreachable");
		const granted = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: created.run,
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		for (const bindings of [
			{ ...authContinuation().bindings, generation_id: "generation-other" },
			{ ...authContinuation().bindings, activation_epoch: 3 },
			{ ...authContinuation().bindings, target_binding_id: "target-other" },
		]) {
			const result = await provider.commitWithClaim(granted.claim, {
				run_id: "run-1",
				expected_revision: 1,
				fragment: baseFragment(),
				continuation: authContinuation({ bindings }),
			});
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.rejection.code).toBe("auth_fragment_not_committable");
			}
		}
		const loaded = await loadSharedRun(store, "run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.revision).toBe(1);
	});

	test("a fencing-stale claim resolves to auth_commit_lease_rejected, never a throw", async () => {
		const { provider, store } = await makeProvider();
		const created = await createSharedRun(store, baseRun());
		expect(created.ok).toBe(true);
		const granted = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		const stale = { ...granted.claim, fencing_token: granted.claim.fencing_token + 41 };
		const result = await provider.commitWithClaim(stale, {
			run_id: "run-1",
			expected_revision: 1,
			fragment: blockedLeaseFragment(),
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.rejection.code).toBe("auth_commit_lease_rejected");
		expect(result.rejection.message.startsWith("auth commit lease rejected")).toBe(
			true,
		);
	});

	test("a store fault during the durable commit resolves to auth_commit_store_faulted", async () => {
		const clock = fixedClock();
		const real = createDefaultPlatformFs();
		const fault = { armed: false };
		const fs: BrowserUsePlatformFs = {
			...real,
			async writeFileDurable(path, contents, mode) {
				if (fault.armed && path.includes("run-store-fault")) {
					throw Object.assign(new Error("simulated flush fault"), { code: "EIO" });
				}
				await real.writeFileDurable(path, contents, mode);
			},
		};
		const store = await makeStoreDeps(clock.now, fs);
		const { port } = makeTokenPort();
		const provider = createBrowserUseAuthProvider({
			store,
			admission: environmentAdmission(port),
			attestationByDigest: () => undefined,
		});
		const created = await createSharedRun(
			store,
			baseRun({ run_id: "run-store-fault" }),
		);
		expect(created.ok).toBe(true);
		const granted = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		fault.armed = true;
		const result = await provider.commitWithClaim(granted.claim, {
			run_id: "run-store-fault",
			expected_revision: 1,
			fragment: baseFragment({
				phase: "lease-request",
				status: "blocked",
				blocked_cause: "lease-unavailable",
				continuation: {
					...BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["lease-unavailable"]
						.continuation,
				},
				binding: {
					...baseFragment().binding,
					run_id: "run-store-fault",
				},
			}),
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.rejection.code).toBe("auth_commit_store_faulted");
		expect(result.rejection.message).toMatch(/persist/);
	});

	test("a lease stolen inside the commit critical section resolves to auth_commit_lease_rejected (D8 catch)", async () => {
		// Defeat the provider's pre-check: the durable lease record is swapped
		// to a stale snapshot only on the SECOND lease-record read of the
		// commit, so validateStoredLeaseForWrite passes at the boundary and the
		// run store's own gate throws "auth commit lease rejected (...)" inside
		// its critical section — the catch must classify it, never reject.
		const clock = fixedClock();
		const real = createDefaultPlatformFs();
		const race = {
			armed: false,
			leaseReads: 0,
			leasePath: null as string | null,
			snapshot: null as string | null,
		};
		const fs: BrowserUsePlatformFs = {
			...real,
			async readTextFile(path) {
				if (race.armed && path === race.leasePath) {
					race.leaseReads += 1;
					if (race.leaseReads >= 2 && race.snapshot !== null) {
						return race.snapshot;
					}
				}
				return await real.readTextFile(path);
			},
		};
		const store = await makeStoreDeps(clock.now, fs);
		const { port } = makeTokenPort();
		const provider = createBrowserUseAuthProvider({
			store,
			admission: environmentAdmission(port),
			attestationByDigest: () => undefined,
		});
		const created = await createSharedRun(store, baseRun());
		expect(created.ok).toBe(true);

		const key = leaseKeyForRun({ environment_profile: ENVIRONMENT_PROFILE });
		race.leasePath = leaseRecordPath(store.paths, key);

		// Mint an older, still-live lease record under a different holder and
		// snapshot its raw bytes: fencing tokens only increase, so the snapshot
		// is stale against any later acquisition.
		const other = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "other-holder",
				ttl_ms: TTL_MS,
			}),
		);
		race.snapshot = await real.readTextFile(race.leasePath);
		await provider.releaseSensitiveIntervalLease({ lease: other.lease });
		const granted = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		expect(granted.lease.fencing_token).toBeGreaterThan(
			other.lease.fencing_token,
		);

		race.armed = true;
		const result = await provider.commitWithClaim(granted.claim, {
			run_id: "run-1",
			expected_revision: 1,
			fragment: blockedLeaseFragment(),
		});
		race.armed = false;
		// The promise RESOLVES with the typed refusal even though the run
		// store's own path threw from its critical section.
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.rejection.code).toBe("auth_commit_lease_rejected");
		expect(
			result.rejection.message.startsWith("auth commit lease rejected"),
		).toBe(true);
		// The pre-check passed (read 1) and the inner gate saw the stolen
		// record (read 2) — the catch branch, not the pre-check, classified.
		expect(race.leaseReads).toBeGreaterThanOrEqual(2);

		// Nothing was persisted under the stolen lease.
		const loaded = await loadSharedRun(store, "run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.revision).toBe(1);
	});

	test("a secret-shaped fragment is refused by the U2 path, not laundered", async () => {
		const { provider, store } = await makeProvider();
		const created = await createSharedRun(store, baseRun());
		expect(created.ok).toBe(true);
		const granted = expectGranted(
			await provider.acquireSensitiveIntervalLease({
				run: { environment_profile: ENVIRONMENT_PROFILE },
				holder_id: "auth-transaction",
				ttl_ms: TTL_MS,
			}),
		);
		const fragment = baseFragment();
		const corrupted = {
			...fragment,
			binding: { ...fragment.binding, origin: "op://x" },
		};
		const result = await provider.commitWithClaim(granted.claim, {
			run_id: "run-1",
			expected_revision: 1,
			fragment: corrupted,
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("unreachable");
		expect(result.rejection.code).toBe("auth_fragment_invalid");
		expect(JSON.stringify(result)).not.toContain("op://");

		// Nothing was persisted: the run is untouched at revision 1.
		const loaded = await loadSharedRun(store, "run-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.revision).toBe(1);
			expect(loaded.run.auth_fragment).toBeUndefined();
		}
	});
});
