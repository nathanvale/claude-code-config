// ---------------------------------------------------------------------------
// Browser Use argv parser + help (plan U7).
//
// Owns argv -> ParsedBrowserUseCommand: family/subcommand resolution, flag
// collection and unknown-flag rejection, run-id/output-mode derivation, and the
// help/version renderers. A leaf below the driver: imports down into core only.
// ParsedBrowserUseCommand is defined here and consumed directly by discovery,
// selection, operations, and the driver. Public entry: parseBrowserUseArgv.
// ---------------------------------------------------------------------------

import {
	type CliWriter,
	createCliRuntimeSuccessEnvelope,
	parseEnumFlag,
	renderCommandUsage,
	usageError,
	writeJsonEnvelope,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_USE_FAMILIES,
	BROWSER_USE_FAMILY_SUBCOMMANDS,
	BROWSER_USE_FAMILY_SUMMARIES,
	type BrowserUseCommand,
	type BrowserUseFamily,
	browserUseContracts,
	browserUseCommandFor,
} from "./command-contract";
import {
	type OutputMode,
	sanitizeUsageValue,
	stringField,
} from "./browser-use-core";

// ---------------------------------------------------------------------------
// Argv parsing, version, and help (plan U7).
//
// argv -> ParsedBrowserUseCommand. Family/subcommand resolve positionally from
// the leading non-flag tokens; declared flags are accepted/rejected against the
// command contract. Help and version rendering live here too — they are pure
// projections of the contract surface and the route-prerequisite pointer.
// ParsedBrowserUseCommand is produced here (KTD2); the driver re-exports it from
// the barrel so region modules keep their type-only import resolving.
// ---------------------------------------------------------------------------

const VERSION = "0.1.0";
// One-line pointer the help surface uses to send agents back to the
// connection prerequisite without copying the envelope schema. browser-use
// never re-declares the Verified Handoff Envelope shape; browser-connect owns
// it.
const ROUTE_PREREQUISITE_POINTER =
	"Prerequisite: mint a Verified Handoff Envelope with `browser-connect connect <adapter> --json` (or `browser-connect run`), then pass it via --handoff.";
// Everyday auto-attach commands (design brief D4): the envelope mints
// internally, so their help never teaches the secondary CLI; --handoff stays
// documented as the advanced override.
const AUTO_ATTACH_POINTER =
	"Connection attaches automatically when --handoff is absent: the command proves warm Agent Chrome and mints the Verified Handoff Envelope in-process. --handoff <path> supplies a pre-minted envelope instead (advanced).";
const AUTO_ATTACH_COMMANDS: ReadonlySet<string> = new Set([
	"targets-list",
	"task-run",
	"runbook-run",
]);

export type ParsedBrowserUseCommand =
	| { kind: "help"; family?: BrowserUseFamily; command?: BrowserUseCommand }
	// Bare `browser-use` with no positional tokens: a compact agent-first
	// launcher, exit 0 (design brief D1). Distinct from an UNKNOWN family
	// token, which stays a usage error naming the invalid value (D6).
	| { kind: "launcher" }
	| { kind: "version"; outputMode: OutputMode }
	| {
			kind: "command";
			command: BrowserUseCommand;
			family: BrowserUseFamily;
			subcommand: string;
			outputMode: OutputMode;
			dryRun: boolean;
			// Raw declared-flag values for the resolved command. Booleans map to "";
			// value-bearing flags map to their string value. Undefined when absent.
			// Repeated flags keep their LAST value here (backward-compatible);
			// `repeatedFlagValues` carries every occurrence for repeatable flags.
			flagValues: Record<string, string>;
			// Every occurrence of each value-bearing flag, in argv order. A caller
			// that treats a flag as repeatable (e.g. runbook run --input) reads it
			// here; single-value callers keep using flagValues unchanged.
			repeatedFlagValues: Record<string, readonly string[]>;
	  };

// ---------------------------------------------------------------------------
// Argv parsing.
// ---------------------------------------------------------------------------

