import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
	configureSync,
	getLogger,
	type LogLevel,
	type LogRecord,
	resetSync,
	type Sink,
	withContext,
} from "@logtape/logtape";
import type { CliWriter, CliWriterContractError } from "./cli-writer";
import { usageError } from "./usage";

export const CLI_DIAGNOSTIC_FLAGS = [
	"--quiet",
	"--verbose",
	"--debug",
	"--run-id",
] as const;

export type CliDiagnosticFlag = (typeof CLI_DIAGNOSTIC_FLAGS)[number];

export type CliDiagnosticMode = "quiet" | "default" | "verbose" | "debug";

export type CliDiagnosticOptions = {
	json: boolean;
	quiet: boolean;
	verbose: boolean;
	debug: boolean;
	mode: CliDiagnosticMode;
	lowestLevel: LogLevel;
	runId: string;
	startedAtMs: number;
};

export type ParsedCliDiagnosticArgv = {
	argv: string[];
	options: CliDiagnosticOptions;
};

export type CliDiagnosticSerializableRecord = {
	timestamp: string;
	level: LogLevel;
	category: readonly string[];
	message: string;
	event?: string;
	[key: string]: unknown;
};

export type CliDiagnosticRedactor = (
	record: CliDiagnosticSerializableRecord,
) => CliDiagnosticSerializableRecord;

export type ConfigureCliDiagnosticsOptions = {
	categoryRoot: string | readonly string[];
	options: CliDiagnosticOptions;
	diagnosticWriter: CliWriter;
	redact?: CliDiagnosticRedactor;
};

/**
 * Describes how a command result relates to the facade-owned Run Correlation ID.
 * `not-applicable` is for discovery projections of commands that do not emit a
 * machine-readable result, not for runtime diagnostics from an active command.
 */
export type CliDiagnosticRunIdSource =
	| "facade"
	| "legacy-domain"
	| "none"
	| "not-applicable";

export type CliDiagnosticContext = Record<string, unknown> & {
	run_id?: string;
	started_at_ms?: number;
	domain_run_id?: string;
	run_id_source?: CliDiagnosticRunIdSource;
};

export type ActiveCliDiagnosticContext = CliDiagnosticContext & {
	run_id: string;
	started_at_ms: number;
};

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const POST_MORTEM_BUFFER_MAX_RECORDS = 250;
const POST_MORTEM_BUFFER_MAX_CONTEXTS = 100;
const CLI_DIAGNOSTIC_CONTEXT_ID_PROPERTY = "__cli_diagnostic_context_id";
type InternalCliDiagnosticContext = ActiveCliDiagnosticContext & {
	[CLI_DIAGNOSTIC_CONTEXT_ID_PROPERTY]: string;
};
const cliDiagnosticContextStorage =
	new AsyncLocalStorage<InternalCliDiagnosticContext>();

export function parseCliDiagnosticArgv(
	argv: readonly string[],
): ParsedCliDiagnosticArgv {
	let mode: CliDiagnosticMode = "default";
	const strippedArgv: string[] = [];
	let quiet = false;
	let verbose = false;
	let debug = false;
	let json = false;
	let runId: string | undefined;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			strippedArgv.push(...argv.slice(index + 1));
			break;
		}
		if (arg === "--quiet") {
			quiet = true;
			mode = "quiet";
			continue;
		}
		if (arg === "--verbose") {
			verbose = true;
			mode = "verbose";
			continue;
		}
		if (arg === "--debug") {
			debug = true;
			mode = "debug";
			continue;
		}
		if (arg === "--json") {
			json = true;
			strippedArgv.push(arg);
			continue;
		}
		if (arg === "--run-id") {
			if (runId) {
				throw usageError("--run-id cannot be specified more than once");
			}
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw usageError("--run-id requires a value");
			}
			runId = parseCliRunId(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--run-id=")) {
			if (runId) {
				throw usageError("--run-id cannot be specified more than once");
			}
			const value = arg.slice("--run-id=".length);
			if (value.startsWith("--")) {
				throw usageError("--run-id requires a value");
			}
			runId = parseCliRunId(value);
			continue;
		}
		strippedArgv.push(arg);
	}
	runId ??= randomUUID();

	return {
		argv: strippedArgv,
		options: {
			json,
			quiet,
			verbose,
			debug,
			mode,
			lowestLevel: lowestLogLevelForDiagnosticMode(mode),
			runId,
			startedAtMs: Date.now(),
		},
	};
}

