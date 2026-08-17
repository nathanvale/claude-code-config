import { describe, expect, test } from "bun:test";

import {
	VAULT_GIT_NEXT_ACTION_IDS,
	isVaultGitCliSafeValue,
	isVaultGitOwnedPathLeaf,
	type VaultGitRepairAction,
} from "../src/model.ts";
import {
	VAULT_GIT_ACTION_AFFORDANCES,
	VAULT_GIT_NEXT_SAFE_ACTION_IDS,
	type VaultGitContinuationContext,
	bindVaultGitPublicInput,
	projectVaultGitNextSafeAction,
	rehydrateVaultGitPersistedNextAction,
} from "../src/next-safe-action.ts";

const ALL_SELECTORS = {
	transaction_id: "txn_11111111111111111111111111111111",
	task_id: "task_11111111111111111111111111111111",
	doctor_task_id: "doctor_task_11111111111111111111111111111111",
	repair_id: "redact-secret-value",
} as const;

describe("vault-git Next Safe Action catalog", () => {
	test("classifies reconcile_quarantine as a network write", () => {
		expect(
			VAULT_GIT_ACTION_AFFORDANCES.find(
				(entry) => entry.id === "reconcile_quarantine",
			),
		).toMatchObject({
			id: "reconcile_quarantine",
			sideEffects: ["read", "check", "network", "write"],
		});
	});

	test("projects the reconcile_quarantine invoke continuation", () => {
		const projection = projectVaultGitNextSafeAction({
			action_id: "reconcile_quarantine",
			selectors: { transaction_id: "txn_11111111111111111111111111111111" },
		});

		expect(projection).toEqual({
			availability: "available",
			continuation: {
				kind: "invoke",
				action_id: "reconcile_quarantine",
				summary: "Reconcile the quarantined host transaction.",
				executable: "vault-git",
				argv: [
					"repair",
					"reconcile-quarantine",
					"--transaction-id",
					"txn_11111111111111111111111111111111",
					"--json",
				],
			},
		});
	});

	test("fails closed to unavailable when reconcile_quarantine has no transaction_id", () => {
		const projection = projectVaultGitNextSafeAction({
			action_id: "reconcile_quarantine",
		});
		expect(projection).toEqual({
			availability: "unavailable",
			continuation: {
				kind: "none",
				action_id: "none",
				summary:
					"No safe continuation is available; operator review is required.",
			},
		});
	});

	test("fails closed to unavailable, and never echoes a private selector value", () => {
		const secret = "/tmp/vault-git/owner-capability";
		const projection = projectVaultGitNextSafeAction({
			action_id: "reconcile_quarantine",
			selectors: { transaction_id: secret },
		});
		expect(projection.availability).toBe("unavailable");
		expect(projection.continuation.kind).toBe("none");
		expect(JSON.stringify(projection)).not.toContain(secret);
	});

	test("projects the provision_repository_ssh needs_human external_prerequisite handoff", () => {
		const projection = projectVaultGitNextSafeAction({
			action_id: "provision_repository_ssh",
		});

		expect(projection).toEqual({
			availability: "available",
			continuation: {
				kind: "needs_human",
				action_id: "provision_repository_ssh",
				summary: "Provision the dedicated repository SSH identity.",
				handoff_kind: "external_prerequisite",
				owner: "repository_ssh_owner",
				condition: "dedicated_identity_ready",
			},
		});
	});

	test("provide_host_enrollment_inputs projects the shipped private input contract", () => {
		expect(
			projectVaultGitNextSafeAction({
				action_id: "provide_host_enrollment_inputs",
			}),
		).toEqual({
			availability: "available",
			continuation: {
				kind: "needs_input",
				action_id: "provide_host_enrollment_inputs",
				summary: "Provide the Host Enrollment inputs.",
				input_contract_id: "setup.vault-git.host-enrollment",
				fields: [
					{ id: "ssh_identity_file_path", input_channel: "private_stdin" },
					{ id: "ssh_public_key_path", input_channel: "private_stdin" },
					{ id: "ssh_known_hosts_path", input_channel: "private_stdin" },
				],
			},
		});
	});

	test("preview_host_enrollment_repair projects the shipped Setup preview invoke", () => {
		expect(
			projectVaultGitNextSafeAction({
				action_id: "preview_host_enrollment_repair",
			}),
		).toEqual({
			availability: "available",
			continuation: {
				kind: "invoke",
				action_id: "preview_host_enrollment_repair",
				summary: "Preview the Host Enrollment repair.",
				executable: "setup",
				argv: ["sync", "--domain", "vault-git", "--check", "--json"],
			},
		});
	});

	test("catalog owns every closed #390 action id exactly once", () => {
		const ids = [...VAULT_GIT_NEXT_SAFE_ACTION_IDS];
		expect(new Set(ids).size).toBe(ids.length);
		for (const required of [
			"reconcile_quarantine",
			"reattest_stale_lease_takeover",
			"preview_host_enrollment_repair",
			"provide_host_enrollment_inputs",
			"provision_repository_ssh",
			"escalate_validation_evidence",
			"apply_vault_content_repair",
			"diagnose_validation_budget",
			"inspect_completion_task",
			"run_janitor",
			"restore_transaction_capability",
			"resume_vault_content_promotion",
			"resume_repaired_transaction",
			"reconcile_repair_promotion",
			"close_verified_publication",
			"retry_proven_unpublished",
			"obtain_remote_evidence",
			"resolve_publication_conflict",
			"restore_remote_contract",
			"inspect_doctor_task",
			"none",
		]) {
			expect(ids).toContain(required);
		}
	});

	test("projects the terminal none continuation as available", () => {
		expect(projectVaultGitNextSafeAction({ action_id: "none" })).toEqual({
			availability: "available",
			continuation: {
				kind: "none",
				action_id: "none",
				summary: "No further action; this workflow is finished.",
			},
		});
	});

	test("apply_vault_content_repair is feature-gated and unavailable now", () => {
		// The vault-content repair command is not yet shipped, so this action fails
		// closed even with complete selectors; no caller can run a command that
		// does not exist. The exact argv shape is asserted in the semantic matrix.
		expect(
			projectVaultGitNextSafeAction({
				action_id: "apply_vault_content_repair",
				selectors: {
					transaction_id: "txn_11111111111111111111111111111111",
					repair_id: "redact-secret-value",
				},
			}).availability,
		).toBe("unavailable");
	});

	// Gap 1: authoritative coverage of every emitted semantic id. Each id is driven
	// with its REAL per-action context and selectors (never one synthetic context
	// bent to pass); every known id resolves to a concrete four-kind continuation.
	test("every existing public next-action id resolves under its real context", () => {
		const fullSelectors = {
			...ALL_SELECTORS,
			evidence_reference: `vault-git:prepared:v2:${"0".repeat(64)}`,
		};
		// Typed per-id context table for the legacy contextual subset. Keys are the
		// exact contextual action ids; values are typed VaultGitContinuationContext.
		const CONTEXTUAL: Readonly<Record<string, VaultGitContinuationContext>> = {
			inspect_status: { result_kind: "transaction_receipt" },
			retry_remote: { result_kind: "inspect" },
			run_repair: { repair_action: "resume" },
			change_input: { result_kind: "completion_task" },
			change_owned_paths: { emission_command: "begin" },
		};
		for (const id of VAULT_GIT_NEXT_ACTION_IDS) {
			// The one deliberately feature-gated public id (U5 vault_content_repair);
			// its fail-closed posture has its own dedicated test above.
			if (id === "apply_vault_content_repair") continue;
			const context = CONTEXTUAL[id];
			const projection = projectVaultGitNextSafeAction({
				action_id: id,
				selectors: fullSelectors,
				...(context ? { context } : {}),
			});
			expect(projection.availability).toBe("available");
			expect(["invoke", "needs_input", "needs_human", "none"]).toContain(
				projection.continuation.kind,
			);
			expect(projection.continuation.summary.trim().length).toBeGreaterThan(0);
		}
	});

	// Negative control: an out-of-contract result_kind cannot silently select a
	// contextual route. The typed union rejects it at compile time; at runtime a
	// forged value must fail closed to unavailable, never a guessed mapping.
	test("an invalid result_kind fails closed instead of selecting a route", () => {
		const forged = { result_kind: "not_a_real_kind" } as unknown as VaultGitContinuationContext;
		expect(
			projectVaultGitNextSafeAction({
				action_id: "inspect_status",
				context: forged,
			}).availability,
		).toBe("unavailable");
		expect(
			projectVaultGitNextSafeAction({
				action_id: "retry_remote",
				context: forged,
			}).availability,
		).toBe("unavailable");
	});

	// Gap 1: an unknown mapping fails closed to a terminal none continuation.
	test("an unmapped action id fails closed to unavailable + terminal none", () => {
		const projection = projectVaultGitNextSafeAction({
			action_id: "not_a_real_action_id",
		});
		expect(projection).toEqual({
			availability: "unavailable",
			continuation: {
				kind: "none",
				action_id: "none",
				summary:
					"No safe continuation is available; operator review is required.",
			},
		});
	});

	test("prototype-inherited action ids remain unknown and fail closed", () => {
		for (const actionId of ["toString", "constructor", "hasOwnProperty"]) {
			const projection = projectVaultGitNextSafeAction({ action_id: actionId });
			expect(projection.availability).toBe("unavailable");
			expect(projection.continuation).toMatchObject({
				kind: "none",
				action_id: "none",
			});
			expect(rehydrateVaultGitPersistedNextAction(actionId)).toMatchObject({
				kind: "none",
				id: "none",
				action_id: "none",
			});
		}
	});

	// Supervisor requirement: summary text is never the availability discriminator.
	test("availability classification is independent of summary text", () => {
		const available = projectVaultGitNextSafeAction({
			action_id: "reconcile_quarantine",
			selectors: { transaction_id: "txn_11111111111111111111111111111111" },
		});
		const unavailable = projectVaultGitNextSafeAction({
			action_id: "not_a_real_action_id",
		});
		// An available continuation and an unavailable one can share zero summary
		// text and still be told apart purely by the typed availability field.
		expect(available.availability).toBe("available");
		expect(unavailable.availability).toBe("unavailable");
		expect(available.continuation.summary).not.toBe(
			unavailable.continuation.summary,
		);
		// The classifier keys on availability, not on any summary substring.
		expect(typeof available.availability).toBe("string");
	});

	// Gap 2: the two task-inspection actions have distinct selector contracts.
	test("inspect_doctor_task binds a doctor_task_ id, not a plain task_ id", () => {
		expect(
			projectVaultGitNextSafeAction({
				action_id: "inspect_doctor_task",
				selectors: {
					doctor_task_id: "doctor_task_11111111111111111111111111111111",
				},
			}),
		).toEqual({
			availability: "available",
			continuation: {
				kind: "invoke",
				action_id: "inspect_doctor_task",
				summary: "Inspect the Doctor Task.",
				executable: "vault-git",
				argv: [
					"doctor",
					"--task-id",
					"doctor_task_11111111111111111111111111111111",
					"--json",
				],
			},
		});

		expect(
			projectVaultGitNextSafeAction({
				action_id: "inspect_doctor_task",
				selectors: { task_id: "task_11111111111111111111111111111111" },
			}).availability,
		).toBe("unavailable");
	});

	test("inspect_completion_task binds a plain task_ id, not a doctor_task_ id", () => {
		expect(
			projectVaultGitNextSafeAction({
				action_id: "inspect_completion_task",
				selectors: {
					doctor_task_id: "doctor_task_11111111111111111111111111111111",
				},
			}).availability,
		).toBe("unavailable");
	});

	// Gap 3: needs_human supports both external_prerequisite and command handoffs.
	test("reattest_stale_lease_takeover is a needs_human external_prerequisite", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "reattest_stale_lease_takeover",
		});
		expect(continuation.kind).toBe("needs_human");
		if (continuation.kind !== "needs_human") throw new Error("unreachable");
		expect(continuation.handoff_kind).toBe("external_prerequisite");
	});

	test("a command handoff carries one exact invocation and no owner/condition", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "return_to_human_review",
			selectors: {
				evidence_reference: `vault-git:prepared:v2:${"a".repeat(64)}`,
			},
		});
		expect(continuation.kind).toBe("needs_human");
		if (continuation.kind !== "needs_human") throw new Error("unreachable");
		expect(continuation.handoff_kind).toBe("command");
		if (continuation.handoff_kind !== "command") throw new Error("unreachable");
		expect(continuation.executable).toBe("vault-git");
		expect(continuation.argv).toEqual([
			"activation",
			"review",
			`vault-git:prepared:v2:${"a".repeat(64)}`,
			"--json",
		]);
	});

	// Real prepared-evidence reference acceptance and rejection (activation contract format).
	test("return_to_human_review accepts a real evidence reference and rejects a fake one", () => {
		const real = `vault-git:prepared:v2:${"0".repeat(64)}`;
		expect(
			projectVaultGitNextSafeAction({
				action_id: "return_to_human_review",
				selectors: { evidence_reference: real },
			}).availability,
		).toBe("available");

		expect(
			projectVaultGitNextSafeAction({
				action_id: "return_to_human_review",
				selectors: { evidence_reference: "prepared-1" },
			}).availability,
		).toBe("unavailable");
	});

	// retry_remote is context-dependent: begin retry vs inspect-time remote retry.
	// A begin retry needs event + owned paths, which are not permitted continuation
	// selectors, so it is a named needs_input contract, never a bare begin argv.
	test("retry_remote in begin context is the begin-transaction needs_input contract", () => {
		const projection = projectVaultGitNextSafeAction({
			action_id: "retry_remote",
			context: { result_kind: "begin" },
		});
		expect(projection).toEqual({
			availability: "available",
			continuation: {
				kind: "needs_input",
				action_id: "begin_transaction",
				summary: "Begin a Vault Transaction.",
				input_contract_id: "vault-git.begin",
				fields: [
					{ id: "event", input_channel: "public" },
					{ id: "owned_paths", input_channel: "public" },
				],
			},
		});
	});

	test("retry_remote in inspect context projects a doctor continuation with the transaction", () => {
		const { availability, continuation } = projectVaultGitNextSafeAction({
			action_id: "retry_remote",
			context: { result_kind: "inspect" },
			selectors: { transaction_id: "txn_11111111111111111111111111111111" },
		});
		expect(availability).toBe("available");
		expect(continuation.kind).toBe("invoke");
		if (continuation.kind !== "invoke") throw new Error("unreachable");
		expect(continuation.argv).toEqual([
			"doctor",
			"--transaction-id",
			"txn_11111111111111111111111111111111",
			"--json",
		]);
	});

	test("retry_remote with no context fails closed to unavailable", () => {
		expect(
			projectVaultGitNextSafeAction({ action_id: "retry_remote" }).availability,
		).toBe("unavailable");
	});

	// begin_transaction needs event + owned paths, which are not permitted
	// continuation selectors, so it is a named needs_input contract with exact
	// ordered descriptors and no argv.
	test("begin_transaction is the exact begin needs_input contract", () => {
		expect(
			projectVaultGitNextSafeAction({ action_id: "begin_transaction" }),
		).toEqual({
			availability: "available",
			continuation: {
				kind: "needs_input",
				action_id: "begin_transaction",
				summary: "Begin a Vault Transaction.",
				input_contract_id: "vault-git.begin",
				fields: [
					{ id: "event", input_channel: "public" },
					{ id: "owned_paths", input_channel: "public" },
				],
			},
		});
	});

	// The pure public-input binder validates descriptor ids and returns the
	// complete sanitized invoke. Input is an ordered entry list so duplicate ids
	// are representable (and refusable). owned_paths carries a typed list value;
	// each path emits its own --path argument, never a comma-joined value. The
	// event is a real VAULT_GIT_EVENT_TYPES literal.
	test("public-input binder returns the full begin invocation with one --path per path", () => {
		const projection = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (projection.continuation.kind !== "needs_input") {
			throw new Error("unreachable");
		}

		const bound = bindVaultGitPublicInput(projection.continuation, [
			{ id: "event", value: "note_created" },
			{ id: "owned_paths", value: ["notes/one.md", "notes/two.md"] },
		]);
		expect(bound).toEqual({
			kind: "invoke",
			action_id: "begin_transaction",
			summary: "Begin a Vault Transaction.",
			executable: "vault-git",
			argv: [
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/one.md",
				"--path",
				"notes/two.md",
				"--json",
			],
		});
	});

	test("public-input binder binds contextual change_owned_paths for begin", () => {
		const context = { emission_command: "begin" as const };
		const projection = projectVaultGitNextSafeAction({
			action_id: "change_owned_paths",
			context,
		});
		if (projection.continuation.kind !== "needs_input") {
			throw new Error("unreachable");
		}

		expect(
			bindVaultGitPublicInput(
				projection.continuation,
				[
					{ id: "event", value: "note_created" },
					{ id: "owned_paths", value: ["notes/one.md"] },
				],
				{ context },
			),
		).toEqual({
			kind: "invoke",
			action_id: "change_owned_paths",
			summary: "Correct the owned paths, then begin.",
			executable: "vault-git",
			argv: [
				"begin",
				"--event",
				"note_created",
				"--path",
				"notes/one.md",
				"--json",
			],
		});
	});

	test("public-input binder binds contextual change_owned_paths for join", () => {
		const transactionId = "txn_11111111111111111111111111111111";
		const context = { emission_command: "join" as const };
		const projection = projectVaultGitNextSafeAction({
			action_id: "change_owned_paths",
			context,
		});
		if (projection.continuation.kind !== "needs_input") {
			throw new Error("unreachable");
		}

		expect(
			bindVaultGitPublicInput(
				projection.continuation,
				[{ id: "owned_paths", value: ["notes/joined.md"] }],
				{
					context,
					selectors: { transaction_id: transactionId },
				},
			),
		).toEqual({
			kind: "invoke",
			action_id: "change_owned_paths",
			summary: "Correct the joined owned paths.",
			executable: "vault-git",
			argv: [
				"join",
				"--transaction-id",
				transactionId,
				"--path",
				"notes/joined.md",
				"--json",
			],
		});
	});

	test("public-input binder refuses a missing required field id", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "note_created" },
			]),
		).toThrow(/owned_paths|missing/i);
	});

	test("public-input binder refuses an unknown/extra field id", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "note_created" },
				{ id: "owned_paths", value: ["notes/one.md"] },
				{ id: "surprise", value: "nope" },
			]),
		).toThrow(/surprise|unknown|extra/i);
	});

	test("public-input binder refuses a duplicate field id", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "note_created" },
				{ id: "event", value: "work_completed" },
				{ id: "owned_paths", value: ["notes/one.md"] },
			]),
		).toThrow(/duplicate/i);
	});

	test("public-input binder refuses a wrong value type", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		// owned_paths must be a list; a scalar string is the wrong type.
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "note_created" },
				{ id: "owned_paths", value: "notes/one.md" },
			]),
		).toThrow(/owned_paths|type|list/i);
	});

	test("public-input binder refuses zero owned paths", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "note_created" },
				{ id: "owned_paths", value: [] },
			]),
		).toThrow(/owned_paths|at least one|empty/i);
	});

	test("public-input binder refuses an invalid event literal", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "docs_update" },
				{ id: "owned_paths", value: ["notes/one.md"] },
			]),
		).toThrow(/event/i);
	});

	// The binder must reject a forged or stale continuation whose descriptor
	// diverges from the authoritative catalog, before it reads any value.
	test("public-input binder rejects a divergent continuation descriptor", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		const values = [
			{ id: "event", value: "note_created" },
			{ id: "owned_paths", value: ["notes/one.md"] },
		];

		// Tampered contract id.
		expect(() =>
			bindVaultGitPublicInput(
				{ ...continuation, input_contract_id: "vault-git.forged" },
				values,
			),
		).toThrow(/divergen|contract/i);

		// Tampered summary.
		expect(() =>
			bindVaultGitPublicInput(
				{ ...continuation, summary: "Do something else." },
				values,
			),
		).toThrow(/divergen|summary/i);

		// Reordered fields.
		expect(() =>
			bindVaultGitPublicInput(
				{
					...continuation,
					fields: [continuation.fields[1], continuation.fields[0]],
				},
				values,
			),
		).toThrow(/divergen|order|field/i);

		// Renamed field id.
		expect(() =>
			bindVaultGitPublicInput(
				{
					...continuation,
					fields: [
						{ id: "evt", input_channel: "public" },
						continuation.fields[1],
					],
				},
				values,
			),
		).toThrow(/divergen|field/i);

		// Changed channel.
		expect(() =>
			bindVaultGitPublicInput(
				{
					...continuation,
					fields: [
						{ id: "event", input_channel: "private_stdin" },
						continuation.fields[1],
					],
				},
				values,
			),
		).toThrow(/divergen|channel|private/i);
	});

	test("public-input binder refuses an option-shaped or escaping path", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		// Option-shaped.
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "note_created" },
				{ id: "owned_paths", value: ["--json"] },
			]),
		).toThrow(/path/i);
		// Parent-escaping.
		expect(() =>
			bindVaultGitPublicInput(continuation, [
				{ id: "event", value: "note_created" },
				{ id: "owned_paths", value: ["../secret"] },
			]),
		).toThrow(/path/i);
	});

	// run_repair projects to the exact doctor-classified repair command, never a
	// Doctor self-loop. The four owner-authority repairs are agent-executable
	// invoke continuations with their exact current argv.
	test("run_repair maps the four owner repairs to their exact invoke argv", () => {
		const txn = "txn_11111111111111111111111111111111";
		const cases: Array<[VaultGitRepairAction, readonly string[]]> = [
			["resume", ["repair", "resume", "--transaction-id", txn, "--json"]],
			[
				"retry-push",
				["repair", "retry-push", "--transaction-id", txn, "--json"],
			],
			[
				"close-verified",
				["repair", "close-verified", "--transaction-id", txn, "--json"],
			],
			[
				"reconcile-quarantine",
				["repair", "reconcile-quarantine", "--transaction-id", txn, "--json"],
			],
		];
		for (const [repair_action, argv] of cases) {
			const { availability, continuation } = projectVaultGitNextSafeAction({
				action_id: "run_repair",
				context: { repair_action },
				selectors: { transaction_id: txn },
			});
			expect(availability).toBe("available");
			expect(continuation.kind).toBe("invoke");
			if (continuation.kind !== "invoke") throw new Error("unreachable");
			expect(continuation.executable).toBe("vault-git");
			expect(continuation.argv).toEqual(argv);
		}
	});

	// stale-lease-takeover requires --prior-writer-stopped, a human attestation,
	// so it is a needs_human command handoff, never an agent-executable invoke.
	test("run_repair stale-lease-takeover is a needs_human command with the attestation flag", () => {
		const txn = "txn_11111111111111111111111111111111";
		const { availability, continuation } = projectVaultGitNextSafeAction({
			action_id: "run_repair",
			context: { repair_action: "stale-lease-takeover" },
			selectors: { transaction_id: txn },
		});
		expect(availability).toBe("available");
		expect(continuation.kind).toBe("needs_human");
		if (continuation.kind !== "needs_human") throw new Error("unreachable");
		expect(continuation.handoff_kind).toBe("command");
		if (continuation.handoff_kind !== "command") throw new Error("unreachable");
		expect(continuation.executable).toBe("vault-git");
		expect(continuation.argv).toEqual([
			"repair",
			"stale-lease-takeover",
			"--transaction-id",
			txn,
			"--prior-writer-stopped",
			"--json",
		]);
	});

	// A non-takeover repair (resume) may resume a pre-acknowledgement receipt with no
	// transaction id: the transaction id is OPTIONAL, emitted only when supplied.
	test("run_repair resume without a transaction id is runnable as `repair resume --json`", () => {
		const { availability, continuation } = projectVaultGitNextSafeAction({
			action_id: "run_repair",
			context: { repair_action: "resume" },
		});
		expect(availability).toBe("available");
		expect(continuation.kind).toBe("invoke");
		if (continuation.kind !== "invoke") throw new Error("unreachable");
		expect(continuation.argv).toEqual(["repair", "resume", "--json"]);
	});

	test("run_repair resume with a transaction id emits the --transaction-id flag", () => {
		const txn = "txn_11111111111111111111111111111111";
		const { availability, continuation } = projectVaultGitNextSafeAction({
			action_id: "run_repair",
			context: { repair_action: "resume" },
			selectors: { transaction_id: txn },
		});
		expect(availability).toBe("available");
		expect(continuation.kind).toBe("invoke");
		if (continuation.kind !== "invoke") throw new Error("unreachable");
		expect(continuation.argv).toEqual([
			"repair",
			"resume",
			"--transaction-id",
			txn,
			"--json",
		]);
	});

	// stale-lease-takeover is the sole repair that REQUIRES a transaction id; without
	// it (and the attestation) there is no safe continuation, so it fails closed.
	test("run_repair stale-lease-takeover without a transaction id fails closed", () => {
		const projection = projectVaultGitNextSafeAction({
			action_id: "run_repair",
			context: { repair_action: "stale-lease-takeover" },
		});
		expect(projection.availability).toBe("unavailable");
		expect(projection.continuation.kind).toBe("none");
	});

	test("the attestation flag never appears in an agent-executable invoke", () => {
		const txn = "txn_11111111111111111111111111111111";
		for (const repair_action of [
			"resume",
			"retry-push",
			"close-verified",
			"reconcile-quarantine",
		] as VaultGitRepairAction[]) {
			const { continuation } = projectVaultGitNextSafeAction({
				action_id: "run_repair",
				context: { repair_action },
				selectors: { transaction_id: txn },
			});
			if (continuation.kind === "invoke") {
				expect(continuation.argv).not.toContain("--prior-writer-stopped");
			}
		}
	});

	// run_repair needs its repair_action to resolve which repair to run; without it the
	// projection fails closed. (A non-takeover repair no longer needs a transaction id;
	// that runnable-without-txn case is proved above; takeover-without-txn fail-closed
	// is proved separately.)
	test("run_repair without a repair_action fails closed", () => {
		expect(
			projectVaultGitNextSafeAction({ action_id: "run_repair" }).availability,
		).toBe("unavailable");
	});

	test("run_doctor is executable with or without a transaction selector", () => {
		const withoutTransaction = projectVaultGitNextSafeAction({
			action_id: "run_doctor",
		});
		expect(withoutTransaction).toMatchObject({
			availability: "available",
			continuation: {
				kind: "invoke",
				action_id: "run_doctor",
				argv: ["doctor", "--json"],
			},
		});

		const transactionId = "txn_11111111111111111111111111111111";
		const withTransaction = projectVaultGitNextSafeAction({
			action_id: "run_doctor",
			selectors: { transaction_id: transactionId },
		});
		expect(withTransaction.continuation).toMatchObject({
			kind: "invoke",
			action_id: "run_doctor",
			argv: ["doctor", "--transaction-id", transactionId, "--json"],
		});
	});

	// inspect_status splits by result_kind (legacy contextual reprojection).
	test("legacy inspect_status reprojects by result_kind", () => {
		const completion = projectVaultGitNextSafeAction({
			action_id: "inspect_status",
			context: { result_kind: "completion_task" },
			selectors: { task_id: "task_11111111111111111111111111111111" },
		});
		expect(completion.continuation.kind).toBe("invoke");
		if (completion.continuation.kind !== "invoke") throw new Error("unreachable");
		expect(completion.continuation.argv).toEqual([
			"status",
			"--task-id",
			"task_11111111111111111111111111111111",
			"--json",
		]);

		const doctor = projectVaultGitNextSafeAction({
			action_id: "inspect_status",
			context: { result_kind: "doctor_task" },
			selectors: {
				doctor_task_id: "doctor_task_11111111111111111111111111111111",
			},
		});
		expect(doctor.continuation.kind).toBe("invoke");
		if (doctor.continuation.kind !== "invoke") throw new Error("unreachable");
		expect(doctor.continuation.argv[0]).toBe("doctor");

		const receipt = projectVaultGitNextSafeAction({
			action_id: "inspect_status",
			context: { result_kind: "transaction_receipt" },
		});
		expect(receipt.continuation.kind).toBe("invoke");
		if (receipt.continuation.kind !== "invoke") throw new Error("unreachable");
		expect(receipt.continuation.argv).toEqual(["status", "--json"]);
	});
});