export function parseBrowserUseArgv(
	argv: readonly string[],
): ParsedBrowserUseCommand {
	// Resolve family/subcommand POSITIONALLY from the leading non-flag tokens.
	// The public form is `browser-use <family> <subcommand> [flags]`. Scanning
	// the whole argv by value (argv.find) would misread a flag VALUE equal to a
	// reserved word (e.g. `--state status`, `--origin targets`) as the
	// family/subcommand. Diagnostic flags are already stripped upstream, so any
	// remaining `--`-prefixed token starts the flag section.
	const positionals: string[] = [];
	for (const arg of argv) {
		if (arg.startsWith("-")) break;
		positionals.push(arg);
	}
	const familyToken = positionals[0];
	const family = isFamily(familyToken) ? familyToken : undefined;
	const subcommandCandidate =
		family === "auth" && positionals[1] === "binding" && positionals[2] !== undefined
			? `binding ${positionals[2]}`
			: positionals[1];
	const resolvedCommand =
		family &&
		subcommandCandidate &&
		subcommandsFor(family).includes(subcommandCandidate)
			? toCommand(family, subcommandCandidate)
			: undefined;

	// Detect --help/--version from STANDALONE option tokens only, mirroring
	// collectFlagValues' value-pairing: a token consumed as a declared
	// value-bearing flag's value (e.g. `--title-contains --version`) must not
	// short-circuit the command. With no resolvable command there are no
	// declared flags, so every option token is standalone (root/family help and
	// bare --version keep their behavior).
	const declaredFlags: Readonly<Record<string, FlagSpec>> = resolvedCommand
		? (browserUseContracts[resolvedCommand].flags ?? {})
		: {};
	const standalone = new Set<string>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("-")) continue;
		const hasInline = arg.includes("=");
		const name = hasInline ? arg.slice(0, arg.indexOf("=")) : arg;
		const spec = declaredFlags[name];
		if (spec && spec.type !== "boolean" && !hasInline) {
			index += 1;
			continue;
		}
		standalone.add(name);
	}

	if (standalone.has("--version")) {
		return {
			kind: "version",
			outputMode: standalone.has("--json") ? "json" : "plain",
		};
	}

	const helpRequested = standalone.has("-h") || standalone.has("--help");

	if (!family) {
		if (helpRequested) return { kind: "help" };
		// No tokens at all -> the agent-first launcher (exit 0, D1). A present
		// but unregistered family token -> usage error naming the value (D6).
		if (familyToken === undefined) return { kind: "launcher" };
		throw usageError(
			`unknown command family: ${sanitizeUsageValue(familyToken)}. Expected: ${BROWSER_USE_FAMILIES.join(", ")}.`,
		);
	}

	const subcommandToken = subcommandCandidate;
	let subcommand =
		subcommandToken && subcommandsFor(family).includes(subcommandToken)
			? subcommandToken
			: undefined;

	// An invalid leaf token is a usage error even under --help: silently
	// rendering family help would masquerade as valid help for a command that
	// does not exist (handoff defect list; D6).
	if (subcommandToken !== undefined && subcommand === undefined) {
		throw usageError(
			`unknown subcommand for ${family}: ${sanitizeUsageValue(subcommandToken)}. Expected: ${subcommandsFor(family).join(", ")}.`,
		);
	}

	if (helpRequested) {
		if (!subcommand) return { kind: "help", family };
		return {
			kind: "help",
			family,
			command: toCommand(family, subcommand),
		};
	}

	// Bare `browser-use guide` resolves to `guide show`: the start-here command
	// the root help advertises must work exactly as printed (D3). The only
	// family-default affordance — every other family still requires its leaf.
	let consumedPositionals = 2;
	if (!subcommand && family === "guide") {
		subcommand = "show";
		consumedPositionals = 1;
	}

	if (!subcommand) {
		throw usageError(
			`missing subcommand for ${family}: expected ${subcommandsFor(family).join(", ")}.`,
		);
	}
	if (subcommand.includes(" ")) consumedPositionals = 3;

	const command = toCommand(family, subcommand);
	// Strip exactly the leading positional tokens, not every occurrence of
	// their string value, so a flag value equal to the family/subcommand word
	// survives into rejectUnknownFlags' value-pairing.
	const rest = argv.slice(consumedPositionals);
	const flags = browserUseContracts[command].flags ?? {};
	rejectUnknownFlags(rest, flags);
	const collected = collectFlagValues(rest, flags);
	const flagValues = collected.values;
	const repeatedFlagValues = collected.repeated;
	// Enum-VALUE validation runs here — before every command-specific required-
	// flag check and the dry-run/live split — so an unregistered enum value fails
	// closed for dry-run and live alike (R27, api-contract parity).
	validateEnumFlagValues(flagValues, flags);
	if (
		command === "run-resume" ||
		command === "run-approve" ||
		command === "run-cancel"
	) {
		const runId = stringField(flagValues["--run"]);
		if (!runId || runId.startsWith("--")) {
			throw usageError(`${command.replace("-", " ")} requires --run <id>.`);
		}
	}
	if (command === "run-approve") {
		const continuation = stringField(flagValues["--continuation"]);
		const artifact = stringField(flagValues["--artifact"]);
		if (!continuation || continuation.startsWith("--")) {
			throw usageError("run approve requires --continuation <id>.");
		}
		if (!artifact || artifact.startsWith("--")) {
			throw usageError("run approve requires --artifact <id>.");
		}
	}
	if (command === "lanes-show") {
		const adapterId = stringField(flagValues["--adapter"]);
		if (!adapterId || adapterId.startsWith("--")) {
			throw usageError("lanes show requires --adapter <id>.");
		}
	}
	// `task run` always attaches through a Verified Handoff Envelope (R3), and
	// needs an intent to route OR a run id to resume (R23). A fresh --intent run
	// mints the envelope internally when --handoff is absent (design brief D4);
	// a resume stays bound to its original attachment, so --run still requires
	// the caller-managed envelope. A dry-run mock still requires the same shape
	// so the contract an agent learns is stable.
	if (command === "task-run") {
		const intent = stringField(flagValues["--intent"]);
		const runId = stringField(flagValues["--run"]);
		if ((!intent || intent.startsWith("--")) && (!runId || runId.startsWith("--"))) {
			throw usageError(
				"task run requires --intent <intent> (or --run <id> to resume an existing run).",
			);
		}
		const handoff = stringField(flagValues["--handoff"]);
		const resuming = runId !== undefined && !runId.startsWith("--");
		if (resuming && (!handoff || handoff.startsWith("--"))) {
			throw usageError(
				"task run --run <id> requires --handoff <path>: a resume re-attaches through the run's verified envelope.",
			);
		}
	}
	// `runbook show`/`runbook run` are targeted by one exact service/flow id
	// (never a scan), so both coordinates are hard-required (mirrors lanes show
	// --adapter). `runbook run` also attaches through a Verified Handoff Envelope
	// (R3); a resume still supplies --run alongside the handoff.
	if (command === "runbook-show" || command === "runbook-run") {
		for (const flag of ["--service", "--flow"] as const) {
			const value = stringField(flagValues[flag]);
			if (!value || value.startsWith("--")) {
				throw usageError(
					`${command.replace("-", " ")} requires ${flag} <id>.`,
				);
			}
		}
	}
	if (command === "runbook-validate" || command === "runbook-apply") {
		const file = stringField(flagValues["--file"]);
		if (file === undefined || file.startsWith("--")) {
			throw usageError(`${command.replace("-", " ")} requires --file <path>.`);
		}
	}
	if (command === "runbook-apply") {
		const expected = stringField(flagValues["--expected-record-digest"]);
		if (expected !== undefined && !/^[0-9a-f]{64}$/.test(expected)) {
			throw usageError(
				"runbook apply --expected-record-digest must be 64 lowercase hex characters.",
			);
		}
	}
	if (command === "runbook-delete") {
		for (const flag of ["--service", "--flow"] as const) {
			const value = stringField(flagValues[flag]);
			if (value === undefined || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
				throw usageError(`runbook delete requires ${flag} <id> as a safe slug.`);
			}
		}
		const expected = stringField(flagValues["--expected-record-digest"]);
		if (expected !== undefined && !/^[0-9a-f]{64}$/.test(expected)) {
			throw usageError(
				"runbook delete --expected-record-digest must be 64 lowercase hex characters.",
			);
		}
	}
	if (command === "runbook-activate") {
		const digest = stringField(flagValues["--catalog-digest"]);
		if (digest === undefined || !/^[0-9a-f]{64}$/.test(digest)) {
			throw usageError(
				"runbook activate requires --catalog-digest <sha256> as 64 lowercase hex characters.",
			);
		}
		const epoch = stringField(flagValues["--expected-epoch"]);
		if (epoch === undefined || !/^(?:0|[1-9]\d*)$/.test(epoch)) {
			throw usageError(
				"runbook activate requires --expected-epoch <n> as a non-negative integer.",
			);
		}
	}
	if (command === "action-validate" || command === "action-apply") {
		const file = stringField(flagValues["--file"]);
		if (file === undefined || file.startsWith("--")) {
			throw usageError(`${command.replace("-", " ")} requires --file <path>.`);
		}
	}
	if (command === "action-apply") {
		const expected = stringField(flagValues["--expected-record-digest"]);
		if (expected !== undefined && !/^[0-9a-f]{64}$/.test(expected)) {
			throw usageError(
				"action apply --expected-record-digest must be 64 lowercase hex characters.",
			);
		}
	}
	if (command === "action-status" || command === "action-promote") {
		const actionId = stringField(flagValues["--id"]);
		if (actionId === undefined || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(actionId)) {
			throw usageError(`${command.replace("-", " ")} requires --id <action-id> as a safe slug.`);
		}
	}
	if (command === "action-promote") {
		const approvalReference = stringField(flagValues["--approval-reference"]);
		if (
			approvalReference === undefined ||
			!/^[a-z0-9][a-z0-9-]{0,127}$/.test(approvalReference)
		) {
			throw usageError(
				"action promote requires --approval-reference <reference> as an opaque safe identifier.",
			);
		}
	}
	// `runbook run` attaches through the agent-browser lane; --handoff is the
	// advanced caller-managed override, minted internally when absent (D4).
	// A resume stays bound to its original attachment (R3/R11) exactly like
	// task run: --run requires the caller-managed envelope, never a fresh mint.
	if (command === "runbook-run") {
		const runId = stringField(flagValues["--run"]);
		const handoff = stringField(flagValues["--handoff"]);
		const resuming = runId !== undefined && !runId.startsWith("--");
		if (resuming && (!handoff || handoff.startsWith("--"))) {
			throw usageError(
				"runbook run --run <id> requires --handoff <path>: a resume re-attaches through the run's verified envelope.",
			);
		}
	}
	// Every migration phase but `status` freezes/validates against one exact
	// source root; a targeted phase is never an unbound scan, so --source is
	// hard-required (mirrors lanes show --adapter). `migration status` is a pure
	// state projection and takes no source.
	if (
		command === "migration-inventory" ||
		command === "migration-plan" ||
		command === "migration-apply" ||
		command === "migration-verify"
	) {
		const source = stringField(flagValues["--source"]);
		if (!source || source.startsWith("--")) {
			throw usageError(`${command.replace("-", " ")} requires --source <path>.`);
		}
	}
	// R11: binding repair and selection projection are targeted reads of exact
	// coordinates, never scans, so their coordinates are hard-required.
	if (command === "auth-repair-item-binding") {
		for (const flag of ["--vault-id", "--item-id"] as const) {
			const value = stringField(flagValues[flag]);
			if (!value || value.startsWith("--")) {
				throw usageError(
					`auth repair-item-binding requires ${flag} <id>.`,
				);
			}
		}
	}
	if (command === "auth-request-binding-selection-grant") {
		const vaultId = stringField(flagValues["--vault-id"]);
		if (!vaultId || vaultId.startsWith("--")) {
			throw usageError(
				"auth request-binding-selection-grant requires --vault-id <id>.",
			);
		}
	}
	if (
		command === "auth-binding-create" ||
		command === "auth-binding-show" ||
		command === "auth-binding-revoke"
	) {
		for (const flag of ["--binding", "--service"] as const) {
			const value = stringField(flagValues[flag]);
			if (!value || value.startsWith("--")) {
				throw usageError(
					`${command.replaceAll("-", " ")} requires ${flag} <id>.`,
				);
			}
		}
	}
	if (command === "auth-binding-create") {
		for (const flag of ["--origin", "--vault-id", "--item-id"] as const) {
			const value = stringField(flagValues[flag]);
			if (!value || value.startsWith("--")) {
				throw usageError(`auth binding create requires ${flag} <value>.`);
			}
		}
	}
	// Derive from parsed flags, not token scans: a value-bearing flag can
	// legitimately consume a token that looks like "--dry-run" or "--json"
	// (e.g. `--title-contains --dry-run`), and a raw includes() would misread
	// that value as the flag being set.
	const dryRun = flagValues["--dry-run"] !== undefined;

	return {
		kind: "command",
		command,
		family,
		subcommand,
		outputMode: outputModeFor(command, flagValues),
		dryRun,
		flagValues,
		repeatedFlagValues,
	};
}

