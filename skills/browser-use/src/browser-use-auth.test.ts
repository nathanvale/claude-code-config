import { describe, expect, test } from "bun:test";
import {
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
	BROWSER_USE_AUTH_BLOCKED_CAUSES,
	BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
	type BrowserUseAuthAttestation,
	type BrowserUseAuthTransactionFragment,
	authAttestationDigestOf,
} from "./browser-use-auth-model";
import {
	authCommitSummaryOf,
	commitAuthTransaction,
	createBrowserUseAuthContract,
} from "./browser-use-auth";
import {
	applyAuthCommit,
	type BrowserUseRunIntegrationPort,
	type BrowserUseSharedRun,
} from "./browser-use-run-model";

// =========================================================================
// Browser Authentication facade (auth plan U2, R6/R21/R30; AE11).
//
// Seam proof: the auth contract Port admits only schema-exact secret-free
// fragments and verifies attestation binding/freshness against observed run
// facts; the commit summary maps every fragment onto exactly one platform
// outcome; commits reach the shared run only through the integration Port —
// proven end-to-end against the platform's own applyAuthCommit reducer.
// =========================================================================

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

function baseAttestation(
	overrides: Partial<BrowserUseAuthAttestation> = {},
): BrowserUseAuthAttestation {
	return {
		run_id: "run-1",
		handoff_evidence_id: "evidence-1",
		lane_id: "agent-browser",
		implementation_integrity_key: "integrity-key-1",
		environment: "agent-chrome",
		profile: "default",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-1",
		service_id: "oncore",
		auth_context: "timesheet",
		subject_reference: "subject-ref-1",
		account_reference: "account-ref-1",
		tenant_reference: "tenant-ref-1",
		identity_basis: "session-identity-proof",
		identity_basis_digest: "basis-digest-1",
		observed_at_epoch_ms: 1_000,
		fresh_until_epoch_ms: 2_000,
		...overrides,
	};
}

function contractFor(record: BrowserUseAuthAttestation | undefined) {
	return createBrowserUseAuthContract({
		attestationByDigest: (digest) =>
			record !== undefined && authAttestationDigestOf(record) === digest
				? record
				: undefined,
	});
}

function verifyInput(record: BrowserUseAuthAttestation) {
	return {
		reference: {
			attestation_digest: authAttestationDigestOf(record),
			fresh_until_epoch_ms: record.fresh_until_epoch_ms,
		},
		run_id: record.run_id,
		environment_profile: {
			environment: record.environment,
			profile: record.profile,
		},
		adapter_id: record.lane_id,
		handoff_evidence_id: record.handoff_evidence_id,
		at_epoch_ms: 1_500,
	} as const;
}

describe("validateSecretFreeFragment (R6)", () => {
	const contract = contractFor(undefined);

	test("admits a schema-exact secret-free fragment", () => {
		expect(
			contract.validateSecretFreeFragment({
				schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
				fragment: baseFragment(),
			}),
		).toBe(true);
	});

	test("rejects an unknown slot schema version", () => {
		expect(
			contract.validateSecretFreeFragment({
				schema_version: "2",
				fragment: baseFragment(),
			}),
		).toBe(false);
	});

	test("rejects a secret-shaped or schema-extended fragment", () => {
		const fragment = baseFragment();
		expect(
			contract.validateSecretFreeFragment({
				schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
				fragment: {
					...fragment,
					binding: { ...fragment.binding, service_id: "op://vault/item" },
				},
			}),
		).toBe(false);
		expect(
			contract.validateSecretFreeFragment({
				schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
				fragment: { ...fragment, password: "hunter2" },
			}),
		).toBe(false);
	});
});

