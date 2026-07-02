// fallow-ignore-file unused-file
// Public capture adapter seam; hooks and fixture tests consume this entrypoint.
import {
	type Receipt,
	type ReceiptField,
	type ReceiptUsage,
	SKILL_FEEDBACK_OUTCOMES,
	type SkillFeedbackOutcome,
	parseReceipt,
} from "./command-contract";

// v0 fixture-tests this seam. Live hooks call `record` directly until their
// harness exposes enough telemetry to build a Receipt without agent recall.
const HARNESS_IDS = ["claude-otel", "codex-json"] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

export type CaptureAdapterRuntime = {
	readGitSha: () => Promise<string>;
	readSkillVersion: (skill: string) => Promise<string>;
};

export type DegradedReason = {
	field: ReceiptField;
	code: string;
	message: string;
	harness: HarnessId;
};

export type CaptureResult =
	| { kind: "receipt"; receipt: Receipt }
	| {
			kind: "degraded";
			receipt: Partial<Receipt>;
			degraded: readonly DegradedReason[];
	  };

export type CaptureAdapter<TRaw = unknown> = {
	harness: HarnessId;
	capture(raw: TRaw): Promise<CaptureResult>;
};

type JsonObject = Record<string, unknown>;

type ClaudeOtelSpan = {
	name?: unknown;
	attributes?: unknown;
	children?: unknown;
};

const CLAUDE_INPUT_TOKEN_KEYS = [
	"input_tokens",
	"gen_ai.usage.input_tokens",
	"llm.usage.input_tokens",
] as const;
const CLAUDE_OUTPUT_TOKEN_KEYS = [
	"output_tokens",
	"gen_ai.usage.output_tokens",
	"llm.usage.output_tokens",
] as const;
const CLAUDE_CACHE_TOKEN_KEYS = [
	"cache_read_tokens",
	"cache_read_input_tokens",
	"gen_ai.usage.cache_read_tokens",
] as const;
const MODEL_KEYS = [
	"model",
	"gen_ai.request.model",
	"gen_ai.response.model",
] as const;
const GENERATED_TS_KEYS = [
	"generated_ts",
	"skill_feedback.generated_ts",
	"timestamp",
] as const;

// Public adapter seam; live hooks call record directly until telemetry is trusted.
// fallow-ignore-next-line unused-export
export class ClaudeOtelAdapter implements CaptureAdapter {
	readonly harness = "claude-otel" as const;

	constructor(private readonly runtime: CaptureAdapterRuntime) {}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
	async capture(raw: unknown): Promise<CaptureResult> {
		const spans = flattenClaudeSpans(readClaudeSpans(raw));
		const interaction =
			spans.find((span) => span.name === "claude_code.interaction") ?? spans[0];
		const llmSpans = spans.filter(
			(span) => span.name === "claude_code.llm_request",
		);
		const reasons: DegradedReason[] = [];
		const receipt: Partial<Receipt> = {};

		copyCommonReceiptFields(
			receipt,
			objectFrom(interaction?.attributes) ?? objectFrom(raw),
		);
		receipt.outcome = readClaudeOutcome(interaction?.attributes);
		assignString(
			receipt,
			"model",
			firstStringFromObjects([interaction, ...llmSpans], MODEL_KEYS),
		);
		assignString(
			receipt,
			"generated_ts",
			receipt.generated_ts ??
				firstStringFromObjects([interaction, ...llmSpans], GENERATED_TS_KEYS),
		);

		const usage = readClaudeUsage(llmSpans);
		if (usage) {
			receipt.usage = usage;
		} else {
			reasons.push(
				degradedReason(
					this.harness,
					"usage",
					"missing-usage",
					"Claude OTel spans did not include a complete token usage set.",
				),
			);
		}

		if (!receipt.model) {
			reasons.push(
				degradedReason(
					this.harness,
					"model",
					"missing-model",
					"Claude OTel spans did not include a model identifier.",
				),
			);
		}

		await attachEngineFields(this.runtime, this.harness, receipt, reasons);
		return finalizeCapture(this.harness, receipt, reasons);
	}
}