/**
 * Builds a diagnostic fallback context after diagnostic parsing failed, so CLI
 * front doors can still report the parse failure as a structured usage error.
 */
export function parseCliDiagnosticFallbackArgv(
	argv: readonly string[],
): ParsedCliDiagnosticArgv {
	const parsed = parseCliDiagnosticArgv(stripRunIdDiagnosticArgs(argv));
	const fallbackRunId = findFirstValidCliRunId(argv);
	if (!fallbackRunId) return parsed;
	return {
		...parsed,
		options: {
			...parsed.options,
			runId: fallbackRunId,
		},
	};
}

export function configureCliDiagnostics({
	categoryRoot,
	options,
	diagnosticWriter,
	redact = redactGenericCliDiagnosticRecord,
}: ConfigureCliDiagnosticsOptions): void {
	const rootCategory = normalizeCategory(categoryRoot);
	const writeSerializedRecord = (record: CliDiagnosticSerializableRecord) => {
		const serialized = redact(record);
		const line = options.json
			? `${JSON.stringify(serialized)}\n`
			: `${formatHumanCliDiagnosticRecord(serialized)}\n`;
		diagnosticWriter.write(line);
	};
	const visibleSink: Sink = (record: LogRecord) => {
		writeSerializedRecord(serializeCliDiagnosticRecord(record));
	};
	const sink =
		options.mode === "default"
			? createPostMortemDiagnosticSink({
					writeSerializedRecord,
					maxBufferSize: POST_MORTEM_BUFFER_MAX_RECORDS,
					maxContexts: POST_MORTEM_BUFFER_MAX_CONTEXTS,
				})
			: visibleSink;

	configureSync({
		reset: true,
		sinks: { diagnostic: sink },
		loggers: [
			{
				category: rootCategory,
				lowestLevel: options.mode === "default" ? "debug" : options.lowestLevel,
				sinks: ["diagnostic"],
			},
			{
				category: ["logtape", "meta"],
				lowestLevel: "fatal",
				sinks: [],
			},
		],
		contextLocalStorage: new AsyncLocalStorage<Record<string, unknown>>(),
	});
}

export function resetCliDiagnostics(): void {
	resetSync();
}

export function withCliDiagnosticContext<T>(
	context: CliDiagnosticContext,
	callback: () => T,
): T {
	const activeContext = normalizeCliDiagnosticContext(context);
	return cliDiagnosticContextStorage.run(activeContext, () =>
		withContext(activeContext, callback),
	);
}

export function createCliDiagnosticContext(
	options: Pick<CliDiagnosticOptions, "runId" | "startedAtMs">,
	context: CliDiagnosticContext = {},
): ActiveCliDiagnosticContext {
	return {
		...context,
		run_id: options.runId,
		started_at_ms: options.startedAtMs,
	};
}

export function getCurrentCliDiagnosticContext():
	| ActiveCliDiagnosticContext
	| undefined {
	return cliDiagnosticContextStorage.getStore();
}

export function getCliDiagnosticDurationMs(
	now = Date.now(),
): number | undefined {
	const context = getCurrentCliDiagnosticContext();
	return context
		? Math.max(0, Math.round(now - context.started_at_ms))
		: undefined;
}

/**
 * Records a package-owned domain run ID on the facade's live async context.
 *
 * LogTape package loggers receive the context snapshot captured when
 * `withCliDiagnosticContext` starts. Exit/error diagnostics that need
 * late-bound domain identity should read `getCurrentCliDiagnosticContext()`.
 */
export function recordCliDomainRunId(
	domainRunId: string,
	runIdSource: CliDiagnosticRunIdSource = "legacy-domain",
): void {
	const context = getCurrentCliDiagnosticContext();
	if (!context) return;
	context.domain_run_id = domainRunId;
	context.run_id_source = runIdSource;
}

export function cliWriterContractErrorProperties(
	error: CliWriterContractError,
): Record<string, unknown> {
	return error.properties;
}

