#!/usr/bin/env bun

// Browser-use binding of the shared no-shell argv transport (plan KTD5).
//
// The transport contract itself — command-vector types, JSON-array override
// resolution, no-shell bounded spawn, exit-127 dependency-missing mapping, and
// the 7-item native-transport parity checklist — is owned by
// @side-quest/mcporter-transport (runtime/mcporter-transport). This module only
// binds browser-use's own override channel and re-exports the surface the rest
// of the package consumes, so existing imports keep working unchanged.
//
// Hard contract (unchanged through the move):
//   - The only override channel is BROWSER_USE_MCPORTER_COMMAND_JSON, a JSON
//     array of non-empty strings. No shell strings, no automatic package-runner
//     fallback, never shell-eval command input.
//   - Default command is the bare `mcporter` vector.

import {
	isMissingTransportCommandResult,
	resolveTransportCommandVector,
	runTransportCommand,
	spawnTransportCommand,
	transportDependencyHintText,
	transportOverrideInvalidHintText,
	type ResolveTransportCommandResult,
	type RunTransportCommandResult,
	type TransportCommandChannel,
	type TransportCommandInput,
	type TransportCommandResult,
	type TransportCommandVector,
	type TransportRuntime,
} from "@side-quest/mcporter-transport";

export const MCPORTER_COMMAND_ENV_VAR = "BROWSER_USE_MCPORTER_COMMAND_JSON";
export const MCPORTER_DEFAULT_COMMAND = ["mcporter"] as const;
export const MCPORTER_COMMAND_EXAMPLES =
	'["bunx","mcporter"], ["npx","-y","mcporter"], or ["pnpm","dlx","mcporter"]';

// Browser-use's surface-owned channel: the shared package takes the env-var
// name and default vector as input rather than hardcoding them.
const MCPORTER_CHANNEL: TransportCommandChannel = {
	envVarName: MCPORTER_COMMAND_ENV_VAR,
	defaultCommand: MCPORTER_DEFAULT_COMMAND,
	overrideExamples: MCPORTER_COMMAND_EXAMPLES,
};

export type McporterCommandVector = TransportCommandVector;
export type McporterCommandInput = TransportCommandInput;
export type McporterCommandResult = TransportCommandResult;
export type McporterRuntime = TransportRuntime;
export type ResolveMcporterCommandResult = ResolveTransportCommandResult;
export type RunMcporterResult = RunTransportCommandResult;

export function resolveMcporterCommandVector(
	env: Record<string, string | undefined>,
): ResolveMcporterCommandResult {
	return resolveTransportCommandVector(MCPORTER_CHANNEL, env);
}

export async function runMcporter(
	runtime: McporterRuntime,
	args: readonly string[],
	timeoutMs: number,
): Promise<RunMcporterResult> {
	return runTransportCommand(MCPORTER_CHANNEL, runtime, args, timeoutMs);
}

export function isMissingCommandResult(result: McporterCommandResult): boolean {
	return isMissingTransportCommandResult(result);
}

export function mcporterDependencyHintText(problem: string): string {
	return transportDependencyHintText(MCPORTER_CHANNEL, problem);
}

export function mcporterOverrideInvalidHintText(message: string): string {
	return transportOverrideInvalidHintText(MCPORTER_CHANNEL, message);
}

export async function spawnMcporterCommand(
	input: McporterCommandInput,
): Promise<McporterCommandResult> {
	return spawnTransportCommand(input);
}