// Collect declared-flag values from the post-positional argv slice. Mirrors
// rejectUnknownFlags' value-pairing: boolean flags map to "", value-bearing
// flags (per declared type, not token shape) take the next token even when it
// starts with "--". The contract already accepted these flags, so this never
// sees an unknown flag.
function collectFlagValues(
	argv: readonly string[],
	flags: Readonly<Record<string, FlagSpec>>,
): { values: Record<string, string>; repeated: Record<string, string[]> } {
	const values: Record<string, string> = {};
	const repeated: Record<string, string[]> = {};
	const record = (name: string, value: string): void => {
		values[name] = value;
		const bucket = repeated[name] ?? [];
		bucket.push(value);
		repeated[name] = bucket;
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const hasInline = arg.includes("=");
		const name = hasInline ? arg.slice(0, arg.indexOf("=")) : arg;
		const spec = flags[name];
		if (!spec) continue;
		if (spec.type === "boolean") {
			record(name, "");
			continue;
		}
		if (hasInline) {
			record(name, arg.slice(arg.indexOf("=") + 1));
			continue;
		}
		if (index + 1 < argv.length) {
			record(name, argv[index + 1]);
			index += 1;
		}
	}
	return { values, repeated };
}

function isFamily(value: string | undefined): value is BrowserUseFamily {
	return (BROWSER_USE_FAMILIES as readonly string[]).includes(value ?? "");
}

