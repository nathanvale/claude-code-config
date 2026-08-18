import { createHash } from "node:crypto";

const SCHEMA_VERSION = "credential.prototype.v1" as const;
const PROTOTYPE_VERSION = "0.1.0" as const;
const DEFAULT_PINNED_OP_VERSION = "2.39.0" as const;

type Outcome = "ok" | "planned" | "blocked";

type NextAction = {
	id: string;
	reason: string;
	command?: string;
};

type PrototypeResult = {
	schema_version: typeof SCHEMA_VERSION;
	run_id: string;
	command: string;
	outcome: Outcome;
	code: string;
	summary: string;
	changed: false;
	side_effect: "none";
	retry_safe: boolean;
	data?: unknown;
	next_action?: NextAction;
};

type PrototypeExecution = {
	exitCode: 0 | 2 | 20 | 70;
	json: boolean;
	result?: PrototypeResult;
	help?: string;
	version?: string;
	diagnostic?: string;
};

type ParsedArguments = {
	json: boolean;
	positionals: string[];
	flags: Map<string, string | true>;
};

const SECRET_SHAPED_FLAGS = new Set([
	"--api-key",
	"--credential",
	"--password",
	"--secret",
	"--token",
]);

function stableRunId(command: string, facts: unknown): string {
	const digest = createHash("sha256")
		.update(JSON.stringify({ command, facts }))
		.digest("hex")
		.slice(0, 12);
	return `cred-${digest}`;
}

function makeResult(input: Omit<PrototypeResult, "schema_version" | "changed" | "side_effect">): PrototypeResult {
	return {
		schema_version: SCHEMA_VERSION,
		changed: false,
		side_effect: "none",
		...input,
	};
}

function parseArguments(argv: string[]): ParsedArguments {
	const json = argv.includes("--json");
	const filtered = argv.filter((value) => value !== "--json");
	const positionals: string[] = [];
	const flags = new Map<string, string | true>();

	for (let index = 0; index < filtered.length; index += 1) {
		const value = filtered[index];
		if (!value.startsWith("--")) {
			positionals.push(value);
			continue;
		}
		if (SECRET_SHAPED_FLAGS.has(value)) {
			throw new UsageError(
				"secret-shaped flags are forbidden; this prototype accepts references and approval handles only",
			);
		}
		if (["--architecture-match", "--digest-match", "--signature-match"].includes(value)) {
			flags.set(value, true);
			continue;
		}
		const next = filtered[index + 1];
		if (next === undefined || next.startsWith("--")) {
			throw new UsageError(`${value} requires a value`);
		}
		flags.set(value, next);
		index += 1;
	}

	return { json, positionals, flags };
}

class UsageError extends Error {}

function requireFlag(flags: Map<string, string | true>, name: string): string {
	const value = flags.get(name);
	if (typeof value !== "string" || value.length === 0) {
		throw new UsageError(`${name} is required`);
	}
	return value;
}

function rejectUnknownFlags(flags: Map<string, string | true>, allowed: string[]): void {
	const allowedSet = new Set(allowed);
	for (const name of flags.keys()) {
		if (!allowedSet.has(name)) throw new UsageError(`unknown flag: ${name}`);
	}
}

function normalizeOrigin(raw: string): string {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new UsageError("--origin must be an absolute HTTPS origin");
	}
	if (parsed.protocol !== "https:" || parsed.origin !== raw) {
		throw new UsageError("--origin must contain only an absolute HTTPS origin with no path, query, or fragment");
	}
	return parsed.origin;
}

function validateCapability(raw: string): string {
	if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(raw)) {
		throw new UsageError("--capability must use lowercase dot-or-dash separated words");
	}
	return raw;
}