export function emitCliDiagnostic(
	category: string | readonly string[],
	level: LogLevel,
	event: string,
	properties: Record<string, unknown> = {},
): void {
	const logger = getLogger(normalizeCategory(category));
	const payload = { ...properties, event };
	switch (level) {
		case "trace":
			logger.trace(event, payload);
			break;
		case "debug":
			logger.debug(event, payload);
			break;
		case "info":
			logger.info(event, payload);
			break;
		case "warning":
			logger.warning(event, payload);
			break;
		case "error":
			logger.error(event, payload);
			break;
		case "fatal":
			logger.fatal(event, payload);
			break;
	}
}

function lowestLogLevelForDiagnosticMode(mode: CliDiagnosticMode): LogLevel {
	switch (mode) {
		case "quiet":
			return "error";
		case "verbose":
			return "info";
		case "debug":
			return "debug";
		case "default":
			return "warning";
	}
}

function parseCliRunId(value: string): string {
	if (value.length === 0) {
		throw usageError("--run-id requires a non-empty value");
	}
	if (value.length > 64) {
		throw usageError("--run-id must be 64 characters or fewer");
	}
	if (!RUN_ID_PATTERN.test(value)) {
		throw usageError(
			"--run-id may contain only letters, numbers, '.', '_', and '-'",
		);
	}
	return value;
}

function findFirstValidCliRunId(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") return undefined;
		if (arg === "--run-id") {
			const value = argv[index + 1];
			if (value && !value.startsWith("--") && RUN_ID_PATTERN.test(value)) {
				return value;
			}
			continue;
		}
		if (arg.startsWith("--run-id=")) {
			const value = arg.slice("--run-id=".length);
			if (!value.startsWith("--") && RUN_ID_PATTERN.test(value)) {
				return value;
			}
		}
	}
	return undefined;
}

function stripRunIdDiagnosticArgs(argv: readonly string[]): string[] {
	const strippedArgv: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") {
			strippedArgv.push(...argv.slice(index));
			break;
		}
		if (arg === "--run-id") {
			const value = argv[index + 1];
			if (value && !value.startsWith("--")) {
				index += 1;
			}
			continue;
		}
		if (arg.startsWith("--run-id=")) {
			continue;
		}
		strippedArgv.push(arg);
	}
	return strippedArgv;
}

function normalizeCliDiagnosticContext(
	context: CliDiagnosticContext,
): InternalCliDiagnosticContext {
	const run_id =
		typeof context.run_id === "string" && context.run_id.length > 0
			? context.run_id
			: randomUUID();
	const started_at_ms =
		typeof context.started_at_ms === "number"
			? context.started_at_ms
			: Date.now();
	return {
		...context,
		run_id,
		started_at_ms,
		[CLI_DIAGNOSTIC_CONTEXT_ID_PROPERTY]: randomUUID(),
	};
}

function normalizeCategory(category: string | readonly string[]): string[] {
	return typeof category === "string" ? [category] : [...category];
}

function createPostMortemDiagnosticSink(options: {
	writeSerializedRecord: (record: CliDiagnosticSerializableRecord) => void;
	maxBufferSize: number;
	maxContexts: number;
}): Sink {
	type BufferState = {
		records: CliDiagnosticSerializableRecord[];
		droppedRecordCount: number;
	};
	const buffers = new Map<string, BufferState>();
	return (record: LogRecord) => {
		const serialized = serializeCliDiagnosticRecord(record);
		const contextKey = diagnosticBufferContextKey(record, serialized);
		const state = getDiagnosticBufferState(buffers, contextKey, options);

		if (record.level === "error" || record.level === "fatal") {
			if (state.droppedRecordCount > 0) {
				options.writeSerializedRecord(
					createDiagnosticBufferTruncatedRecord(
						serialized,
						state.droppedRecordCount,
					),
				);
			}
			for (const bufferedRecord of state.records) {
				options.writeSerializedRecord(bufferedRecord);
			}
			state.records = [];
			state.droppedRecordCount = 0;
			options.writeSerializedRecord(serialized);
			return;
		}

		if (state.records.length >= options.maxBufferSize) {
			state.records.shift();
			state.droppedRecordCount += 1;
		}
		state.records.push(serialized);
	};
}