function subcommandsFor(family: BrowserUseFamily): readonly string[] {
	return BROWSER_USE_FAMILY_SUBCOMMANDS[family];
}

function toCommand(
	family: BrowserUseFamily,
	subcommand: string,
): BrowserUseCommand {
	return browserUseCommandFor(family, subcommand);
}

type FlagSpec = { type?: string; values?: readonly string[] };

// Validate every enum-typed flag's supplied VALUE against the contract's
// declared `values`, contract-derived so dry-run and live agree (R27): an
// unregistered --intent/--lane/--mode/--adapter fails with the SAME usage error
// the live path would raise, BEFORE the dry-run/live split short-circuits. Runs
// after collectFlagValues, so it sees each flag's resolved value (last wins,
// matching flagValues). Reuses the facade's parseEnumFlag — the one enum-flag
// usage-error mechanism — never a hand-rolled message.
function validateEnumFlagValues(
	flagValues: Readonly<Record<string, string>>,
	flags: Readonly<Record<string, FlagSpec>>,
): void {
	for (const [name, spec] of Object.entries(flags)) {
		if (spec.type !== "enum" || !spec.values) continue;
		const value = flagValues[name];
		if (value === undefined) continue;
		parseEnumFlag(name, value, spec.values);
	}
}

function rejectUnknownFlags(
	argv: readonly string[],
	flags: Readonly<Record<string, FlagSpec>>,
): void {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		const spec = flags[name];
		if (!spec) {
			throw usageError(`unknown option: ${sanitizeUsageValue(name)}`);
		}
		// Consume the value token for space-separated value-bearing flags. Use the
		// declared flag type, not the next token's shape, so a value that itself
		// starts with `--` (e.g. `--title-contains --beta`) is still its value and
		// is not misread as a separate unknown flag.
		if (!arg.includes("=") && spec.type !== "boolean" && index + 1 < argv.length) {
			index += 1;
		}
	}
}

