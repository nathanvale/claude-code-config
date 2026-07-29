import { afterAll, describe, expect, test } from "bun:test";
import type {
	BrowserUseTokenRetrievalPort,
	BrowserUseTokenRetrievalRejection,
} from "./browser-use-op";
import type {
	BrowserUseEnvironmentTokenCustodyAction,
	BrowserUseEnvironmentTokenCustodyState,
} from "./browser-use-environment-token";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import {
	BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE,
} from "./browser-use-auth-model";
import type { BrowserUseVaultItemEvidence } from "./browser-use-auth-bindings";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import {
	type RunStoreDeps,
	createSharedRun,
	loadSharedRun,
} from "./browser-use-runs";
import {
	BROWSER_USE_AUTH_READINESS_CONTRACT_ID,
	BROWSER_USE_AUTH_SUBCOMMANDS,
} from "./command-contract";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

// Narrowed envelope view for assertions (parseJson returns unknown-valued
// records; the facade's own tests prove the envelope schema).
type EnvelopeView = {
	data: Record<string, unknown> & {
		evaluation: Record<string, unknown>;
		run?: Record<string, unknown>;
	};
	continuation: { next_action_id: string };
	error: { code: string };
};

function envelopeOf(stdout: string): EnvelopeView {
	return parseJson(stdout) as unknown as EnvelopeView;
}

// =========================================================================
// R27 auth repair surface (auth plan 2026-07-21-003 U3a; ADR 0028).
//
// The four blocked-cause continuations as dispatchable commands: the
// subcommand IS the continuation id (alignment pinned below), native-custody
// absence is the typed acquire-native-capability evaluation, blocked
// evaluations chain to the command that discharges their cause, and a --run
// binding is honest — the run's own persisted continuation must name the
// dispatched command. Every case drives the REAL CLI driver via runForTest.
// =========================================================================

const disposables: { dispose(): void }[] = [];

afterAll(() => {
	for (const disposable of disposables) {
		disposable.dispose();
	}
});

async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	deps: RunStoreDeps;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		env: xdg.env,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
	};
}

function evidenceItem(
	itemId: string,
	overrides: Partial<BrowserUseVaultItemEvidence> = {},
): BrowserUseVaultItemEvidence {
	return {
		item_id: itemId,
		vault_id: "vault-1",
		item_revision: 7,
		origins: ["https://portal.example.test"],
		login_paths: ["/login"],
		supported_methods: ["password"],
		state: "active",
		...overrides,
	};
}

function rejection(
	code: BrowserUseTokenRetrievalRejection["code"],
): BrowserUseTokenRetrievalRejection {
	return { code, message: `retrieval rejected (${code}).` };
}

function lifecycleRuntime(input: {
	tty?: boolean;
	results: readonly BrowserUseEnvironmentTokenCustodyState[];
}): {
	runtime: ReturnType<typeof makeRuntime>;
	calls: Array<{
		action: BrowserUseEnvironmentTokenCustodyAction;
		input_channel?: "stdin" | "tty";
	}>;
} {
	const calls: Array<{
		action: BrowserUseEnvironmentTokenCustodyAction;
		input_channel?: "stdin" | "tty";
	}> = [];
	const results = [...input.results];
	return {
		calls,
		runtime: makeRuntime({
			environmentTokenLifecycle: {
				inputIsTTY: () => input.tty ?? false,
				execute: async (request) => {
					calls.push(request);
					const result = results.shift();
					if (result === undefined) {
						throw new Error("unexpected lifecycle execution");
					}
					return result;
				},
			},
		}),
	};
}

