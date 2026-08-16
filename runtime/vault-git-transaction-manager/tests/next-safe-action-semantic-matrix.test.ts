import { describe, expect, test } from "bun:test";

import { parseVaultGitInvocation } from "../src/command-contract.ts";
import {
	VAULT_GIT_NEXT_SAFE_ACTION_IDS,
	projectVaultGitNextSafeAction,
	type VaultGitContinuationContext,
	type VaultGitNextSafeActionContinuation,
} from "../src/next-safe-action.ts";

/**
 * Independent exact semantic matrix. For every real emission branch of every
 * existing next-action id, it pins the expected continuation kind and — for an
 * invoke or command handoff — the exact argv, which it drives through the real
 * command parser to prove the projection is a genuine, parser-accepted command.
 * This catches well-typed but semantically-wrong mappings that a valid-kind /
 * nonempty-summary check misses.
 */

const TXN = "txn_11111111111111111111111111111111";
const TASK = "task_11111111111111111111111111111111";
const DOCTOR_TASK = "doctor_task_11111111111111111111111111111111";
const EVIDENCE = `vault-git:prepared:v2:${"0".repeat(64)}`;
const REPAIR_ID = "redact-secret-value";

const SELECTORS = {
	transaction_id: TXN,
	task_id: TASK,
	doctor_task_id: DOCTOR_TASK,
	evidence_reference: EVIDENCE,
	repair_id: REPAIR_ID,
} as const;

type ExpectInvoke = {
	readonly kind: "invoke";
	readonly argv: readonly string[];
};
type ExpectCommand = {
	readonly kind: "needs_human";
	readonly handoff_kind: "command";
	readonly argv: readonly string[];
};
type ExpectPrerequisite = {
	readonly kind: "needs_human";
	readonly handoff_kind: "external_prerequisite";
	readonly owner: string;
	readonly condition: string;
};
type ExpectNeedsInput = {
	readonly kind: "needs_input";
	readonly input_contract_id: string;
};
type ExpectNone = { readonly kind: "none" };
type Expectation =
	| ExpectInvoke
	| ExpectCommand
	| ExpectPrerequisite
	| ExpectNeedsInput
	| ExpectNone;

interface MatrixRow {
	readonly label: string;
	readonly action_id: string;
	readonly context?: VaultGitContinuationContext;
	readonly expect: Expectation;
}

// Feature-gated catalog actions: their continuation targets a command that only
// becomes executable once its product feature ships, so they fail closed to
// unavailable today. Mapped to the owning implementation unit for test bookkeeping
// only — the runtime names product features, never plan units.
const FEATURE_GATED: Readonly<Record<string, string>> = {
	preview_host_enrollment_repair: "vault_git_host_enrollment",
	provide_host_enrollment_inputs: "vault_git_host_enrollment",
	apply_vault_content_repair: "vault_content_repair",
	resume_vault_content_promotion: "vault_content_repair",
};

// The parser accepts an invoke/command argv (throws on rejection). This asserts
// the projected command is real and parser-accepted before trusting the mapping.
function assertParserAccepts(argv: readonly string[]): void {
	expect(() => parseVaultGitInvocation([...argv])).not.toThrow();
}

function assertContinuation(
	continuation: VaultGitNextSafeActionContinuation,
	expect_: Expectation,
): void {
	expect(continuation.kind).toBe(expect_.kind);
	if (expect_.kind === "invoke" && continuation.kind === "invoke") {
		expect(continuation.argv).toEqual(expect_.argv);
		// Every available vault-git invoke MUST parse today (gated future commands
		// never reach here — they project unavailable).
		if (continuation.executable === "vault-git") {
			assertParserAccepts(continuation.argv);
		}
		return;
	}
	if (expect_.kind === "needs_input" && continuation.kind === "needs_input") {
		expect(continuation.input_contract_id).toBe(expect_.input_contract_id);
		return;
	}
	if (expect_.kind === "none") return;
	if (expect_.kind === "needs_human" && continuation.kind === "needs_human") {
		expect(continuation.handoff_kind).toBe(expect_.handoff_kind);
		if (
			expect_.handoff_kind === "command" &&
			continuation.handoff_kind === "command"
		) {
			expect(continuation.argv).toEqual(expect_.argv);
			assertParserAccepts(continuation.argv);
			return;
		}
		if (
			expect_.handoff_kind === "external_prerequisite" &&
			continuation.handoff_kind === "external_prerequisite"
		) {
			expect(String(continuation.owner)).toBe(expect_.owner);
			expect(continuation.condition).toBe(expect_.condition);
			return;
		}
	}
	throw new Error(`unhandled expectation for kind ${continuation.kind}`);
}