describe("verifyAttestation (R30, AE11)", () => {
	test("a fresh, binding-exact attestation verifies", async () => {
		const record = baseAttestation();
		expect(await contractFor(record).verifyAttestation(verifyInput(record))).toBe(true);
	});

	test("a missing record refuses", async () => {
		const record = baseAttestation();
		expect(await contractFor(undefined).verifyAttestation(verifyInput(record))).toBe(
			false,
		);
	});

	test("freshness expiry refuses (stale attestation after expiry, AE11)", async () => {
		const record = baseAttestation();
		expect(
			await contractFor(record).verifyAttestation({
				...verifyInput(record),
				at_epoch_ms: 2_001,
			}),
		).toBe(false);
	});

	test("a reference freshness bound that disagrees with the record refuses", async () => {
		const record = baseAttestation();
		expect(
			await contractFor(record).verifyAttestation({
				...verifyInput(record),
				reference: {
					attestation_digest: authAttestationDigestOf(record),
					fresh_until_epoch_ms: 99_999,
				},
			}),
		).toBe(false);
	});

	test("lane, handoff, run, or profile drift refuses (AE11)", async () => {
		const record = baseAttestation();
		const input = verifyInput(record);
		expect(
			await contractFor(record).verifyAttestation({
				...input,
				adapter_id: "playwright-cdp",
			}),
		).toBe(false);
		expect(
			await contractFor(record).verifyAttestation({
				...input,
				handoff_evidence_id: "evidence-2",
			}),
		).toBe(false);
		expect(
			await contractFor(record).verifyAttestation({ ...input, run_id: "run-2" }),
		).toBe(false);
		expect(
			await contractFor(record).verifyAttestation({
				...input,
				environment_profile: { environment: "agent-chrome", profile: "other" },
			}),
		).toBe(false);
	});

	test("an edited record fails the digest recomputation", async () => {
		const record = baseAttestation();
		const reference = {
			attestation_digest: authAttestationDigestOf(record),
			fresh_until_epoch_ms: record.fresh_until_epoch_ms,
		};
		const edited = { ...record, subject_reference: "subject-ref-2" };
		const contract = createBrowserUseAuthContract({
			attestationByDigest: () => edited,
		});
		expect(
			await contract.verifyAttestation({ ...verifyInput(record), reference }),
		).toBe(false);
	});
});