describe("environment-token lifecycle public commands", () => {
	test("status reports the unavailable lower-assurance lane and one install action without OP", async () => {
		const calls = {
			identity: 0,
			vaults: 0,
			items: 0,
			item: 0,
			field: 0,
		};
		const unexpectedPort: BrowserUseTokenRetrievalPort = {
			getServiceAccountIdentity: async () => {
				calls.identity += 1;
				return { ok: false, rejection: rejection("capability-missing") };
			},
			listVaults: async () => {
				calls.vaults += 1;
				return { ok: false, rejection: rejection("capability-missing") };
			},
			listLoginItems: async () => {
				calls.items += 1;
				return { ok: false, rejection: rejection("capability-missing") };
			},
			getLoginItem: async () => {
				calls.item += 1;
				return { ok: false, rejection: rejection("capability-missing") };
			},
			fetchCredentialField: async () => {
				calls.field += 1;
				return { ok: false, rejection: rejection("capability-missing") };
			},
		};
		const result = await runForTest(
			["auth", "status", "--json"],
			makeRuntime({
				authAdmission: {
					kind: "blocked",
					cause: { code: "environment-token-not-ready" },
					evidence: {
						native: { verdict: "native-capability-absent" },
						environment: {
							state: "missing",
							next_action: "install-local-token",
						},
					},
				},
				authTokenRetrieval: unexpectedPort,
			}),
		);

		expect(result.exitCode).toBe(20);
		const envelope = parseJson(result.stdout) as {
			data: {
				contract: string;
				state: string;
				selected_lane: string | null;
				lane_state: string;
				assurance: string;
				blocked_cause: string;
				checks: Record<string, { state: string }>;
			};
			runtime_actions: Array<{ id: string }>;
			continuation: { next_action_id: string };
		};
		expect(envelope.data).toMatchObject({
			contract: "browser-use.auth-status",
			state: "blocked",
			selected_lane: null,
			lane_state: "unavailable",
			assurance: "lower-assurance",
			blocked_cause: "missing-token",
			checks: {
				token_file: { state: "missing" },
				op: { state: "not-evaluated" },
				wrapper: { state: "not-evaluated" },
				helper: { state: "not-evaluated" },
				service_account: { state: "not-evaluated" },
				vault_scope: { state: "not-evaluated" },
				admin_authority: { state: "not-evaluated" },
				profile: { state: "not-evaluated" },
				binding: { state: "not-evaluated" },
			},
		});
		expect(envelope.runtime_actions).toHaveLength(1);
		expect(envelope.runtime_actions[0]?.id).toBe("install-local-token");
		expect(envelope.continuation.next_action_id).toBe("install-local-token");
		expect(calls).toEqual({
			identity: 0,
			vaults: 0,
			items: 0,
			item: 0,
			field: 0,
		});
	});

	test("status composes admitted metadata and earned supporting evidence without field retrieval", async () => {
		const calls = { bindingEvidence: 0, field: 0, uncapturedPort: 0 };
		const port = fakePort({
			getBindingEvidence: async () => {
				calls.bindingEvidence += 1;
				return {
					ok: true,
					evidence: {
						identity: {
							service_account_id: "service-account-1",
							state: "ACTIVE",
							type: "SERVICE_ACCOUNT",
						},
						vaults: [{ vault_id: "vault-1" }],
						item_evidence: null,
					},
				};
			},
			fetchCredentialField: async () => {
				calls.field += 1;
				return { ok: false, rejection: rejection("capability-missing") };
			},
		});
		const result = await runForTest(
			["auth", "status", "--json"],
			makeRuntime({
				authAdmission: {
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
			},
				authTokenRetrieval: fakePort({
					getBindingEvidence: async () => {
						calls.uncapturedPort += 1;
						throw new Error("uncaptured token port must never be consulted");
					},
				}),
				authStatusSupport: async () => ({
					contract: "browser-use.auth-status-support",
					schema_version: "1",
					executables: {
						op: "ready",
						wrapper: "ready",
						helper: "ready",
					},
					admin_authority: "proven",
					profile: "live-clean",
					binding: "ready",
					proof: AUTH_STATUS_PROOF,
				}),
			}),
		);

		expect(result.exitCode).toBe(0);
		const envelope = parseJson(result.stdout) as {
			data: {
				contract: string;
				state: string;
				selected_lane: string | null;
				lane_state: string;
				assurance: string;
				checks: Record<string, { state: string }>;
			};
			runtime_actions: Array<{ id: string }>;
			continuation: { next_action_id: string };
		};
		expect(envelope.data).toMatchObject({
			contract: "browser-use.auth-status",
			state: "ready",
			selected_lane: "environment-injected-op",
			lane_state: "ready",
			assurance: "lower-assurance",
			checks: {
				token_file: { state: "ready" },
				op: { state: "ready" },
				wrapper: { state: "ready" },
				helper: { state: "ready" },
				service_account: { state: "active" },
				vault_scope: { state: "exactly-one" },
				admin_authority: { state: "proven" },
				profile: { state: "live-clean" },
				binding: { state: "ready" },
			},
		});
		expect(envelope.runtime_actions).toHaveLength(1);
		expect(envelope.runtime_actions[0]?.id).toBe("run-authenticated-runbook");
		expect(envelope.continuation.next_action_id).toBe(
			"run-authenticated-runbook",
		);
		expect(calls).toEqual({
			bindingEvidence: 1,
			field: 0,
			uncapturedPort: 0,
		});
	});

	test("noninteractive install without explicit stdin returns a human gate and never waits", async () => {
		const fixture = lifecycleRuntime({
			results: [],
		});
		const result = await runForTest(
			["auth", "install-token", "--json"],
			fixture.runtime,
		);
		expect(result.exitCode).toBe(21);
		expect(fixture.calls).toEqual([]);
		expect(envelopeOf(result.stdout).error.code).toBe("human-action-required");
		expect(result.stdout).not.toContain("OP_SERVICE_ACCOUNT_TOKEN");
	});

	test("status fails closed when no command-scoped lane admission was captured", async () => {
		const fixture = lifecycleRuntime({
			results: [{ state: "missing", next_action: "install-local-token" }],
		});
		const result = await runForTest(["auth", "status", "--json"], fixture.runtime);
		expect(result.exitCode).toBe(20);
		expect(fixture.calls).toEqual([]);
		const envelope = parseJson(result.stdout) as {
			data: {
				contract: string;
				state: string;
				blocked_cause: string;
			};
			continuation: { next_action_id: string };
		};
		expect(envelope.data).toMatchObject({
			contract: "browser-use.auth-status",
			state: "blocked",
			blocked_cause: "admission-unavailable",
		});
		expect(envelope.continuation.next_action_id).toBe(
			"inspect-capability-loss",
		);
	});

	test("explicit stdin installs when missing and replaces when already ready", async () => {
		for (const [standing, mutation] of [
			["missing", "install"],
			["ready", "replace"],
		] as const) {
			const standingState: BrowserUseEnvironmentTokenCustodyState =
				standing === "missing"
					? { state: "missing", next_action: "install-local-token" }
					: { state: "ready", next_action: "validate-service-account" };
			const fixture = lifecycleRuntime({
				results: [
					standingState,
					{
						state: mutation === "install" ? "installed" : "replaced",
						next_action: "validate-service-account",
					},
				],
			});
			const result = await runForTest(
				["auth", "install-token", "--stdin", "--json"],
				fixture.runtime,
			);
			expect(result.exitCode).toBe(0);
			expect(fixture.calls).toEqual([
				{ action: "status" },
				{ action: mutation, input_channel: "stdin" },
			]);
			expect(envelopeOf(result.stdout).data).toMatchObject({
				operation: mutation,
				state: mutation === "install" ? "installed" : "replaced",
			});
		}
	});

	test("hidden TTY uses the native hidden channel and removal keeps remote revocation explicit", async () => {
		const install = lifecycleRuntime({
			tty: true,
			results: [
				{ state: "missing", next_action: "install-local-token" },
				{ state: "installed", next_action: "validate-service-account" },
			],
		});
		expect(
			(await runForTest(["auth", "install-token", "--json"], install.runtime))
				.exitCode,
		).toBe(0);
		expect(install.calls).toEqual([
			{ action: "status" },
			{ action: "install", input_channel: "tty" },
		]);

		const remove = lifecycleRuntime({
			results: [
				{
					state: "removed",
					remote_authority: "may-remain-live",
					next_action: "revoke-service-account-token-remotely",
				},
			],
		});
		const removed = await runForTest(
			["auth", "remove-token", "--json"],
			remove.runtime,
		);
		expect(removed.exitCode).toBe(0);
		expect(remove.calls).toEqual([{ action: "remove" }]);
		expect(envelopeOf(removed.stdout).data).toMatchObject({
			state: "removed",
			remote_authority: "may-remain-live",
		});
		expect(envelopeOf(removed.stdout).continuation.next_action_id).toBe(
			"revoke-service-account-token-remotely",
		);
	});
});