// The two Owned Path rules are deliberately distinct. The leaf rule is for literal
// filesystem paths (on-disk adapter, durable store/ledger): it accepts a literal
// leading dash and an embedded LF. The CLI-token rule (for argv-bound values)
// rejects both. The public input binder composes BOTH, so a literal path that is
// valid on disk is still refused as public argv when it is option-shaped or carries
// a control character.
describe("vault-git Owned Path leaf vs CLI-token split", () => {
	test("the leaf rule accepts a leading-dash and an embedded-LF literal path", () => {
		expect(isVaultGitOwnedPathLeaf("-owned.md")).toBe(true);
		expect(isVaultGitOwnedPathLeaf(":magic*[x]\n.md")).toBe(true);
		// It still rejects absolute, trailing-slash, NUL/CR, and `.git` segments.
		expect(isVaultGitOwnedPathLeaf("/etc/passwd")).toBe(false);
		expect(isVaultGitOwnedPathLeaf("notes/")).toBe(false);
		expect(isVaultGitOwnedPathLeaf("a\rb.md")).toBe(false);
		expect(isVaultGitOwnedPathLeaf("a\0b.md")).toBe(false);
		expect(isVaultGitOwnedPathLeaf(".git/config")).toBe(false);
	});

	test("the CLI-token rule rejects a leading dash and any CR/LF/NUL", () => {
		expect(isVaultGitCliSafeValue("-owned.md")).toBe(false);
		expect(isVaultGitCliSafeValue(":magic*[x]\n.md")).toBe(false);
		expect(isVaultGitCliSafeValue("a\rb.md")).toBe(false);
		expect(isVaultGitCliSafeValue("notes/one.md")).toBe(true);
	});

	test("the public input binder refuses a leading-dash or embedded-LF owned path", () => {
		const { continuation } = projectVaultGitNextSafeAction({
			action_id: "begin_transaction",
		});
		if (continuation.kind !== "needs_input") throw new Error("unreachable");
		for (const badPath of ["-owned.md", ":magic*[x]\n.md"]) {
			expect(() =>
				bindVaultGitPublicInput(continuation, [
					{ id: "event", value: "note_created" },
					{ id: "owned_paths", value: [badPath] },
				]),
			).toThrow(/path/i);
		}
	});
});