function getDiagnosticBufferState(
	buffers: Map<
		string,
		{ records: CliDiagnosticSerializableRecord[]; droppedRecordCount: number }
	>,
	contextKey: string,
	options: { maxContexts: number },
): { records: CliDiagnosticSerializableRecord[]; droppedRecordCount: number } {
	const existing = buffers.get(contextKey);
	if (existing) {
		buffers.delete(contextKey);
		buffers.set(contextKey, existing);
		return existing;
	}
	while (buffers.size >= options.maxContexts) {
		const oldestKey = buffers.keys().next().value;
		if (typeof oldestKey !== "string") break;
		buffers.delete(oldestKey);
	}
	const created = { records: [], droppedRecordCount: 0 };
	buffers.set(contextKey, created);
	return created;
}

function diagnosticBufferContextKey(
	record: LogRecord,
	serialized: CliDiagnosticSerializableRecord,
): string {
	const contextId = (record.properties as Record<string, unknown>)[
		CLI_DIAGNOSTIC_CONTEXT_ID_PROPERTY
	];
	if (typeof contextId === "string" && contextId.length > 0) {
		return contextId;
	}
	return typeof serialized.run_id === "string"
		? serialized.run_id
		: "__default__";
}

function createDiagnosticBufferTruncatedRecord(
	trigger: CliDiagnosticSerializableRecord,
	droppedRecordCount: number,
): CliDiagnosticSerializableRecord {
	return {
		...trigger,
		level: "warning",
		message: "diagnostic-buffer-truncated",
		event: "diagnostic-buffer-truncated",
		buffer_truncated: true,
		buffer_truncation_policy: "oldest_dropped",
		dropped_record_count: droppedRecordCount,
	};
}

function serializeCliDiagnosticRecord(
	record: LogRecord,
): CliDiagnosticSerializableRecord {
	const properties = redactGenericValue(record.properties) as Record<
		string,
		unknown
	>;
	const event =
		typeof properties.event === "string" ? properties.event : undefined;
	const {
		event: _event,
		[CLI_DIAGNOSTIC_CONTEXT_ID_PROPERTY]: _contextId,
		...rest
	} = properties;
	return {
		timestamp: new Date(record.timestamp).toISOString(),
		level: record.level,
		category: record.category,
		message: formatLogTapeMessage(record.message),
		...(event ? { event } : {}),
		...rest,
	};
}

export function redactGenericCliDiagnosticRecord(
	record: CliDiagnosticSerializableRecord,
): CliDiagnosticSerializableRecord {
	return redactGenericValue(record) as CliDiagnosticSerializableRecord;
}

function redactGenericValue(value: unknown, key = ""): unknown {
	if (isSensitiveDiagnosticKey(key)) {
		return "[REDACTED]";
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactGenericValue(entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([entryKey, entryValue]) => [
				entryKey,
				redactGenericValue(entryValue, entryKey),
			]),
		);
	}
	if (typeof value === "string" && looksLikeSecretDiagnosticValue(value)) {
		return "[REDACTED]";
	}
	return value;
}

function isSensitiveDiagnosticKey(key: string): boolean {
	return /(?:token$|(?:^|[-_])token(?:$|[-_])|secret|password|passwd|credential|authorization|api[-_]?key|cookie)/i.test(
		key,
	);
}

function looksLikeSecretDiagnosticValue(value: string): boolean {
	return /^(?:bearer\s+|basic\s+|op:\/\/)/i.test(value);
}

function formatLogTapeMessage(message: readonly unknown[]): string {
	return message
		.map((part) =>
			typeof part === "string"
				? part
				: JSON.stringify(redactGenericValue(part)),
		)
		.join("");
}

function formatHumanCliDiagnosticRecord(
	record: CliDiagnosticSerializableRecord,
): string {
	const {
		timestamp: _timestamp,
		level,
		category,
		message,
		event,
		...properties
	} = record;
	const label = event ?? message;
	const propertySuffix = Object.entries(properties)
		.map(([key, value]) => `${key}=${formatHumanDiagnosticValue(value)}`)
		.join(" ");
	return [level.toUpperCase(), category.join("."), label, propertySuffix]
		.filter(Boolean)
		.join(" ");
}

function formatHumanDiagnosticValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value);
}