// A fake port whose every method answers from canned values; unset methods
// fail the test loudly rather than silently succeeding.
function fakePort(
	overrides: Partial<BrowserUseTokenRetrievalPort>,
): BrowserUseTokenRetrievalPort {
	const refuse = (name: string) => async () => {
		throw new Error(`fake port method ${name} was not expected to be called`);
	};
	return {
		getServiceAccountIdentity: async () => ({
			ok: true,
			identity: {
				service_account_id: "service-account-1",
				state: "ACTIVE",
				type: "SERVICE_ACCOUNT",
			},
		}),
		listVaults: refuse("listVaults") as BrowserUseTokenRetrievalPort["listVaults"],
		listLoginItems: refuse(
			"listLoginItems",
		) as BrowserUseTokenRetrievalPort["listLoginItems"],
		getLoginItem: refuse(
			"getLoginItem",
		) as BrowserUseTokenRetrievalPort["getLoginItem"],
		fetchCredentialField: refuse(
			"fetchCredentialField",
		) as BrowserUseTokenRetrievalPort["fetchCredentialField"],
		...overrides,
	};
}

type AuthStatusSupportFixture = {
	contract: "browser-use.auth-status-support";
	schema_version: "1";
	executables: {
		op: "ready" | "missing" | "unsafe" | "unproven";
		wrapper: "ready" | "missing" | "unsafe" | "unproven";
		helper: "ready" | "missing" | "unsafe" | "unproven";
	};
	admin_authority: "proven" | "missing" | "invalid";
	profile: "live-clean" | "missing" | "unsafe" | "unproven";
	binding: "ready" | "missing" | "stale" | "invalid";
	proof: {
		lane_digest: string;
		principal_digest: string;
		vault_digest: string;
		profile_digest: string;
		profile_posture_receipt_digest: string;
		binding_context_digest: string;
		binding_receipt_digest: string;
		observed_at_epoch_ms: number;
		fresh_until_epoch_ms: number;
	};
};

const AUTH_STATUS_PROOF = {
	lane_digest: "10a326413857cc1a7acb1d1cc7d623476aa02b7283085b27b75dff918b265c7d",
	principal_digest:
		"5d7c7fff1e59dc18d0d951b5a30859827506e9417c98defe13528623651356c5",
	vault_digest: "fb3cff3652702c773d0740dc34c2378822ea1be4164eb2d5516c7962125a24af",
	profile_digest:
		"897e7115d9aca68c616685a1b387987afeebe245c6aa822345f7049fbba977ac",
	profile_posture_receipt_digest:
		"9999999999999999999999999999999999999999999999999999999999999999",
	binding_context_digest:
		"01c7c46b5c848478e7d5977ead0a872518734bd30d2ec681307dc2e786b35267",
	binding_receipt_digest:
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	observed_at_epoch_ms: 900,
	fresh_until_epoch_ms: 1_100,
} as const;