describe("authCommitSummaryOf (R6/R21)", () => {
	test("an authenticated fragment maps to ready with its attestation reference", () => {
		const result = authCommitSummaryOf(
			baseFragment({
				phase: "terminal",
				status: "terminal",
				terminal_outcome: "authenticated",
				identity_basis: "session-identity-proof",
				identity_basis_digest: "basis-digest-1",
				attestation_digest: "attestation-digest-1",
				fresh_until_epoch_ms: 9_000,
			}),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.summary.state).toBe("ready");
			expect(result.summary.attestation).toEqual({
				attestation_digest: "attestation-digest-1",
				fresh_until_epoch_ms: 9_000,
			});
		}
	});

	test("every blocked cause maps to its one platform state and continuation", () => {
		for (const cause of BROWSER_USE_AUTH_BLOCKED_CAUSES) {
			const entry = BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause];
			const result = authCommitSummaryOf(
				baseFragment({
					status: "blocked",
					blocked_cause: cause,
					continuation: { ...entry.continuation },
				}),
			);
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.summary.state).toBe(entry.run_state);
				expect(result.summary.continuation).toEqual(entry.continuation);
			}
		}
	});

	test("an active fragment (write-ahead persistence point) stays awaiting-auth", () => {
		const result = authCommitSummaryOf(
			baseFragment({
				phase: "write-ahead-submission",
				submission_started: true,
				external_effect: "possible",
				attempt: {
					budget_key: "oncore::timesheet::https://portal.example.com",
					limit: 3,
					consumed: 1,
				},
			}),
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.summary.state).toBe("awaiting-auth");
			expect(result.summary.continuation?.next_action_id).toBe(
				"continue-auth-transaction",
			);
		}
	});

	test("a cancelled fragment is not committable as an auth outcome", () => {
		const result = authCommitSummaryOf(
			baseFragment({
				phase: "terminal",
				status: "terminal",
				terminal_outcome: "cancelled",
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.rejection.code).toBe("auth_fragment_not_committable");
		}
	});

	test("an inadmissible fragment is rejected before any summary exists", () => {
		const fragment = baseFragment();
		const result = authCommitSummaryOf({
			...fragment,
			binding: { ...fragment.binding, origin: "op://vault/item" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.rejection.code).toBe("auth_fragment_invalid");
	});
});

describe("commitAuthTransaction (R6, KTD10)", () => {
	test("the fragment and derived summary reach the Port verbatim", async () => {
		const calls: unknown[] = [];
		const port: BrowserUseRunIntegrationPort = {
			async commitAuthOutcome(input) {
				calls.push(input);
				return {
					ok: false,
					rejection: { code: "run_revision_stale", message: "stale." },
				};
			},
		};
		const fragment = baseFragment();
		const result = await commitAuthTransaction(port, {
			run_id: "run-1",
			expected_revision: 7,
			fragment,
		});
		expect(calls).toEqual([
			{
				run_id: "run-1",
				expected_revision: 7,
				fragment: {
					schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
					fragment,
				},
				summary: {
					state: "awaiting-auth",
					continuation: {
						next_action_id: "continue-auth-transaction",
						summary: "The authentication transaction is mid-flight; continue it.",
					},
				},
			},
		]);
		expect(result.ok).toBe(false);
	});

	test("a non-committable fragment never reaches the Port", async () => {
		let called = false;
		const port: BrowserUseRunIntegrationPort = {
			async commitAuthOutcome() {
				called = true;
				return {
					ok: false,
					rejection: { code: "run_terminal", message: "unreachable." },
				};
			},
		};
		const result = await commitAuthTransaction(port, {
			run_id: "run-1",
			expected_revision: 1,
			fragment: baseFragment({
				phase: "terminal",
				status: "terminal",
				terminal_outcome: "cancelled",
			}),
		});
		expect(called).toBe(false);
		expect(result.ok).toBe(false);
	});

	test("end-to-end against the platform reducer: a blocked outcome commits atomically", async () => {
		const run: BrowserUseSharedRun = {
			run_id: "run-1",
			revision: 3,
			state: "awaiting-auth",
			task_intent: "routine-automation",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "evidence-1",
			mutation_dispatched: false,
			artifacts: [],
			continuation: {
				next_action_id: "continue-auth-transaction",
				summary: "The authentication transaction is mid-flight; continue it.",
			},
		};
		const contract = contractFor(undefined);
		const port: BrowserUseRunIntegrationPort = {
			async commitAuthOutcome(input) {
				return applyAuthCommit(
					run,
					{
						expected_revision: input.expected_revision,
						fragment: input.fragment,
						summary: input.summary,
					},
					contract,
				);
			},
		};
		const blocked = baseFragment({
			status: "blocked",
			blocked_cause: "lease-unavailable",
			continuation: {
				...BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE["lease-unavailable"].continuation,
			},
		});
		const result = await commitAuthTransaction(port, {
			run_id: "run-1",
			expected_revision: 3,
			fragment: blocked,
		});
		expect(result.ok).toBe(true);
		if (result.ok && "run" in result) {
			expect(result.run.revision).toBe(4);
			expect(result.run.state).toBe("awaiting-auth");
			expect(result.run.continuation?.next_action_id).toBe("wait-for-lease-holder");
			expect(result.run.auth_fragment?.fragment).toEqual(blocked);
		}
	});

	test("end-to-end: a secret-shaped fragment is refused by the reducer via the contract", async () => {
		const run: BrowserUseSharedRun = {
			run_id: "run-1",
			revision: 3,
			state: "awaiting-auth",
			task_intent: "routine-automation",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			mutation_dispatched: false,
			artifacts: [],
			continuation: {
				next_action_id: "continue-auth-transaction",
				summary: "The authentication transaction is mid-flight; continue it.",
			},
		};
		const contract = contractFor(undefined);
		const fragment = baseFragment();
		const corrupted = {
			...fragment,
			binding: { ...fragment.binding, target_id: "wss://portal.example.com/cdp" },
		} as BrowserUseAuthTransactionFragment;
		// Bypass the facade's own admission to prove the reducer-side gate holds
		// even for a caller that skips authCommitSummaryOf.
		const result = applyAuthCommit(
			run,
			{
				expected_revision: 3,
				fragment: {
					schema_version: BROWSER_USE_AUTH_FRAGMENT_SCHEMA_VERSION,
					fragment: corrupted,
				},
				summary: {
					state: "awaiting-auth",
					continuation: {
						next_action_id: "continue-auth-transaction",
						summary: "The authentication transaction is mid-flight; continue it.",
					},
				},
			},
			contract,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.rejection.code).toBe("auth_fragment_unsafe");
	});
});
