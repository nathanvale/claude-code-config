import type {
	CliRuntimeErrorEnvelope,
	CommandFacadeContract,
	CommandFacadeResultContract,
	RuntimeErrorRecoverability,
} from "./command-facade";
import type {
	BranchStation,
	BranchStationEvidence,
} from "./station-map";
import {
	createCliRuntimeErrorEnvelope,
	createCliRuntimeSuccessEnvelope,
} from "./runtime-envelope";
import {
	describeCliProcessRun,
	parseCliProcessJson,
	type CliProcessResult,
} from "./process-testing";
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

/**
 * Field expectations for reusable JSON error-envelope assertions.
 *
 * @example
 * ```typescript
 * assertJsonErrorEnvelope(envelope, {
 *   code: "usage_error",
 *   recoverability: "change_input",
 *   processExitCode: 2,
 * })
 * ```
 */
export type JsonErrorEnvelopeExpectation = {
	processExitCode: number;
	code: string;
	recoverability: RuntimeErrorRecoverability;
	errorResultContract?: CommandFacadeResultContract;
	runId?: string;
	failureDomain?: string;
};

export type WrittenCliRuntimeErrorEnvelope<TData = unknown> =
	CliRuntimeErrorEnvelope<TData> & {
		duration_ms?: number;
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

/**
 * Assert that a JSON error envelope satisfies the facade runtime contract.
 *
 * Uses the facade envelope builder for validation so tests catch drift in
 * runtime actions, continuation, diagnostic trail, and structured error shape.
 *
 * @param envelope - Parsed JSON value emitted by a CLI
 * @param expected - Expected fields for the structured error
 * @returns The original envelope narrowed to a runtime error envelope
 * @throws When the envelope is not a valid facade error envelope
 *
 * @example
 * ```typescript
 * const envelope = assertJsonErrorEnvelope(result.stdoutJson, {
 *   code: "config_missing",
 *   recoverability: "repair_state",
 *   processExitCode: 1,
 * })
 * ```
 */
export function assertJsonErrorEnvelope(
	envelope: unknown,
	expected: JsonErrorEnvelopeExpectation,
): WrittenCliRuntimeErrorEnvelope {
	if (!isJsonObject(envelope)) {
		throw new Error("Expected JSON error envelope object.");
	}
	if (envelope.status !== "error") {
		throw new Error("Expected JSON error envelope status=error.");
	}
	if (typeof envelope.run_id !== "string" || envelope.run_id.trim() === "") {
		throw new Error("Expected JSON error envelope run_id.");
	}
	if (!isJsonObject(envelope.error)) {
		throw new Error("Expected JSON error envelope error object.");
	}
	const runId = expected.runId ?? envelope.run_id;
	if (envelope.run_id !== runId) {
		throw new Error(
			`JSON error envelope run_id mismatch: expected=${runId} actual=${envelope.run_id}`,
		);
	}

	const validatedEnvelope = envelope as RuntimeErrorEnvelopeCandidate;
	assertSupportedJsonErrorEnvelopeKeys(validatedEnvelope);
	assertOptionalDurationMs("JSON error envelope", validatedEnvelope.duration_ms);
	try {
		const input = runtimeErrorEnvelopeInput(
			validatedEnvelope,
			expected.processExitCode,
		);
		createCliRuntimeErrorEnvelope(input);
	} catch (error) {
		throw new Error(
			`Invalid JSON error envelope: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (envelope.error.code !== expected.code) {
		throw new Error(
			`JSON error envelope code mismatch: expected=${expected.code} actual=${envelope.error.code}`,
		);
	}
	if (envelope.error.recoverability !== expected.recoverability) {
		throw new Error(
			`JSON error envelope recoverability mismatch: expected=${expected.recoverability} actual=${envelope.error.recoverability}`,
		);
	}
	if (envelope.error.exit_code !== expected.processExitCode) {
		throw new Error(
			`JSON error envelope exit_code mismatch: expected=${expected.processExitCode} actual=${envelope.error.exit_code}`,
		);
	}
	if (
		expected.failureDomain !== undefined &&
		envelope.error.failure_domain !== expected.failureDomain
	) {
		throw new Error(
			`JSON error envelope failure_domain mismatch: expected=${expected.failureDomain} actual=${envelope.error.failure_domain}`,
		);
	}
	assertErrorDataResultContract(envelope.data, expected.errorResultContract);

	return envelope as WrittenCliRuntimeErrorEnvelope;
}

/**
 * Assert that an envelope data payload carries the declared result contract.
 *
 * This checks facade-owned metadata only; package-owned result vocabulary stays
 * with the consuming package's tests.
 *
 * @param input - Command label, facade contract, and parsed envelope
 * @throws When the envelope lacks matching result-contract metadata
 *
 * @example
 * ```typescript
 * assertCommandResultContract({
 *   command: "report",
 *   contract: reportContract,
 *   envelope,
 * })
 * ```
 */
export function assertCommandResultContract(input: {
	command: string;
	contract: Pick<CommandFacadeContract, "json" | "outputModes" | "resultContract">;
	envelope: unknown;
}): void {
	if (!input.contract.resultContract) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} classification=missing-contract`,
		);
	}
	if (
		input.contract.json !== true ||
		(input.contract.outputModes !== undefined &&
			!input.contract.outputModes.includes("json"))
	) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} classification=non-json-result-contract`,
		);
	}
	if (!isJsonObject(input.envelope)) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} classification=missing-envelope`,
		);
	}
	if (input.envelope.status !== "ok") {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} classification=not-success-envelope`,
		);
	}
	if (
		typeof input.envelope.run_id !== "string" ||
		input.envelope.run_id.trim() === ""
	) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} classification=missing-run-id`,
		);
	}
	if (!isJsonObject(input.envelope.data)) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} classification=missing-data`,
		);
	}
	const successEnvelope = input.envelope as RuntimeSuccessEnvelopeCandidate;
	assertSupportedJsonSuccessEnvelopeKeys(input.command, successEnvelope);
	assertOptionalDurationMs(
		`Command result contract assertion failed: command=${input.command}`,
		successEnvelope.duration_ms,
	);
	try {
		createCliRuntimeSuccessEnvelope({
			run_id: successEnvelope.run_id,
			data: successEnvelope.data,
			...(successEnvelope.runtime_actions !== undefined
				? {
						runtime_actions:
							successEnvelope.runtime_actions as NonNullable<
								RuntimeSuccessEnvelopeInput["runtime_actions"]
							>,
					}
				: {}),
			...(successEnvelope.continuation !== undefined
				? {
						continuation:
							successEnvelope.continuation as NonNullable<
								RuntimeSuccessEnvelopeInput["continuation"]
							>,
					}
				: {}),
			...(successEnvelope.diagnostic_trail !== undefined
				? {
						diagnostic_trail:
							successEnvelope.diagnostic_trail as NonNullable<
								RuntimeSuccessEnvelopeInput["diagnostic_trail"]
							>,
					}
				: {}),
		});
	} catch (error) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} classification=invalid-success-envelope reason=${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	const actual = input.envelope.data.contract_id;
	const expected = input.contract.resultContract.id;
	if (actual !== expected) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} expected=${expected} actual=${String(actual)}`,
		);
	}
	const actualSchemaVersion = input.envelope.data.schema_version;
	const expectedSchemaVersion = input.contract.resultContract.schema_version;
	if (actualSchemaVersion !== expectedSchemaVersion) {
		throw new Error(
			`Command result contract assertion failed: command=${input.command} schema_version expected=${String(expectedSchemaVersion)} actual=${String(actualSchemaVersion)}`,
		);
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

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RuntimeErrorEnvelopeInput = Parameters<
	typeof createCliRuntimeErrorEnvelope
>[0];

type RuntimeSuccessEnvelopeInput = Parameters<
	typeof createCliRuntimeSuccessEnvelope
>[0];

type RuntimeErrorEnvelopeCandidate = Record<string, unknown> & {
	run_id: string;
	error: Record<string, unknown>;
};

type RuntimeSuccessEnvelopeCandidate = Record<string, unknown> & {
	run_id: string;
	data: Record<string, unknown>;
};

function assertSupportedJsonErrorEnvelopeKeys(
	envelope: RuntimeErrorEnvelopeCandidate,
): void {
	const supportedKeys = new Set([
		"status",
		"run_id",
		"data",
		"error",
		"runtime_actions",
		"continuation",
		"diagnostic_trail",
		"duration_ms",
	]);
	const unsupportedKeys = Object.keys(envelope).filter(
		(key) => !supportedKeys.has(key),
	);
	if (unsupportedKeys.length > 0) {
		throw new Error(
			`Invalid JSON error envelope: unsupported field(s): ${unsupportedKeys.join(", ")}`,
		);
	}
}

function assertSupportedJsonSuccessEnvelopeKeys(
	command: string,
	envelope: RuntimeSuccessEnvelopeCandidate,
): void {
	const supportedKeys = new Set([
		"status",
		"run_id",
		"data",
		"runtime_actions",
		"continuation",
		"diagnostic_trail",
		"duration_ms",
	]);
	const unsupportedKeys = Object.keys(envelope).filter(
		(key) => !supportedKeys.has(key),
	);
	if (unsupportedKeys.length > 0) {
		throw new Error(
			`Command result contract assertion failed: command=${command} classification=unsupported-field fields=${unsupportedKeys.join(", ")}`,
		);
	}
}

function assertOptionalDurationMs(messagePrefix: string, value: unknown): void {
	if (value === undefined) return;
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		throw new Error(`${messagePrefix} duration_ms must be a non-negative number.`);
	}
}