// Public adapter seam; live hooks call record directly until telemetry is trusted.
// fallow-ignore-next-line unused-export
export class CodexJsonAdapter implements CaptureAdapter {
	readonly harness = "codex-json" as const;

	constructor(private readonly runtime: CaptureAdapterRuntime) {}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
	async capture(raw: unknown): Promise<CaptureResult> {
		const events = readCodexEvents(raw);
		const terminalEvent =
			events.find((event) => eventType(event) === "turn.failed") ??
			events.find((event) => eventType(event) === "turn.completed");
		const completedEvent = events.find(
			(event) => eventType(event) === "turn.completed",
		);
		const failedEvent = events.find((event) => eventType(event) === "turn.failed");
		const reasons: DegradedReason[] = [];
		const receipt: Partial<Receipt> = {};

		copyCommonReceiptFields(receipt, objectFrom(raw));
		receipt.outcome = failedEvent
			? "failed"
			: completedEvent
				? "confirmed"
				: "ambiguous";
		assignString(
			receipt,
			"model",
			firstStringFromObjects([terminalEvent, completedEvent, failedEvent], [
				"model",
				"payload.model",
				"data.model",
			]) ?? receipt.model,
		);

		const usage =
			readCodexUsage(terminalEvent) ??
			readCodexUsage(completedEvent) ??
			readCodexUsage(failedEvent);
		if (usage) {
			receipt.usage = usage;
		} else {
			reasons.push(
				degradedReason(
					this.harness,
					"usage",
					"missing-usage",
					"Codex JSON events did not include a complete Usage object.",
				),
			);
		}

		if (!terminalEvent) {
			reasons.push(
				degradedReason(
					this.harness,
					"outcome",
					"missing-terminal-event",
					"Codex JSON event stream did not include turn.completed or turn.failed.",
				),
			);
		}
		if (!receipt.model) {
			reasons.push(
				degradedReason(
					this.harness,
					"model",
					"missing-model",
					"Codex JSON events did not include a model identifier.",
				),
			);
		}

		await attachEngineFields(this.runtime, this.harness, receipt, reasons);
		return finalizeCapture(this.harness, receipt, reasons);
	}
}

// Public adapter seam; Fallow cannot see harness selection consumers.
// fallow-ignore-next-line unused-export
export function selectAdapter(
	harness: HarnessId,
	runtime: CaptureAdapterRuntime,
): CaptureAdapter {
	switch (harness) {
		case "claude-otel":
			return new ClaudeOtelAdapter(runtime);
		case "codex-json":
			return new CodexJsonAdapter(runtime);
		default:
			return assertNever(harness);
	}
}

