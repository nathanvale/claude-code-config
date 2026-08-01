import { afterAll, describe, expect, test } from "bun:test";
import {
	chmod,
	link,
	lstat,
	mkdir,
	readFile,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { findCommandFacadeMetadataDrift } from "@side-quest/cli-command-facade";
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
	BROWSER_USE_AUTH_REPAIR_SUBCOMMANDS,
	BROWSER_USE_AUTH_SETUP_SUBCOMMANDS,
	BROWSER_USE_AUTH_SUBCOMMANDS,
	browserUseContracts,
} from "./command-contract";
import {
	AUTH_TOKEN_GATE_ORDER,
	AUTH_TOKEN_REPAIR_PATHS,
	AUTH_TOKEN_SUPERVISOR_CAUSES,
	authTokenRepairPathFor,
	runForTest,
} from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import type {
	AuthTokenProcessSpawn,
	AuthTokenSupervisorInput,
	AuthTokenSupervisorResult,
} from "./browser-use-runtime";
import {
	AUTH_TOKEN_SUPERVISOR_DEGRADED_ACTIONS,
	__authTokenSupervisorForTest,
} from "./browser-use-runtime";

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

function supervisorRuntime(
	result: AuthTokenSupervisorResult,
	calls: AuthTokenSupervisorInput[] = [],
) {
	return makeRuntime({
		runAuthTokenSupervisor: async (input) => {
			calls.push(input);
			return result;
		},
	});
}

const healthyStatus = {
	exitCode: 0,
	stdout: JSON.stringify({
		schema_version: 1,
		ok: true,
		state: "ready",
		lane: { selected: "environment-injected-op", status: "ready" },
		checks: {
			token_file: { status: "ready" },
			op: { status: "ready" },
			token: { status: "ready" },
			vault_scope: { status: "ready", visible_count: 1 },
			profile_policy: { status: "ready" },
		},
		next_action: "rerun-confidential-command",
	}),
	stderr: "",
} as const satisfies AuthTokenSupervisorResult;

const profilePolicyBlockedStatus = {
	exitCode: 20,
	stdout: JSON.stringify({
		schema_version: 1,
		ok: false,
		state: "blocked",
		cause: "profile-policy-unproven",
		lane: { selected: "environment-injected-op", status: "blocked" },
		checks: {
			token_file: { status: "ready" },
			op: { status: "ready" },
			token: { status: "ready" },
			vault_scope: { status: "ready", visible_count: 1 },
			profile_policy: {
				status: "blocked",
				cause: "profile-policy-unproven",
			},
		},
		next_action: "create-credential-clean-profile",
	}),
	stderr: "",
} as const satisfies AuthTokenSupervisorResult;

const allRedStatus = {
	exitCode: 20,
	stdout: JSON.stringify({
		schema_version: 1,
		ok: false,
		state: "blocked",
		cause: "profile-policy-unproven",
		lane: { selected: "environment-injected-op", status: "blocked" },
		checks: {
			token_file: { status: "blocked", cause: "unsafe-ancestry" },
			op: { status: "blocked", cause: "process-failed" },
			token: { status: "blocked", cause: "token-missing" },
			vault_scope: { status: "blocked", cause: "invalid-vault-scope" },
			profile_policy: {
				status: "blocked",
				cause: "profile-policy-unproven",
			},
		},
		next_action: "create-credential-clean-profile",
	}),
	stderr: "",
} as const satisfies AuthTokenSupervisorResult;

function blockedStatus(
	cause: string,
	checks: Record<string, Record<string, unknown>>,
): AuthTokenSupervisorResult {
	return {
		exitCode: 20,
		stdout: JSON.stringify({
			schema_version: 1,
			ok: false,
			state: "blocked",
			cause,
			lane: { selected: "environment-injected-op", status: "blocked" },
			checks,
			next_action:
				cause.startsWith("profile-policy")
					? "create-credential-clean-profile"
					: cause === "invalid-vault-scope"
						? "repair-vault-grant"
						: "install-token",
		}),
		stderr: "",
	};
}

const greenChecks = {
	token_file: { status: "ready" },
	op: { status: "ready" },
	token: { status: "ready" },
	vault_scope: { status: "ready", visible_count: 1 },
	profile_policy: { status: "ready" },
} as const;

function stringLeaves(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringLeaves);
	if (typeof value !== "object" || value === null) return [];
	return Object.values(value).flatMap(stringLeaves);
}

function stableEnvelopeBytes(stdout: string): string {
	return stdout.replace(/("duration_ms": )-?\d+/, "$1<duration>");
}

function fixtureStream(contents = ""): ReadableStream<Uint8Array> {
	return new Blob([contents]).stream();
}