function authStatusSupport(
	overrides: Partial<AuthStatusSupportFixture> = {},
): AuthStatusSupportFixture {
	return {
		contract: "browser-use.auth-status-support",
		schema_version: "1",
		executables: { op: "ready", wrapper: "ready", helper: "ready" },
		admin_authority: "proven",
		profile: "live-clean",
		binding: "ready",
		proof: AUTH_STATUS_PROOF,
		...overrides,
	};
}

function composedStatusRuntime(input: {
	support?: () => Promise<unknown>;
	vaultCount?: number;
	rejection?: BrowserUseTokenRetrievalRejection;
	metadataEvidence?: unknown;
}): {
	runtime: ReturnType<typeof makeRuntime>;
	calls: { bindingEvidence: number; field: number };
} {
	const calls = { bindingEvidence: 0, field: 0 };
	const port = fakePort({
		getBindingEvidence: async () => {
			calls.bindingEvidence += 1;
			if (input.rejection !== undefined) {
				return { ok: false, rejection: input.rejection };
			}
			return (input.metadataEvidence === undefined
				? {
						ok: true,
						evidence: {
							identity: {
								service_account_id: "service-account-1",
								state: "ACTIVE",
								type: "SERVICE_ACCOUNT",
							},
							vaults: Array.from(
								{ length: input.vaultCount ?? 1 },
								(_, index) => ({ vault_id: `vault-${index + 1}` }),
							),
							item_evidence: null,
						},
					}
				: {
						ok: true,
						evidence: input.metadataEvidence,
					}) as Awaited<
				ReturnType<
					NonNullable<BrowserUseTokenRetrievalPort["getBindingEvidence"]>
				>
			>;
		},
		fetchCredentialField: async () => {
			calls.field += 1;
			return { ok: false, rejection: rejection("capability-missing") };
		},
	});
	return {
		calls,
		runtime: makeRuntime({
			authAdmission: {
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
			},
			authTokenRetrieval: port,
			authStatusSupport:
				input.support ?? (async () => authStatusSupport()),
		}),
	};
}

