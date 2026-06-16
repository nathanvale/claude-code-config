import {
	type CliStructuredRuntimeErrorBuilderInput,
	type CommandFacadeContract,
	type CommandResultData,
	type CommandResultPayload,
	type createCliRuntimeError,
	type createCliRepairStateRuntimeError,
	type createCliRetryRuntimeError,
	type createCliUsageRuntimeError,
	createCommandResultData,
} from "@side-quest/cli-command-facade";
import { assertJsonErrorEnvelope } from "@side-quest/cli-command-facade/testing";

const reportContract = {
	script: "tools/report.ts",
	summary: "Report command state.",
	usage: ["report --json"],
	json: true,
	audience: "agent",
	mutation: "read-only",
	sideEffects: ["check"],
	flags: {
		"--json": { type: "boolean", description: "Emit JSON." },
	},
	exitCodes: {
		"0": "report emitted",
		"1": "report failed",
		"2": "usage error",
	},
	resultContract: {
		id: "example.report",
		schema_version: 1,
	},
} as const satisfies CommandFacadeContract<"report">;

type ReportPayload = CommandResultPayload<{ total: number }>;
type ReportResult = CommandResultData<ReportPayload>;
type UnionReportPayload = CommandResultPayload<
	{ total: number } | { total: number; contract_id: undefined }
>;
type SafeUnionReportPayload = CommandResultPayload<
	{ total: number } | { total: number; label: string }
>;
type RawUnionReportPayload =
	| { total: number }
	| { total: number; contract_id: undefined };
type DictionaryReportPayload = CommandResultPayload<Record<string, unknown>>;
type NumberDictionaryReportPayload = CommandResultPayload<Record<number, unknown>>;
type SymbolDictionaryReportPayload = CommandResultPayload<
	Record<symbol, unknown>
>;
type BroadObjectReportPayload = CommandResultPayload<object>;
type EmptyObjectReportPayload = CommandResultPayload<Record<never, never>>;
type ArrayReportPayload = CommandResultPayload<unknown[]>;
type FunctionReportPayload = CommandResultPayload<() => { total: number }>;

interface InterfaceReportPayload {
	total: number;
}

// @ts-expect-error payload type requires an explicit consumer-owned shape.
type _BarePayload = CommandResultPayload;

const typedResult: ReportResult = {
	contract_id: "example.report",
	schema_version: 1,
	total: 1,
};
const _metadataId: string = typedResult.contract_id;
const _payloadTotal: number = typedResult.total;

// @ts-expect-error facade-owned metadata belongs to createCommandResultData.
const _reservedPayload: ReportPayload = { contract_id: "other", total: 1 };
const _reservedUndefinedPayload: ReportPayload = {
	// @ts-expect-error facade-owned metadata cannot be present as undefined.
	contract_id: undefined,
	total: 1,
};

const literalResult = createCommandResultData(reportContract, { total: 1 });
const _literalContractId: "example.report" = literalResult.contract_id;
const _literalSchemaVersion: 1 = literalResult.schema_version;
const _literalPayloadTotal: number = literalResult.total;

const interfacePayload: InterfaceReportPayload = { total: 2 };
const interfacePayloadResult = createCommandResultData(
	reportContract,
	interfacePayload,
);
const _interfacePayloadTotal: number = interfacePayloadResult.total;