describe("token doctor repair groundwork", () => {
	test("the repair map covers every supervisor cause with the Repair Path rubric", () => {
		expect(AUTH_TOKEN_GATE_ORDER).toEqual([
			"token_file",
			"op",
			"token",
			"vault_scope",
			"profile_policy",
		]);
		expect(Object.keys(AUTH_TOKEN_REPAIR_PATHS).sort()).toEqual(
			[...AUTH_TOKEN_SUPERVISOR_CAUSES].sort(),
		);
		for (const cause of AUTH_TOKEN_SUPERVISOR_CAUSES) {
			const repair = AUTH_TOKEN_REPAIR_PATHS[cause];
			expect(repair.repairCommand.length).toBeGreaterThan(0);
			expect(["auto-fixable", "manual-only"]).toContain(repair.posture);
			expect(repair.successSignal.length).toBeGreaterThan(0);
			expect(repair.stopCondition.length).toBeGreaterThan(0);
		}
	});

	test("an unmapped future cause falls back to a gate-owned explain hint", () => {
		expect(authTokenRepairPathFor("future-supervisor-cause", "token")).toEqual({
			repairCommand: "browser-use auth status --json",
			posture: "manual-only",
			successSignal: "The token gate reports a code-owned cause.",
			stopCondition:
				"Stop and explain the unmapped token cause before attempting repair.",
		});
	});

	test("the three cold runtime causes own distinct repair commands and actions", () => {
		const causes = [
			"token-supervisor-unavailable",
			"op-path-unavailable",
			"unsafe-config-root",
		] as const;
		const commands = causes.map(
			(cause) => AUTH_TOKEN_REPAIR_PATHS[cause].repairCommand,
		);
		expect(commands[0]).toBe(
			"bun --cwd runtime/browser-use-environment-auth run build:release",
		);
		expect(new Set(commands).size).toBe(3);
		expect(AUTH_TOKEN_SUPERVISOR_DEGRADED_ACTIONS).toMatchObject({
			"token-supervisor-unavailable": "build-token-supervisor",
			"op-path-unavailable": "install-op-cli",
			"unsafe-config-root": "repair-config-root",
		});
	});

	test("doctor and reload are setup commands with vocabulary-safe contracts", () => {
		expect(BROWSER_USE_AUTH_SETUP_SUBCOMMANDS).toContain("doctor");
		expect(BROWSER_USE_AUTH_SETUP_SUBCOMMANDS).toContain("reload");
		expect(BROWSER_USE_AUTH_REPAIR_SUBCOMMANDS).not.toContain("doctor");
		expect(BROWSER_USE_AUTH_REPAIR_SUBCOMMANDS).not.toContain("reload");
		expect(browserUseContracts["auth-doctor"]).toBeDefined();
		expect(browserUseContracts["auth-reload"]).toBeDefined();
		expect(
			findCommandFacadeMetadataDrift(browserUseContracts, {
				path: "skills/browser-use/src/command-contract.ts",
			}),
		).toEqual([]);
	});

	test("doctor --fix stays aligned across contract, help, and parser", async () => {
		const contract = browserUseContracts["auth-doctor"];
		expect(contract.usage).toContain(
			"auth doctor [--fix [profile]] [--caller <label>] [--json|--plain]",
		);
		expect(contract.flags).toMatchObject({
			"--fix": {
				type: "boolean",
				description:
					"Attempt owner-delegated repairs for red gates, then re-check every gate; add profile to limit repair to profile policy.",
			},
		});
		expect(contract.mutation).toBe("write");
		expect(contract.sideEffects).toEqual(["check", "write"]);
		expect(contract.executionModes).toEqual(["check", "normal"]);
		expect(contract.interactivity).toBe("none");

		const help = await runForTest(
			["auth", "doctor", "--fix", "--help"],
			makeRuntime(),
		);
		expect(help.exitCode).toBe(0);
		expect(help.stdout).toContain(
			"browser-use auth doctor [--fix [profile]] [--caller <label>] [--json|--plain]",
		);
		expect(help.stdout).toContain(
			"--fix Attempt owner-delegated repairs for red gates, then re-check every gate; add profile to limit repair to profile policy.",
		);
	});

	test("setup commands keep doctor on status and route reload through its typed gate", async () => {
		const calls: AuthTokenSupervisorInput[] = [];
		const doctor = await runForTest(
			["auth", "doctor", "--json"],
			supervisorRuntime(healthyStatus, calls),
		);
		expect(doctor.exitCode).toBe(0);
		expect(calls).toEqual([{ mode: "status" }]);
		expect(envelopeOf(doctor.stdout).data.action).toBe("status");

		const reload = await runForTest(
			["auth", "reload", "--json"],
			makeRuntime({
				readAuthTokenSource: async () => ({ status: "missing" }),
				stdinIsTTY: () => false,
				runAuthTokenSupervisor: async () => {
					throw new Error("non-TTY reload without a source must not spawn");
				},
			}),
		);
		expect(reload.exitCode).toBe(20);
		expect((parseJson(reload.stdout).error as { code: string }).code).toBe(
			"auth_token_source_missing",
		);
	});
});