describe("composed authentication status gate priority", () => {
	test.each([
		{
			name: "missing wrapper",
			support: authStatusSupport({
				executables: { op: "ready", wrapper: "missing", helper: "ready" },
			}),
			vaultCount: 1,
			rejection: undefined,
			blockedCause: "wrapper-missing",
			action: "inspect-capability-loss",
			metadataCalls: 0,
		},
		{
			name: "invalid service account",
			support: authStatusSupport(),
			vaultCount: 1,
			rejection: rejection("output-shape-invalid"),
			blockedCause: "invalid-service-account",
			action: "inspect-capability-loss",
			metadataCalls: 1,
		},
		{
			name: "multiple vaults",
			support: authStatusSupport(),
			vaultCount: 2,
			rejection: undefined,
			blockedCause: "invalid-vault-scope",
			action: "repair-vault-grant",
			metadataCalls: 1,
		},
		{
			name: "missing admin receipt",
			support: authStatusSupport({ admin_authority: "missing" }),
			vaultCount: 1,
			rejection: undefined,
			blockedCause: "admin-authority-missing",
			action: "record-admin-authority-receipt",
			metadataCalls: 1,
		},
		{
			name: "unsafe profile",
			support: authStatusSupport({ profile: "unsafe" }),
			vaultCount: 1,
			rejection: undefined,
			blockedCause: "profile-unsafe",
			action: "approve-clean-profile-creation",
			metadataCalls: 1,
		},
		{
			name: "stale binding",
			support: authStatusSupport({ binding: "stale" }),
			vaultCount: 1,
			rejection: undefined,
			blockedCause: "binding-stale",
			action: "repair-item-binding",
			metadataCalls: 1,
		},
	] as const)(
		"$name emits one prioritized repair without retrieving a field",
		async (scenario) => {
			const fixture = composedStatusRuntime({
				support: async () => scenario.support,
				vaultCount: scenario.vaultCount,
				...(scenario.rejection === undefined
					? {}
					: { rejection: scenario.rejection }),
			});
			const result = await runForTest(
				["auth", "status", "--json"],
				fixture.runtime,
			);

			expect(result.exitCode).toBe(20);
			const envelope = parseJson(result.stdout) as {
				data: { blocked_cause: string };
				runtime_actions: Array<{ id: string }>;
				continuation: { next_action_id: string };
			};
			expect(envelope.data.blocked_cause).toBe(scenario.blockedCause);
			expect(envelope.runtime_actions).toHaveLength(1);
			expect(envelope.runtime_actions[0]?.id).toBe(scenario.action);
			expect(envelope.continuation.next_action_id).toBe(scenario.action);
			expect(fixture.calls).toEqual({
				bindingEvidence: scenario.metadataCalls,
				field: 0,
			});
		},
	);

	test("hostile supporting evidence is rejected whole before metadata", async () => {
		const sentinel = "not-a-real-secret-value";
		const fixture = composedStatusRuntime({
			support: async () => ({
				...authStatusSupport(),
				operator_email: "operator@example.test",
				notes: sentinel.repeat(10_000),
			}),
		});
		const result = await runForTest(
			["auth", "status", "--json"],
			fixture.runtime,
		);

		expect(result.exitCode).toBe(20);
		const envelope = parseJson(result.stdout) as {
			data: { blocked_cause: string };
			runtime_actions: Array<{ id: string }>;
		};
		expect(envelope.data.blocked_cause).toBe("support-evidence-unavailable");
		expect(envelope.runtime_actions).toHaveLength(1);
		expect(envelope.runtime_actions[0]?.id).toBe("inspect-capability-loss");
		expect(fixture.calls).toEqual({ bindingEvidence: 0, field: 0 });
		expect(result.stdout).not.toContain(sentinel);
		expect(result.stdout).not.toContain("operator@example.test");
	});

	test.each([
		{
			name: "lane",
			proof: {
				...AUTH_STATUS_PROOF,
				lane_digest:
					"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
			cause: "support-evidence-mismatch",
		},
		{
			name: "principal",
			proof: {
				...AUTH_STATUS_PROOF,
				principal_digest:
					"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			},
			cause: "support-evidence-mismatch",
		},
		{
			name: "vault",
			proof: {
				...AUTH_STATUS_PROOF,
				vault_digest:
					"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			},
			cause: "support-evidence-mismatch",
		},
		{
			name: "profile",
			proof: {
				...AUTH_STATUS_PROOF,
				profile_digest:
					"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			},
			cause: "support-evidence-mismatch",
		},
		{
			name: "binding context",
			proof: {
				...AUTH_STATUS_PROOF,
				binding_context_digest:
					"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			},
			cause: "support-evidence-mismatch",
		},
		{
			name: "binding receipt",
			proof: {
				...AUTH_STATUS_PROOF,
				binding_receipt_digest:
					"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
			cause: "support-evidence-mismatch",
		},
		{
			name: "same logical profile with a different posture receipt",
			proof: {
				...AUTH_STATUS_PROOF,
				profile_posture_receipt_digest:
					"8888888888888888888888888888888888888888888888888888888888888888",
			},
			cause: "support-evidence-mismatch",
		},
		{
			name: "freshness",
			proof: {
				...AUTH_STATUS_PROOF,
				fresh_until_epoch_ms: 1_000,
			},
			cause: "support-evidence-stale",
		},
	] as const)(
		"a stale $name proof cannot authorize the captured environment lane",
		async ({ proof, cause }) => {
		const fixture = composedStatusRuntime({
			support: async () =>
				authStatusSupport({
					proof,
				}),
		});
		const result = await runForTest(
			["auth", "status", "--json"],
			fixture.runtime,
		);

		expect(result.exitCode).toBe(20);
		const envelope = parseJson(result.stdout) as {
			data: { blocked_cause: string };
			runtime_actions: Array<{ id: string }>;
		};
		expect(envelope.data.blocked_cause).toBe(cause);
		expect(envelope.runtime_actions).toEqual([
			expect.objectContaining({ id: "inspect-capability-loss" }),
		]);
		expect(fixture.calls).toEqual({ bindingEvidence: 1, field: 0 });
		},
	);

	test.each([
		{
			name: "an extra secret-shaped top-level field",
			evidence: {
				identity: {
					service_account_id: "service-account-1",
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
				vaults: [{ vault_id: "vault-1" }],
				item_evidence: null,
				token: "op://hostile-extra-field",
			},
		},
		{
			name: "an inactive identity",
			evidence: {
				identity: {
					service_account_id: "service-account-1",
					state: "SUSPENDED",
					type: "SERVICE_ACCOUNT",
				},
				vaults: [{ vault_id: "vault-1" }],
				item_evidence: null,
			},
		},
		{
			name: "an oversized identity",
			evidence: {
				identity: {
					service_account_id: "x".repeat(257),
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
				vaults: [{ vault_id: "vault-1" }],
				item_evidence: null,
			},
		},
		{
			name: "invalid UTF-8 replacement data",
			evidence: {
				identity: {
					service_account_id: "service\uFFFDaccount",
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
				vaults: [{ vault_id: "vault-1" }],
				item_evidence: null,
			},
		},
		{
			name: "extra vault metadata",
			evidence: {
				identity: {
					service_account_id: "service-account-1",
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
				vaults: [{ vault_id: "vault-1", name: "Browser Automation" }],
				item_evidence: null,
			},
		},
		{
			name: "an oversized vault set",
			evidence: {
				identity: {
					service_account_id: "service-account-1",
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
				vaults: Array.from({ length: 129 }, (_, index) => ({
					vault_id: `vault-${index}`,
				})),
				item_evidence: null,
			},
		},
	] as const)(
		"hostile OP metadata with $name is rejected whole",
		async ({ evidence }) => {
			const fixture = composedStatusRuntime({ metadataEvidence: evidence });
			const result = await runForTest(
				["auth", "status", "--json"],
				fixture.runtime,
			);

			expect(result.exitCode).toBe(20);
			const envelope = parseJson(result.stdout) as {
				data: { blocked_cause: string };
				runtime_actions: Array<{ id: string }>;
			};
			expect(envelope.data.blocked_cause).toBe("invalid-service-account");
			expect(envelope.runtime_actions).toEqual([
				expect.objectContaining({ id: "inspect-capability-loss" }),
			]);
			expect(fixture.calls).toEqual({ bindingEvidence: 1, field: 0 });
			expect(result.stdout).not.toContain("op://hostile-extra-field");
			expect(result.stdout).not.toContain("Browser Automation");
		},
	);
});

function blockedRun(
	runId: string,
	continuationId: string,
	overrides: Partial<BrowserUseSharedRun> = {},
): Omit<BrowserUseSharedRun, "revision"> {
	return {
		run_id: runId,
		state: "awaiting-auth",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		mutation_dispatched: false,
		artifacts: [],
		continuation: {
			next_action_id: continuationId,
			summary: "Discharge this auth continuation, then resume.",
		},
		...overrides,
	};
}

describe("subcommand <-> blocked-cause continuation alignment (the drift tripwire)", () => {
	test("every repair-dispatchable cause continuation IS an auth subcommand", () => {
		for (const cause of [
			"missing-token",
			"invalid-vault-scope",
			"revoked-binding",
			"ambiguous-binding-selection",
			"unsupported-method",
			"capability-loss",
		] as const) {
			const continuation =
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation.next_action_id;
			expect(
				(BROWSER_USE_AUTH_SUBCOMMANDS as readonly string[]).includes(continuation),
			).toBe(true);
		}
	});

	test("every auth repair subcommand discharges exactly one cause-table continuation", () => {
		const tableIds = new Set(
			Object.values(BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE).map(
				(entry) => entry.continuation.next_action_id,
			),
		);
		for (const subcommand of BROWSER_USE_AUTH_SUBCOMMANDS.filter(
			(candidate) =>
				![
					"status",
					"install-token",
					"remove-token",
					"inspect-auth-readiness",
				].includes(candidate),
		)) {
			expect(tableIds.has(subcommand)).toBe(true);
		}
	});
});

describe("native capability absent (the default runtime, ADR 0028)", () => {
	for (const subcommand of [
		"enroll-browser-automation-token",
		"repair-vault-grant",
	] as const) {
		test(`auth ${subcommand} reports the typed absent state, exit 0`, async () => {
			const result = await runForTest(
				["auth", subcommand, "--json"],
				makeRuntime(),
			);
			expect(result.exitCode).toBe(0);
			const envelope = envelopeOf(result.stdout);
			expect(envelope.data.contract).toBe(BROWSER_USE_AUTH_READINESS_CONTRACT_ID);
			expect(envelope.data.action).toBe(subcommand);
			expect(envelope.data.evaluation).toEqual({
				status: "native-capability-absent",
				blocked_cause: "missing-token",
			});
			expect(envelope.continuation.next_action_id).toBe(
				"acquire-native-capability",
			);
		});
	}

	test("plain output carries the same action and continuation (parity)", async () => {
		const result = await runForTest(
			["auth", "repair-vault-grant", "--plain"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			`contract=${BROWSER_USE_AUTH_READINESS_CONTRACT_ID}`,
		);
		expect(result.stdout).toContain("action=repair-vault-grant");
		expect(result.stdout).toContain("continuation=acquire-native-capability");
		expect(result.stdout).toContain("status=native-capability-absent");
	});
});

describe("enroll-browser-automation-token over an injected port", () => {
	test("an operational token evaluates clean", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({ ok: true, vaults: [{ vault_id: "vault-1" }] }),
			}),
		});
		const result = await runForTest(
			["auth", "enroll-browser-automation-token", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation.status).toBe("token-operational");
		expect(envelope.continuation.next_action_id).toBe("inspect-auth-readiness");
	});

	test("a revoked token routes to the native enrollment gate", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({ ok: false, rejection: rejection("token-revoked") }),
			}),
		});
		const result = await runForTest(
			["auth", "enroll-browser-automation-token", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toMatchObject({
			status: "token-rejected",
			blocked_cause: "missing-token",
			detail: { rejection_code: "token-revoked" },
		});
		expect(envelope.continuation.next_action_id).toBe(
			"acquire-native-capability",
		);
	});
});

describe("unsupported-method and capability-loss continuations", () => {
	test("choose-supported-auth-method is a live dispatchable check", async () => {
		const result = await runForTest(
			["auth", "choose-supported-auth-method", "--json"],
			makeRuntime({ authTokenRetrieval: fakePort({}) }),
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toEqual({
			status: "method-selection-required",
			blocked_cause: "unsupported-method",
		});
		expect(envelope.continuation.next_action_id).toBe(
			"inspect-auth-readiness",
		);
	});

	test("inspect-capability-loss proves the metadata port is callable", async () => {
		const result = await runForTest(
			["auth", "inspect-capability-loss", "--json"],
			makeRuntime({
				authTokenRetrieval: fakePort({
					listVaults: async () => ({
						ok: true,
						vaults: [{ vault_id: "vault-1" }],
					}),
				}),
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toEqual({
			status: "capability-present",
			detail: { visible_vault_count: 1 },
		});
		expect(envelope.continuation.next_action_id).toBe(
			"inspect-auth-readiness",
		);
	});

	test("inspect-auth-readiness is a live bounded session-proof gate", async () => {
		const result = await runForTest(
			["auth", "inspect-auth-readiness", "--json"],
			makeRuntime({
				authTokenRetrieval: fakePort({
					listVaults: async () => ({
						ok: true,
						vaults: [{ vault_id: "vault-1" }],
					}),
				}),
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toEqual({
			status: "session-identity-proof-unavailable",
			blocked_cause: "capability-loss",
			detail: {
				metadata_capability: "present",
				visible_vault_count: 1,
			},
		});
		expect(envelope.continuation.next_action_id).toBe(
			"inspect-auth-readiness",
		);
	});
});

describe("repair-vault-grant over an injected port (R8)", () => {
	test("exactly one visible vault proves the grant", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({ ok: true, vaults: [{ vault_id: "vault-1" }] }),
			}),
		});
		const result = await runForTest(["auth", "repair-vault-grant", "--json"], runtime);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toMatchObject({
			status: "scope-proven",
			detail: { vault_id: "vault-1" },
		});
		expect(envelope.continuation.next_action_id).toBe("inspect-auth-readiness");
	});

	test("multiple visible vaults keep the repair continuation with the count", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({
					ok: true,
					vaults: [{ vault_id: "vault-1" }, { vault_id: "vault-2" }],
				}),
			}),
		});
		const result = await runForTest(["auth", "repair-vault-grant", "--json"], runtime);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toMatchObject({
			status: "invalid-vault-scope",
			blocked_cause: "invalid-vault-scope",
			detail: { visible_count: 2 },
		});
		expect(envelope.continuation.next_action_id).toBe("repair-vault-grant");
	});

	test("a token-lifecycle rejection chains to enrollment (the cause chain)", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({
					ok: false,
					rejection: rejection("capability-missing"),
				}),
			}),
		});
		const result = await runForTest(["auth", "repair-vault-grant", "--json"], runtime);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toMatchObject({
			status: "retrieval-rejected",
			blocked_cause: "missing-token",
		});
		expect(envelope.continuation.next_action_id).toBe(
			"enroll-browser-automation-token",
		);
	});
});