const _validSafeUnionPayload: SafeUnionReportPayload = { total: 1 };
const _validSafeUnionPayloadTotal: number = _validSafeUnionPayload.total;
declare const safeUnionPayload: SafeUnionReportPayload;
const safeUnionResult = createCommandResultData(reportContract, safeUnionPayload);
if ("label" in safeUnionResult) {
	const _safeUnionLabel: string = safeUnionResult.label;
}
// @ts-expect-error unions with any reserved-key branch are rejected.
const _invalidUnionPayload: UnionReportPayload = { total: 1 };
declare const rawUnionPayload: RawUnionReportPayload;
// @ts-expect-error raw union inputs cannot hide branch-only reserved keys.
createCommandResultData(reportContract, rawUnionPayload);
// @ts-expect-error broad dictionary payloads can hide reserved metadata keys.
const _dictionaryPayload: DictionaryReportPayload = { total: 1 };
declare const rawDictionaryPayload: Record<string, unknown>;
// @ts-expect-error raw dictionaries can hide reserved metadata keys.
createCommandResultData(reportContract, rawDictionaryPayload);
// @ts-expect-error numeric dictionaries are not plain named result payloads.
const _numberDictionaryPayload: NumberDictionaryReportPayload = { 1: "bad" };
declare const rawNumberDictionaryPayload: Record<number, unknown>;
// @ts-expect-error raw numeric dictionaries are not plain named result payloads.
createCommandResultData(reportContract, rawNumberDictionaryPayload);
// @ts-expect-error symbol dictionaries are not plain named result payloads.
const _symbolDictionaryPayload: SymbolDictionaryReportPayload = {};
declare const rawSymbolDictionaryPayload: Record<symbol, unknown>;
// @ts-expect-error raw symbol dictionaries are not plain named result payloads.
createCommandResultData(reportContract, rawSymbolDictionaryPayload);
// @ts-expect-error broad object payloads can hide reserved metadata keys.
const _broadObjectPayload: BroadObjectReportPayload = { total: 1 };
declare const rawBroadObjectPayload: object;
// @ts-expect-error raw broad objects can hide reserved metadata keys.
createCommandResultData(reportContract, rawBroadObjectPayload);
// @ts-expect-error empty object payloads carry no named fields to project.
const _emptyObjectPayload: EmptyObjectReportPayload = {};
// @ts-expect-error arrays are rejected by the runtime helper.
const _arrayPayload: ArrayReportPayload = [];
// @ts-expect-error functions are rejected by the runtime helper.
const _functionPayload: FunctionReportPayload = () => ({ total: 1 });

// @ts-expect-error facade-owned contract_id belongs to the helper.
createCommandResultData(reportContract, {
	total: 1,
	contract_id: "other",
});
// @ts-expect-error facade-owned schema_version belongs to the helper.
createCommandResultData(reportContract, {
	total: 1,
	schema_version: 1,
});
// @ts-expect-error facade-owned contract_id cannot be present as undefined.
createCommandResultData(reportContract, { total: 1, contract_id: undefined });
// @ts-expect-error facade-owned schema_version cannot be present as undefined.
createCommandResultData(reportContract, { total: 1, schema_version: undefined });
// @ts-expect-error arrays are rejected at the helper call site.
createCommandResultData(reportContract, ["bad"]);
// @ts-expect-error functions are rejected at the helper call site.
createCommandResultData(reportContract, () => ({ total: 1 }));

const _usageAllowsOmittedExitCode: Parameters<
	typeof createCliUsageRuntimeError
>[0] = {
	run_id: "run-test-1",
	message: "Invalid input.",
};

const _usageAllowsExitCodeTwo: Parameters<
	typeof createCliUsageRuntimeError
>[0] = {
	run_id: "run-test-1",
	message: "Invalid input.",
	exit_code: 2,
};

const _usageAllowsOpenDocsHint: Parameters<
	typeof createCliUsageRuntimeError
>[0] = {
	run_id: "run-test-1",
	message: "Open docs.",
	hint: { summary: "Open docs.", action: "open_docs" },
};

const _usageRejectsWrongExitCode: Parameters<
	typeof createCliUsageRuntimeError
>[0] = {
	run_id: "run-test-1",
	message: "Invalid input.",
	// @ts-expect-error usage runtime errors are process exit code 2.
	exit_code: 1,
};

const _usageRejectsRetryHint: Parameters<
	typeof createCliUsageRuntimeError
>[0] = {
	run_id: "run-test-1",
	message: "Retry.",
	hint: {
		summary: "Retry.",
		// @ts-expect-error retry hints do not match change_input recovery.
		action: "retry",
	},
};

const _repairAllowsOpenDocsHint: Parameters<
	typeof createCliRepairStateRuntimeError
>[0] = {
	run_id: "run-test-1",
	code: "config_missing",
	message: "Config is missing.",
	exit_code: 1,
	hint: { summary: "Open docs.", action: "open_docs" },
};

const _repairRejectsRetryHint: Parameters<
	typeof createCliRepairStateRuntimeError
>[0] = {
	run_id: "run-test-1",
	code: "config_missing",
	message: "Config is missing.",
	exit_code: 1,
	hint: {
		summary: "Retry.",
		// @ts-expect-error retry hints do not match repair_state recovery.
		action: "retry",
	},
};

