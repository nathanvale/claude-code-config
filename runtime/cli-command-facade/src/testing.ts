import type { CommandFacadeContract } from "./command-facade";
export {
	DEFAULT_CLI_PROCESS_TIMEOUT_MS,
	describeCliProcessRun,
	parseCliProcessJson,
	runCliProcess,
	type CliProcessCommand,
	type CliProcessResult,
} from "./process-testing";

export type CommandHelpFlagSurfaceInput = {
	command: string;
	contract: Pick<CommandFacadeContract, "flags">;
	help: string;
	absentFlags?: readonly string[];
};

export type RuntimeContractRedactionFixture = {
	label: string;
	value: string;
};

export const RUNTIME_CONTRACT_REDACTION_FIXTURES = [
	{ label: "credential", value: "super-secret-password" },
	{ label: "bearer-token", value: "Bearer sqe.secret.token" },
	{ label: "cookie", value: "sessionid=secret-cookie" },
	{ label: "tenant-id", value: "tenant_123456" },
	{ label: "account-id", value: "account_987654" },
	{
		label: "local-path",
		value:
			"/Users/example/.config/side-quest/browser-automation/auth-state.json",
	},
	{
		label: "command-example",
		value: "bun run browser-automation debug open https://example.test",
	},
	{ label: "payment-account", value: "payment_account_123" },
	{ label: "scope", value: "scope:finance.bankstatementsplus.read" },
	{
		label: "browser-debugger-url",
		value: "ws://127.0.0.1:9222/devtools/browser/secret-debugger",
	},
	{ label: "op-secret-ref", value: "op://Private/Vault/Item/password" },
] as const satisfies readonly RuntimeContractRedactionFixture[];

export function extendRuntimeContractRedactionFixtures(
	fixtures: readonly RuntimeContractRedactionFixture[],
): RuntimeContractRedactionFixture[] {
	return [...RUNTIME_CONTRACT_REDACTION_FIXTURES, ...fixtures];
}

export function listRuntimeContractFixtureLeaks(
	value: unknown,
	fixtures: readonly RuntimeContractRedactionFixture[] = RUNTIME_CONTRACT_REDACTION_FIXTURES,
): RuntimeContractRedactionFixture[] {
	const text =
		typeof value === "string" ? value : (JSON.stringify(value) ?? "");
	return fixtures.filter((fixture) => text.includes(fixture.value));
}

export function assertNoRuntimeContractFixtureLeaks(
	value: unknown,
	fixtures: readonly RuntimeContractRedactionFixture[] = RUNTIME_CONTRACT_REDACTION_FIXTURES,
): void {
	const leaks = listRuntimeContractFixtureLeaks(value, fixtures);
	if (leaks.length > 0) {
		throw new Error(
			`Runtime contract output leaked redaction fixtures: ${leaks
				.map((leak) => leak.label)
				.join(", ")}`,
		);
	}
}

export function assertCommandHelpFlagSurface(
	input: CommandHelpFlagSurfaceInput,
): void {
	for (const flag of Object.keys(input.contract.flags)) {
		if (!helpContainsFlagToken(input.help, flag)) {
			throw new Error(
				`Command help flag surface mismatch: command=${input.command} flag=${flag} classification=missing-present`,
			);
		}
	}

	for (const flag of input.absentFlags ?? []) {
		if (helpContainsFlagToken(input.help, flag)) {
			throw new Error(
				`Command help flag surface mismatch: command=${input.command} flag=${flag} classification=leaked-absent`,
			);
		}
	}
}

export type CommandSurfaceCase<TResult> = {
	label: string;
	argv: readonly string[];
	assert: (
		result: TResult,
		context: { label: string; argv: readonly string[] },
	) => void | Promise<void>;
};

export type CommandSurfaceRunner<TResult> = (
	argv: readonly string[],
) => TResult | Promise<TResult>;

export async function runCommandSurfaceCases<TResult>(input: {
	cases: readonly CommandSurfaceCase<TResult>[];
	runner: CommandSurfaceRunner<TResult>;
}): Promise<void> {
	if (input.cases.length === 0) {
		throw new Error("Command surface cases must include at least one case.");
	}

	for (const commandCase of input.cases) {
		const argv = [...commandCase.argv];
		let result: TResult;
		try {
			result = await input.runner([...argv]);
		} catch (error) {
			throw annotateCommandSurfaceCaseError(
				"runner",
				{ label: commandCase.label, argv },
				error,
			);
		}

		try {
			await commandCase.assert(result, {
				label: commandCase.label,
				argv: [...argv],
			});
		} catch (error) {
			throw annotateCommandSurfaceCaseError(
				"assertion",
				{ label: commandCase.label, argv },
				error,
			);
		}
	}
}

function helpContainsFlagToken(help: string, flag: string): boolean {
	return listAdvertisedHelpFlagTokens(help).has(flag);
}

function listAdvertisedHelpFlagTokens(help: string): Set<string> {
	const flags = new Set<string>();
	let inUsageBlock = false;

	for (const line of help.split(/\r?\n/)) {
		const trimmed = line.trimStart();
		const usageHeader = isUsageLine(trimmed);
		const usageContinuation: boolean =
			inUsageBlock && trimmed !== "" && line.length > trimmed.length;
		if (usageHeader || usageContinuation || isOptionLine(trimmed)) {
			for (const flag of trimmed.matchAll(/--[A-Za-z0-9][A-Za-z0-9_-]*/g)) {
				flags.add(flag[0]);
			}
		}
		inUsageBlock = usageHeader || usageContinuation;
	}
	return flags;
}

function isUsageLine(line: string): boolean {
	return line.startsWith("Usage:");
}

function isOptionLine(line: string): boolean {
	return /^(?:-[A-Za-z0-9],\s*)?--[A-Za-z0-9][A-Za-z0-9_-]*(?:[\s=,|]|$)/.test(
		line,
	);
}

function annotateCommandSurfaceCaseError(
	phase: "runner" | "assertion",
	commandCase: { label: string; argv: readonly string[] },
	error: unknown,
): Error {
	return new Error(
		`Command surface case ${phase} failed: label=${commandCase.label} argv=${JSON.stringify(
			commandCase.argv,
		)}\n${errorMessage(error)}`,
		{ cause: error },
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
