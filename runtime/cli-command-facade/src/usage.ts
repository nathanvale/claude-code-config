import type { CommandFacadeContract } from "./command-facade";

export class CliUsageError extends Error {
	constructor(
		message = "help",
		readonly options: { showMessage?: boolean; exitCode?: number } = {},
	) {
		super(message);
		this.name = "CliUsageError";
	}
}

export function usageError(message: string): CliUsageError {
	return new CliUsageError(message, { exitCode: 2, showMessage: true });
}

export function helpRequested(exitCode = 0): CliUsageError {
	return new CliUsageError("help", { exitCode, showMessage: false });
}

export function requireValue(
	argv: readonly string[],
	index: number,
	flag: string,
): string {
	const value = argv[index + 1];
	if (!value) {
		throw usageError(`${flag} requires a value`);
	}
	return value;
}

export function formatEnumFlagError(
	flag: string,
	value: string,
	values: readonly string[],
): string {
	return `${flag} must be one of: ${values.join(", ")} (got: ${JSON.stringify(value)})`;
}

export function parseEnumFlag<T extends string>(
	flag: string,
	value: string,
	values: readonly T[],
): T {
	if (!values.includes(value as T)) {
		throw usageError(formatEnumFlagError(flag, value, values));
	}
	return value as T;
}

export function renderCommandUsage(
	contract: Pick<CommandFacadeContract, "flags" | "summary" | "usage">,
): string {
	const usageLines = contract.usage.map((usage, index) =>
		index === 0 ? `Usage: ${usage}` : `       ${usage}`,
	);
	const flagLines = Object.entries(contract.flags).flatMap(
		([flag, metadata]) =>
			metadata.description ? [`${flag} ${metadata.description}`] : [],
	);
	return `${[
		...usageLines,
		"",
		contract.summary,
		...(flagLines.length ? flagLines : []),
	].join("\n")}\n`;
}

export function composeAliasArgv(
	defaultArgs: readonly string[],
	argv: readonly string[],
): string[] {
	return [...defaultArgs, ...argv];
}

export function projectUsageToRoute(
	usage: string,
	routePrefix: string,
	defaultArgs: readonly string[] = [],
): string {
	const canonical = usage.replace(/^\S+/, routePrefix);
	return removeAliasDefaultArgs(canonical, defaultArgs);
}

export function projectUsagesToRoute(
	usage: readonly string[],
	routePrefix: string,
	defaultArgs: readonly string[] = [],
): string[] {
	return usage.map((line) =>
		projectUsageToRoute(line, routePrefix, defaultArgs),
	);
}

function removeAliasDefaultArgs(
	usage: string,
	defaultArgs: readonly string[],
): string {
	return defaultArgs.reduce(
		(line, arg) =>
			line
				.replace(new RegExp(`\\s+\\[${escapeRegExp(arg)}\\](?=\\s|$)`, "g"), "")
				.replace(new RegExp(`\\s+${escapeRegExp(arg)}(?=\\s|$)`, "g"), ""),
		usage,
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