function loginPlan(origin: string, capability: string): PrototypeResult {
	const runId = stableRunId("login", { origin, capability });
	return makeResult({
		run_id: runId,
		command: "login plan",
		outcome: "planned",
		code: "login_plan_ready",
		summary: "Browser Use authentication remains paused; one exact credential-front-door handoff is ready for approval.",
		retry_safe: true,
		data: {
			origin,
			capability,
			auth_mode: "credential-front-door-prototype",
			browser_use_auth: "paused-fail-closed",
			adapter: "simulated-browser-login",
			credential_visibility: "none",
		},
		next_action: {
			id: "execute-approved-login",
			reason: "Execute only the exact origin and capability represented by this run ID.",
			command: `credential login execute --origin ${origin} --capability ${capability} --approval ${runId} --json`,
		},
	});
}

function loginExecute(origin: string, capability: string, approval: string): PrototypeExecution {
	const expected = stableRunId("login", { origin, capability });
	if (approval !== expected) {
		return {
			exitCode: 20,
			json: false,
			diagnostic: "login approval does not match the exact origin and capability",
			result: makeResult({
				run_id: expected,
				command: "login execute",
				outcome: "blocked",
				code: "approval_mismatch",
				summary: "No adapter handoff occurred because the approval handle does not match this login plan.",
				retry_safe: true,
				data: { origin, capability, browser_use_auth: "paused-fail-closed" },
				next_action: {
					id: "plan-login-again",
					reason: "Generate the deterministic plan for these exact inputs and use its run ID.",
					command: `credential login plan --origin ${origin} --capability ${capability} --json`,
				},
			}),
		};
	}

	return {
		exitCode: 0,
		json: false,
		result: makeResult({
			run_id: expected,
			command: "login execute",
			outcome: "ok",
			code: "simulated_login_handoff_complete",
			summary: "The prototype admitted one exact handoff to the simulated browser-login adapter; no browser or credential action occurred.",
			retry_safe: false,
			data: {
				origin,
				capability,
				auth_mode: "credential-front-door-prototype",
				browser_use_auth: "paused-fail-closed",
				adapter: "simulated-browser-login",
				credential_visibility: "none",
				production_effect: "would-authenticate-one-warm-chrome-target",
			},
			next_action: {
				id: "inspect-prototype-status",
				reason: "Confirm the prototype leaves all machine state unchanged.",
				command: "credential status --json",
			},
		}),
	};
}

function runtimeVerify(input: {
	pinned: string;
	observed: string;
	digestMatch: boolean;
	signatureMatch: boolean;
	architectureMatch: boolean;
}): PrototypeExecution {
	const runId = stableRunId("runtime verify", input);
	const failures = [
		input.pinned === input.observed ? undefined : "version",
		input.digestMatch ? undefined : "digest",
		input.signatureMatch ? undefined : "signature",
		input.architectureMatch ? undefined : "architecture",
	].filter((value): value is string => value !== undefined);

	if (failures.length > 0) {
		return {
			exitCode: 20,
			json: false,
			diagnostic: `runtime custody blocked: ${failures.join(", ")} mismatch`,
			result: makeResult({
				run_id: runId,
				command: "runtime verify",
				outcome: "blocked",
				code: "runtime_pin_mismatch",
				summary: "The observed runtime does not satisfy the complete pinned manifest.",
				retry_safe: true,
				data: { ...input, failures },
				next_action: {
					id: "install-pinned-runtime",
					reason: "Inspect and explicitly install the proved manifest artifact before retrying.",
				},
			}),
		};
	}

	return {
		exitCode: 0,
		json: false,
		result: makeResult({
			run_id: runId,
			command: "runtime verify",
			outcome: "ok",
			code: "runtime_pin_verified",
			summary: "The simulated runtime satisfies the exact pinned version, digest, signature, and architecture checks.",
			retry_safe: true,
			data: input,
			next_action: {
				id: "plan-browser-login",
				reason: "Runtime custody is ready for a bounded credential request.",
				command: "credential login plan --origin https://example.test --capability example.login --json",
			},
		}),
	};
}