// Output mode keys on the resolved command, then explicit flags. Operator-
// audience commands (the status projections) default to plain; every other
// command is machine-first JSON. The default derives from the declared
// contract audience, so a new command cannot silently pick the wrong default.
// Keying on the command (not an argv token scan) keeps a flag VALUE of "status"
// from flipping output mode.
function outputModeFor(
	command: BrowserUseCommand,
	flagValues: Readonly<Record<string, string>>,
): OutputMode {
	if (flagValues["--plain"] !== undefined) return "plain";
	if (flagValues["--json"] !== undefined) return "json";
	// The guide is agent-audience but prose-first: its default output is the
	// readable text (its contract lists plain first); --json still wraps it.
	if (command === "guide-show") return "plain";
	return browserUseContracts[command].audience === "operator" ? "plain" : "json";
}

// Output mode for pre-parse error paths (diagnostic-parse or command-parse
// failure) where no command is resolved yet. Flag-only; default JSON so an
// agent can machine-read the error explaining what went wrong.
export function errorOutputMode(argv: readonly string[]): OutputMode {
	if (argv.includes("--plain")) return "plain";
	return "json";
}

export function applyEnvRunId(
	argv: readonly string[],
	runId: string | undefined,
): readonly string[] {
	if (!runId) return argv;
	if (argv.includes("--run-id")) return argv;
	return [...argv, "--run-id", runId];
}

