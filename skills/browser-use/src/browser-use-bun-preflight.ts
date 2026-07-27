// ---------------------------------------------------------------------------
// Bun runtime preflight for the installed front door (DDA-A21).
//
// The installed `browser-use` bin is a `#!/usr/bin/env bun` entry. When bun is
// absent from PATH the kernel/`env` emit a RAW exec error
// (`env: bun: No such file or directory`, exit 127) with no repair path — the
// daily-driver failure DDA-A21 forbids. This module owns the POSIX-sh launcher
// shim that a delivered bin can front: it proves bun resolves before `exec`ing
// the real entry, and on a missing bun prints ONE actionable, named remedy to
// stderr and exits with a typed code — never a bare exec error.
//
// Pure string owner: no I/O, no process control. The shim body is emitted for
// delivery and asserted at the process boundary; wiring it into setup bin
// delivery (today a direct symlink to the entry) is the remaining integration
// step and stays owned by runtime/setup's bin topology.
// ---------------------------------------------------------------------------

/** Typed exit code the shim uses when the bun runtime is missing (input tier). */
export const BUN_PREFLIGHT_MISSING_EXIT_CODE = 2;

/** The named runtime the remedy points the operator at. */
export const BUN_PREFLIGHT_RUNTIME_NAME = "bun";

/** The install command the remedy names. */
export const BUN_PREFLIGHT_INSTALL_COMMAND = "curl -fsSL https://bun.sh/install | bash";

/** The stable remedy string a missing bun prints (named, actionable, no path leak). */
export function bunPreflightRemedy(commandName: string): string {
	return [
		`${commandName}: the Bun runtime is required but was not found on PATH.`,
		`Install it with: ${BUN_PREFLIGHT_INSTALL_COMMAND}`,
		`Then ensure '${BUN_PREFLIGHT_RUNTIME_NAME}' resolves on PATH and re-run ${commandName}.`,
	].join("\n");
}

/**
 * Emit the POSIX-sh launcher shim for one delivered command. The shim:
 *   1. checks `command -v bun` (portable executable probe);
 *   2. on absence prints {@link bunPreflightRemedy} to stderr and exits with
 *      {@link BUN_PREFLIGHT_MISSING_EXIT_CODE} — a typed remedy, not a raw
 *      `env: bun` error;
 *   3. otherwise `exec bun "<entry>" "$@"`, preserving args and exit status.
 *
 * @param input - The delivered command name and the absolute entry it fronts
 * @returns The shim script bytes (shebang included)
 */
export function bunPreflightShim(input: {
	commandName: string;
	entryPath: string;
}): string {
	const remedy = bunPreflightRemedy(input.commandName);
	// Single-quote the remedy for a `printf %s` heredoc-free emit; the remedy is
	// a fixed owner-controlled string with no single quotes, so no escaping race.
	const remedyLiteral = remedy.replaceAll("'", "'\\''");
	const entryLiteral = input.entryPath.replaceAll("'", "'\\''");
	return [
		"#!/bin/sh",
		"# Generated bun-preflight launcher (DDA-A21). Do not edit; owner:",
		"# skills/browser-use/src/browser-use-bun-preflight.ts.",
		"if ! command -v bun >/dev/null 2>&1; then",
		`\tprintf '%s\\n' '${remedyLiteral}' >&2`,
		`\texit ${BUN_PREFLIGHT_MISSING_EXIT_CODE}`,
		"fi",
		`exec bun '${entryLiteral}' "$@"`,
		"",
	].join("\n");
}
