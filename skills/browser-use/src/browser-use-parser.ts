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

export type ParsedBrowserUseCommand =
	| { kind: "help"; family?: BrowserUseFamily; command?: BrowserUseCommand }
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
			flagValues: Record<string, string>;
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
	const subcommandCandidate = positionals[1];
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
		throw usageError(
			`missing command family: expected ${BROWSER_USE_FAMILIES.join(", ")}.`,
		);
	}

	const subcommandToken = positionals[1];
	const subcommand =
		subcommandToken && subcommandsFor(family).includes(subcommandToken)
			? subcommandToken
			: undefined;

	if (helpRequested) {
		if (!subcommand) return { kind: "help", family };
		return {
			kind: "help",
			family,
			command: toCommand(family, subcommand),
		};
	}

	if (!subcommand) {
		throw usageError(
			`missing subcommand for ${family}: expected ${subcommandsFor(family).join(", ")}.`,
		);
	}

	const command = toCommand(family, subcommand);
	// Strip exactly the two leading positional tokens, not every occurrence of
	// their string value, so a flag value equal to the family/subcommand word
	// survives into rejectUnknownFlags' value-pairing.
	const rest = argv.slice(2);
	const flags = browserUseContracts[command].flags ?? {};
	rejectUnknownFlags(rest, flags);
	const flagValues = collectFlagValues(rest, flags);
	if (command === "run-resume" || command === "run-cancel") {
		const runId = stringField(flagValues["--run"]);
		if (!runId || runId.startsWith("--")) {
			throw usageError(`${command.replace("-", " ")} requires --run <id>.`);
		}
	}
	if (command === "lanes-show") {
		const adapterId = stringField(flagValues["--adapter"]);
		if (!adapterId || adapterId.startsWith("--")) {
			throw usageError("lanes show requires --adapter <id>.");
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
): Record<string, string> {
	const values: Record<string, string> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const hasInline = arg.includes("=");
		const name = hasInline ? arg.slice(0, arg.indexOf("=")) : arg;
		const spec = flags[name];
		if (!spec) continue;
		if (spec.type === "boolean") {
			values[name] = "";
			continue;
		}
		if (hasInline) {
			values[name] = arg.slice(arg.indexOf("=") + 1);
			continue;
		}
		if (index + 1 < argv.length) {
			values[name] = argv[index + 1];
			index += 1;
		}
	}
	return values;
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
	return `${family}-${subcommand}` as BrowserUseCommand;
}

type FlagSpec = { type?: string };

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
		const prerequisite =
			commandFlags["--handoff"] !== undefined
				? `\n${ROUTE_PREREQUISITE_POINTER}`
				: "";
		return `${renderCommandUsage(browserUseContracts[command])}${prerequisite}\n`;
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
	// consume the envelope directly).
	const familyConsumesHandoff = subcommandsFor(family).some((sub) => {
		const flags: Readonly<Record<string, FlagSpec>> =
			browserUseContracts[toCommand(family, sub)].flags ?? {};
		return flags["--handoff"] !== undefined;
	});
	return [
		`Usage: browser-use ${family} <subcommand> [flags]`,
		"",
		"Subcommands:",
		...subLines,
		...(familyConsumesHandoff ? ["", ROUTE_PREREQUISITE_POINTER] : []),
		"",
	].join("\n");
}

function renderRootHelp(): string {
	const familyLines = BROWSER_USE_FAMILIES.map((family) => {
		return `  ${family.padEnd(10)} ${BROWSER_USE_FAMILY_SUMMARIES[family]}`;
	});
	return [
		"Usage: browser-use <family> <subcommand> [flags]",
		"",
		"Command families:",
		...familyLines,
		"",
		"Global diagnostic flags:",
		"  --run-id <id>   Set run correlation id.",
		"  --quiet         Suppress diagnostics.",
		"  --verbose       Emit info diagnostics to stderr.",
		"  --debug         Emit debug diagnostics to stderr.",
		"  --version       Print version.",
		"",
		`Browser attachment commands accepting --handoff require:\n  ${ROUTE_PREREQUISITE_POINTER}`,
		"",
	].join("\n");
}