function assertErrorDataResultContract(
	data: unknown,
	expected: CommandFacadeResultContract | undefined,
): void {
	if (!isJsonObject(data)) {
		if (expected) {
			throw new Error("JSON error envelope data result contract missing data.");
		}
		return;
	}

	const carriesResultMetadata =
		Object.hasOwn(data, "contract_id") ||
		Object.hasOwn(data, "schema_version");
	if (!carriesResultMetadata) {
		if (expected) {
			throw new Error(
				"JSON error envelope data result contract metadata missing.",
			);
		}
		return;
	}
	if (!expected) {
		throw new Error(
			"JSON error envelope data result contract requires errorResultContract.",
		);
	}

	if (data.contract_id !== expected.id) {
		throw new Error(
			`JSON error envelope data contract_id mismatch: expected=${expected.id} actual=${String(data.contract_id)}`,
		);
	}
	if (data.schema_version !== expected.schema_version) {
		throw new Error(
			`JSON error envelope data schema_version mismatch: expected=${String(expected.schema_version)} actual=${String(data.schema_version)}`,
		);
	}
}

function runtimeErrorEnvelopeInput(
	envelope: RuntimeErrorEnvelopeCandidate,
	processExitCode: number,
): RuntimeErrorEnvelopeInput {
	return {
		run_id: envelope.run_id,
		process_exit_code: processExitCode,
		error: envelope.error as RuntimeErrorEnvelopeInput["error"],
		...(envelope.data !== undefined ? { data: envelope.data } : {}),
		...(envelope.runtime_actions !== undefined
			? {
					runtime_actions:
						envelope.runtime_actions as NonNullable<
							RuntimeErrorEnvelopeInput["runtime_actions"]
						>,
				}
			: {}),
		...(envelope.continuation !== undefined
			? {
					continuation:
						envelope.continuation as NonNullable<
							RuntimeErrorEnvelopeInput["continuation"]
						>,
				}
			: {}),
		...(envelope.diagnostic_trail !== undefined
			? {
					diagnostic_trail:
						envelope.diagnostic_trail as NonNullable<
							RuntimeErrorEnvelopeInput["diagnostic_trail"]
						>,
				}
			: {}),
	};
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

// -- Station integration testing helpers --

export type StationRuntimeEnvelope = {
	status?: "ok" | "error";
	data?: Record<string, unknown>;
	error?: { code?: string };
};

export type StationScenario<TStation extends BranchStation = BranchStation> = {
	run: (station: TStation) => Promise<BranchStationEvidence>;
};

export function extractEnvelopeContractId(
	envelope: StationRuntimeEnvelope,
): string | undefined {
	const dataContract = envelope.data?.contract ?? envelope.data?.contract_id;
	if (typeof dataContract === "string") return dataContract;
	return undefined;
}

export function assertStationEnvelope(
	station: BranchStation,
	result: CliProcessResult,
): StationRuntimeEnvelope {
	if (result.exitCode !== station.expectedExitCode) {
		throw new Error(
			`Station ${station.id} exit code mismatch: expected=${station.expectedExitCode} actual=${result.exitCode}\n${describeCliProcessRun(result)}`,
		);
	}
	if (!station.expectedEnvelopeStatus) return {};
	const envelope = parseCliProcessJson<StationRuntimeEnvelope>(result);
	if (envelope.status !== station.expectedEnvelopeStatus) {
		throw new Error(
			`Station ${station.id} envelope status mismatch: expected=${station.expectedEnvelopeStatus} actual=${envelope.status}\n${describeCliProcessRun(result)}`,
		);
	}
	const observedContract = extractEnvelopeContractId(envelope);
	if (
		station.expectedResultContractId &&
		observedContract !== station.expectedResultContractId
	) {
		throw new Error(
			`Station ${station.id} contract id mismatch: expected=${station.expectedResultContractId} actual=${observedContract}\n${describeCliProcessRun(result)}`,
		);
	}
	if (
		station.expectedErrorCode &&
		envelope.error?.code !== station.expectedErrorCode
	) {
		throw new Error(
			`Station ${station.id} error code mismatch: expected=${station.expectedErrorCode} actual=${envelope.error?.code}\n${describeCliProcessRun(result)}`,
		);
	}
	return envelope;
}

export function buildStationEvidence(
	station: BranchStation,
	result: CliProcessResult,
	envelope: StationRuntimeEnvelope,
): BranchStationEvidence {
	const contractId = extractEnvelopeContractId(envelope);
	return {
		stationId: station.id,
		status: "covered",
		...(result.exitCode !== null ? { observedExitCode: result.exitCode } : {}),
		...(envelope.status ? { observedEnvelopeStatus: envelope.status } : {}),
		...(contractId ? { observedResultContractId: contractId } : {}),
		...(envelope.error?.code
			? { observedErrorCode: envelope.error.code }
			: {}),
	};
}

export function buildSkippedStationEvidence(
	station: BranchStation,
	rationale: string,
): BranchStationEvidence {
	return {
		stationId: station.id,
		status: "skipped",
		rationale,
	};
}