function candidatesResult(): PrototypeResult {
	return makeResult({
		run_id: stableRunId("candidates", "top-three"),
		command: "candidates",
		outcome: "ok",
		code: "production_candidates_listed",
		summary: "Three production hardening candidates are retained; the prototype implements only their agent-visible contract shape.",
		retry_safe: true,
		data: {
			candidates: [
				{
					id: "credential-front-door",
					strength: "strong",
					production_role: "Deep module for intent admission, safe delivery, results, diagnostics, and repair.",
				},
				{
					id: "browser-auth-pause-adapter",
					strength: "strong",
					production_role: "Reversible fail-closed pause plus one admitted Browser Login adapter handoff.",
				},
				{
					id: "pinned-op-runtime-custody",
					strength: "strong",
					production_role: "Private stable runtime with manifest pin, provenance checks, explicit updates, and rollback.",
				},
			],
			production_facade: "required-later-not-used-here",
		},
	});
}

function statusResult(): PrototypeResult {
	return makeResult({
		run_id: stableRunId("status", "in-memory"),
		command: "status",
		outcome: "ok",
		code: "prototype_status_ready",
		summary: "The credential front door is simulated, Browser Use authentication is fail-closed, and no machine state is owned.",
		retry_safe: true,
		data: {
			prototype_version: PROTOTYPE_VERSION,
			persistence: "none",
			credential_front_door: "simulated-active",
			browser_use_auth: "simulated-paused-fail-closed",
			pinned_op_version: DEFAULT_PINNED_OP_VERSION,
			command_facade: "not-used",
			live_credentials: "not-used",
		},
		next_action: {
			id: "inspect-production-candidates",
			reason: "Review the retained hardening candidates before choosing a production slice.",
			command: "credential candidates --json",
		},
	});
}

function usageFailure(json: boolean, message: string): PrototypeExecution {
	const runId = stableRunId("usage", message);
	return {
		exitCode: 2,
		json,
		diagnostic: message,
		result: makeResult({
			run_id: runId,
			command: "usage",
			outcome: "blocked",
			code: "invalid_usage",
			summary: message,
			retry_safe: true,
			next_action: {
				id: "show-help",
				reason: "Inspect the accepted prototype command surface.",
				command: "credential --help",
			},
		}),
	};
}

/**
 * Run one in-memory credential CLI prototype command.
 *
 * @param argv - Arguments after the executable name.
 * @returns The deterministic result, output mode, diagnostic, and exit code.
 * @throws Never. Expected and unexpected failures are converted to result envelopes.
 *
 * @example
 * ```ts
 * const execution = runPrototypeCommand(["status", "--json"]);
 * process.exitCode = execution.exitCode;
 * ```
 */