// Extract an explicit `--run-id` flag value with a real flag parse, stopping at
// the `--` end-of-options terminator. Returns the value when a standalone
// `--run-id <value>` (or `--run-id=<value>`) appears in the options region,
// else undefined. Used only to decide whether the run id is EXPLICIT; unlike a
// raw `argv.includes("--run-id")` it does not flip true for a `--run-id` token
// smuggled past `--` or carried as another flag's value, which would otherwise
// assert a run the diagnostic layer never resolved.
export function parsedRunIdFlag(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--") return undefined;
		if (token === "--run-id") {
			const value = argv[index + 1];
			return value !== undefined && !value.startsWith("--") ? value : undefined;
		}
		if (token.startsWith("--run-id=")) {
			return stringField(token.slice("--run-id=".length));
		}
	}
	return undefined;
}


// ---------------------------------------------------------------------------
// Version + help.
// ---------------------------------------------------------------------------

export function writeVersion(
	stdout: CliWriter,
	outputMode: OutputMode,
	runtime: { runId: string; durationMs: number },
): void {
	if (outputMode === "plain") {
		stdout.write(`browser-use ${VERSION}\n`);
		return;
	}
	writeJsonEnvelope(
		stdout,
		createCliRuntimeSuccessEnvelope({
			run_id: runtime.runId,
			data: { name: "browser-use", version: VERSION },
		}),
		runtime,
	);
}

export function renderHelp(
	family?: BrowserUseFamily,
	command?: BrowserUseCommand,
): string {
	if (command) {
		// Contract-driven: only commands that actually accept --handoff carry the
		// mint-an-envelope prerequisite (targets status reads selected state only).
		const commandFlags: Readonly<Record<string, FlagSpec>> =
			browserUseContracts[command].flags ?? {};
		const prerequisite = AUTO_ATTACH_COMMANDS.has(command)
			? `\n${AUTO_ATTACH_POINTER}`
			: commandFlags["--handoff"] !== undefined
				? `\n${ROUTE_PREREQUISITE_POINTER}`
				: "";
		// Leaf usage names the executable (D5): agents copy usage lines verbatim,
		// so `Usage: task list` without the bin name is not runnable as printed.
		const contract = browserUseContracts[command];
		const prefixed = {
			...contract,
			usage: contract.usage.map((usage) => `browser-use ${usage}`),
		};
		return `${renderCommandUsage(prefixed)}${prerequisite}\n`;
	}
	if (family) return renderFamilyHelp(family);
	return renderRootHelp();
}