describe("auth doctor renderer", () => {
	test("AE1: bare doctor renders four green gates and one repairable red gate read-only", async () => {
		const calls: AuthTokenSupervisorInput[] = [];
		const result = await runForTest(
			["auth", "doctor"],
			supervisorRuntime(profilePolicyBlockedStatus, calls),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(calls).toEqual([{ mode: "status" }]);
		expect(result.stdout).toBe(
			[
				"browser-use auth doctor",
				"lane: environment-injected-op",
				"gate            verdict  state",
				"token_file      green    ready",
				"op              green    ready",
				"token           green    ready",
				"vault_scope     green    ready visible_count=1",
				"profile_policy  red      blocked cause=profile-policy-unproven",
				"  repair: browser-use auth doctor --fix profile",
				"summary: 4 green, 1 red",
				"",
			].join("\n"),
		);
	});

	test("all-red supervisor state renders one repair command per custody gate", async () => {
		const result = await runForTest(
			["auth", "doctor", "--plain"],
			supervisorRuntime(allRedStatus),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe(
			[
				"browser-use auth doctor",
				"lane: environment-injected-op",
				"gate            verdict  state",
				"token_file      red      blocked cause=unsafe-ancestry",
				"  repair: browser-use auth install-token --replace",
				"op              red      blocked cause=process-failed",
				"  repair: browser-use auth reload",
				"token           red      blocked cause=token-missing",
				"  repair: browser-use auth reload",
				"vault_scope     red      blocked cause=invalid-vault-scope",
				"  repair: browser-use auth repair-vault-grant",
				"profile_policy  red      blocked cause=profile-policy-unproven",
				"  repair: browser-use auth doctor --fix profile",
				"summary: 0 green, 5 red",
				"",
			].join("\n"),
		);
		expect(
			result.stdout.split("\n").filter((line) => line.startsWith("  repair:")),
		).toHaveLength(5);
	});

	test("missing and unproven custody states remain repairable red gates", async () => {
		const result = await runForTest(
			["auth", "doctor"],
			supervisorRuntime({
				exitCode: 20,
				stdout: JSON.stringify({
					schema_version: 1,
					ok: false,
					state: "blocked",
					cause: "token-unsafe",
					lane: { selected: "environment-injected-op", status: "blocked" },
					checks: {
						token_file: { status: "missing", cause: "token-missing" },
						op: { status: "unproven" },
						token: { status: "blocked", cause: "token-invalid" },
						vault_scope: { status: "ready", visible_count: 1 },
						profile_policy: { status: "ready" },
					},
					next_action: "repair-token-custody",
				}),
				stderr: "",
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain(
			"token_file      red      missing cause=token-missing\n" +
				"  repair: browser-use auth reload",
		);
		expect(result.stdout).toContain(
			"op              red      unproven\n" +
				"  repair: browser-use auth status --json",
		);
		expect(result.stdout).toContain("summary: 2 green, 3 red");
		expect(result.stdout).not.toContain("unknown");
		expect(
			result.stdout.split("\n").filter((line) => line.startsWith("  repair:")),
		).toHaveLength(3);
	});

	test("AE5: degraded runtime causes render a red runtime gate and five unknowns", async () => {
		for (const [cause, nextAction, repairCommand] of [
			[
				"token-supervisor-unavailable",
				"build-token-supervisor",
				"bun --cwd runtime/browser-use-environment-auth run build:release",
			],
			[
				"op-path-unavailable",
				"install-op-cli",
				'brew bundle --file "$HOME/code/dotfiles/config/brew/Brewfile"',
			],
			[
				"unsafe-config-root",
				"repair-config-root",
				"browser-use auth install-token",
			],
		] as const) {
			const result = await runForTest(
				["auth", "doctor"],
				supervisorRuntime({
					exitCode: 20,
					stdout: JSON.stringify({
						schema_version: 1,
						ok: false,
						state: "blocked",
						cause,
						next_action: nextAction,
					}),
					stderr: "",
				}),
			);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toBe(
				[
					"browser-use auth doctor",
					"lane: unknown",
					"gate            verdict  state",
					`runtime         red      blocked cause=${cause}`,
					`  repair: ${repairCommand}`,
					"token_file      unknown  unknown",
					"op              unknown  unknown",
					"token           unknown  unknown",
					"vault_scope     unknown  unknown",
					"profile_policy  unknown  unknown",
					"summary: 1 red, 5 unknown",
					"",
				].join("\n"),
			);
			expect(
				result.stdout.split("\n").filter((line) => line.startsWith("  repair:")),
			).toHaveLength(1);
		}
	});

	test("doctor --json matches status --json bytes apart from invocation duration", async () => {
		for (const fixture of [healthyStatus, profilePolicyBlockedStatus]) {
			const status = await runForTest(
				["auth", "status", "--run-id", "doctor-parity", "--json"],
				supervisorRuntime(fixture),
			);
			const doctor = await runForTest(
				["auth", "doctor", "--run-id", "doctor-parity", "--json"],
				supervisorRuntime(fixture),
			);

			expect(doctor.exitCode).toBe(status.exitCode);
			expect(stableEnvelopeBytes(doctor.stdout)).toBe(
				stableEnvelopeBytes(status.stdout),
			);
			expect(doctor.stderr).toBe(status.stderr);
		}
	});

	test("doctor envelopes carry typed action ids without repair command text", async () => {
		const result = await runForTest(
			["auth", "doctor", "--json"],
			supervisorRuntime(allRedStatus),
		);
		const envelope = envelopeOf(result.stdout);
		const projectedText = stringLeaves(envelope);

		expect(result.exitCode).toBe(20);
		expect(envelope.continuation.next_action_id).toBe(
			"create-credential-clean-profile",
		);
		for (const repair of Object.values(AUTH_TOKEN_REPAIR_PATHS)) {
			expect(
				projectedText.some((text) => text.includes(repair.repairCommand)),
			).toBe(false);
		}
	});

	test("AE2: --fix delegates stale-token and profile repairs, then exits green after re-check", async () => {
		const profilePath = "/fixture/profiles/agent chrome";
		const statusCalls: AuthTokenSupervisorInput[] = [];
		const statusResults = [
			{
				...profilePolicyBlockedStatus,
				stdout: JSON.stringify({
					schema_version: 1,
					ok: false,
					state: "blocked",
					cause: "token-invalid",
					lane: { selected: "environment-injected-op", status: "blocked" },
					checks: {
						token_file: { status: "ready" },
						op: { status: "ready" },
						token: { status: "blocked", cause: "token-invalid" },
						vault_scope: { status: "ready", visible_count: 1 },
						profile_policy: {
							status: "blocked",
							cause: "profile-policy-unproven",
						},
					},
					next_action: "install-token",
				}),
			},
			healthyStatus,
		] satisfies AuthTokenSupervisorResult[];
		const ownerCalls: Array<{
			argv: readonly string[];
			env: Record<string, string | undefined>;
			timeoutMs: number;
		}> = [];
		const result = await runForTest(
			["auth", "doctor", "--fix"],
			makeRuntime({
				env: {
					HOME: "/fixture/home",
					PATH: "/fixture/bin",
					WARM_CHROME_PROFILE_DIR: profilePath,
				},
				runAuthTokenSupervisor: async (input) => {
					statusCalls.push(input);
					return statusResults.shift() ?? healthyStatus;
				},
			}),
			{
				warmChromeEntrypoint: "/fixture/worktree/runtime/warm-chrome/src/cli.ts",
				spawnOwner: async (input) => {
					ownerCalls.push(input);
					return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
				},
			},
		);

		expect(result.exitCode).toBe(0);
		expect(statusCalls).toEqual([{ mode: "status" }, { mode: "status" }]);
		expect(ownerCalls).toHaveLength(2);
		expect(ownerCalls[0]?.argv.slice(-4)).toEqual([
			"auth",
			"reload",
			"--json",
			"--quiet",
		]);
		expect(ownerCalls[1]?.argv).toEqual([
			process.execPath,
			"/fixture/worktree/runtime/warm-chrome/src/cli.ts",
			"repair",
			"--profile-only",
			"--profile",
			profilePath,
			"--json",
			"--quiet",
		]);
		expect(ownerCalls.every((call) => call.timeoutMs > 0)).toBe(true);
		expect(
			ownerCalls.every(
				(call) => call.env.OP_SERVICE_ACCOUNT_TOKEN === undefined,
			),
		).toBe(true);
		expect(result.stdout).toContain("summary: 5 green, 0 red");
	});

	test("mixed safe and unsafe reds heal independently and retain the manual profile step", async () => {
		const initial = blockedStatus("token-invalid", {
			...greenChecks,
			token: { status: "blocked", cause: "token-invalid" },
			profile_policy: {
				status: "blocked",
				cause: "profile-policy-unsafe",
			},
		});
		const final = blockedStatus("profile-policy-unsafe", {
			...greenChecks,
			profile_policy: {
				status: "blocked",
				cause: "profile-policy-unsafe",
			},
		});
		const statuses = [initial, final];
		const ownerCalls: readonly string[][] = [];
		const mutableOwnerCalls = ownerCalls as string[][];
		const result = await runForTest(
			["auth", "doctor", "--fix"],
			makeRuntime({
				env: { HOME: "/fixture/home", PATH: "/fixture/bin" },
				runAuthTokenSupervisor: async () => statuses.shift() ?? final,
			}),
			{
				warmChromeEntrypoint: "/fixture/warm-chrome.ts",
				spawnOwner: async (input) => {
					mutableOwnerCalls.push([...input.argv]);
					return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(ownerCalls).toHaveLength(1);
		expect(ownerCalls[0]?.slice(-4)).toEqual([
			"auth",
			"reload",
			"--json",
			"--quiet",
		]);
		expect(result.stdout).toContain(
			"fix profile_policy: refused; manual: browser-use auth doctor --fix profile",
		);
		expect(result.stdout).toContain("summary: 4 green, 1 red");
	});

	test("all-manual reds spawn no owner and render every manual continuation", async () => {
		const manual = blockedStatus("unsafe-ancestry", {
			token_file: { status: "blocked", cause: "unsafe-ancestry" },
			op: { status: "blocked", cause: "op-session-unavailable" },
			token: { status: "blocked", cause: "item-missing" },
			vault_scope: { status: "blocked", cause: "invalid-vault-scope" },
			profile_policy: {
				status: "blocked",
				cause: "profile-policy-unsafe",
			},
		});
		let ownerCalls = 0;
		const result = await runForTest(
			["auth", "doctor", "--fix"],
			makeRuntime({
				env: { HOME: "/fixture/home" },
				runAuthTokenSupervisor: async () => manual,
			}),
			{
				spawnOwner: async () => {
					ownerCalls += 1;
					return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(ownerCalls).toBe(0);
		for (const command of [
			"browser-use auth install-token --replace",
			"op signin",
			"browser-use auth repair-vault-grant",
		]) {
			expect(result.stdout).toContain(command);
		}
		expect(result.stdout).toContain("browser-use auth doctor --fix profile");
	});

	test("an owner failure skips token dependents but still runs independent profile repair", async () => {
		const initial = blockedStatus("token-invalid", {
			...greenChecks,
			token: { status: "blocked", cause: "token-invalid" },
			vault_scope: { status: "blocked", cause: "invalid-vault-scope" },
			profile_policy: {
				status: "blocked",
				cause: "profile-policy-unproven",
			},
		});
		const final = blockedStatus("token-invalid", {
			...greenChecks,
			token: { status: "blocked", cause: "token-invalid" },
			vault_scope: { status: "blocked", cause: "invalid-vault-scope" },
		});
		const statuses = [initial, final];
		const ownerCalls: string[][] = [];
		const result = await runForTest(
			["auth", "doctor", "--fix"],
			makeRuntime({
				env: { HOME: "/fixture/home" },
				runAuthTokenSupervisor: async () => statuses.shift() ?? final,
			}),
			{
				warmChromeEntrypoint: "/fixture/warm-chrome.ts",
				spawnOwner: async (input) => {
					ownerCalls.push([...input.argv]);
					return ownerCalls.length === 1
						? {
								exitCode: 20,
								stdout: JSON.stringify({ error: { code: "auth_token_source_auth_required" } }),
								stderr: "",
								timedOut: false,
							}
						: { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(ownerCalls).toHaveLength(2);
		expect(ownerCalls.some((argv) => argv.includes("repair-vault-grant"))).toBe(
			false,
		);
		expect(ownerCalls.some((argv) => argv.includes("--profile-only"))).toBe(true);
		expect(result.stdout).toContain(
			"owner_failed reason=auth_token_source_auth_required",
		);
		expect(result.stdout).toContain("fix vault_scope: skipped");
	});

	test("degraded runtime fix is hint-only and performs no owner mutation", async () => {
		const degraded = {
			exitCode: 20,
			stdout: JSON.stringify({
				schema_version: 1,
				ok: false,
				state: "blocked",
				cause: "token-supervisor-unavailable",
				next_action: "build-token-supervisor",
			}),
			stderr: "",
		} satisfies AuthTokenSupervisorResult;
		let ownerCalls = 0;
		let statusCalls = 0;
		const result = await runForTest(
			["auth", "doctor", "--fix"],
			makeRuntime({
				runAuthTokenSupervisor: async () => {
					statusCalls += 1;
					return degraded;
				},
			}),
			{
				spawnOwner: async () => {
					ownerCalls += 1;
					return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(statusCalls).toBe(2);
		expect(ownerCalls).toBe(0);
		expect(result.stdout).toContain(
			"bun --cwd runtime/browser-use-environment-auth run build:release",
		);
	});

	test("persistent vault red gets one pure re-proof followed by the manual 1Password grant", async () => {
		const vaultRed = blockedStatus("invalid-vault-scope", {
			...greenChecks,
			vault_scope: {
				status: "blocked",
				cause: "invalid-vault-scope",
				visible_count: 0,
			},
		});
		const ownerCalls: string[][] = [];
		const result = await runForTest(
			["auth", "doctor", "--fix"],
			makeRuntime({ runAuthTokenSupervisor: async () => vaultRed }),
			{
				spawnOwner: async (input) => {
					ownerCalls.push([...input.argv]);
					return { exitCode: 0, stdout: "{}", stderr: "", timedOut: false };
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(ownerCalls).toHaveLength(1);
		expect(ownerCalls[0]).toContain("repair-vault-grant");
		expect(result.stdout).toContain(
			"Grant the service account access to exactly one vault in 1Password",
		);
	});

	test("an unresolvable warm-chrome entrypoint becomes an exact manual command", async () => {
		let ownerCalls = 0;
		const result = await runForTest(
			["auth", "doctor", "--fix", "profile"],
			makeRuntime({
				env: {
					HOME: "/fixture/home",
					WARM_CHROME_PROFILE_DIR: "/fixture/exact profile",
				},
				runAuthTokenSupervisor: async () => profilePolicyBlockedStatus,
			}),
			{
				warmChromeEntrypoint: null,
				spawnOwner: async () => {
					ownerCalls += 1;
					return { exitCode: 1, stdout: "", stderr: "", timedOut: false };
				},
			},
		);

		expect(result.exitCode).toBe(20);
		expect(ownerCalls).toBe(0);
		expect(result.stdout).toContain(
			'manual: warm-chrome repair --profile-only --profile "/fixture/exact profile"',
		);
		expect(result.stdout).not.toContain("not found");
	});

	test("--fix JSON re-check keeps repair commands in human output only", async () => {
		const vaultRed = blockedStatus("invalid-vault-scope", {
			...greenChecks,
			vault_scope: {
				status: "blocked",
				cause: "invalid-vault-scope",
				visible_count: 0,
			},
		});
		const result = await runForTest(
			["auth", "doctor", "--fix", "--json"],
			makeRuntime({ runAuthTokenSupervisor: async () => vaultRed }),
			{
				spawnOwner: async () => ({
					exitCode: 0,
					stdout: "{}",
					stderr: "",
					timedOut: false,
				}),
			},
		);
		const projectedText = stringLeaves(parseJson(result.stdout));

		expect(result.exitCode).toBe(20);
		expect(projectedText).not.toContain(
			"browser-use auth repair-vault-grant",
		);
		expect(projectedText.some((text) => text.includes("1Password"))).toBe(false);
		expect(envelopeOf(result.stdout).continuation.next_action_id).toBe(
			"repair-vault-grant",
		);
	});
});

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

function rejection(
	code: BrowserUseTokenRetrievalRejection["code"],
): BrowserUseTokenRetrievalRejection {
	return { code, message: `retrieval rejected (${code}).` };
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
		for (const subcommand of BROWSER_USE_AUTH_REPAIR_SUBCOMMANDS) {
			expect(tableIds.has(subcommand)).toBe(true);
		}
	});
});

describe("ADR 0030 token lifecycle commands", () => {
	test("install-token --from rejects a malformed source before custody work", async () => {
		for (const sourceRef of [
			"not-a-source",
			"op://vault?/item/field",
			"op://vault/item?/field",
			"op://vault/item/field\n",
			"op://vault/item/field\0",
		]) {
			const calls: AuthTokenSupervisorInput[] = [];
			let sourceWrites = 0;
			const result = await runForTest(
				["auth", "install-token", "--from", sourceRef, "--json"],
				makeRuntime({
					runAuthTokenSupervisor: async (input) => {
						calls.push(input);
						return healthyStatus;
					},
					writeAuthTokenSource: async () => {
						sourceWrites += 1;
						return { ok: true };
					},
				}),
			);

			expect(result.exitCode).toBe(20);
			expect((parseJson(result.stdout).error as { code: string }).code).toBe(
				"auth_token_source_invalid",
			);
			expect(calls).toEqual([]);
			expect(sourceWrites).toBe(0);
		}
	});

	test("install-token help advertises the source flag and its exclusive stdin form", async () => {
		const result = await runForTest(
			["auth", "install-token", "--help"],
			makeRuntime(),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("[--from <reference>|--stdin]");
		expect(result.stdout).toContain("--from Fetch from one OP item field reference");
	});

	test("install-token refuses source and stdin together before custody work", async () => {
		const calls: AuthTokenSupervisorInput[] = [];
		const result = await runForTest(
			[
				"auth",
				"install-token",
				"--from",
				"op://Vault/Item/field",
				"--stdin",
				"--json",
			],
			supervisorRuntime(healthyStatus, calls),
		);

		expect(result.exitCode).toBe(20);
		expect((parseJson(result.stdout).error as { code: string }).code).toBe(
			"auth_token_source_invalid",
		);
		expect(calls).toEqual([]);
	});

	test("install-token --from records the source only after a successful install", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		const calls: AuthTokenSupervisorInput[] = [];
		const sourceRef = "op://Browser Automation/Service Account/credential";
		const result = await runForTest(
			["auth", "install-token", "--from", sourceRef, "--json"],
			makeRuntime({
				env: scratch.env,
				runAuthTokenSupervisor: async (input) => {
					calls.push(input);
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							schema_version: 1,
							ok: true,
							state: "installed",
							next_action: "auth-status",
						}),
						stderr: "",
					};
				},
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([
			{ mode: "install", input: "source", replace: false, sourceRef },
		]);
		const sourcePath = join(custodyDir, "token-source.json");
		expect(JSON.parse(await readFile(sourcePath, "utf8"))).toEqual({
			schema_version: 1,
			source: sourceRef,
		});
		const sourceMetadata = await lstat(sourcePath);
		const effectiveUserId = process.geteuid?.() ?? process.getuid?.();
		if (effectiveUserId === undefined) {
			throw new Error("POSIX user id unavailable");
		}
		expect(sourceMetadata.mode & 0o777).toBe(0o600);
		expect(sourceMetadata.uid).toBe(effectiveUserId);
		expect(sourceMetadata.nlink).toBe(1);
		expect(envelopeOf(result.stdout).data.evaluation.detail).toEqual({
			source_present: true,
		});
		expect(result.stdout + result.stderr).not.toContain(sourceRef);
	});

	test("AE3: reload uses the validated stored source non-interactively", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		const sourceRef = "op://Browser Automation/Service Account/credential";
		await writeFile(
			join(custodyDir, "token-source.json"),
			`${JSON.stringify({ schema_version: 1, source: sourceRef })}\n`,
			{ mode: 0o600 },
		);
		const calls: AuthTokenSupervisorInput[] = [];
		const result = await runForTest(
			["auth", "reload", "--json"],
			makeRuntime({
				env: scratch.env,
				stdinIsTTY: () => false,
				runAuthTokenSupervisor: async (input) => {
					calls.push(input);
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							schema_version: 1,
							ok: true,
							state: "replaced",
							next_action: "auth-status",
						}),
						stderr: "",
					};
				},
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([
			{ mode: "install", input: "source", replace: true, sourceRef },
		]);
		expect(envelopeOf(result.stdout).data.evaluation.detail).toEqual({
			source_present: true,
		});
		expect(result.stdout + result.stderr).not.toContain(sourceRef);
	});

	test("AE3: reload without a source refuses non-TTY input without prompting", async () => {
		let supervisorCalls = 0;
		const startedAt = Date.now();
		const result = await runForTest(
			["auth", "reload", "--json"],
			makeRuntime({
				readAuthTokenSource: async () => ({ status: "missing" }),
				stdinIsTTY: () => false,
				runAuthTokenSupervisor: async () => {
					supervisorCalls += 1;
					throw new Error("must not prompt or spawn");
				},
			}),
		);

		expect(Date.now() - startedAt).toBeLessThan(500);
		expect(result.exitCode).toBe(20);
		expect((parseJson(result.stdout).error as { code: string }).code).toBe(
			"auth_token_source_missing",
		);
		expect(supervisorCalls).toBe(0);
		expect(envelopeOf(result.stdout).data.evaluation.detail).toEqual({
			source_present: false,
		});
	});

	test("reload without a source uses the hidden prompt only on a TTY", async () => {
		const calls: AuthTokenSupervisorInput[] = [];
		const result = await runForTest(
			["auth", "reload", "--json"],
			makeRuntime({
				readAuthTokenSource: async () => ({ status: "missing" }),
				stdinIsTTY: () => true,
				runAuthTokenSupervisor: async (input) => {
					calls.push(input);
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							schema_version: 1,
							ok: true,
							state: "replaced",
							next_action: "auth-status",
						}),
						stderr: "",
					};
				},
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([
			{ mode: "install", input: "prompt", replace: true },
		]);
		expect(envelopeOf(result.stdout).data.evaluation.detail).toEqual({
			source_present: false,
		});
	});

	test("a failed source install does not persist its reference", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		const sourceRef = "op://Browser Automation/Revoked Item/credential";
		const result = await runForTest(
			["auth", "install-token", "--from", sourceRef, "--json"],
			makeRuntime({
				env: scratch.env,
				runAuthTokenSupervisor: async () => ({
					exitCode: 20,
					stdout: JSON.stringify({
						schema_version: 1,
						ok: false,
						state: "blocked",
						cause: "invalid-service-account",
						next_action: "repair-token-custody",
					}),
					stderr: "",
				}),
			}),
		);

		expect(result.exitCode).toBe(20);
		expect(envelopeOf(result.stdout).data.evaluation.blocked_cause).toBe(
			"invalid-service-account",
		);
		expect(lstat(join(custodyDir, "token-source.json"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(result.stdout + result.stderr).not.toContain(sourceRef);
	});

	test("a successful install refuses to replace an unsafe recorded source", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		const sourcePath = join(custodyDir, "token-source.json");
		const targetPath = join(scratch.base, "unsafe-source-target.json");
		const targetContents = "do-not-replace";
		await writeFile(targetPath, targetContents, { mode: 0o600 });
		await symlink(targetPath, sourcePath);
		const sourceRef = "op://Browser Automation/Service Account/credential";
		const calls: AuthTokenSupervisorInput[] = [];
		const result = await runForTest(
			["auth", "install-token", "--from", sourceRef, "--json"],
			makeRuntime({
				env: scratch.env,
				runAuthTokenSupervisor: async (input) => {
					calls.push(input);
					return {
						exitCode: 0,
						stdout: JSON.stringify({
							schema_version: 1,
							ok: true,
							state: "installed",
							next_action: "auth-status",
						}),
						stderr: "",
					};
				},
			}),
		);

		expect(result.exitCode).toBe(20);
		expect((parseJson(result.stdout).error as { code: string }).code).toBe(
			"auth_token_source_unsafe",
		);
		expect(calls).toEqual([
			{ mode: "install", input: "source", replace: false, sourceRef },
		]);
		expect(await readFile(targetPath, "utf8")).toBe(targetContents);
		expect((await lstat(sourcePath)).isSymbolicLink()).toBe(true);
		expect(result.stdout + result.stderr).not.toContain(sourceRef);
	});

	test("reload refuses symlinked and hard-linked source files before spawning", async () => {
		for (const linkKind of ["symbolic", "hard"] as const) {
			const scratch = makeTempXdgEnv();
			disposables.push(scratch);
			const custodyDir = join(
				scratch.env.XDG_CONFIG_HOME ?? "",
				"browser-use",
				"auth.nosync",
			);
			await mkdir(custodyDir, { recursive: true, mode: 0o700 });
			const target = join(scratch.base, `${linkKind}-source.json`);
			await writeFile(
				target,
				JSON.stringify({
					schema_version: 1,
					source: "op://Vault/Item/field",
				}),
				{ mode: 0o600 },
			);
			const sourcePath = join(custodyDir, "token-source.json");
			if (linkKind === "symbolic") await symlink(target, sourcePath);
			else await link(target, sourcePath);
			let supervisorCalls = 0;
			const result = await runForTest(
				["auth", "reload", "--json"],
				makeRuntime({
					env: scratch.env,
					runAuthTokenSupervisor: async () => {
						supervisorCalls += 1;
						return healthyStatus;
					},
				}),
			);

			expect(result.exitCode).toBe(20);
			expect((parseJson(result.stdout).error as { code: string }).code).toBe(
				"auth_token_source_unsafe",
			);
			expect(supervisorCalls).toBe(0);
		}
	});

	test("reload refuses a non-owner-only source mode before spawning", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		const sourcePath = join(custodyDir, "token-source.json");
		await writeFile(
			sourcePath,
			JSON.stringify({
				schema_version: 1,
				source: "op://Vault/Item/field",
			}),
			{ mode: 0o600 },
		);
		await chmod(sourcePath, 0o640);
		let supervisorCalls = 0;
		const result = await runForTest(
			["auth", "reload", "--json"],
			makeRuntime({
				env: scratch.env,
				runAuthTokenSupervisor: async () => {
					supervisorCalls += 1;
					return healthyStatus;
				},
			}),
		);

		expect(result.exitCode).toBe(20);
		expect((parseJson(result.stdout).error as { code: string }).code).toBe(
			"auth_token_source_unsafe",
		);
		expect(supervisorCalls).toBe(0);
	});

	test("reload refuses a symlink in the stored source ancestry before spawning", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const realConfigHome = join(scratch.base, "real-config");
		const linkedConfigHome = join(scratch.base, "linked-config");
		const custodyDir = join(
			realConfigHome,
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		await writeFile(
			join(custodyDir, "token-source.json"),
			JSON.stringify({
				schema_version: 1,
				source: "op://Vault/Item/field",
			}),
			{ mode: 0o600 },
		);
		await symlink(realConfigHome, linkedConfigHome);
		let supervisorCalls = 0;
		const result = await runForTest(
			["auth", "reload", "--json"],
			makeRuntime({
				env: { ...scratch.env, XDG_CONFIG_HOME: linkedConfigHome },
				runAuthTokenSupervisor: async () => {
					supervisorCalls += 1;
					return healthyStatus;
				},
			}),
		);

		expect(result.exitCode).toBe(20);
		expect((parseJson(result.stdout).error as { code: string }).code).toBe(
			"auth_token_source_unsafe",
		);
		expect(supervisorCalls).toBe(0);
	});

	test("reload refuses a stored reference that no longer parses", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		await writeFile(
			join(custodyDir, "token-source.json"),
			JSON.stringify({ schema_version: 1, source: "not-a-source" }),
			{ mode: 0o600 },
		);
		let supervisorCalls = 0;
		const result = await runForTest(
			["auth", "reload", "--json"],
			makeRuntime({
				env: scratch.env,
				runAuthTokenSupervisor: async () => {
					supervisorCalls += 1;
					return healthyStatus;
				},
			}),
		);

		expect(result.exitCode).toBe(20);
		expect((parseJson(result.stdout).error as { code: string }).code).toBe(
			"auth_token_source_invalid",
		);
		expect(supervisorCalls).toBe(0);
	});

	test("source install passes the OP pipe directly and scrubs every child env", async () => {
		const sourcePipe = fixtureStream();
		const spawns: Parameters<AuthTokenProcessSpawn>[0][] = [];
		const spawn: AuthTokenProcessSpawn = (input) => {
			spawns.push(input);
			const stdout =
				input.argv[1] === "read"
					? sourcePipe
					: input.argv[0] === "/fixture/supervisor"
						? fixtureStream(
								JSON.stringify({
									schema_version: 1,
									ok: true,
									state: "installed",
									next_action: "auth-status",
								}),
							)
						: null;
			const stderr =
				input.argv[0] === "/fixture/supervisor" ? fixtureStream() : null;
			return {
				stdout,
				stderr,
				exited: Promise.resolve({ exitCode: 0, signalCode: null }),
				kill: () => {},
			};
		};
		const sourceRef = "op://Browser Automation/Service Account/credential";
		const result = await __authTokenSupervisorForTest.run(
			{
				HOME: "/fixture/home",
				OP_SERVICE_ACCOUNT_TOKEN: "AUTH_SENTINEL_must_not_spawn",
				OP_SESSION_operator: "operator-session",
			},
			{ mode: "install", input: "source", replace: false, sourceRef },
			{
				supervisorPath: "/fixture/supervisor",
				opPath: "/fixture/op",
				configRoot: "/fixture/config",
				profilePath: "/fixture/profile",
			},
			spawn,
		);

		expect(result.exitCode).toBe(0);
		expect(spawns.map((call) => call.argv)).toEqual([
			["/fixture/op", "whoami"],
			["/fixture/op", "read", sourceRef],
			expect.arrayContaining([
				"/fixture/supervisor",
				"install",
				"--input",
				"stdin",
			]),
		]);
		expect(spawns[2]?.stdin).toBe(sourcePipe);
		expect(spawns.every((call) => call.timeoutMs > 0)).toBe(true);
		expect(
			spawns.every(
				(call) => call.env.OP_SERVICE_ACCOUNT_TOKEN === undefined,
			),
		).toBe(true);
		expect(JSON.stringify(spawns)).not.toContain("AUTH_SENTINEL_must_not_spawn");
	});

	test("the Bun process adapter hands child stdout directly to child stdin", async () => {
		const source = __authTokenSupervisorForTest.spawn({
			argv: ["/usr/bin/printf", "fd-proof"],
			env: { PATH: "/usr/bin:/bin" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			timeoutMs: 1_000,
		});
		expect(source.stdout).not.toBeNull();
		const sink = __authTokenSupervisorForTest.spawn({
			argv: ["/bin/cat"],
			env: { PATH: "/usr/bin:/bin" },
			stdin: source.stdout as ReadableStream<Uint8Array>,
			stdout: "pipe",
			stderr: "pipe",
			timeoutMs: 1_000,
		});

		const [sourceExit, sinkExit, stdout, stderr] = await Promise.all([
			source.exited,
			sink.exited,
			new Response(sink.stdout).text(),
			new Response(sink.stderr).text(),
		]);
		expect(sourceExit).toEqual({ exitCode: 0, signalCode: null });
		expect(sinkExit).toEqual({ exitCode: 0, signalCode: null });
		expect(stdout).toBe("fd-proof");
		expect(stderr).toBe("");
	});

	test("install-token --from refuses a signed-out OP session quickly and persists nothing", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		let spawnCalls = 0;
		const signedOut = await __authTokenSupervisorForTest.run(
			{},
			{
				mode: "install",
				input: "source",
				replace: false,
				sourceRef: "op://Browser Automation/Service Account/credential",
			},
			{
				supervisorPath: "/fixture/supervisor",
				opPath: "/fixture/op",
				configRoot: "/fixture/config",
				profilePath: "/fixture/profile",
			},
			() => {
				spawnCalls += 1;
				return {
					stdout: null,
					stderr: null,
					exited: Promise.resolve({ exitCode: 1, signalCode: null }),
					kill: () => {},
				};
			},
		);
		const startedAt = Date.now();
		const result = await runForTest(
			[
				"auth",
				"install-token",
				"--from",
				"op://Browser Automation/Service Account/credential",
				"--json",
			],
			makeRuntime({
				env: scratch.env,
				runAuthTokenSupervisor: async () => signedOut,
			}),
		);

		expect(Date.now() - startedAt).toBeLessThan(500);
		expect(spawnCalls).toBe(1);
		expect(result.exitCode).toBe(20);
		expect((parseJson(result.stdout).error as { code: string }).code).toBe(
			"auth_token_source_auth_required",
		);
		expect(envelopeOf(result.stdout).data.evaluation.blocked_cause).toBe(
			"op-session-unavailable",
		);
		expect(lstat(join(custodyDir, "token-source.json"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(result.stdout + result.stderr).not.toContain(
			"op://Browser Automation/Service Account/credential",
		);
	});

	test("install-token --stdin delegates token input to the native supervisor", async () => {
		const calls: AuthTokenSupervisorInput[] = [];
		const runtime = supervisorRuntime(
			{
				exitCode: 0,
				stdout: JSON.stringify({
					schema_version: 1,
					ok: true,
					state: "installed",
					next_action: "auth-status",
				}),
				stderr: "",
			},
			calls,
		);
		const result = await runForTest(
			["auth", "install-token", "--stdin", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([
			{ mode: "install", input: "stdin", replace: false },
		]);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toEqual({ status: "installed" });
		expect(envelope.continuation.next_action_id).toBe("auth-status");
	});

	test("install-token defaults to a hidden prompt and supports atomic replacement", async () => {
		const calls: AuthTokenSupervisorInput[] = [];
		const runtime = supervisorRuntime(
			{
				exitCode: 0,
				stdout: JSON.stringify({
					schema_version: 1,
					ok: true,
					state: "replaced",
					next_action: "auth-status",
				}),
				stderr: "",
			},
			calls,
		);
		const result = await runForTest(
			["auth", "install-token", "--replace", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([
			{ mode: "install", input: "prompt", replace: true },
		]);
		expect(result.stdout).not.toContain("OP_SERVICE_ACCOUNT_TOKEN");
		expect(result.stderr).toBe("");
	});

	test("token argv and ambient token env are rejected before supervisor or stdin reads", async () => {
		let supervisorCalls = 0;
		let stdinReads = 0;
		const runtime = makeRuntime({
			env: { OP_SERVICE_ACCOUNT_TOKEN: "AUTH_SENTINEL_9f31" },
			readStdin: async () => {
				stdinReads += 1;
				throw new Error("stdin must remain unread");
			},
			runAuthTokenSupervisor: async () => {
				supervisorCalls += 1;
				return healthyStatus;
			},
		});
		const ambient = await runForTest(
			["auth", "install-token", "--stdin", "--json"],
			runtime,
		);
		expect(ambient.exitCode).toBe(20);
		expect(supervisorCalls).toBe(0);
		expect(stdinReads).toBe(0);
		expect(ambient.stdout + ambient.stderr).not.toContain("AUTH_SENTINEL_9f31");

		const argv = await runForTest(
			["auth", "install-token", "--token", "AUTH_SENTINEL_argv", "--json"],
			supervisorRuntime(healthyStatus),
		);
		expect(argv.exitCode).toBe(2);
		expect(argv.stdout + argv.stderr).not.toContain("AUTH_SENTINEL_argv");
	});

	test("failed replacement stays blocked and names custody repair", async () => {
		const result = await runForTest(
			["auth", "install-token", "--stdin", "--replace", "--json"],
			supervisorRuntime({
				exitCode: 20,
				stdout: JSON.stringify({
					schema_version: 1,
					ok: false,
					state: "blocked",
					cause: "invalid-service-account",
					next_action: "repair-token-custody",
				}),
				stderr: "",
			}),
		);
		expect(result.exitCode).toBe(20);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toEqual({
			status: "blocked",
			blocked_cause: "invalid-service-account",
		});
		expect(envelope.continuation.next_action_id).toBe("repair-token-custody");
	});

	test("remove-token targets native custody and retains remote revocation as next action", async () => {
		const scratch = makeTempXdgEnv();
		disposables.push(scratch);
		const custodyDir = join(
			scratch.env.XDG_CONFIG_HOME ?? "",
			"browser-use",
			"auth.nosync",
		);
		await mkdir(custodyDir, { recursive: true, mode: 0o700 });
		const sourcePath = join(custodyDir, "token-source.json");
		const sourceBytes = `${JSON.stringify({
			schema_version: 1,
			source: "op://Browser Automation/Service Account/credential",
		})}\n`;
		await writeFile(sourcePath, sourceBytes, { mode: 0o600 });
		const calls: AuthTokenSupervisorInput[] = [];
		const result = await runForTest(
			["auth", "remove-token", "--json"],
			makeRuntime({
				env: scratch.env,
				runAuthTokenSupervisor: async (input) => {
					calls.push(input);
					return {
					exitCode: 0,
					stdout: JSON.stringify({
						schema_version: 1,
						ok: true,
						state: "removed",
						next_action: "revoke-service-account-token-remotely",
						remote_authority: "may-remain-live",
					}),
					stderr: "",
					};
				},
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([{ mode: "remove" }]);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.continuation.next_action_id).toBe(
			"revoke-service-account-token-remotely",
		);
		expect(result.stdout).toContain("may-remain-live");
		expect(await readFile(sourcePath, "utf8")).toBe(sourceBytes);
	});

	test("status --json projects every secret-free admission gate", async () => {
		const calls: AuthTokenSupervisorInput[] = [];
		const result = await runForTest(
			["auth", "status", "--json"],
			supervisorRuntime(healthyStatus, calls),
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toEqual([{ mode: "status" }]);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation).toEqual({
			status: "ready",
			detail: {
				lane: { selected: "environment-injected-op", status: "ready" },
				checks: {
					token_file: { status: "ready" },
					op: { status: "ready" },
					token: { status: "ready" },
					vault_scope: { status: "ready", visible_count: 1 },
					profile_policy: { status: "ready" },
				},
			},
		});
		expect(envelope.continuation.next_action_id).toBe(
			"rerun-confidential-command",
		);
	});

	test("status allowlists native fields and never forwards native stderr", async () => {
		const sentinel = "NATIVE_OUTPUT_SENTINEL_b871";
		const result = await runForTest(
			["auth", "status", "--json"],
			supervisorRuntime({
				...healthyStatus,
				stdout: JSON.stringify({
					...JSON.parse(healthyStatus.stdout),
					debug: sentinel,
				}),
				stderr: sentinel,
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout + result.stderr).not.toContain(sentinel);
	});

	// Regression: the create-credential-clean-profile continuation contains the
	// word "credential", which the envelope leak-guard bans in free text. The
	// id must ride the envelope's id fields (shape-gated), so a profile-policy
	// block emits its typed envelope instead of crashing the CLI with
	// CliRuntimeContractError at emit time.
	test("profile-policy blocked status emits the typed clean-profile continuation", async () => {
		const result = await runForTest(
			["auth", "status", "--json"],
			supervisorRuntime({
				exitCode: 20,
				stdout: JSON.stringify({
					schema_version: 1,
					ok: false,
					state: "blocked",
					cause: "profile-policy-unproven",
					lane: { selected: "environment-injected-op", status: "blocked" },
					checks: {
						token_file: { status: "ready" },
						op: { status: "ready" },
						token: { status: "ready" },
						vault_scope: { status: "ready", visible_count: 1 },
						profile_policy: {
							status: "blocked",
							cause: "profile-policy-unproven",
						},
					},
					next_action: "create-credential-clean-profile",
				}),
				stderr: "",
			}),
		);
		expect(result.exitCode).toBe(20);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.data.evaluation.status).toBe("blocked");
		expect(envelope.data.evaluation.blocked_cause).toBe(
			"profile-policy-unproven",
		);
		expect(envelope.continuation.next_action_id).toBe(
			"create-credential-clean-profile",
		);
	});

	// Regression: the last-resort error emitter must be total. An upstream
	// failure whose message carries leak-guard vocabulary (here the word
	// "credential") must produce a typed runtime_error envelope with the
	// message withheld — never an uncaught CliRuntimeContractError.
	test("a supervisor failure carrying banned vocabulary still emits a typed envelope", async () => {
		const sentinel = "supervisor rejected the credential material";
		const result = await runForTest(
			["auth", "status", "--json"],
			makeRuntime({
				runAuthTokenSupervisor: async () => {
					throw new Error(sentinel);
				},
			}),
		);
		expect(result.exitCode).toBe(1);
		const envelope = parseJson(result.stdout);
		expect((envelope.error as { code: string }).code).toBe("runtime_error");
		expect(result.stdout).not.toContain(sentinel);
	});

	test("unsafe token custody blocks with exactly one repair action", async () => {
		const result = await runForTest(
			["auth", "status", "--json"],
			supervisorRuntime({
				exitCode: 20,
				stdout: JSON.stringify({
					schema_version: 1,
					ok: false,
					state: "blocked",
					cause: "token-unsafe",
					lane: { selected: "environment-injected-op", status: "blocked" },
					checks: {
						token_file: { status: "blocked", cause: "token-unsafe" },
						op: { status: "unproven" },
						token: { status: "unproven" },
						vault_scope: { status: "unproven" },
						profile_policy: { status: "unproven" },
					},
					next_action: "repair-token-custody",
				}),
				stderr: "",
			}),
		);
		expect(result.exitCode).toBe(20);
		const envelope = envelopeOf(result.stdout);
		expect(envelope.continuation.next_action_id).toBe("repair-token-custody");
		expect(
			(parseJson(result.stdout).runtime_actions as unknown[]).length,
		).toBe(1);
	});

	test("degraded runtime causes retain distinct typed repair actions", async () => {
		for (const [cause, nextAction] of [
			["token-supervisor-unavailable", "build-token-supervisor"],
			["op-path-unavailable", "install-op-cli"],
			["unsafe-config-root", "repair-config-root"],
		] as const) {
			const result = await runForTest(
				["auth", "status", "--json"],
				supervisorRuntime({
					exitCode: 20,
					stdout: JSON.stringify({
						schema_version: 1,
						ok: false,
						state: "blocked",
						cause,
						next_action: nextAction,
					}),
					stderr: "",
				}),
			);
			const envelope = envelopeOf(result.stdout);
			expect(envelope.data.evaluation.blocked_cause).toBe(cause);
			expect(envelope.continuation.next_action_id).toBe(nextAction);
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
				"install-token",
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
		expect(result.stdout).toContain("continuation=install-token");
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
			"install-token",
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
			"install-token",
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
		// Redaction: the evidence's origins and login paths never reach the
		// envelope — only ids, state, and methods project.
		expect(result.stdout).not.toContain("portal.example.test");
		expect(result.stdout).not.toContain("/login");
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