const MATRIX: readonly MatrixRow[] = [
	// --- inspection / discovery ---
	{
		label: "inspect_status @ transaction_receipt -> status",
		action_id: "inspect_status",
		context: { result_kind: "transaction_receipt" },
		expect: { kind: "invoke", argv: ["status", "--json"] },
	},
	{
		label: "inspect_status @ completion_task -> status --task-id",
		action_id: "inspect_status",
		context: { result_kind: "completion_task" },
		expect: {
			kind: "invoke",
			argv: ["status", "--task-id", TASK, "--json"],
		},
	},
	{
		label: "inspect_status @ doctor_task -> doctor --task-id",
		action_id: "inspect_status",
		context: { result_kind: "doctor_task" },
		expect: {
			kind: "invoke",
			argv: ["doctor", "--task-id", DOCTOR_TASK, "--json"],
		},
	},
	{
		label: "inspect_completion_task -> status --task-id",
		action_id: "inspect_completion_task",
		expect: {
			kind: "invoke",
			argv: ["status", "--task-id", TASK, "--json"],
		},
	},
	{
		label: "inspect_doctor_task -> doctor --task-id",
		action_id: "inspect_doctor_task",
		expect: {
			kind: "invoke",
			argv: ["doctor", "--task-id", DOCTOR_TASK, "--json"],
		},
	},
	{
		label: "inspect_configured_vault -> Activation Home",
		action_id: "inspect_configured_vault",
		expect: { kind: "invoke", argv: ["activation", "--json"] },
	},
	{
		label: "inspect_commands -> commands --json",
		action_id: "inspect_commands",
		expect: { kind: "invoke", argv: ["commands", "--json"] },
	},
	{
		label: "inspect_remote_lease -> doctor --transaction-id",
		action_id: "inspect_remote_lease",
		expect: {
			kind: "invoke",
			argv: ["doctor", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "run_doctor -> doctor --transaction-id",
		action_id: "run_doctor",
		expect: {
			kind: "invoke",
			argv: ["doctor", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "run_janitor -> janitor",
		action_id: "run_janitor",
		expect: { kind: "invoke", argv: ["janitor", "--json"] },
	},

	// --- completion family (needs_input; commit subject is caller input) ---
	{
		label: "complete_transaction -> complete needs_input",
		action_id: "complete_transaction",
		expect: { kind: "needs_input", input_contract_id: "vault-git.complete" },
	},
	{
		label: "resume_writing -> complete needs_input",
		action_id: "resume_writing",
		expect: { kind: "needs_input", input_contract_id: "vault-git.complete" },
	},
	{
		label: "run_owned_path_checks -> complete needs_input",
		action_id: "run_owned_path_checks",
		expect: { kind: "needs_input", input_contract_id: "vault-git.complete" },
	},
	{
		label: "change_commit_summary -> complete needs_input",
		action_id: "change_commit_summary",
		expect: { kind: "needs_input", input_contract_id: "vault-git.complete" },
	},

	// --- begin family (needs_input; begin requires event + paths) ---
	{
		label: "begin_transaction -> begin needs_input",
		action_id: "begin_transaction",
		expect: { kind: "needs_input", input_contract_id: "vault-git.begin" },
	},
	{
		label: "change_owned_paths @ begin -> begin needs_input",
		action_id: "change_owned_paths",
		context: { emission_command: "begin" },
		expect: { kind: "needs_input", input_contract_id: "vault-git.begin" },
	},
	{
		label: "change_owned_paths @ join -> join needs_input (preserves join role)",
		action_id: "change_owned_paths",
		context: { emission_command: "join" },
		expect: { kind: "needs_input", input_contract_id: "vault-git.join" },
	},

	// --- join role: continue_outer_transaction is terminal for the joiner ---
	{
		label: "continue_outer_transaction -> terminal none (outer owner completes)",
		action_id: "continue_outer_transaction",
		expect: { kind: "none" },
	},

	// --- capability lane: private, never a public argv ---
	{
		label: "use_owner_capability -> private capability prerequisite",
		action_id: "use_owner_capability",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "transaction_owner",
			condition: "owner_capability_supplied",
		},
	},
	{
		label: "use_join_capability -> private capability prerequisite",
		action_id: "use_join_capability",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "join_owner",
			condition: "join_capability_supplied",
		},
	},
	{
		label: "reload_capability -> private launcher prerequisite",
		action_id: "reload_capability",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "private_launcher",
			condition: "transaction_capability_reloaded",
		},
	},

	// --- repair family (run_repair carries the exact doctor-classified action) ---
	{
		label: "run_repair resume -> invoke repair resume",
		action_id: "run_repair",
		context: { repair_action: "resume" },
		expect: {
			kind: "invoke",
			argv: ["repair", "resume", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "run_repair retry-push -> invoke repair retry-push",
		action_id: "run_repair",
		context: { repair_action: "retry-push" },
		expect: {
			kind: "invoke",
			argv: ["repair", "retry-push", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "run_repair close-verified -> invoke repair close-verified",
		action_id: "run_repair",
		context: { repair_action: "close-verified" },
		expect: {
			kind: "invoke",
			argv: ["repair", "close-verified", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "run_repair reconcile-quarantine -> invoke repair reconcile-quarantine",
		action_id: "run_repair",
		context: { repair_action: "reconcile-quarantine" },
		expect: {
			kind: "invoke",
			argv: [
				"repair",
				"reconcile-quarantine",
				"--transaction-id",
				TXN,
				"--json",
			],
		},
	},
	{
		label: "run_repair stale-lease-takeover -> command handoff (attestation)",
		action_id: "run_repair",
		context: { repair_action: "stale-lease-takeover" },
		expect: {
			kind: "needs_human",
			handoff_kind: "command",
			argv: [
				"repair",
				"stale-lease-takeover",
				"--transaction-id",
				TXN,
				"--prior-writer-stopped",
				"--json",
			],
		},
	},
	{
		label: "retry_push -> invoke repair retry-push",
		action_id: "retry_push",
		expect: {
			kind: "invoke",
			argv: ["repair", "retry-push", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "reconcile_quarantine -> invoke repair reconcile-quarantine",
		action_id: "reconcile_quarantine",
		expect: {
			kind: "invoke",
			argv: [
				"repair",
				"reconcile-quarantine",
				"--transaction-id",
				TXN,
				"--json",
			],
		},
	},
	{
		label: "request_operator_takeover -> command handoff (attestation)",
		action_id: "request_operator_takeover",
		expect: {
			kind: "needs_human",
			handoff_kind: "command",
			argv: [
				"repair",
				"stale-lease-takeover",
				"--transaction-id",
				TXN,
				"--prior-writer-stopped",
				"--json",
			],
		},
	},

	// --- activation surface ---
	{
		label: "prepare_fresh -> activation prepare",
		action_id: "prepare_fresh",
		expect: {
			kind: "invoke",
			argv: ["activation", "prepare", "--json"],
		},
	},
	{
		label: "review_prepared -> interactive human review command",
		action_id: "review_prepared",
		expect: {
			kind: "needs_human",
			handoff_kind: "command",
			argv: ["activation", "review", EVIDENCE, "--json"],
		},
	},
	{
		label: "return_to_human_review -> interactive human review command",
		action_id: "return_to_human_review",
		expect: {
			kind: "needs_human",
			handoff_kind: "command",
			argv: ["activation", "review", EVIDENCE, "--json"],
		},
	},
	{
		label: "configure_activation_identity -> external prerequisite",
		action_id: "configure_activation_identity",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "activation_identity_configured",
		},
	},

	// --- operator / evidence handoffs ---
	{
		label: "request_operator_review -> external prerequisite",
		action_id: "request_operator_review",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "operator_reviewed_evidence",
		},
	},
	{
		label: "inspect_private_receipt -> external prerequisite",
		action_id: "inspect_private_receipt",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "private_receipt_inspected",
		},
	},
	{
		label: "preserve_local_edits -> external prerequisite",
		action_id: "preserve_local_edits",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "local_edits_preserved",
		},
	},

	// --- offline / runtime prerequisites (not terminal none) ---
	{
		label: "capture_private_draft -> offline prerequisite",
		action_id: "capture_private_draft",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "online_connectivity_restored",
		},
	},
	{
		label: "wait_for_runtime -> runtime prerequisite",
		action_id: "wait_for_runtime",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "runtime_owner_available",
		},
	},

	// --- retry_remote contextual branches ---
	{
		label: "retry_remote @ begin -> begin needs_input (event + paths)",
		action_id: "retry_remote",
		context: { result_kind: "begin" },
		expect: { kind: "needs_input", input_contract_id: "vault-git.begin" },
	},
	{
		label: "retry_remote @ inspect -> doctor --transaction-id",
		action_id: "retry_remote",
		context: { result_kind: "inspect" },
		expect: {
			kind: "invoke",
			argv: ["doctor", "--transaction-id", TXN, "--json"],
		},
	},

	// --- change_input contextual corrections ---
	{
		label: "change_input @ completion_task -> completion task-id needs_input",
		action_id: "change_input",
		context: { result_kind: "completion_task" },
		expect: {
			kind: "needs_input",
			input_contract_id: "vault-git.completion-task-id",
		},
	},
	{
		label: "change_input @ doctor_task -> doctor task-id needs_input",
		action_id: "change_input",
		context: { result_kind: "doctor_task" },
		expect: {
			kind: "needs_input",
			input_contract_id: "vault-git.doctor-task-id",
		},
	},

	// --- completion family: continue_transaction (same complete contract) ---
	{
		label: "continue_transaction -> complete needs_input",
		action_id: "continue_transaction",
		expect: { kind: "needs_input", input_contract_id: "vault-git.complete" },
	},

	// --- #390 validation route matrix ---
	{
		label: "provision_repository_ssh -> external prerequisite (repository_ssh_owner)",
		action_id: "provision_repository_ssh",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "repository_ssh_owner",
			condition: "dedicated_identity_ready",
		},
	},
	{
		label: "escalate_validation_evidence -> external prerequisite",
		action_id: "escalate_validation_evidence",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "validation_evidence_required",
		},
	},
	{
		label: "diagnose_validation_budget -> external prerequisite (performance owner)",
		action_id: "diagnose_validation_budget",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_performance_owner",
			condition: "validation_stage_budget_diagnosed",
		},
	},

	// --- #390 Stale-Lease Takeover ---
	{
		label: "reattest_stale_lease_takeover -> external prerequisite",
		action_id: "reattest_stale_lease_takeover",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "stale_lease_takeover_reattested",
		},
	},

	// --- #390 interrupted Repair Promotion ---
	{
		label: "restore_transaction_capability -> external prerequisite",
		action_id: "restore_transaction_capability",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "transaction_owner_capability_available",
		},
	},
	{
		label: "resume_repaired_transaction -> invoke repair resume",
		action_id: "resume_repaired_transaction",
		expect: {
			kind: "invoke",
			argv: ["repair", "resume", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "reconcile_repair_promotion -> external prerequisite",
		action_id: "reconcile_repair_promotion",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "repair_promotion_reconciliation_required",
		},
	},

	// --- #390 Unknown Publication Outcome ---
	{
		label: "close_verified_publication -> invoke repair close-verified",
		action_id: "close_verified_publication",
		expect: {
			kind: "invoke",
			argv: ["repair", "close-verified", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "retry_proven_unpublished -> invoke repair retry-push",
		action_id: "retry_proven_unpublished",
		expect: {
			kind: "invoke",
			argv: ["repair", "retry-push", "--transaction-id", TXN, "--json"],
		},
	},
	{
		label: "obtain_remote_evidence -> external prerequisite",
		action_id: "obtain_remote_evidence",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "remote_evidence_available",
		},
	},
	{
		label: "resolve_publication_conflict -> external prerequisite",
		action_id: "resolve_publication_conflict",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "publication_conflict_resolved",
		},
	},
	{
		label: "restore_remote_contract -> external prerequisite",
		action_id: "restore_remote_contract",
		expect: {
			kind: "needs_human",
			handoff_kind: "external_prerequisite",
			owner: "vault_git_operator",
			condition: "remote_contract_restored",
		},
	},

	// --- terminal ---
	{ label: "none -> terminal none", action_id: "none", expect: { kind: "none" } },
];

