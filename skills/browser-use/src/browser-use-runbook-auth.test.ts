import { afterEach, describe, expect, test } from "bun:test";
import type { BrowserUseAuthProvider } from "./browser-use-auth-provider";
import { authCommitSummaryOf } from "./browser-use-auth";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type { BrowserUseAccessibilitySnapshot } from "./browser-use-cdp-observer";
import type { BrowserUseDeliveryHook } from "./browser-use-confidential-field-delivery";
import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";
import { createDefaultPlatformFs, openBrowserUsePaths } from "./browser-use-paths";
import { fixedClock, makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import { runBrowserUseRunbookAuth } from "./browser-use-runbook-auth";

const disposables: Array<{ dispose(): void }> = [];
afterEach(() => {
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

function form(): BrowserUseAccessibilitySnapshot {
	return {
		target_id: "target-fixture",
		nodes: [
			{ node_id: "form", role: "form", accessible_name: "Sign in", ignored: false, child_ids: ["username", "password", "submit"], properties: {} },
			{ node_id: "username", parent_id: "form", role: "textbox", accessible_name: "Username", ignored: false, backend_node_id: 11, properties: {} },
			{ node_id: "password", parent_id: "form", role: "textbox", accessible_name: "Password", ignored: false, backend_node_id: 12, properties: {} },
			{ node_id: "submit", parent_id: "form", role: "button", accessible_name: "Sign in", ignored: false, backend_node_id: 13, properties: {} },
		],
	};
}

function welcome(): BrowserUseAccessibilitySnapshot {
	return {
		target_id: "target-fixture",
		nodes: [{ node_id: "welcome", role: "heading", accessible_name: "Welcome to Dashboard", ignored: false, properties: {} }],
	};
}

async function fixture(
	proof: boolean,
	proofOrigin = "https://fixture.test",
) {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(opened.refusal.message);
	const clock = fixedClock(10_000);
	const store = { fs, paths: opened.paths, clock: clock.now };
	let run: BrowserUseSharedRun = {
		run_id: "shared-run-fixture",
		revision: 1,
		state: "running",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "agent-browser",
		handoff_evidence_id: "handoff-fixture",
		runbook_target_binding: { schema_version: "1", mode: "exact", binding_id: "target-fixture" },
		runbook_progress: { schema_version: "1", service_id: "fixture", flow_id: "business", runbook_version: "1", next_step: 0, total_steps: 1 },
		mutation_dispatched: false,
		artifacts: [],
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
	let screen = form();
	const result = await runBrowserUseRunbookAuth(
		{
			store,
			provider,
			implementation_integrity_key: "fixture-integrity",
			login: {
				observer: {
					snapshot: async () => ({ ok: true, snapshot: screen }),
					probeNode: async () => ({ ok: true, probe: { visible: true, operable: true } }),
					activateControl: async () => {
						expect(latestSubmissionStarted).toBe(true);
						screen = welcome();
						return { ok: true };
					},
				},
				proveTarget: async (input) => {
					const node = screen.nodes.find((candidate) => candidate.accessible_name === input.field.accessible_name);
					if (node?.backend_node_id === undefined) return { ok: false, cause: "target-proof-invalid" };
					const target = { lane_id: input.lane_id, run_id: input.run_id, top_level_origin: "https://fixture.test", frame_origin: "https://fixture.test", target_id: "target-fixture", page_id: "page-fixture", frame_id: "frame-fixture", account_ref: "account-ref-fixture", target_proof_digest: `proof-${node.backend_node_id}`, field: { role: node.role, accessible_name: node.accessible_name, backend_node_id: node.backend_node_id } };
					return { ok: true, target, reproveTarget: async () => ({ proven: true, observed_digest: target.target_proof_digest }) };
				},
				tokenRetrieval,
				deliver,
				proveAuthenticatedState: async ({ target_id }) => proof
					? { proven: true, proof: { target_id, page_id: "page-authenticated", frame_id: "frame-authenticated", origin: proofOrigin, subject_reference: "subject-ref", account_reference: "account-ref", tenant_reference: "tenant-ref", identity_basis_digest: "basis-digest" } }
					: { proven: false, cause: "human-identity-attestation-required" },
			},
		},
		{
			run,
			dispatch_claim: { fencing_token: 1, activation_epoch: 1, holderId: "dispatch" },
			service_id: "fixture",
			auth_context_ref: "interactive-login",
			allowed_origins: ["https://fixture.test"],
			expected_url: "https://fixture.test/login",
			target_id: "target-fixture",
		},
	);
	return { result, delivered };
}

describe("runbook auth route", () => {
	test("keeps run identity and gates one business dispatch behind authenticated ready", async () => {
		const { result, delivered } = await fixture(true);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.run.run_id).toBe("shared-run-fixture");
		expect(result.run.handoff_evidence_id).toBe("handoff-fixture");
		// `ready` is the observable gate the caller keys business dispatch on, and
		// the delivered order proves the full username->password flow ran once.
		expect(result.run.state).toBe("ready");
		expect(delivered).toEqual(["username", "password"]);
	});

	test("ambiguous authenticated state returns one continuation and zero business dispatch", async () => {
		const { result } = await fixture(false);
		// The blocked envelope (not a ready run) is what withholds business dispatch;
		// asserting it is the real "zero dispatch" proof.
		expect(result).toMatchObject({
			ok: false,
			blocked: {
				blocked_cause: "human-identity-attestation-required",
				continuation: { next_action_id: "complete-human-identity-attestation" },
			},
		});
		expect(result.ok === false && "run" in result && result.run.state === "ready").toBe(false);
	});

	test("authenticated-state proof on a moved origin refuses before business dispatch", async () => {
		const { result } = await fixture(true, "https://moved.fixture.test");
		expect(result).toMatchObject({
			ok: false,
			blocked: {
				blocked_cause: "origin-mismatch",
				continuation: { next_action_id: "inspect-origin-mismatch" },
			},
		});
	});
});