describe("repair-item-binding over an injected port (R11 targeted read)", () => {
	test("missing coordinates are a usage error, never a scan", async () => {
		const result = await runForTest(
			["auth", "repair-item-binding", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
	});

	test("a live exact item evaluates binding-live with redacted evidence", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({
					ok: true,
					vaults: [{ vault_id: "vault-1" }],
				}),
				getLoginItem: async (input) => ({
					ok: true,
					item: evidenceItem("item-1", { vault_id: input.vault_id }),
				}),
			}),
		});
		const result = await runForTest(
			[
				"auth",
				"repair-item-binding",
				"--vault-id",
				"vault-1",
				"--item-id",
				"item-1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toMatchObject({
			status: "binding-live",
			detail: {
				vault_id: "vault-1",
				item_id: "item-1",
				item_state: "active",
				supported_methods: ["password"],
			},
		});
		expect(envelope.continuation.next_action_id).toBe("inspect-auth-readiness");
		// Redaction: the evidence's origins and login paths never reach the
		// envelope — only ids, state, and methods project.
		expect(result.stdout).not.toContain("portal.example.test");
		expect(result.stdout).not.toContain("/login");
	});

	test("a missing item is the revoked-binding cause with the self continuation", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({
					ok: true,
					vaults: [{ vault_id: "vault-1" }],
				}),
				getLoginItem: async () => ({
					ok: false,
					rejection: rejection("item-missing"),
				}),
			}),
		});
		const result = await runForTest(
			[
				"auth",
				"repair-item-binding",
				"--vault-id",
				"vault-1",
				"--item-id",
				"item-gone",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toMatchObject({
			status: "binding-unusable",
			blocked_cause: "revoked-binding",
			detail: { rejection_code: "item-missing" },
		});
		expect(envelope.continuation.next_action_id).toBe("repair-item-binding");
	});

	test("a caller-selected second vault blocks before the item read", async () => {
		let itemReads = 0;
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({
					ok: true,
					vaults: [{ vault_id: "vault-1" }, { vault_id: "vault-2" }],
				}),
				getLoginItem: async () => {
					itemReads += 1;
					throw new Error("must not read outside proven vault scope");
				},
			}),
		});
		const result = await runForTest(
			[
				"auth",
				"repair-item-binding",
				"--vault-id",
				"vault-2",
				"--item-id",
				"item-1",
				"--json",
			],
			runtime,
		);
		expect(envelopeOf(result.stdout).data.evaluation).toMatchObject({
			status: "invalid-vault-scope",
			blocked_cause: "invalid-vault-scope",
			detail: { visible_count: 2 },
		});
		expect(itemReads).toBe(0);
	});
});