describe("vault-git Next Safe Action semantic matrix", () => {
	for (const row of MATRIX) {
		test(row.label, () => {
			const projection = projectVaultGitNextSafeAction({
				action_id: row.action_id,
				selectors: SELECTORS,
				...(row.context ? { context: row.context } : {}),
			});
			expect(projection.availability).toBe("available");
			assertContinuation(projection.continuation, row.expect);
		});
	}

	// Feature-gated actions fail closed to unavailable today, so no caller can try
	// to execute a command that does not yet exist. When their product feature
	// ships (removing the catalog gate), these flip to available and the matrix
	// must gain their rows — the bijection enforces that.
	test("feature-gated catalog actions return unavailable now", () => {
		for (const actionId of Object.keys(FEATURE_GATED)) {
			const projection = projectVaultGitNextSafeAction({
				action_id: actionId,
				selectors: SELECTORS,
			});
			expect(projection.availability).toBe("unavailable");
			expect(projection.continuation.kind).toBe("none");
		}
	});

	// Every available vault-git invoke/command in the matrix parser-accepts today.
	test("every available vault-git command parser-accepts today", () => {
		for (const row of MATRIX) {
			const { continuation } = projectVaultGitNextSafeAction({
				action_id: row.action_id,
				selectors: SELECTORS,
				...(row.context ? { context: row.context } : {}),
			});
			const argv =
				continuation.kind === "invoke" &&
				continuation.executable === "vault-git"
					? continuation.argv
					: continuation.kind === "needs_human" &&
							continuation.handoff_kind === "command" &&
							continuation.executable === "vault-git"
						? continuation.argv
						: null;
			if (argv !== null) {
				expect(() => parseVaultGitInvocation([...argv])).not.toThrow();
			}
		}
	});

	// Fail closed when a legacy contextual id has no context to disambiguate.
	test("change_input without context fails closed", () => {
		expect(
			projectVaultGitNextSafeAction({ action_id: "change_input" }).availability,
		).toBe("unavailable");
	});

	test("change_owned_paths without emission_command fails closed", () => {
		expect(
			projectVaultGitNextSafeAction({ action_id: "change_owned_paths" })
				.availability,
		).toBe("unavailable");
	});

	// Branch bijection: every reachable BRANCH — each direct catalog key plus each
	// contextual branch of a legacy id — is owned by exactly one matrix row. A
	// missing, duplicate, or extra branch key fails, so no catalog entry or context
	// branch can land without a matrix row.
	test("matrix rows are a bijection with every reachable branch", () => {
		// Reprojection targets: catalog keys reached only via a legacy id's context
		// branch (not directly emitted). Excluded from direct coverage; their
		// coverage is asserted through the owning legacy branch below.
		const REPROJECTION_TARGETS = new Set([
			"inspect_transaction", // via inspect_status @ transaction_receipt
			"correct_completion_task_id", // via change_input @ completion_task
			"correct_doctor_task_id", // via change_input @ doctor_task
		]);

		// Legacy ids that fan out into typed context branches. Each branch is a
		// distinct required key of the form `<id>@<branch>`.
		const CONTEXTUAL_BRANCHES: Readonly<Record<string, readonly string[]>> = {
			inspect_status: [
				"transaction_receipt",
				"completion_task",
				"doctor_task",
			],
			retry_remote: ["begin", "inspect"],
			change_input: ["completion_task", "doctor_task"],
			change_owned_paths: ["begin", "join"],
			run_repair: [
				"resume",
				"retry-push",
				"close-verified",
				"stale-lease-takeover",
				"reconcile-quarantine",
			],
		};
		const LEGACY_CONTEXTUAL = new Set(Object.keys(CONTEXTUAL_BRANCHES));

		// Expected branch keys: direct catalog keys (minus reprojection targets,
		// legacy fan-out ids, and feature-gated actions that fail closed today)
		// plus one key per declared contextual branch. Feature-gated actions are
		// covered by their own unavailable-now test, not as available rows.
		const gated = new Set(Object.keys(FEATURE_GATED));
		const expected = new Set<string>();
		for (const key of VAULT_GIT_NEXT_SAFE_ACTION_IDS) {
			if (REPROJECTION_TARGETS.has(key)) continue;
			if (LEGACY_CONTEXTUAL.has(key)) continue;
			if (gated.has(key)) continue;
			expected.add(key);
		}
		for (const [id, branches] of Object.entries(CONTEXTUAL_BRANCHES)) {
			for (const branch of branches) expected.add(`${id}@${branch}`);
		}

		// Actual branch keys owned by matrix rows.
		const branchKeyOf = (row: MatrixRow): string => {
			if (!LEGACY_CONTEXTUAL.has(row.action_id)) return row.action_id;
			const ctx = row.context;
			const branch =
				row.action_id === "run_repair"
					? ctx?.repair_action
					: row.action_id === "change_owned_paths"
						? ctx?.emission_command
						: ctx?.result_kind;
			return `${row.action_id}@${branch ?? "none"}`;
		};
		const actualCounts = new Map<string, number>();
		for (const row of MATRIX) {
			const key = branchKeyOf(row);
			actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1);
		}
		const actual = new Set(actualCounts.keys());

		const missing = [...expected].filter((key) => !actual.has(key)).sort();
		const extra = [...actual].filter((key) => !expected.has(key)).sort();
		const duplicates = [...actualCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([key]) => key)
			.sort();

		expect({ missing, extra, duplicates }).toEqual({
			missing: [],
			extra: [],
			duplicates: [],
		});
	});
});
