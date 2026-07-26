import { afterAll, describe, expect, test } from "bun:test";
import type {
	BrowserUseTokenRetrievalPort,
	BrowserUseTokenRetrievalRejection,
} from "./browser-use-op";
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
import { type RunStoreDeps, createSharedRun } from "./browser-use-runs";
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
		origins: ["https://portal.example.test"],
		login_paths: ["/login"],
		supported_methods: ["password"],
		state: "active",
		...overrides,
	};
}

function rejection(code: string): BrowserUseTokenRetrievalRejection {
	return {
		code: code as BrowserUseTokenRetrievalRejection["code"],
		message: `retrieval rejected (${code}).`,
	};
}

// A fake port whose every method answers from canned values; unset methods
// fail the test loudly rather than silently succeeding.
function fakePort(
	overrides: Partial<BrowserUseTokenRetrievalPort>,
): BrowserUseTokenRetrievalPort {
	const refuse = (name: string) => async () => {
		throw new Error(`fake port method ${name} was not expected to be called`);
	};
	return {
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
		] as const) {
			const continuation =
				BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE[cause].continuation.next_action_id;
			expect(
				(BROWSER_USE_AUTH_SUBCOMMANDS as readonly string[]).includes(continuation),
			).toBe(true);
		}
	});

	test("every auth subcommand discharges exactly one cause-table continuation", () => {
		const tableIds = new Set(
			Object.values(BROWSER_USE_AUTH_BLOCKED_CAUSE_TABLE).map(
				(entry) => entry.continuation.next_action_id,
			),
		);
		for (const subcommand of BROWSER_USE_AUTH_SUBCOMMANDS) {
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
	});

	test("a missing item is the revoked-binding cause with the self continuation", async () => {
		const runtime = makeRuntime({
			authTokenRetrieval: fakePort({
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
				listLoginItems: async () => ({
					ok: true,
					items: [evidenceItem("item-1"), evidenceItem("item-2", { state: "active" })],
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
					{ ordinal: 2, item_id: "item-2", item_state: "active" },
				],
			},
		});
		expect(envelope.continuation.next_action_id).toBe(
			"acquire-native-capability",
		);
	});
});

describe("--run binding (the run's continuation stays the one truth)", () => {
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