describe("request-binding-selection-grant over an injected port (R20)", () => {
	test("a missing --vault-id is a usage error", async () => {
		const result = await runForTest(
			["auth", "request-binding-selection-grant", "--json"],
			makeRuntime(),
		);
		expect(result.exitCode).toBe(2);
	});

	test("the candidate set projects with ordinals; signing stays broker-owned", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({
					ok: true,
					vaults: [{ vault_id: "vault-1" }],
				}),
				listLoginItems: async () => ({
					ok: true,
					// A stale second candidate proves per-item state projects
					// faithfully, not just the default.
					items: [evidenceItem("item-1"), evidenceItem("item-2", { state: "moved" })],
				}),
			}),
		});
		const result = await runForTest(
			["auth", "request-binding-selection-grant", "--vault-id", "vault-1", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toMatchObject({
			status: "selection-candidates-projected",
			detail: {
				vault_id: "vault-1",
				candidate_count: 2,
				candidates: [
					{ ordinal: 1, item_id: "item-1", item_state: "active" },
					{ ordinal: 2, item_id: "item-2", item_state: "moved" },
				],
			},
		});
		expect(envelope.continuation.next_action_id).toBe(
			"acquire-native-capability",
		);
	});

	test("a vault id outside the single visible grant blocks before discovery", async () => {
		let discoveryCalls = 0;
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
				listVaults: async () => ({
					ok: true,
					vaults: [{ vault_id: "vault-1" }],
				}),
				listLoginItems: async () => {
					discoveryCalls += 1;
					throw new Error("must not discover outside proven vault scope");
				},
			}),
		});
		const result = await runForTest(
			[
				"auth",
				"request-binding-selection-grant",
				"--vault-id",
				"vault-2",
				"--json",
			],
			runtime,
		);
		expect(envelopeOf(result.stdout).data.evaluation).toMatchObject({
			status: "invalid-vault-scope",
			detail: {
				visible_count: 1,
				requested_vault_matches: false,
			},
		});
		expect(discoveryCalls).toBe(0);
	});
});

