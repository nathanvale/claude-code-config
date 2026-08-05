import { afterEach, describe, expect, test } from "bun:test";
import {
	configureCliDiagnostics,
	parseCliDiagnosticArgv,
	resetCliDiagnostics,
} from "@side-quest/cli-command-facade";
import type { BrowserUseAuthProvider } from "./browser-use-auth-provider";
import { authCommitSummaryOf } from "./browser-use-auth";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	type BrowserUseAuthAttestation,
	type BrowserUseAuthTransactionFragment,
	authAttestationDigestOf,
} from "./browser-use-auth-model";
import {
	applyAuthTransition,
	beginAuthTransaction,
	type BrowserUseAuthTransactionEvent,
} from "./browser-use-auth-transaction";
import type { BrowserUseAccessibilitySnapshot } from "./browser-use-cdp-observer";
import type { BrowserUseDeliveryHook } from "./browser-use-confidential-field-delivery";
import type { BrowserUseHumanIdentityAttestationDriver } from "./browser-use-human-identity-attestation";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import { fixedClock, makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import { runBrowserUseRunbookAuth } from "./browser-use-runbook-auth";
import { writeAuthAttestationRecord } from "./browser-use-runs";

const disposables: Array<{ dispose(): void }> = [];
afterEach(() => {
	resetCliDiagnostics();
	for (const disposable of disposables.splice(0)) disposable.dispose();
});

const binding: BrowserUseItemBinding = {
	service_id: "fixture",
	auth_context: "interactive-login",
	allowed_origins: ["https://fixture.test"],
	allowed_login_paths: ["/login"],
	vault_id: "vault-fixture",
	item_id: "item-fixture",
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

function form(passwordFirst = false): BrowserUseAccessibilitySnapshot {
	const credentialNodes = [
		{ node_id: "username", parent_id: "form", role: "textbox", accessible_name: "Username", ignored: false, backend_node_id: 11, properties: {} },
		{ node_id: "password", parent_id: "form", role: "textbox", accessible_name: "Password", ignored: false, backend_node_id: 12, properties: {} },
	];
	return {
		target_id: "target-fixture",
		nodes: [
			{ node_id: "form", role: "form", accessible_name: "Sign in", ignored: false, child_ids: ["username", "password", "submit"], properties: {} },
			...(passwordFirst ? credentialNodes.toReversed() : credentialNodes),
			{ node_id: "submit", parent_id: "form", role: "button", accessible_name: "Sign in", ignored: false, backend_node_id: 13, properties: {} },
		],
	};
}

function welcome(): BrowserUseAccessibilitySnapshot {
	return {
		target_id: "target-fixture",
		nodes: [
			{ node_id: "profile", role: "heading", accessible_name: "Profile", ignored: false, properties: {} },
			{ node_id: "documents", role: "heading", accessible_name: "Documents", ignored: false, properties: {} },
			{ node_id: "edit-profile", role: "button", accessible_name: "Edit profile", ignored: false, backend_node_id: 21, properties: {} },
		],
	};
}

const persistedAttestation: BrowserUseAuthAttestation = {
	run_id: "shared-run-fixture",
	handoff_evidence_id: "handoff-fixture",
	lane_id: "agent-browser",
	implementation_integrity_key: "fixture-integrity",
	environment: "agent-chrome",
	profile: "default",
	target_id: "target-fixture",
	page_id: "page-authenticated",
	frame_id: "frame-authenticated",
	service_id: "fixture",
	auth_context: "interactive-login",
	subject_reference: "subject-ref",
	account_reference: "account-ref",
	tenant_reference: "tenant-ref",
	identity_basis: "session-identity-proof",
	identity_basis_digest: "basis-digest",
	observed_at_epoch_ms: 10_000,
	fresh_until_epoch_ms: 40_000,
};
const persistedAttestationDigest = authAttestationDigestOf(persistedAttestation);

function persistedFragmentAt(
	stage:
		| "pre-submit"
		| "submission-started"
		| "post-submit-proof"
		| "authenticated",
): BrowserUseAuthTransactionFragment {
	const begun = beginAuthTransaction({
		binding: {
			run_id: "shared-run-fixture",
			handoff_evidence_id: "handoff-fixture",
			lane_id: "agent-browser",
			environment: "agent-chrome",
			profile: "default",
			service_id: "fixture",
			auth_context: "interactive-login",
			origin: "https://fixture.test",
			target_id: "target-fixture",
			page_id: "target-fixture",
			frame_id: "target-fixture",
		},
		method: "password",
		attempt_limit: 3,
		attempts_already_consumed: 0,
	});
	if (!begun.ok) throw new Error(begun.rejection.message);
	let fragment = begun.fragment;
	const events: BrowserUseAuthTransactionEvent[] = [
		{ type: "pre-auth-proved" },
		{ type: "preparation-complete" },
		{ type: "lease-granted" },
		{ type: "method-step-complete", step: "identify-auth-state" },
		{ type: "method-step-complete", step: "reprove-target" },
		{ type: "method-step-complete", step: "fill-password" },
	];
	if (stage !== "pre-submit") events.push({ type: "submission-dispatched" });
	if (stage === "post-submit-proof" || stage === "authenticated") {
		events.push(
			{ type: "submit-outcome-observed", outcome: "success" },
			{ type: "cleanup-complete" },
		);
	}
	if (stage === "authenticated") {
		events.push(
			{
				type: "postcondition-proven",
				identity_basis: "session-identity-proof",
				identity_basis_digest: "basis-digest",
			},
			{
				type: "attestation-issued",
				attestation_digest: persistedAttestationDigest,
				fresh_until_epoch_ms: 40_000,
			},
		);
	}
	for (const event of events) {
		const applied = applyAuthTransition(fragment, event);
		if (!applied.ok) throw new Error(applied.rejection.message);
		fragment = applied.fragment;
	}
	return fragment;
}

type FixtureOptions = {
	proof: boolean;
	proofOrigin?: string;
	expectedUrl?: string;
	observedUrl?: string;
	passwordFirst?: boolean;
	initialFragment?: BrowserUseAuthTransactionFragment;
	initialScreen?: BrowserUseAccessibilitySnapshot;
	proofOwner?: boolean;
	handoffEvidenceId?: string | null;
	loginFormPersists?: boolean;
	humanIdentityAttestation?: BrowserUseHumanIdentityAttestationDriver;
	actionPolicyHash?: string | null;
	preExistingSession?: boolean;
};

async function fixture(options: FixtureOptions) {
	const proofOrigin = options.proofOrigin ?? "https://fixture.test";
	const expectedUrl = options.expectedUrl ?? "https://fixture.test/login";
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(opened.refusal.message);
	const clock = fixedClock(10_000);
	const store = { fs, paths: opened.paths, clock: clock.now };
	if (options.initialFragment?.terminal_outcome === "authenticated") {
		const written = await writeAuthAttestationRecord(store, {
			digest: persistedAttestationDigest,
			record: persistedAttestation,
		});
		if (!written.ok) throw new Error(written.message);
	}
	let run: BrowserUseSharedRun = {
		run_id: "shared-run-fixture",
		revision: 1,
		state:
			options.initialFragment?.terminal_outcome === "authenticated"
				? "ready"
				: "running",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "agent-browser",
		...(options.handoffEvidenceId === null
			? {}
			: { handoff_evidence_id: options.handoffEvidenceId ?? "handoff-fixture" }),
		runbook_target_binding: { schema_version: "1", mode: "exact", binding_id: "target-fixture" },
		runbook_progress: { schema_version: "1", service_id: "fixture", flow_id: "business", runbook_version: "1", next_step: 0, total_steps: 1 },
		mutation_dispatched: false,
		artifacts: [],
		...(options.initialFragment === undefined
			? {}
			: {
					auth_fragment: {
						schema_version: options.initialFragment.schema_version,
						fragment: options.initialFragment,
					},
				}),
		...(options.initialFragment?.terminal_outcome === "authenticated"
			? {
					auth_attestation: {
						attestation_digest: persistedAttestationDigest,
						fresh_until_epoch_ms: 40_000,
					},
				}
			: {}),
	};
	let latestSubmissionStarted = false;
	const lease = {
		key: "sensitive",
		fencing_token: 1,
		activation_epoch: 1,
		holder_id: "auth",
		acquired_at_epoch_ms: 10_000,
		heartbeat_at_epoch_ms: 10_000,
		expires_at_epoch_ms: 40_000,
		recovered_from: null,
		scope: { auth_context_ref: "interactive-login" },
	};
	const provider: BrowserUseAuthProvider = {
		acquireSensitiveIntervalLease: async () => ({ granted: true, event: { type: "lease-granted" }, claim: { fencing_token: 1, activation_epoch: 1, holderId: "auth" }, lease }),
		heartbeatSensitiveIntervalLease: async () => ({ granted: true, event: { type: "lease-granted" }, claim: { fencing_token: 1, activation_epoch: 1, holderId: "auth" }, lease }),
		releaseSensitiveIntervalLease: async () => ({ ok: true }),
		integrationPortFor: () => { throw new Error("unused"); },
		prepareSecretFree: async () => ({ ok: true, event: { type: "preparation-complete" }, binding }),
		retrieveCredentialField: async () => ({ ok: false, event: { type: "blocked", cause: "capability-loss" }, continuation: { next_action_id: "inspect-capability-loss", summary: "inspect" }, rejection: { code: "token-revoked", message: "unused" } }),
		commitWithClaim: async (_claim, input) => {
			const mapped = authCommitSummaryOf(input.fragment);
			if (!mapped.ok) return mapped;
			run = {
				...run,
				revision: run.revision + 1,
				state: mapped.summary.state,
				auth_fragment: { schema_version: input.fragment.schema_version, fragment: input.fragment },
				auth_attestation: mapped.summary.attestation,
				continuation: mapped.summary.continuation,
			};
			latestSubmissionStarted = input.fragment.submission_started;
			return { ok: true, run };
		},
		buildAgentBrowserDeliveryContext: () => { throw new Error("unused"); },
	};
	const tokenRetrieval: BrowserUseTokenRetrievalPort = {
		listVaults: async () => ({ ok: true, vaults: [] }),
		listLoginItems: async () => ({ ok: true, items: [] }),
		getLoginItem: async () => ({ ok: false, rejection: { code: "item-missing", message: "unused" } }),
		fetchCredentialField: async ({ field }) => ({ ok: true, handle: { handle_id: `handle-${field}`, field, expires_at_epoch_ms: 40_000 } }),
	};
	const delivered: string[] = [];
	const deliver: BrowserUseDeliveryHook = async ({ field }) => {
		delivered.push(field);
		return { ok: true, shape: { field, byte_length: 8 } };
	};
	let screen =
		options.initialScreen ??
		(options.preExistingSession ? welcome() : form(options.passwordFirst));
	const navigations: Array<{ target_id: string; url: string }> = [];
	const proofTransitions: string[] = [];
	let proofCalls = 0;
	let snapshotCalls = 0;
	const result = await runBrowserUseRunbookAuth(
		{
			store,
			provider,
			implementation_integrity_key: "fixture-integrity",
			...(options.humanIdentityAttestation === undefined
				? {}
				: { humanIdentityAttestation: options.humanIdentityAttestation }),
			login: {
				observer: {
					snapshot: async () => {
						snapshotCalls += 1;
						return { ok: true, snapshot: screen };
					},
					probeNode: async () => ({ ok: true, probe: { visible: true, operable: true } }),
					activateControl: async () => {
						expect(latestSubmissionStarted).toBe(true);
						screen = options.loginFormPersists
							? form(options.passwordFirst)
							: welcome();
						return { ok: true };
					},
				},
				proveTarget: async (input) => {
					const node = screen.nodes.find((candidate) => candidate.accessible_name === input.field.accessible_name);
					if (node?.backend_node_id === undefined) return { ok: false, cause: "target-proof-invalid" };
					const target = { lane_id: input.lane_id, run_id: input.run_id, top_level_url: input.expected_url, top_level_origin: "https://fixture.test", frame_origin: "https://fixture.test", target_id: "target-fixture", page_id: "page-fixture", frame_id: "frame-fixture", account_ref: "account-ref-fixture", target_proof_digest: `proof-${node.backend_node_id}`, field: { role: node.role, accessible_name: node.accessible_name, backend_node_id: node.backend_node_id } };
					return { ok: true, target, reproveTarget: async () => ({ proven: true, observed_digest: target.target_proof_digest }) };
				},
				tokenRetrieval,
				deliver,
				...(options.proofOwner === false
					? {}
					: {
							proveAuthenticatedState: async ({ target_id, transition }) => {
								proofCalls += 1;
								proofTransitions.push(transition);
								return options.proof
									? { proven: true as const, proof: { target_id, page_id: "page-authenticated", frame_id: "frame-authenticated", origin: proofOrigin, subject_reference: "subject-ref", account_reference: "account-ref", tenant_reference: "tenant-ref", identity_basis_digest: "basis-digest" } }
									: { proven: false as const, cause: "human-identity-attestation-required" as const };
							},
						}),
			},
			navigateToDeclaredTarget: async (input) => {
				navigations.push(input);
				return { ok: true };
			},
		},
		{
			run,
			dispatch_claim: { fencing_token: 1, activation_epoch: 1, holderId: "dispatch" },
			service_id: "fixture",
			flow_id: "business",
			action_policy_hash:
				options.actionPolicyHash === undefined
					? "a".repeat(64)
					: options.actionPolicyHash,
			auth_context_ref: "interactive-login",
			allowed_origins: ["https://fixture.test"],
			expected_url: expectedUrl,
			...(options.observedUrl !== undefined
				? { observed_url: options.observedUrl }
				: {}),
			target_id: "target-fixture",
		},
	);
	return {
		result,
		delivered,
		navigations,
		proofTransitions,
		proofCalls,
		snapshotCalls,
	};
}

describe("runbook auth route", () => {
	test("bootstraps one neutral target to the declared login URL before authentication", async () => {
		const { result, navigations } = await fixture({
			proof: true,
			observedUrl: "about:blank",
		});
		expect(result).toMatchObject({ ok: true, run: { state: "ready" } });
		expect(navigations).toEqual([
			{ target_id: "target-fixture", url: "https://fixture.test/login" },
		]);
	});

	test("refuses a cross-origin neutral bootstrap before navigation or authentication", async () => {
		const { result, navigations, delivered } = await fixture({
			proof: true,
			expectedUrl: "https://near-miss.fixture.test/login",
			observedUrl: "about:blank",
		});
		expect(result).toMatchObject({
			ok: false,
			blocked: { blocked_cause: "origin-mismatch" },
		});
		expect(navigations).toEqual([]);
		expect(delivered).toEqual([]);
	});

	test("keeps run identity and gates one business dispatch behind authenticated ready", async () => {
		const { result, delivered } = await fixture({ proof: true });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.run.run_id).toBe("shared-run-fixture");
		expect(result.run.handoff_evidence_id).toBe("handoff-fixture");
		// `ready` is the observable gate the caller keys business dispatch on, and
		// the delivered order proves the full username->password flow ran once.
		expect(result.run.state).toBe("ready");
		expect(delivered).toEqual(["username", "password"]);
	});

	test("reuses a substantive pre-existing session without credential delivery", async () => {
		const { result, delivered, proofTransitions } = await fixture({
			proof: true,
			observedUrl: "https://fixture.test/home",
			preExistingSession: true,
		});

		expect(result).toMatchObject({ ok: true, run: { state: "ready" } });
		expect(delivered).toEqual([]);
		expect(proofTransitions).toEqual(["pre-existing-session"]);
	});

	test("combined form authenticates when accessibility order exposes password before username", async () => {
		const { result, delivered } = await fixture({
			proof: true,
			passwordFirst: true,
		});
		expect(result).toMatchObject({ ok: true, run: { state: "ready" } });
		expect(delivered).toEqual(["username", "password"]);
	});

	test("keeps business dispatch blocked when the post-submit login form remains", async () => {
		const { result } = await fixture({
			proof: true,
			loginFormPersists: true,
		});

		expect(result).toMatchObject({
			ok: false,
			blocked: {
				blocked_cause: "unknown-post-submit-state",
				continuation: { next_action_id: "inspect-post-submit-state" },
			},
		});
		expect(result.ok === false && "run" in result && result.run.state === "ready").toBe(false);
	});

	test("debug diagnostics record ordered secret-free lifecycle mappings", async () => {
		const lines: string[] = [];
		configureCliDiagnostics({
			categoryRoot: "browser-use.cli",
			options: parseCliDiagnosticArgv(["--debug"]).options,
			diagnosticWriter: {
				write: (chunk) => {
					lines.push(chunk);
					return true;
				},
			},
		});

		const { result } = await fixture({ proof: true });
		expect(result).toMatchObject({ ok: true, run: { state: "ready" } });
		const trail = lines.join("");
		expect(trail).toContain("auth-lifecycle-transition");
		for (const sequence of [1, 2, 3, 4, 5, 6, 7]) {
			expect(trail).toContain(`sequence=${sequence}`);
		}
		expect(trail).toContain("login_step=username");
		expect(trail).toContain("login_step=password");
		expect(trail).not.toContain("auth-lifecycle-transition-rejected");
		expect(trail).not.toContain(binding.vault_id);
		expect(trail).not.toContain(binding.item_id);
		expect(trail).not.toContain("https://fixture.test/login");
	});

	test("failed post-submit proof returns one unknown continuation and zero business dispatch", async () => {
		const { result } = await fixture({ proof: false });
		// The blocked envelope (not a ready run) is what withholds business dispatch;
		// asserting it is the real "zero dispatch" proof.
		expect(result).toMatchObject({
			ok: false,
			blocked: {
				blocked_cause: "unknown-post-submit-state",
				continuation: { next_action_id: "inspect-post-submit-state" },
			},
		});
		expect(result.ok === false && "run" in result && result.run.state === "ready").toBe(false);
	});

	test("persists the presence gate, consumes one human attestation, and resumes the same run to ready", async () => {
		const observedStates: string[] = [];
		const { result } = await fixture({
			proof: false,
			humanIdentityAttestation: async (input) => {
				observedStates.push(input.run.state);
				expect(input.run.continuation?.next_action_id).toBe(
					"complete-human-identity-attestation",
				);
				return {
					ok: true,
					attestation: {
						run_id: input.run.run_id,
						handoff_evidence_id: "handoff-fixture",
						lane_id: "agent-browser",
						implementation_integrity_key: "fixture-integrity",
						environment: "agent-chrome",
						profile: "default",
						target_id: "target-fixture",
						page_id: "target-fixture",
						frame_id: "target-fixture",
						service_id: "fixture",
						auth_context: "interactive-login",
						subject_reference: "subject-ref",
						account_reference: "account-ref",
						tenant_reference: "tenant-ref",
						identity_basis: "human-identity-attestation",
						identity_basis_digest: "b".repeat(64),
						observed_at_epoch_ms: 10_000,
						fresh_until_epoch_ms: 40_000,
					},
				};
			},
		});

		expect(observedStates).toEqual(["awaiting-user-presence"]);
		expect(result).toMatchObject({
			ok: true,
			run: {
				run_id: "shared-run-fixture",
				state: "ready",
				auth_attestation: {
					attestation_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
					fresh_until_epoch_ms: 40_000,
				},
			},
		});
	});

	test("refuses human identity authorization without an execution-binding digest", async () => {
		let attestationCalls = 0;
		const { result } = await fixture({
			proof: false,
			actionPolicyHash: null,
			humanIdentityAttestation: async () => {
				attestationCalls += 1;
				return {
					ok: false,
					code: "unreachable",
					message: "unreachable",
				};
			},
		});

		expect(result).toMatchObject({
			ok: false,
			failure: { code: "runbook_auth_execution_binding_missing" },
		});
		expect(attestationCalls).toBe(0);
	});

	test("authenticated-state proof on a moved origin refuses before business dispatch", async () => {
		const { result } = await fixture({
			proof: true,
			proofOrigin: "https://moved.fixture.test",
		});
		expect(result).toMatchObject({
			ok: false,
			blocked: {
				blocked_cause: "origin-mismatch",
				continuation: { next_action_id: "inspect-origin-mismatch" },
			},
		});
	});

	test("post-submit restart advances through fresh proof without credential replay", async () => {
		const initialFragment = persistedFragmentAt("post-submit-proof");
		const { result, delivered, proofCalls } = await fixture({
			proof: true,
			initialFragment,
			// A delayed transition may leave the old form visible. Persisted
			// write-ahead truth, not the page shape, owns restart behavior.
			initialScreen: form(),
		});
		expect(result).toMatchObject({
			ok: true,
			run: {
				run_id: "shared-run-fixture",
				state: "ready",
				auth_fragment: {
					fragment: {
						terminal_outcome: "authenticated",
						submission_started: false,
						external_effect: "possible",
					},
				},
			},
		});
		expect(delivered).toEqual([]);
		expect(proofCalls).toBe(1);
	});

	test("pre-submit restart re-proves and consumes one credential attempt", async () => {
		const { result, delivered, proofCalls } = await fixture({
			proof: true,
			initialFragment: persistedFragmentAt("pre-submit"),
		});
		expect(result).toMatchObject({
			ok: true,
			run: {
				run_id: "shared-run-fixture",
				auth_fragment: {
					fragment: {
						attempt: { consumed: 1 },
						terminal_outcome: "authenticated",
					},
				},
			},
		});
		expect(delivered).toEqual(["username", "password"]);
		expect(proofCalls).toBe(1);
	});

	test("restart preserves the unbound handoff sentinel when the run omits evidence", async () => {
		const initialFragment = persistedFragmentAt("pre-submit");
		const { result } = await fixture({
			proof: true,
			handoffEvidenceId: null,
			initialFragment: {
				...initialFragment,
				binding: {
					...initialFragment.binding,
					handoff_evidence_id: "handoff-unbound",
				},
			},
		});
		expect(result).toMatchObject({ ok: true });
	});

	test("authenticated restart requires fresh proof and never replays credentials", async () => {
		const { result, delivered, proofCalls } = await fixture({
			proof: true,
			initialFragment: persistedFragmentAt("authenticated"),
			initialScreen: form(),
		});
		expect(result).toMatchObject({
			ok: true,
			run: {
				run_id: "shared-run-fixture",
				state: "ready",
				auth_fragment: {
					fragment: { terminal_outcome: "authenticated" },
				},
			},
		});
		expect(delivered).toEqual([]);
		expect(proofCalls).toBe(1);
	});

	test("submission-started restart returns one unknown continuation without browser work", async () => {
		const initialFragment = persistedFragmentAt("submission-started");
		const { result, delivered, proofCalls, snapshotCalls } = await fixture({
			proof: true,
			initialFragment,
		});
		expect(result).toMatchObject({
			ok: false,
			run: {
				run_id: "shared-run-fixture",
				auth_fragment: {
					fragment: {
						submission_started: true,
						external_effect: "possible",
					},
				},
			},
			blocked: {
				blocked_cause: "unknown-post-submit-state",
				continuation: { next_action_id: "inspect-post-submit-state" },
			},
		});
		expect(delivered).toEqual([]);
		expect(proofCalls).toBe(0);
		expect(snapshotCalls).toBe(0);
	});

	test("post-submit restart without a proof owner fails closed before credentials", async () => {
		const { result, delivered, proofCalls } = await fixture({
			proof: true,
			proofOwner: false,
			initialFragment: persistedFragmentAt("post-submit-proof"),
			initialScreen: form(),
		});
		expect(result).toMatchObject({
			ok: false,
			blocked: {
				blocked_cause: "human-identity-attestation-required",
				continuation: {
					next_action_id: "complete-human-identity-attestation",
				},
			},
		});
		expect(delivered).toEqual([]);
		expect(proofCalls).toBe(0);
	});

	test("post-submit restart proof failure returns one unknown continuation", async () => {
		const { result, delivered, proofCalls } = await fixture({
			proof: false,
			initialFragment: persistedFragmentAt("post-submit-proof"),
			initialScreen: form(),
		});
		expect(result).toMatchObject({
			ok: false,
			run: {
				run_id: "shared-run-fixture",
				auth_fragment: {
					fragment: { external_effect: "possible" },
				},
			},
			blocked: {
				blocked_cause: "unknown-post-submit-state",
				continuation: { next_action_id: "inspect-post-submit-state" },
			},
		});
		expect(delivered).toEqual([]);
		expect(proofCalls).toBe(1);
	});

	test("malformed or stale persisted fragments refuse instead of starting new auth", async () => {
		const valid = persistedFragmentAt("pre-submit");
		const cases: BrowserUseAuthTransactionFragment[] = [
			{
				...valid,
				schema_version: "stale",
			} as unknown as BrowserUseAuthTransactionFragment,
			{ ...valid, binding: { ...valid.binding, run_id: "another-run" } },
		];
		for (const initialFragment of cases) {
			const { result, delivered, proofCalls, snapshotCalls } = await fixture({
				proof: true,
				initialFragment,
			});
			expect(result).toMatchObject({
				ok: false,
				failure: { code: "auth_fragment_invalid" },
			});
			expect(delivered).toEqual([]);
			expect(proofCalls).toBe(0);
			expect(snapshotCalls).toBe(0);
		}
	});
});
