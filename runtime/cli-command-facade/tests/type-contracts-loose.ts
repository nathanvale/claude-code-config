import {
	type CommandFacadeContract,
	type CommandResultPayload,
	createCommandResultData,
} from "@side-quest/cli-command-facade";

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

// @ts-expect-error bare payload type would erase reserved-key checks.
type _BarePayload = CommandResultPayload;

type UndefinedContractIdPayload = CommandResultPayload<{
	total: number;
	contract_id: undefined;
}>;
// @ts-expect-error reserved contract_id is rejected without exact optional types.
const _undefinedContractIdPayload: UndefinedContractIdPayload = {
	total: 1,
	contract_id: undefined,
};

type UndefinedSchemaVersionPayload = CommandResultPayload<{
	total: number;
	schema_version: undefined;
}>;
// @ts-expect-error reserved schema_version is rejected without exact optional types.
const _undefinedSchemaVersionPayload: UndefinedSchemaVersionPayload = {
	total: 1,
	schema_version: undefined,
};

// @ts-expect-error reserved contract_id is rejected at the helper call site.
createCommandResultData(reportContract, { total: 1, contract_id: undefined });
// @ts-expect-error reserved schema_version is rejected at the helper call site.
createCommandResultData(reportContract, { total: 1, schema_version: undefined });

type LooseUnionPayload = CommandResultPayload<
	{ total: number } | { total: number; contract_id: undefined }
>;
type SafeLooseUnionPayload = CommandResultPayload<
	{ total: number } | { total: number; label: string }
>;
type LooseDictionaryPayload = CommandResultPayload<Record<string, unknown>>;
type LooseNumberDictionaryPayload = CommandResultPayload<Record<number, unknown>>;
type LooseSymbolDictionaryPayload = CommandResultPayload<
	Record<symbol, unknown>
>;
type LooseBroadObjectPayload = CommandResultPayload<object>;
type LooseEmptyObjectPayload = CommandResultPayload<Record<never, never>>;
type LooseArrayPayload = CommandResultPayload<unknown[]>;
type LooseFunctionPayload = CommandResultPayload<() => { total: number }>;
const _validSafeLooseUnionPayload: SafeLooseUnionPayload = { total: 1 };
declare const safeLooseUnionPayload: SafeLooseUnionPayload;
const safeLooseUnionResult = createCommandResultData(
	reportContract,
	safeLooseUnionPayload,
);
if ("label" in safeLooseUnionResult) {
	const _safeLooseUnionLabel: string = safeLooseUnionResult.label;
}
// @ts-expect-error loose unions with any reserved-key branch are rejected.
const _invalidLooseUnionPayload: LooseUnionPayload = { total: 1 };
declare const rawLooseUnionPayload:
	| { total: number }
	| { total: number; contract_id: undefined };
// @ts-expect-error raw loose union inputs cannot hide branch-only reserved keys.
createCommandResultData(reportContract, rawLooseUnionPayload);
// @ts-expect-error broad loose dictionaries can hide reserved metadata keys.
const _looseDictionaryPayload: LooseDictionaryPayload = { total: 1 };
declare const rawLooseDictionaryPayload: Record<string, unknown>;
// @ts-expect-error raw loose dictionaries can hide reserved metadata keys.
createCommandResultData(reportContract, rawLooseDictionaryPayload);
// @ts-expect-error numeric loose dictionaries are not plain named result payloads.
const _looseNumberDictionaryPayload: LooseNumberDictionaryPayload = { 1: "bad" };
declare const rawLooseNumberDictionaryPayload: Record<number, unknown>;
// @ts-expect-error raw numeric loose dictionaries are not plain named result payloads.
createCommandResultData(reportContract, rawLooseNumberDictionaryPayload);
// @ts-expect-error symbol loose dictionaries are not plain named result payloads.
const _looseSymbolDictionaryPayload: LooseSymbolDictionaryPayload = {};
declare const rawLooseSymbolDictionaryPayload: Record<symbol, unknown>;
// @ts-expect-error raw symbol loose dictionaries are not plain named result payloads.
createCommandResultData(reportContract, rawLooseSymbolDictionaryPayload);
// @ts-expect-error broad loose objects can hide reserved metadata keys.
const _looseBroadObjectPayload: LooseBroadObjectPayload = { total: 1 };
declare const rawLooseBroadObjectPayload: object;
// @ts-expect-error raw broad loose objects can hide reserved metadata keys.
createCommandResultData(reportContract, rawLooseBroadObjectPayload);
// @ts-expect-error empty loose objects carry no named fields to project.
const _looseEmptyObjectPayload: LooseEmptyObjectPayload = {};
// @ts-expect-error arrays are rejected by the runtime helper.
const _looseArrayPayload: LooseArrayPayload = [];
// @ts-expect-error functions are rejected by the runtime helper.
const _looseFunctionPayload: LooseFunctionPayload = () => ({ total: 1 });
// @ts-expect-error arrays are rejected at the helper call site.
createCommandResultData(reportContract, ["bad"]);
// @ts-expect-error functions are rejected at the helper call site.
createCommandResultData(reportContract, () => ({ total: 1 }));
