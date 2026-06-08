import { describe, expect, test } from "bun:test";

import {
	CliRuntimeContractError,
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
	type DiagnosticTrailReference,
	type StructuredRuntimeError,
	validateAgentHint,
	validateStructuredRuntimeError,
} from "@side-quest/cli-command-facade";
import {
	assertNoRuntimeContractFixtureLeaks,
	extendRuntimeContractRedactionFixtures,
	listRuntimeContractFixtureLeaks,
	RUNTIME_CONTRACT_REDACTION_FIXTURES,
} from "@side-quest/cli-command-facade/testing";

describe("CLI command facade runtime envelope", () => {
	test("builds ADR-0010 success envelopes", () => {
		const runtimeActions = [
			{
				id: "inspect-readiness",
				summary: "Inspect runtime readiness.",
				side_effects: ["check"],
			},
		] as const;
		// R7/KTD3: an envelope with runtime_actions must carry a continuation
		// posture, so the happy path now pins the matching continuation too.
		const continuation = { next_action_id: "inspect-readiness" } as const;

		const envelope = createCliRuntimeSuccessEnvelope({
			run_id: "run-test-1",
			data: { ok: true },
			runtime_actions: runtimeActions,
			continuation,
		});

		expect(envelope).toEqual({
			status: "ok",
			run_id: "run-test-1",
			data: { ok: true },
			runtime_actions: runtimeActions,
			continuation,
		});
		expect(envelope).not.toHaveProperty("schema_version");
		expect(envelope).not.toHaveProperty("schemaVersion");
		expect(envelope.runtime_actions).not.toBe(runtimeActions);
		expect(envelope.runtime_actions?.[0]?.side_effects).not.toBe(
			runtimeActions[0].side_effects,
		);
	});

	test("builds ADR-0010 error envelopes", () => {
		const error = createTestRuntimeError();

		const envelope = createCliRuntimeErrorEnvelope({
			run_id: "run-test-1",
			error,
			process_exit_code: 2,
		});

		expect(envelope).toEqual({
			status: "error",
			run_id: "run-test-1",
			error,
		});
		expect(envelope).not.toHaveProperty("schema_version");
		expect(envelope).not.toHaveProperty("schemaVersion");
		expect(envelope.error).not.toBe(error);
		expect(envelope.error.hint).not.toBe(error.hint);
	});

	test("carries package-owned data on error envelopes", () => {
		const data = {
			failure_kind: "route_failure",
			candidate_decisions: [{ adapter_id: "chrome-devtools" }],
		};

		const envelope = createCliRuntimeErrorEnvelope({
			run_id: "run-test-1",
			data,
			error: createTestRuntimeError(),
			process_exit_code: 2,
		});

		expect(envelope.status).toBe("error");
		expect(envelope.data).toBe(data);
	});

	// U4: Diagnostic Trail Reference (KTD6) — a same-run pointer from a failed
	// invocation to a package-owned Diagnostic Capability, narrowed to exclude
	// raw logs, trace URLs, retention, and access policy.
	describe("diagnostic trail reference", () => {
		const diagnosticTrail: DiagnosticTrailReference = {
			run_id: "run-test-1",
			surface: { kind: "diagnostic_capability", id: "runtime:inspect" },
			summary: "Run the readiness check to see why the write was refused.",
			docs_url: "https://docs.example.test/cli/diagnostics",
		};

		test("clones a matching-run_id trail into the error envelope output", () => {
			const envelope = createCliRuntimeErrorEnvelope({
				run_id: "run-test-1",
				error: createTestRuntimeError(),
				process_exit_code: 2,
				diagnostic_trail: diagnosticTrail,
			});

			expect(envelope.diagnostic_trail).toEqual(diagnosticTrail);
			// Defensive copy: not the same reference, and the nested surface is cloned.
			expect(envelope.diagnostic_trail).not.toBe(diagnosticTrail);
			expect(envelope.diagnostic_trail?.surface).not.toBe(
				diagnosticTrail.surface,
			);
		});

		test("clones a trail into the success envelope output", () => {
			const envelope = createCliRuntimeSuccessEnvelope({
				run_id: "run-test-1",
				data: { ok: true },
				diagnostic_trail: {
					run_id: "run-test-1",
					surface: { kind: "diagnostic_capability", id: "runtime:inspect" },
				},
			});

			expect(envelope.diagnostic_trail).toEqual({
				run_id: "run-test-1",
				surface: { kind: "diagnostic_capability", id: "runtime:inspect" },
			});
		});

		test("fails when the trail run_id differs from the envelope run_id", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: { ...diagnosticTrail, run_id: "run-other" },
				}),
			);
			expect(issues).toContain(
				"diagnostic_trail.run_id must match envelope run_id",
			);
		});

		test("fails when summary carries a local log path", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: {
						...diagnosticTrail,
						summary: "See /Users/nathanvale/.cache/cli/run.log for detail.",
					},
				}),
			);
			expect(
				issues.some((issue) =>
					issue.startsWith(
						"diagnostic_trail.summary includes unsafe runtime-contract text: local-path",
					),
				),
			).toBe(true);
		});

		test("fails when docs_url points at a non-public host", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: {
						...diagnosticTrail,
						docs_url: "http://127.0.0.1:9222/devtools/trace",
					},
				}),
			);
			expect(issues).toContain(
				"diagnostic_trail.docs_url must not point at a non-public host",
			);
		});

		test("fails for an unsupported surface.kind", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: {
						run_id: "run-test-1",
						surface: {
							kind: "raw_log_file" as never,
							id: "runtime:inspect",
						},
					},
				}),
			);
			expect(
				issues.some((issue) =>
					issue.startsWith(
						"diagnostic_trail.surface.kind must be one of: diagnostic_capability",
					),
				),
			).toBe(true);
		});

		test("rejects a forbidden raw-log field via the allowed-keys gate", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: {
						...diagnosticTrail,
						log_path: "/var/log/cli/run.log",
					} as never,
				}),
			);
			expect(
				issues.some((issue) =>
					issue.startsWith(
						"diagnostic_trail.log_path is not a supported runtime-contract field",
					),
				),
			).toBe(true);
		});

		test("fails for a non-object diagnostic_trail", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: "not-an-object" as never,
				}),
			);
			expect(issues).toContain("diagnostic_trail must be an object");
		});

		test("fails for an empty surface.id", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: {
						run_id: "run-test-1",
						surface: { kind: "diagnostic_capability", id: "" },
					},
				}),
			);
			expect(issues).toContain(
				"diagnostic_trail.surface.id must be a non-empty string",
			);
		});

		test("fails when summary carries a control character (parity with projected free-text fields)", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: {
						...diagnosticTrail,
						// An ANSI escape (ESC, 0x1B) — rejected by validateProjectedFreeText
						// but invisible to a bare safe-text pattern scan.
						summary: "Readiness check \x1b[31mfailed\x1b[0m.",
					},
				}),
			);
			expect(issues).toContain(
				"diagnostic_trail.summary contains control characters",
			);
		});

		test("fails when surface.id carries a control character", () => {
			const issues = captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					diagnostic_trail: {
						run_id: "run-test-1",
						surface: {
							kind: "diagnostic_capability",
							id: "runtime\x00inspect",
						},
					},
				}),
			);
			expect(issues).toContain(
				"diagnostic_trail.surface.id contains control characters",
			);
		});

		test("a failure envelope carries runtime_actions, continuation, and diagnostic_trail without collision", () => {
			const runtimeActions = [
				{
					id: "inspect-readiness",
					summary: "Inspect runtime readiness.",
					side_effects: ["check"],
				},
			] as const;

			const envelope = createCliRuntimeErrorEnvelope({
				run_id: "run-test-1",
				error: createTestRuntimeError(),
				process_exit_code: 2,
				runtime_actions: runtimeActions,
				continuation: { next_action_id: "inspect-readiness" },
				diagnostic_trail: {
					run_id: "run-test-1",
					surface: { kind: "diagnostic_capability", id: "runtime:inspect" },
				},
			});

			expect(envelope.runtime_actions).toEqual(runtimeActions);
			expect(envelope.continuation).toEqual({
				next_action_id: "inspect-readiness",
			});
			expect(envelope.diagnostic_trail).toEqual({
				run_id: "run-test-1",
				surface: { kind: "diagnostic_capability", id: "runtime:inspect" },
			});
		});
	});

	test("validates structured runtime errors and agent hints", () => {
		expect(
			validateStructuredRuntimeError(createTestRuntimeError(), {
				run_id: "run-test-1",
				process_exit_code: 2,
			}),
		).toEqual([]);
		expect(
			validateAgentHint(
				{
					summary: "Authenticate before retrying.",
					action: "authenticate",
					docs_url: "https://docs.example.test/auth",
				},
				{ recoverability: "authenticate" },
			),
		).toEqual([]);
		expect(
			validateAgentHint(
				{
					summary: "Read the troubleshooting page.",
					action: "open_docs",
					docs_url: "https://docs.example.test/troubleshooting",
				},
				{ recoverability: "repair_state" },
			),
		).toEqual([]);

		expect(
			validateStructuredRuntimeError(
				createTestRuntimeError({ severity: "spicy" as never }),
			),
		).toContain("error.severity must be one of: info, warning, error, fatal");
		expect(
			validateStructuredRuntimeError(
				createTestRuntimeError({
					recoverability: "authenticate",
					retryable: true,
				}),
			),
		).toContain("error.retryable true requires recoverability retry");
		expect(
			validateAgentHint(
				{ summary: "Retry the same input.", action: "retry" },
				{ recoverability: "authenticate" },
			),
		).toContain("hint.action must match or refine recoverability");
		expect(validateAgentHint({ action: "retry" })).toContain(
			"hint.summary must be a non-empty string",
		);
		expect(
			validateAgentHint({
				summary: "Open local docs.",
				docs_url: "file:///tmp/runtime-contract",
			}),
		).toContain("hint.docs_url must use http or https");
	});

	test("rejects invalid runtime envelopes", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError({ exit_code: 1 }),
					process_exit_code: 2,
				}),
			),
		).toContain("error.exit_code must match process_exit_code");
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [],
				}),
			),
		).toContain(
			"runtime_actions must be omitted when no runtime actions are present",
		);
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{
							id: "",
							summary: "",
							side_effects: [],
						},
					],
				}),
			),
		).toEqual(
			// A continuation-required issue (R7) co-occurs with the action-shape
			// issues now that runtime_actions demands a continuation posture.
			expect.arrayContaining([
				"runtime_actions.0.id must be a non-empty string",
				"runtime_actions.0.summary must be a non-empty string",
				"runtime_actions.0.side_effects must not be empty",
				"continuation is required when runtime_actions is present",
			]),
		);
	});

	test("rejects unsafe runtime-contract projection text", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError({
						message: "Bearer sqe.secret.token",
					}),
					process_exit_code: 2,
				}),
			),
		).toContain(
			"error.message includes unsafe runtime-contract text: credential",
		);
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{
							id: "inspect",
							summary: "Run bun test now.",
							side_effects: ["check"],
						},
					],
				}),
			),
		).toContain(
			"runtime_actions.0.summary includes unsafe runtime-contract text: command-example",
		);
		expect(
			validateAgentHint({
				summary: "Repair missing scope:finance.bankstatementsplus.read.",
			}),
		).toContain("hint.summary includes unsafe runtime-contract text: scope");
	});

	// U1 — Runtime Continuation Guidance (ADR-0010 amendment). `continuation`
	// expresses this invocation's continuation decision; it is required whenever
	// runtime_actions are emitted, and must carry exactly one posture.
	test("clones continuation on a success envelope with a matching next_action_id", () => {
		const runtimeActions = [
			{
				id: "inspect-readiness",
				summary: "Inspect runtime readiness.",
				side_effects: ["check"],
			},
		] as const;
		const continuation = {
			next_action_id: "inspect-readiness",
			constraints: [
				{
					id: "no-browser",
					summary: "Do not launch the browser before readiness passes.",
					forbidden_side_effects: ["browser"],
				},
			],
		} as const;

		const envelope = createCliRuntimeSuccessEnvelope({
			run_id: "run-test-1",
			data: { ok: true },
			runtime_actions: runtimeActions,
			continuation,
		});

		expect(envelope).toEqual({
			status: "ok",
			run_id: "run-test-1",
			data: { ok: true },
			runtime_actions: runtimeActions,
			continuation,
		});
		expect(envelope.continuation).not.toBe(continuation);
		expect(envelope.continuation?.constraints).not.toBe(
			continuation.constraints,
		);
		expect(
			envelope.continuation?.constraints?.[0]?.forbidden_side_effects,
		).not.toBe(continuation.constraints[0].forbidden_side_effects);
	});

	test("carries failure_domain, action docs_url, and continuation constraints on an error envelope", () => {
		const envelope = createCliRuntimeErrorEnvelope({
			run_id: "run-test-1",
			error: createTestRuntimeError({ failure_domain: "browser_entry" }),
			process_exit_code: 2,
			runtime_actions: [
				{
					id: "open-troubleshooting",
					summary: "Read the troubleshooting steps.",
					side_effects: ["read"],
					docs_url: "https://docs.example.test/cli/troubleshooting",
				},
			],
			continuation: {
				requires_operator: true,
				constraints: [
					{
						id: "needs-human",
						summary: "An operator must confirm the workspace before retrying.",
						forbidden_action_ids: ["open-troubleshooting"],
					},
				],
			},
		});

		expect(envelope.error.failure_domain).toBe("browser_entry");
		expect(envelope.runtime_actions?.[0]?.docs_url).toBe(
			"https://docs.example.test/cli/troubleshooting",
		);
		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope.continuation?.constraints?.[0]?.id).toBe("needs-human");
		// docs_url must be deep-cloned, not shared with the caller input.
		expect(envelope.runtime_actions).not.toBe(undefined);
	});

	test("clones operator recovery choices on an error envelope", () => {
		const directSideEffects = ["check"] as const;
		const envelope = createCliRuntimeErrorEnvelope({
			run_id: "run-test-1",
			error: createTestRuntimeError({
				code: "adapter_dependency_missing",
				recoverability: "repair_state",
				retryable: false,
				hint: {
					summary: "Choose how to repair adapter dependencies.",
					action: "repair_state",
				},
			}),
			process_exit_code: 2,
			runtime_actions: [
				{
					id: "install-runner",
					summary: "Install the missing runner.",
					side_effects: ["write", "network"],
				},
			],
			continuation: {
				requires_operator: true,
				constraints: [
					{
						id: "no-fallback",
						summary: "Do not switch to another adapter.",
						forbidden_action_ids: ["adapter-fallback"],
						forbidden_side_effects: ["browser"],
					},
				],
				choices: [
					{
						id: "install-runner",
						label: "Install runner",
						summary: "Best when this machine should have the runner.",
						recoverability: "repair_state",
						action_id: "install-runner",
					},
					{
						id: "inspect-config",
						label: "Inspect config",
						summary: "Best before making local setup changes.",
						recoverability: "repair_state",
						side_effects: directSideEffects,
						docs_url: "https://docs.example.test/adapter/config",
					},
				],
			},
		});

		expect(envelope.continuation?.choices).toEqual([
			{
				id: "install-runner",
				label: "Install runner",
				summary: "Best when this machine should have the runner.",
				recoverability: "repair_state",
				action_id: "install-runner",
			},
			{
				id: "inspect-config",
				label: "Inspect config",
				summary: "Best before making local setup changes.",
				recoverability: "repair_state",
				side_effects: ["check"],
				docs_url: "https://docs.example.test/adapter/config",
			},
		]);
		expect(envelope.continuation?.choices?.[1]?.side_effects).not.toBe(
			directSideEffects,
		);
	});

	test("rejects recovery choices outside an error operator stop", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					continuation: {
						requires_operator: true,
						constraints: [
							{ id: "needs-human", summary: "Operator must choose." },
						],
						choices: [
							{
								id: "inspect-config",
								label: "Inspect config",
								summary: "Review setup state.",
								recoverability: "repair_state",
								side_effects: ["check"],
							},
						],
					},
				}),
			),
		).toContain("continuation.choices is valid only on error envelopes");

		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: {
						next_action_id: "inspect",
						choices: [
							{
								id: "inspect-config",
								label: "Inspect config",
								summary: "Review setup state.",
								recoverability: "repair_state",
								side_effects: ["check"],
							},
						],
					},
				}),
			),
		).toEqual(
			expect.arrayContaining([
				"continuation.choices requires requires_operator true",
				"continuation.choices must not be used with continuation.next_action_id",
			]),
		);
	});

	test("rejects malformed recovery choice fields", () => {
		const issues = captureRuntimeContractIssues(() =>
			createCliRuntimeErrorEnvelope({
				run_id: "run-test-1",
				error: createTestRuntimeError(),
				process_exit_code: 2,
				continuation: {
					requires_operator: true,
					constraints: [
						{ id: "needs-human", summary: "Operator must choose." },
					],
					choices: [
						{
							id: "",
							label: "",
							summary: "",
							recoverability: "spicy",
						} as never,
					],
				},
			}),
		);

		expect(issues).toEqual(
			expect.arrayContaining([
				"continuation.choices.0.id must be a non-empty string",
				"continuation.choices.0.label must be a non-empty string",
				"continuation.choices.0.summary must be a non-empty string",
				"continuation.choices.0.recoverability must be one of: none, retry, change_input, authenticate, repair_state, contact_support",
				"continuation.choices.0.side_effects is required without action_id",
			]),
		);
	});

	test("rejects invalid recovery choice side-effect ownership", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					runtime_actions: [
						{ id: "install", summary: "Install.", side_effects: ["write"] },
					],
					continuation: {
						requires_operator: true,
						constraints: [
							{ id: "needs-human", summary: "Operator must choose." },
						],
						choices: [
							{
								id: "install",
								label: "Install",
								summary: "Install the missing dependency.",
								recoverability: "repair_state",
								action_id: "install",
								side_effects: ["write"],
							},
						],
					},
				}),
			),
		).toContain(
			"continuation.choices.0.side_effects must be omitted when action_id is present",
		);

		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					continuation: {
						requires_operator: true,
						constraints: [
							{ id: "needs-human", summary: "Operator must choose." },
						],
						choices: [
							{
								id: "inspect-config",
								label: "Inspect config",
								summary: "Review setup state.",
								recoverability: "repair_state",
								side_effects: ["spicy"],
							} as never,
						],
					},
				}),
			),
		).toContain(
			"continuation.choices.0.side_effects.0 must be one of: read, check, write, destructive, auth, network, browser",
		);
	});

	test("rejects recovery choice action references without matching runtime actions", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					continuation: {
						requires_operator: true,
						constraints: [
							{ id: "needs-human", summary: "Operator must choose." },
						],
						choices: [
							{
								id: "install",
								label: "Install",
								summary: "Install the missing dependency.",
								recoverability: "repair_state",
								action_id: "install",
							},
						],
					},
				}),
			),
		).toContain(
			"continuation.choices.0.action_id requires emitted runtime_actions",
		);

		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: {
						requires_operator: true,
						constraints: [
							{ id: "needs-human", summary: "Operator must choose." },
						],
						choices: [
							{
								id: "install",
								label: "Install",
								summary: "Install the missing dependency.",
								recoverability: "repair_state",
								action_id: "install",
							},
						],
					},
				}),
			),
		).toContain(
			"continuation.choices.0.action_id must reference a runtime_actions[].id",
		);
	});

	test("rejects recovery choices that conflict with continuation constraints", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					runtime_actions: [
						{
							id: "adapter-fallback",
							summary: "Use fallback adapter.",
							side_effects: ["read"],
						},
					],
					continuation: {
						requires_operator: true,
						constraints: [
							{
								id: "no-fallback",
								summary: "Do not switch adapters.",
								forbidden_action_ids: ["adapter-fallback"],
							},
						],
						choices: [
							{
								id: "fallback",
								label: "Use fallback",
								summary: "Switch to another adapter.",
								recoverability: "repair_state",
								action_id: "adapter-fallback",
							},
						],
					},
				}),
			),
		).toContain(
			"continuation.choices.0.action_id must not appear in continuation.constraints[].forbidden_action_ids",
		);

		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					continuation: {
						requires_operator: true,
						constraints: [
							{
								id: "no-browser",
								summary: "Do not open a browser.",
								forbidden_side_effects: ["browser"],
							},
						],
						choices: [
							{
								id: "launch",
								label: "Launch browser",
								summary: "Open a browser for inspection.",
								recoverability: "repair_state",
								side_effects: ["browser"],
							},
						],
					},
				}),
			),
		).toContain(
			"continuation.choices.0 must not use a side effect forbidden by continuation.constraints",
		);
	});

	test("rejects a continuation next_action_id that no runtime action declares", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: { next_action_id: "absent" },
				}),
			),
		).toContain(
			"continuation.next_action_id must reference a runtime_actions[].id",
		);
	});

	test("rejects a continuation that sets both next_action_id and requires_operator", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: {
						next_action_id: "inspect",
						requires_operator: true,
						constraints: [
							{ id: "c", summary: "Operator must review the result." },
						],
					},
				}),
			),
		).toContain(
			"continuation must set exactly one of next_action_id or requires_operator",
		);
	});

	test("rejects a continuation that sets neither next_action_id nor requires_operator", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: {},
				}),
			),
		).toContain(
			"continuation must set exactly one of next_action_id or requires_operator",
		);
	});

	test("rejects an operator-stop continuation with no constraint summary", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: { requires_operator: true },
				}),
			),
		).toContain(
			"continuation.requires_operator requires at least one constraint summary",
		);
	});

	test("rejects duplicate continuation constraint ids", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: {
						next_action_id: "inspect",
						constraints: [
							{ id: "dup", summary: "First constraint." },
							{ id: "dup", summary: "Second constraint." },
						],
					},
				}),
			),
		).toContain("continuation.constraints.1.id must be unique");
	});

	test("rejects an unknown forbidden_side_effects value", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: {
						next_action_id: "inspect",
						constraints: [
							{
								id: "c",
								summary: "No spicy work.",
								forbidden_side_effects: ["spicy"] as never,
							},
						],
					},
				}),
			),
		).toContain(
			`continuation.constraints.0.forbidden_side_effects.0 must be one of: ${[
				"read",
				"check",
				"write",
				"destructive",
				"auth",
				"network",
				"browser",
			].join(", ")}`,
		);
	});

	test("rejects a primary action whose id is forbidden by the same continuation", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "fallback", summary: "Fall back.", side_effects: ["read"] },
					],
					continuation: {
						next_action_id: "fallback",
						constraints: [
							{
								id: "no-fallback",
								summary: "Never fall back to the legacy adapter.",
								forbidden_action_ids: ["fallback"],
							},
						],
					},
				}),
			),
		).toContain(
			"continuation.next_action_id must not appear in continuation.constraints[].forbidden_action_ids",
		);
	});

	test("rejects a primary action whose side effects are forbidden by the same continuation", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{
							id: "launch",
							summary: "Launch the workflow.",
							side_effects: ["browser"],
						},
					],
					continuation: {
						next_action_id: "launch",
						constraints: [
							{
								id: "no-browser",
								summary: "Do not open the browser before readiness passes.",
								forbidden_side_effects: ["browser"],
							},
						],
					},
				}),
			),
		).toContain(
			"continuation primary action must not use a side effect forbidden by continuation.constraints",
		);
	});

	test("rejects command-like fields on a runtime action", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{
							id: "inspect",
							summary: "Inspect.",
							side_effects: ["check"],
							command_template: "bun run inspect",
							safe_command: "bun run inspect",
						} as never,
					],
					continuation: { next_action_id: "inspect" },
				}),
			),
		).toEqual(
			expect.arrayContaining([
				"runtime_actions.0.command_template is not a supported runtime-contract field",
				"runtime_actions.0.safe_command is not a supported runtime-contract field",
			]),
		);
	});

	test("rejects unsafe and public-unsafe runtime action docs_url targets", () => {
		const docsUrlIssues = (docsUrl: string) =>
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{
							id: "open-docs",
							summary: "Open the docs.",
							side_effects: ["read"],
							docs_url: docsUrl,
						},
					],
					continuation: { next_action_id: "open-docs" },
				}),
			);

		expect(docsUrlIssues("https://user:pass@docs.example.test/x")).toContain(
			"runtime_actions.0.docs_url must not include credentials",
		);
		expect(docsUrlIssues("file:///tmp/runtime-contract")).toContain(
			"runtime_actions.0.docs_url must use http or https",
		);
		expect(docsUrlIssues("http://localhost:8080/docs")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		expect(docsUrlIssues("http://127.0.0.1:8080/docs")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		expect(docsUrlIssues("http://10.0.0.1/docs")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		expect(docsUrlIssues("http://169.254.169.254/latest/meta-data")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		// Remaining RFC-1918 ranges and the all-zeros host.
		expect(docsUrlIssues("http://192.168.1.1/docs")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		expect(docsUrlIssues("http://172.16.0.1/docs")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		expect(docsUrlIssues("http://0.0.0.0/docs")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		// A trailing FQDN-root dot must not bypass the localhost match.
		expect(docsUrlIssues("http://localhost./docs")).toContain(
			"runtime_actions.0.docs_url must not point at a non-public host",
		);
		// IPv6 loopback / unspecified / link-local / ULA / IPv4-mapped loopback —
		// all unsafe-by-default, mirroring the IPv4 blocks.
		for (const ipv6 of [
			"http://[::1]/docs",
			"http://[::ffff:127.0.0.1]/docs",
			"http://[fc00::1]/docs",
			"http://[fd00::1]/docs",
			"http://[fe80::1]/docs",
		]) {
			expect(docsUrlIssues(ipv6)).toContain(
				"runtime_actions.0.docs_url must not point at a non-public host",
			);
		}
		// http and https are both allowed in this slice (parity with Agent Hint),
		// so a public http docs_url builds without throwing.
		expect(() =>
			createCliRuntimeSuccessEnvelope({
				run_id: "run-test-1",
				data: { ok: true },
				runtime_actions: [
					{
						id: "open-docs",
						summary: "Open the docs.",
						side_effects: ["read"],
						docs_url: "http://docs.example.test/ok",
					},
				],
				continuation: { next_action_id: "open-docs" },
			}),
		).not.toThrow();
	});

	test("rejects a failure_domain with unsafe text or non-lower-snake-case spelling", () => {
		expect(
			validateStructuredRuntimeError(
				createTestRuntimeError({ failure_domain: "Browser-Entry" }),
			),
		).toContain(
			"error.failure_domain must be a lower_snake_case package-owned label",
		);
		expect(
			validateStructuredRuntimeError(
				createTestRuntimeError({ failure_domain: "uses api_key material" }),
			),
		).toEqual(
			expect.arrayContaining([
				"error.failure_domain must be a lower_snake_case package-owned label",
			]),
		);
		expect(
			validateStructuredRuntimeError(
				createTestRuntimeError({ failure_domain: "browser_entry" }),
			),
		).toEqual([]);
	});

	test("rejects recoverability retry paired with retryable false (bidirectional)", () => {
		expect(
			validateStructuredRuntimeError(
				createTestRuntimeError({
					recoverability: "retry",
					retryable: false,
				}),
			),
		).toContain("error.recoverability retry requires retryable true");
	});

	test("rejects helper-created envelopes with runtime_actions but no continuation", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
				}),
			),
		).toContain("continuation is required when runtime_actions is present");
	});

	test("allows an operator-stop continuation without runtime_actions", () => {
		const envelope = createCliRuntimeErrorEnvelope({
			run_id: "run-test-1",
			error: createTestRuntimeError(),
			process_exit_code: 2,
			continuation: {
				requires_operator: true,
				constraints: [
					{
						id: "needs-human",
						summary: "An operator must resolve the blocked workspace.",
					},
				],
			},
		});

		expect(envelope.continuation?.requires_operator).toBe(true);
		expect(envelope).not.toHaveProperty("runtime_actions");
	});

	test("degrades a malformed action side_effects to a recoverable issue, not a TypeError", () => {
		// A non-array side_effects on the primary action must not make the
		// continuation cross-axis check throw a raw TypeError — it stays a
		// recoverable CliRuntimeContractError (the #62 recoverable-drift contract).
		const issues = captureRuntimeContractIssues(() =>
			createCliRuntimeSuccessEnvelope({
				run_id: "run-test-1",
				data: { ok: true },
				runtime_actions: [
					{
						id: "inspect",
						summary: "Inspect.",
						side_effects: "check" as never,
					},
				],
				continuation: {
					next_action_id: "inspect",
					constraints: [
						{
							id: "no-browser",
							summary: "No browser work.",
							forbidden_side_effects: ["browser"],
						},
					],
				},
			}),
		);
		expect(issues).toContain("runtime_actions.0.side_effects must be an array");
	});

	test("reports a runtime-contract issue for an autonomous posture with no runtime_actions", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeErrorEnvelope({
					run_id: "run-test-1",
					error: createTestRuntimeError(),
					process_exit_code: 2,
					continuation: { next_action_id: "inspect" },
				}),
			),
		).toContain(
			"continuation.next_action_id must reference a runtime_actions[].id",
		);
	});

	test("rejects a continuation that is not an object", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: "bad" as never,
				}),
			),
		).toContain("continuation must be an object");
	});

	test("rejects a non-boolean requires_operator", () => {
		expect(
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: {
						next_action_id: "inspect",
						requires_operator: 1 as never,
					},
				}),
			),
		).toContain("continuation.requires_operator must be a boolean");
	});

	test("rejects non-array continuation constraint and forbidden axes", () => {
		const issuesFor = (continuation: unknown) =>
			captureRuntimeContractIssues(() =>
				createCliRuntimeSuccessEnvelope({
					run_id: "run-test-1",
					data: { ok: true },
					runtime_actions: [
						{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
					],
					continuation: continuation as never,
				}),
			);

		expect(
			issuesFor({ next_action_id: "inspect", constraints: "bad" }),
		).toContain("continuation.constraints must be an array");
		expect(
			issuesFor({
				next_action_id: "inspect",
				constraints: [{ id: "c", summary: "s", forbidden_action_ids: "bad" }],
			}),
		).toContain(
			"continuation.constraints.0.forbidden_action_ids must be an array",
		);
		expect(
			issuesFor({
				next_action_id: "inspect",
				constraints: [{ id: "c", summary: "s", forbidden_side_effects: "bad" }],
			}),
		).toContain(
			"continuation.constraints.0.forbidden_side_effects must be an array",
		);
		expect(
			issuesFor({ next_action_id: "inspect", constraints: ["bad"] }),
		).toContain("continuation.constraints.0 must be an object");
	});

	for (const bad of [
		"1browser",
		"browser__entry",
		"browser_entry_",
		"_browser",
		"Browser",
	]) {
		test(`rejects non-lower-snake-case failure_domain ${JSON.stringify(bad)}`, () => {
			expect(
				validateStructuredRuntimeError(
					createTestRuntimeError({ failure_domain: bad }),
				),
			).toContain(
				"error.failure_domain must be a lower_snake_case package-owned label",
			);
		});
	}

	test("deep-clones forbidden_action_ids on the error-envelope continuation", () => {
		const forbidden = ["open-troubleshooting"] as const;
		const envelope = createCliRuntimeErrorEnvelope({
			run_id: "run-test-1",
			error: createTestRuntimeError(),
			process_exit_code: 2,
			runtime_actions: [
				{ id: "inspect", summary: "Inspect.", side_effects: ["check"] },
			],
			continuation: {
				requires_operator: true,
				constraints: [
					{
						id: "needs-human",
						summary: "Operator must confirm before continuing.",
						forbidden_action_ids: [...forbidden],
					},
				],
			},
		});

		expect(
			envelope.continuation?.constraints?.[0]?.forbidden_action_ids,
		).toEqual(["open-troubleshooting"]);
		expect(
			envelope.continuation?.constraints?.[0]?.forbidden_action_ids,
		).not.toBe(forbidden);
	});

	test("exports reusable runtime contract redaction fixtures", () => {
		const extendedFixtures = extendRuntimeContractRedactionFixtures([
			{ label: "package-secret", value: "PACKAGE_SECRET" },
		]);

		expect(
			listRuntimeContractFixtureLeaks(
				{ message: "PACKAGE_SECRET" },
				extendedFixtures,
			).map((fixture) => fixture.label),
		).toEqual(["package-secret"]);
		expect(() =>
			assertNoRuntimeContractFixtureLeaks({
				message: RUNTIME_CONTRACT_REDACTION_FIXTURES[0].value,
			}),
		).toThrow(/credential/);
		assertNoRuntimeContractFixtureLeaks(
			createCliRuntimeErrorEnvelope({
				run_id: "run-test-1",
				error: createTestRuntimeError(),
				process_exit_code: 2,
			}),
		);
	});

});

function createTestRuntimeError(
	overrides: Partial<StructuredRuntimeError> = {},
): StructuredRuntimeError {
	return {
		run_id: "run-test-1",
		code: "invalid-input",
		message: "Invalid input.",
		exit_code: 2,
		severity: "error",
		recoverability: "change_input",
		retryable: false,
		hint: {
			summary: "Change the input and try again.",
			action: "change_input",
			docs_url: "https://docs.example.test/cli/errors",
		},
		...overrides,
	};
}

function captureRuntimeContractIssues(fn: () => unknown): readonly string[] {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(CliRuntimeContractError);
		return (error as CliRuntimeContractError).issues;
	}
	throw new Error("expected CliRuntimeContractError");
}