// Public adapter seam; Fallow cannot see harness validation consumers.
// fallow-ignore-next-line unused-export
export function assertHarnessId(value: string): asserts value is HarnessId {
	if (!(HARNESS_IDS as readonly string[]).includes(value)) {
		throw new Error(`Unknown skill-feedback harness: ${value}`);
	}
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function readClaudeSpans(raw: unknown): ClaudeOtelSpan[] {
	if (Array.isArray(raw)) {
		return raw.filter(isObject);
	}
	const object = objectFrom(raw);
	const spans = arrayFrom(object?.spans);
	if (spans) {
		return spans.filter(isObject);
	}
	return object ? [object] : [];
}

function flattenClaudeSpans(spans: readonly ClaudeOtelSpan[]): JsonObject[] {
	const flattened: JsonObject[] = [];
	for (const span of spans) {
		const object = objectFrom(span);
		if (!object) continue;
		flattened.push(object);
		const children = arrayFrom(span.children);
		if (children) {
			flattened.push(...flattenClaudeSpans(children.filter(isObject)));
		}
	}
	return flattened;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function readClaudeOutcome(attributes: unknown): SkillFeedbackOutcome {
	const outcome = stringFrom(objectFrom(attributes)?.outcome);
	if (isSkillFeedbackOutcome(outcome)) {
		return outcome;
	}
	const success = objectFrom(attributes)?.success;
	if (success === true) return "confirmed";
	if (success === false) return "failed";
	return "ambiguous";
}

function readClaudeUsage(spans: readonly JsonObject[]): ReceiptUsage | undefined {
	const inputTokens = sumNumberAttrs(spans, CLAUDE_INPUT_TOKEN_KEYS);
	const outputTokens = sumNumberAttrs(spans, CLAUDE_OUTPUT_TOKEN_KEYS);
	const cacheReadTokens = sumNumberAttrs(spans, CLAUDE_CACHE_TOKEN_KEYS);
	if (
		inputTokens === undefined ||
		outputTokens === undefined ||
		cacheReadTokens === undefined
	) {
		return undefined;
	}
	return {
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		cache_read_tokens: cacheReadTokens,
	};
}

function readCodexEvents(raw: unknown): JsonObject[] {
	if (Array.isArray(raw)) {
		return raw.filter(isObject);
	}
	const object = objectFrom(raw);
	const events = arrayFrom(object?.events);
	return events?.filter(isObject) ?? [];
}

function eventType(event: JsonObject): string | undefined {
	return stringFrom(event.type) ?? stringFrom(event.event) ?? stringFrom(event.kind);
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function readCodexUsage(event: JsonObject | undefined): ReceiptUsage | undefined {
	if (!event) return undefined;
	const usage =
		objectFrom(event.usage) ??
		objectFrom(objectFrom(event.payload)?.usage) ??
		objectFrom(objectFrom(event.data)?.usage);
	const inputTokens = numberFrom(usage?.input_tokens);
	const outputTokens = numberFrom(usage?.output_tokens);
	const reasoningOutputTokens = numberFrom(usage?.reasoning_output_tokens) ?? 0;
	const cacheReadTokens = numberFrom(usage?.cached_input_tokens);
	if (
		inputTokens === undefined ||
		outputTokens === undefined ||
		cacheReadTokens === undefined
	) {
		return undefined;
	}
	return {
		input_tokens: inputTokens,
		output_tokens: outputTokens + reasoningOutputTokens,
		cache_read_tokens: cacheReadTokens,
	};
}

function copyCommonReceiptFields(
	receipt: Partial<Receipt>,
	source: JsonObject | undefined,
): void {
	if (!source) return;
	const context = objectFrom(source.context);
	const attributes = objectFrom(source.attributes);
	const candidates = [source, context, attributes];
	assignString(
		receipt,
		"skill",
		firstStringFromObjects(candidates, ["skill", "skill.name"]),
	);
	assignString(
		receipt,
		"goal",
		firstStringFromObjects(candidates, ["goal", "skill_feedback.goal"]),
	);
	assignString(
		receipt,
		"friction",
		firstStringFromObjects(candidates, [
			"friction",
			"skill_feedback.friction",
		]),
	);
	assignString(
		receipt,
		"explanation",
		firstStringFromObjects(candidates, [
			"explanation",
			"skill_feedback.explanation",
		]),
	);
	assignString(
		receipt,
		"generated_ts",
		firstStringFromObjects(candidates, GENERATED_TS_KEYS),
	);
}

function assignString<K extends keyof Receipt>(
	receipt: Partial<Receipt>,
	key: K,
	value: Receipt[K] | undefined,
): void {
	if (typeof value === "string" && value !== "") {
		receipt[key] = value;
	}
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
async function attachEngineFields(
	runtime: CaptureAdapterRuntime,
	harness: HarnessId,
	receipt: Partial<Receipt>,
	reasons: DegradedReason[],
): Promise<void> {
	try {
		const gitSha = await runtime.readGitSha();
		if (gitSha) {
			receipt.git_sha = gitSha;
		} else {
			reasons.push(
				degradedReason(
					harness,
					"git_sha",
					"missing-git-sha",
					"Runtime did not return a git SHA.",
				),
			);
		}
	} catch {
		reasons.push(
			degradedReason(
				harness,
				"git_sha",
				"git-sha-unavailable",
				"Runtime could not read the git SHA.",
			),
		);
	}

	if (!receipt.skill) {
		reasons.push(
			degradedReason(
				harness,
				"skill_version",
				"missing-skill-version",
				"Runtime could not read a skill version without a skill identity.",
			),
		);
		return;
	}

	try {
		const skillVersion = await runtime.readSkillVersion(receipt.skill);
		if (skillVersion) {
			receipt.skill_version = skillVersion;
		} else {
			reasons.push(
				degradedReason(
					harness,
					"skill_version",
					"missing-skill-version",
					"Runtime did not return a skill version.",
				),
			);
		}
	} catch {
		reasons.push(
			degradedReason(
				harness,
				"skill_version",
				"skill-version-unavailable",
				"Runtime could not read the skill version.",
			),
		);
	}
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function finalizeCapture(
	harness: HarnessId,
	receipt: Partial<Receipt>,
	reasons: readonly DegradedReason[],
): CaptureResult {
	const parsed = parseReceipt(receipt);
	const schemaReasons = schemaDegradedReasons(harness, parsed);
	const degraded = dedupeReasons([...reasons, ...schemaReasons]);
	const parsedReceipt =
		parsed.kind === "ok" || parsed.kind === "degraded"
			? parsed.fields
			: receipt;

	if (parsed.kind === "ok" && degraded.length === 0) {
		return { kind: "receipt", receipt: parsed.fields as Receipt };
	}
	return {
		kind: "degraded",
		receipt: parsedReceipt,
		degraded,
	};
}

function schemaDegradedReasons(
	harness: HarnessId,
	parsed: ReturnType<typeof parseReceipt>,
): DegradedReason[] {
	if (parsed.kind === "degraded") {
		return parsed.gaps.map((field) =>
			degradedReason(
				harness,
				field,
				"missing-field",
				`Capture result is missing receipt field ${field}.`,
			),
		);
	}
	if (parsed.kind === "invalid") {
		return [
			degradedReason(
				harness,
				parsed.field,
				"invalid-field",
				`Capture result has invalid receipt field ${parsed.field}: ${parsed.reason}.`,
			),
		];
	}
	if (parsed.kind === "unknown-field") {
		return [
			degradedReason(
				harness,
				"skill",
				"unknown-field",
				`Capture result contained unknown field ${parsed.field}.`,
			),
		];
	}
	return [];
}

function degradedReason(
	harness: HarnessId,
	field: ReceiptField,
	code: string,
	message: string,
): DegradedReason {
	return { field, code, message, harness };
}

function dedupeReasons(reasons: readonly DegradedReason[]): DegradedReason[] {
	const seen = new Set<string>();
	const deduped: DegradedReason[] = [];
	for (const reason of reasons) {
		const key = `${reason.field}:${reason.code}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(reason);
	}
	return deduped;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function firstStringFromObjects(
	objects: readonly (JsonObject | undefined)[],
	keys: readonly string[],
): string | undefined {
	for (const object of objects) {
		const attributes = objectFrom(object?.attributes);
		const source =
			attributes && Object.keys(attributes).length > 0 ? attributes : object;
		for (const key of keys) {
			const value = stringFrom(readPath(source, key));
			if (value) return value;
		}
	}
	return undefined;
}

// Covered by package tests; keep owner-local safety branches explicit.
// fallow-ignore-next-line complexity
function sumNumberAttrs(
	spans: readonly JsonObject[],
	keys: readonly string[],
): number | undefined {
	let total = 0;
	let found = false;
	for (const span of spans) {
		const attributes = objectFrom(span.attributes) ?? span;
		for (const key of keys) {
			const value = numberFrom(readPath(attributes, key));
			if (value !== undefined) {
				total += value;
				found = true;
				break;
			}
		}
	}
	return found ? total : undefined;
}

function readPath(source: JsonObject | undefined, path: string): unknown {
	if (!source) return undefined;
	const direct = source[path];
	if (direct !== undefined) return direct;
	return path
		.split(".")
		.reduce<unknown>(
			(value, key) => (isObject(value) ? value[key] : undefined),
			source,
		);
}

function objectFrom(value: unknown): JsonObject | undefined {
	return isObject(value) ? value : undefined;
}

function arrayFrom(value: unknown): unknown[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringFrom(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isSkillFeedbackOutcome(
	value: string | undefined,
): value is SkillFeedbackOutcome {
	return (
		value !== undefined &&
		(SKILL_FEEDBACK_OUTCOMES as readonly string[]).includes(value)
	);
}

function assertNever(value: never): never {
	throw new Error(`Unknown skill-feedback harness: ${String(value)}`);
}