describe("--run binding (the run's continuation stays the one truth)", () => {
	test("selection-grant derives the single live vault when the run discarded coordinates", async () => {
		const store = await makeStore();
		await createSharedRun(
			store.deps,
			blockedRun(
				"run-auth-selection-no-vault",
				"request-binding-selection-grant",
			),
		);
		const result = await runForTest(
			[
				"auth",
				"request-binding-selection-grant",
				"--run",
				"run-auth-selection-no-vault",
				"--json",
			],
			makeRuntime({
				env: store.env,
				authTokenRetrieval: fakePort({
					listVaults: async () => ({
						ok: true,
						vaults: [{ vault_id: "vault-1" }],
					}),
					listLoginItems: async () => ({
						ok: true,
						items: [evidenceItem("item-1")],
					}),
				}),
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(envelopeOf(result.stdout).data.evaluation).toMatchObject({
			status: "selection-candidates-projected",
			detail: {
				vault_id: "vault-1",
				candidate_count: 1,
			},
		});
	});

	test("repair-item-binding remains dispatchable when the run has no repair coordinates", async () => {
		const store = await makeStore();
		await createSharedRun(
			store.deps,
			blockedRun("run-auth-no-coordinates", "repair-item-binding"),
		);
		const result = await runForTest(
			[
				"auth",
				"repair-item-binding",
				"--run",
				"run-auth-no-coordinates",
				"--json",
			],
			makeRuntime({
				env: store.env,
				authTokenRetrieval: fakePort({}),
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toEqual({
			status: "binding-coordinates-unavailable",
			blocked_cause: "revoked-binding",
		});
		expect(envelope.continuation.next_action_id).toBe(
			"inspect-auth-readiness",
		);
		const loaded = await loadSharedRun(
			store.deps,
			"run-auth-no-coordinates",
		);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.continuation?.next_action_id).toBe(
				"inspect-auth-readiness",
			);
		}
	});

	test("a run naming this command binds the evaluation to it", async () => {
		const store = await makeStore();
		await createSharedRun(
			store.deps,
			blockedRun("run-auth-bind", "enroll-browser-automation-token"),
		);
		const runtime = makeRuntime({ env: store.env });
		const result = await runForTest(
			[
				"auth",
				"enroll-browser-automation-token",
				"--run",
				"run-auth-bind",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.run).toEqual({
			run_id: "run-auth-bind",
			state: "awaiting-auth",
			continuation_id: "enroll-browser-automation-token",
		});
		expect(envelope.data.evaluation.status).toBe("native-capability-absent");
	});

	test("a run naming a DIFFERENT continuation fails closed at 20", async () => {
		const store = await makeStore();
		await createSharedRun(
			store.deps,
			blockedRun("run-auth-mismatch", "repair-item-binding"),
		);
		const runtime = makeRuntime({ env: store.env });
		const result = await runForTest(
			[
				"auth",
				"enroll-browser-automation-token",
				"--run",
				"run-auth-mismatch",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.error.code).toBe("auth_continuation_mismatch");
		expect(envelope.data.persisted_continuation_id).toBe("repair-item-binding");
		expect(envelope.continuation.next_action_id).toBe("follow_run_continuation");
	});

	test("an unknown run id is the shared run_not_found refusal", async () => {
		const store = await makeStore();
		const runtime = makeRuntime({ env: store.env });
		const result = await runForTest(
			["auth", "repair-vault-grant", "--run", "run-none", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.error.code).toBe("run_not_found");
	});
});