const _retryAllowsRetryHint: Parameters<typeof createCliRetryRuntimeError>[0] = {
	run_id: "run-test-1",
	code: "temporary_unavailable",
	message: "Dependency unavailable.",
	exit_code: 1,
	hint: { summary: "Retry.", action: "retry" },
};

const _retryRejectsOpenDocsHint: Parameters<
	typeof createCliRetryRuntimeError
>[0] = {
	run_id: "run-test-1",
	code: "temporary_unavailable",
	message: "Dependency unavailable.",
	exit_code: 1,
	hint: {
		summary: "Open docs.",
		// @ts-expect-error open_docs hints do not match retry recovery.
		action: "open_docs",
	},
};

const _runtimeErrorAllowsRetry: Parameters<typeof createCliRuntimeError>[0] = {
	run_id: "run-test-1",
	code: "temporary_unavailable",
	message: "Dependency unavailable.",
	exit_code: 1,
	recoverability: "retry",
	retryable: true,
	hint: { summary: "Retry.", action: "retry" },
};

const runtimeErrorRejectsRetryableFalseInput = {
	run_id: "run-test-1",
	code: "temporary_unavailable",
	message: "Dependency unavailable.",
	exit_code: 1,
	recoverability: "retry",
	retryable: false,
} as const;
// @ts-expect-error createCliRuntimeError requires retryable=true for retry.
const _runtimeErrorRejectsRetryableFalse: Parameters<
	typeof createCliRuntimeError
>[0] = runtimeErrorRejectsRetryableFalseInput;

const runtimeErrorRejectsRetryableTrueInput = {
	run_id: "run-test-1",
	code: "config_missing",
	message: "Config is missing.",
	exit_code: 1,
	recoverability: "repair_state",
	retryable: true,
} as const;
// @ts-expect-error createCliRuntimeError requires retryable=false for non-retry.
const _runtimeErrorRejectsRetryableTrue: Parameters<
	typeof createCliRuntimeError
>[0] = runtimeErrorRejectsRetryableTrueInput;

const retryRecoverabilityRejectsRetryableFalseInput = {
	run_id: "run-test-1",
	code: "temporary_unavailable",
	message: "Dependency unavailable.",
	exit_code: 1,
	recoverability: "retry",
	retryable: false,
} as const;
// @ts-expect-error retry recoverability requires retryable=true.
const _retryRecoverabilityRejectsRetryableFalse: CliStructuredRuntimeErrorBuilderInput =
	retryRecoverabilityRejectsRetryableFalseInput;

const nonRetryRecoverabilityRejectsRetryableTrueInput = {
	run_id: "run-test-1",
	code: "config_missing",
	message: "Config is missing.",
	exit_code: 1,
	recoverability: "repair_state",
	retryable: true,
} as const;
// @ts-expect-error non-retry recoverability requires retryable=false.
const _nonRetryRecoverabilityRejectsRetryableTrue: CliStructuredRuntimeErrorBuilderInput =
	nonRetryRecoverabilityRejectsRetryableTrueInput;

const typedErrorEnvelope = assertJsonErrorEnvelope(
	{
		status: "error",
		run_id: "run-test-1",
		error: {
			run_id: "run-test-1",
			code: "config_missing",
			message: "Config is missing.",
			exit_code: 1,
			severity: "error",
			recoverability: "repair_state",
			retryable: false,
		},
	},
	{
		code: "config_missing",
		recoverability: "repair_state",
		processExitCode: 1,
	},
);
const _errorEnvelopeData: unknown = typedErrorEnvelope.data;
// @ts-expect-error helper does not validate caller-owned error data fields.
typedErrorEnvelope.data.total;
// @ts-expect-error helper takes no type arguments; data shape is not caller-narrowed.
assertJsonErrorEnvelope<{ total: number }>(
	{
		status: "error",
		run_id: "run-test-1",
		error: {
			run_id: "run-test-1",
			code: "config_missing",
			message: "Config is missing.",
			exit_code: 1,
			severity: "error",
			recoverability: "repair_state",
			retryable: false,
		},
	},
	{
		code: "config_missing",
		recoverability: "repair_state",
		processExitCode: 1,
	},
);