function renderFamilyHelp(family: BrowserUseFamily): string {
	const subLines = subcommandsFor(family).map((sub) => {
		const contract = browserUseContracts[toCommand(family, sub)];
		return `  ${sub.padEnd(10)} ${contract.summary}`;
	});
	// Contract-driven prerequisite: only families with a --handoff-consuming
	// command point at the connection prerequisite (platform families do not
	// consume the envelope directly). A family whose handoff consumers all
	// auto-attach (task, runbook — design brief D4) gets the auto-attach line
	// instead: everyday help never teaches the secondary CLI.
	const handoffConsumers = subcommandsFor(family).filter((sub) => {
		const flags: Readonly<Record<string, FlagSpec>> =
			browserUseContracts[toCommand(family, sub)].flags ?? {};
		return flags["--handoff"] !== undefined;
	});
	const pointer =
		handoffConsumers.length === 0
			? []
			: handoffConsumers.every((sub) =>
						AUTO_ATTACH_COMMANDS.has(toCommand(family, sub)),
					)
				? ["", AUTO_ATTACH_POINTER]
				: ["", ROUTE_PREREQUISITE_POINTER];
	return [
		`Usage: browser-use ${family} <subcommand> [flags]`,
		"",
		"Subcommands:",
		...subLines,
		...pointer,
		"",
	].join("\n");
}

// Root help is the agent-first front door (design brief D2): intent-grouped,
// start-here first, budgeted, and free of secondary-CLI commands. The family
// grouping below is presentation only — the parser accepts every family from
// BROWSER_USE_FAMILY_SUBCOMMANDS regardless of group. renderRootHelp asserts
// group completeness at render time so a new family cannot silently vanish
// from help.
const ROOT_HELP_GROUPS: ReadonlyArray<{
	heading: string;
	families: readonly BrowserUseFamily[];
}> = [
	{
		heading: "Everyday work:",
		families: ["task", "run", "runbook", "action", "artifact"],
	},
	{ heading: "Recovery:", families: ["repair", "auth"] },
	{
		heading: "Advanced (platform internals):",
		families: ["targets", "operate", "lanes", "migration"],
	},
];

function renderRootHelp(): string {
	// Completeness check: every registered family except `guide` (rendered in
	// the Start here block) must appear in exactly one group.
	const grouped = new Set(ROOT_HELP_GROUPS.flatMap((group) => group.families));
	for (const family of BROWSER_USE_FAMILIES) {
		if (family !== "guide" && !grouped.has(family)) {
			throw new Error(`root help group table is missing family: ${family}`);
		}
	}
	const groupLines = ROOT_HELP_GROUPS.flatMap((group) => [
		group.heading,
		...group.families.map(
			(family) =>
				`  ${family.padEnd(10)} ${BROWSER_USE_FAMILY_SUMMARIES[family]}`,
		),
		"",
	]);
	return [
		"browser-use - orchestrate browser tasks through one warm Chrome (for AI agents)",
		"",
		"Usage: browser-use <family> <subcommand> [flags]",
		"",
		"Start here (for AI agents):",
		"  browser-use guide                Core workflow, copy-paste loop (version-matched)",
		"  browser-use task list --json     Discover code-owned Task Intents",
		"  browser-use runbook list --json  Discover service runbooks",
		"  browser-use runbook activate --catalog-digest <sha256> --expected-epoch <n> --json  Select a reviewed immutable generation",
		"",
		...groupLines,
		"Global flags:",
		"  --json | --plain   Output mode (JSON envelopes carry the next safe action).",
		"  --run-id <id>      Set run correlation id.",
		"  --quiet | --verbose | --debug   Diagnostic volume (stderr).",
		"  --version          Print version.",
		"",
		"Every family: browser-use <family> --help. Every leaf: browser-use <family> <subcommand> --help.",
		"",
	].join("\n");
}

// The no-arg launcher (D1): smaller than root help, exit 0, one obvious next
// action. Agents cold-starting on this CLI should never need to guess.
export function renderLauncher(): string {
	return [
		"browser-use - orchestrate browser tasks through one warm Chrome (for AI agents)",
		"",
		"Start here:",
		"  browser-use guide                Core workflow, copy-paste loop",
		"  browser-use task list --json     Discover code-owned Task Intents",
		"  browser-use --help               Full command families",
		"",
	].join("\n");
}