export function runPrototypeCommand(argv: string[]): PrototypeExecution {
	const requestedJson = argv.includes("--json");
	try {
		if (argv.length === 0 || argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
			return { exitCode: 0, json: requestedJson, help: prototypeHelp() };
		}
		if (argv.includes("--version")) {
			return { exitCode: 0, json: requestedJson, version: PROTOTYPE_VERSION };
		}

		const parsed = parseArguments(argv);
		const [command, subcommand, ...extraPositionals] = parsed.positionals;

		if (command === "candidates" && subcommand === undefined) {
			rejectUnknownFlags(parsed.flags, []);
			return { exitCode: 0, json: parsed.json, result: candidatesResult() };
		}
		if (command === "status" && subcommand === undefined) {
			rejectUnknownFlags(parsed.flags, []);
			return { exitCode: 0, json: parsed.json, result: statusResult() };
		}
		if (command === "login" && subcommand === "plan" && extraPositionals.length === 0) {
			rejectUnknownFlags(parsed.flags, ["--origin", "--capability"]);
			const origin = normalizeOrigin(requireFlag(parsed.flags, "--origin"));
			const capability = validateCapability(requireFlag(parsed.flags, "--capability"));
			return { exitCode: 0, json: parsed.json, result: loginPlan(origin, capability) };
		}
		if (command === "login" && subcommand === "execute" && extraPositionals.length === 0) {
			rejectUnknownFlags(parsed.flags, ["--origin", "--capability", "--approval"]);
			const origin = normalizeOrigin(requireFlag(parsed.flags, "--origin"));
			const capability = validateCapability(requireFlag(parsed.flags, "--capability"));
			const approval = requireFlag(parsed.flags, "--approval");
			const execution = loginExecute(origin, capability, approval);
			return { ...execution, json: parsed.json };
		}
		if (command === "runtime" && subcommand === "verify" && extraPositionals.length === 0) {
			rejectUnknownFlags(parsed.flags, [
				"--pinned",
				"--observed",
				"--digest-match",
				"--signature-match",
				"--architecture-match",
			]);
			const execution = runtimeVerify({
				pinned: requireFlag(parsed.flags, "--pinned"),
				observed: requireFlag(parsed.flags, "--observed"),
				digestMatch: parsed.flags.get("--digest-match") === true,
				signatureMatch: parsed.flags.get("--signature-match") === true,
				architectureMatch: parsed.flags.get("--architecture-match") === true,
			});
			return { ...execution, json: parsed.json };
		}

		throw new UsageError("unknown command or unsupported positional arguments");
	} catch (error) {
		if (error instanceof UsageError) return usageFailure(requestedJson, error.message);
		return {
			exitCode: 70,
			json: requestedJson,
			diagnostic: "unexpected prototype failure",
			result: makeResult({
				run_id: stableRunId("unexpected", "redacted"),
				command: "unexpected",
				outcome: "blocked",
				code: "unexpected_failure",
				summary: "The prototype failed unexpectedly without changing machine state.",
				retry_safe: false,
				next_action: {
					id: "inspect-prototype-source",
					reason: "Inspect the throwaway prototype locally; no persisted diagnostics exist.",
				},
			}),
		};
	}
}

/**
 * Render one concise human result from the same agent-native envelope used by JSON mode.
 *
 * @param result - Prototype result returned by {@link runPrototypeCommand}.
 * @returns Human-readable lines that retain outcome, correlation, state change, and recovery.
 *
 * @example
 * ```ts
 * const execution = runPrototypeCommand(["status"]);
 * if (execution.result) console.log(renderPrototypeHuman(execution.result));
 * ```
 */
export function renderPrototypeHuman(result: PrototypeResult): string {
	const lines = [
		`${result.outcome.toUpperCase()} ${result.code}: ${result.summary}`,
		`run_id=${result.run_id} changed=${result.changed} side_effect=${result.side_effect} retry_safe=${result.retry_safe}`,
	];
	if (result.next_action) {
		lines.push(`next_action=${result.next_action.id}: ${result.next_action.reason}`);
		if (result.next_action.command) lines.push(`next_command=${result.next_action.command}`);
	}
	return lines.join("\n");
}

/**
 * Return the complete prototype command discovery text.
 *
 * @returns Help text for humans and agent drivers.
 *
 * @example
 * ```ts
 * console.log(prototypeHelp());
 * ```
 */
export function prototypeHelp(): string {
	return `credential prototype ${PROTOTYPE_VERSION}

Purpose:
  Demonstrate an agent-native Credential Front Door without credentials,
  persistence, Browser Use mutation, runtime installation, or command facade.

Usage:
  credential candidates [--json]
  credential status [--json]
  credential login plan --origin <https-origin> --capability <id> [--json]
  credential login execute --origin <https-origin> --capability <id> --approval <run-id> [--json]
  credential runtime verify --pinned <version> --observed <version> --digest-match --signature-match --architecture-match [--json]

Exit codes:
  0   Success or read-only plan
  2   Invalid usage
  20  Blocked with a safe repair action
  70  Unexpected prototype failure

Examples:
  credential candidates --json
  credential login plan --origin https://example.test --capability example.login --json
  credential runtime verify --pinned 2.39.0 --observed 2.39.0 --digest-match --signature-match --architecture-match --json

Safety:
  No command accepts a password, token, API key, or secret value.
  Every command is in-memory and returns changed=false, side_effect=none.`;
}
