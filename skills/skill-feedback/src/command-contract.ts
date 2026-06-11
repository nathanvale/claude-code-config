import {
	type CommandFacadeContract,
	defineCommandFacadeContract,
} from "@side-quest/cli-command-facade";

/**
 * Stable result contract identity for skill-feedback record envelopes.
 *
 * Agents use this to distinguish a Software Learning Report from raw receipts.
 */
export const SKILL_FEEDBACK_CONTRACT_ID = "skill-feedback.record" as const;

/**
 * Schema version for the package-owned Software Learning Report envelope.
 *
 * Increment when agent-visible record semantics change.
 */
export const SKILL_FEEDBACK_SCHEMA_VERSION = "1" as const;

/**
 * Evaluation name carried on every record, aligning with the OpenTelemetry
 * GenAI `gen_ai.evaluation.result` event family (name/label/explanation).
 */
const SKILL_FEEDBACK_EVALUATION_NAME = "skill-feedback" as const;

/**
 * Domain outcome enum carried inside the envelope `data` (mirrors fallow's
 * `FALLOW_STATUS_VALUES`). Never forked off `StructuredRuntimeError`: the
 * outcome is a property of the record, not of a failure.
 */
export const SKILL_FEEDBACK_OUTCOMES = [
	"confirmed",
	"failed",
	"ambiguous",
] as const;

/**
 * Skill-run outcome union (== success-verify three-way outcome).
 */
export type SkillFeedbackOutcome = (typeof SKILL_FEEDBACK_OUTCOMES)[number];

/**
 * The single trust-boundary constant. These are the only receipt fields an
 * agent authors as free text, and therefore the only fields the redactor (U6)
 * scrubs. Everything not in this set is adapter-derived, engine-read telemetry
 * that is trusted and never redacted — which makes "telemetry untouched,
 * narration redacted" a unit-testable invariant.
 *
 * SECURITY (KTD2a): a field is only safe to skip redaction when its value
 * cannot be agent-authored. `model`, `git_sha`, and `skill_version` are read
 * inside the engine (model from adapter telemetry; git_sha/skill_version from
 * the repo) and are NEVER accepted as CLI flags. There is deliberately no
 * `--model` / `--git-sha` / `--skill-version` flag, so an agent cannot smuggle
 * a secret into a "trusted" field to dodge the redactor. The only
 * flag-supplied values are exactly these redaction-gated narrated fields.
 */
export const NARRATED_FIELDS = ["goal", "friction", "explanation"] as const;

/**
 * Narrated (redaction-gated) field union.
 */
export type NarratedField = (typeof NARRATED_FIELDS)[number];

/**
 * Adapter-derived telemetry usage tokens (passed through untouched).
 */
export type ReceiptUsage = {
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
};

/**
 * The flat v0 receipt — one object, not a nested `{ telemetry, narrated }`
 * shape (KTD2a). Mirrors `RunOutcome` in
 * `prototypes/browser-use-uplift/metrics-telemetry/telemetry.ts`: flat record,
 * passed-in timestamp, three-way outcome.
 *
 * Required narrated fields are `goal` and `friction`; `explanation` is the
 * optional narrated field. Telemetry tags (`skill_version`, `git_sha`,
 * `model`, `usage`) are adapter/engine-read, never flag-supplied.
 * `generated_ts` is a passed-in ISO string, never an ambient-clock read (KTD5).
 */
export type Receipt = {
	skill: string;
	goal: string;
	outcome: SkillFeedbackOutcome;
	friction: string;
	explanation?: string;
	skill_version: string;
	git_sha: string;
	model: string;
	usage: ReceiptUsage;
	generated_ts: string;
};

/**
 * Every receipt key, in declaration order. The parser rejects any key not in
 * this allow-list rather than silently dropping it (storage-routing rule,
 * KTD8) — fail loud, not fail quiet.
 */
export const RECEIPT_FIELDS = [
	"skill",
	"goal",
	"outcome",
	"friction",
	"explanation",
	"skill_version",
	"git_sha",
	"model",
	"usage",
	"generated_ts",
] as const;

/**
 * Receipt field union.
 */
export type ReceiptField = (typeof RECEIPT_FIELDS)[number];

/**
 * Receipt fields that must be present for a non-degraded record. The optional
 * `explanation` is intentionally absent. Engine-read telemetry tags remain
 * required for a complete record; missing tags degrade instead of blocking.
 */
const REQUIRED_RECEIPT_FIELDS = [
	"skill",
	"goal",
	"outcome",
	"friction",
	"skill_version",
	"git_sha",
	"model",
	"usage",
	"generated_ts",
] as const;

/**
 * The Software Learning Report — one flat record destined for the success
 * envelope's `data`. Shaped like a `gen_ai.evaluation.result` event
 * (name/label/explanation) plus warehouse tags (skill version, git SHA, model,
 * usage). The outcome enum lives here, inside `data`, never on the error.
 */
export type SoftwareLearningReport = {
	/** Evaluation family name; always {@link SKILL_FEEDBACK_EVALUATION_NAME}. */
	evaluation_name: typeof SKILL_FEEDBACK_EVALUATION_NAME;
	/** R18a machine-readable marker: record text is untrusted evidence. */
	untrusted_evidence: true;
	/** Passed-in ISO timestamp (KTD5); never an ambient-clock read. */
	generated_ts: string;
	skill: string;
	skill_version: string;
	git_sha: string;
	model: string;
	/** Domain outcome enum, carried inside the record (not on the error). */
	outcome: SkillFeedbackOutcome;
	goal: string;
	friction: string;
	explanation: string | null;
	usage: ReceiptUsage;
	/** R21: true when one or more required receipt fields were missing. */
	degraded: boolean;
	/** R6: required receipt fields that were missing, listed explicitly. */
	gaps: readonly ReceiptField[];
	/**
	 * R21: count of redactions applied to narrated fields. U2 emits 0 — U6
	 * owns redaction and writes the real count. Carried in the shape now so the
	 * record contract is stable.
	 */
	redactions: number;
};

/**
 * Outcome of parsing an untrusted receipt object into a typed receipt.
 *
 * A discriminated union, not exceptions-as-control-flow: `unknown-field` and
 * `invalid` are the fail-loud cases (storage-routing reject), while `ok` and
 * `degraded` both carry a usable partial receipt. `degraded` lists the missing
 * required fields as `gaps` (R6) so the absence is visible, never defaulted.
 */
export type ParseReceiptResult =
	| { kind: "ok"; fields: Partial<Receipt> }
	| {
			kind: "degraded";
			fields: Partial<Receipt>;
			gaps: readonly ReceiptField[];
	  }
	| { kind: "unknown-field"; field: string }
	| { kind: "invalid"; field: ReceiptField; reason: string };

const RECEIPT_FIELD_SET: ReadonlySet<string> = new Set(RECEIPT_FIELDS);
const RECEIPT_USAGE_FIELDS = [
	"input_tokens",
	"output_tokens",
	"cache_read_tokens",
] as const;
const RECEIPT_USAGE_FIELD_SET: ReadonlySet<string> = new Set(
	RECEIPT_USAGE_FIELDS,
);

function isReceiptUsage(value: unknown): value is ReceiptUsage {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const usage = value as Record<string, unknown>;
	const keys = Object.keys(usage);
	return (
		keys.length === RECEIPT_USAGE_FIELDS.length &&
		keys.every((key) => RECEIPT_USAGE_FIELD_SET.has(key)) &&
		typeof usage.input_tokens === "number" &&
		typeof usage.output_tokens === "number" &&
		typeof usage.cache_read_tokens === "number"
	);
}

/**
 * Parse an untrusted receipt object into typed fields.
 *
 * Fail loud on any key outside {@link RECEIPT_FIELDS} (`unknown-field`) and on
 * a present-but-wrong-typed field (`invalid`). Missing required fields are not
 * an error — they yield `degraded` with the gap list (R6). No redaction or
 * writing happens here (U6 owns that); this is schema validation only.
 *
 * Deterministic: the same input object always yields the same result. No
 * module-level cached state is read (KTD5).
 *
 * @example
 * ```typescript
 * const result = parseReceipt({ skill: "fallow", goal: "x", outcome: "confirmed", ... })
 * if (result.kind === "ok") { useReceipt(result.fields) }
 * ```
 */
export function parseReceipt(raw: unknown): ParseReceiptResult {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { kind: "invalid", field: "skill", reason: "receipt is not an object" };
	}
	const input = raw as Record<string, unknown>;

	for (const key of Object.keys(input)) {
		if (!RECEIPT_FIELD_SET.has(key)) {
			return { kind: "unknown-field", field: key };
		}
	}

	const fields: Partial<Receipt> = {};

	if ("skill" in input) {
		if (typeof input.skill !== "string") {
			return { kind: "invalid", field: "skill", reason: "expected string" };
		}
		fields.skill = input.skill;
	}
	if ("goal" in input) {
		if (typeof input.goal !== "string") {
			return { kind: "invalid", field: "goal", reason: "expected string" };
		}
		fields.goal = input.goal;
	}
	if ("outcome" in input) {
		if (!SKILL_FEEDBACK_OUTCOMES.includes(input.outcome as SkillFeedbackOutcome)) {
			return {
				kind: "invalid",
				field: "outcome",
				reason: `expected one of ${SKILL_FEEDBACK_OUTCOMES.join(", ")}`,
			};
		}
		fields.outcome = input.outcome as SkillFeedbackOutcome;
	}
	if ("friction" in input) {
		if (typeof input.friction !== "string") {
			return { kind: "invalid", field: "friction", reason: "expected string" };
		}
		fields.friction = input.friction;
	}
	if ("explanation" in input) {
		if (typeof input.explanation !== "string") {
			return {
				kind: "invalid",
				field: "explanation",
				reason: "expected string",
			};
		}
		fields.explanation = input.explanation;
	}
	if ("skill_version" in input) {
		if (typeof input.skill_version !== "string") {
			return {
				kind: "invalid",
				field: "skill_version",
				reason: "expected string",
			};
		}
		fields.skill_version = input.skill_version;
	}
	if ("git_sha" in input) {
		if (typeof input.git_sha !== "string") {
			return { kind: "invalid", field: "git_sha", reason: "expected string" };
		}
		fields.git_sha = input.git_sha;
	}
	if ("model" in input) {
		if (typeof input.model !== "string") {
			return { kind: "invalid", field: "model", reason: "expected string" };
		}
		fields.model = input.model;
	}
	if ("usage" in input) {
		if (!isReceiptUsage(input.usage)) {
			return {
				kind: "invalid",
				field: "usage",
				reason: "expected { input_tokens, output_tokens, cache_read_tokens }",
			};
		}
		fields.usage = input.usage;
	}
	if ("generated_ts" in input) {
		if (typeof input.generated_ts !== "string") {
			return {
				kind: "invalid",
				field: "generated_ts",
				reason: "expected ISO string",
			};
		}
		fields.generated_ts = input.generated_ts;
	}

	const gaps = REQUIRED_RECEIPT_FIELDS.filter(
		(field) => !(field in fields),
	);
	if (gaps.length > 0) {
		return { kind: "degraded", fields, gaps };
	}
	return { kind: "ok", fields };
}

/**
 * Build a Software Learning Report from parsed receipt fields.
 *
 * Pure and deterministic: identical input fields produce a byte-identical
 * record, including `generated_ts` (passed-in, never clock-read — KTD5). The
 * `untrusted_evidence` marker (R18a) is always `true`. `redactions` is `0`
 * here — U6 owns redaction and overwrites the count on the write path. Missing
 * required fields become explicit `gaps` and flip `degraded` (R6/R21), never
 * silent defaults; missing optional `explanation` becomes `null`.
 *
 * @example
 * ```typescript
 * const parsed = parseReceipt(raw)
 * if (parsed.kind === "ok" || parsed.kind === "degraded") {
 *   const report = buildSoftwareLearningReport(parsed)
 * }
 * ```
 */
export function buildSoftwareLearningReport(
	parsed: Extract<ParseReceiptResult, { kind: "ok" | "degraded" }>,
): SoftwareLearningReport {
	const { fields } = parsed;
	const gaps = parsed.kind === "degraded" ? parsed.gaps : [];
	return {
		evaluation_name: SKILL_FEEDBACK_EVALUATION_NAME,
		untrusted_evidence: true,
		generated_ts: fields.generated_ts ?? "",
		skill: fields.skill ?? "",
		skill_version: fields.skill_version ?? "",
		git_sha: fields.git_sha ?? "",
		model: fields.model ?? "",
		outcome: fields.outcome ?? "ambiguous",
		goal: fields.goal ?? "",
		friction: fields.friction ?? "",
		explanation: fields.explanation ?? null,
		usage: fields.usage ?? {
			input_tokens: 0,
			output_tokens: 0,
			cache_read_tokens: 0,
		},
		degraded: gaps.length > 0,
		gaps,
		redactions: 0,
	};
}

/**
 * Public subcommands accepted by skill-feedback. v0 ships one: `record`.
 */
const SKILL_FEEDBACK_COMMANDS = ["record"] as const;

/**
 * Public command union for the facade-backed skill-feedback CLI.
 */
export type SkillFeedbackCommand = (typeof SKILL_FEEDBACK_COMMANDS)[number];

type SkillFeedbackAudience = "agent";
type SkillFeedbackMutation = "capture";
type SkillFeedbackCommandContract = CommandFacadeContract<
	SkillFeedbackCommand,
	SkillFeedbackAudience,
	SkillFeedbackMutation
>;

/**
 * Flags for `record`.
 *
 * SECURITY (KTD2a): only the redaction-gated narrated fields and the
 * non-secret identity/timestamp inputs are flags. The trusted telemetry tags
 * `model`, `git_sha`, and `skill_version` are ENGINE-READ — there is
 * deliberately no `--model` / `--git-sha` / `--skill-version` flag, so an agent
 * cannot route a secret through a field the redactor skips.
 */
const recordFlags = {
	"--skill": {
		type: "string",
		required: true,
		description: "Skill identity the receipt describes.",
	},
	"--goal": {
		type: "string",
		required: true,
		description: "Narrated free-text run goal (redaction-gated).",
	},
	"--outcome": {
		type: "enum",
		values: SKILL_FEEDBACK_OUTCOMES,
		required: true,
		description: "Run outcome: confirmed, failed, or ambiguous.",
	},
	"--friction": {
		type: "string",
		required: true,
		description: "Narrated free-text friction note (redaction-gated).",
	},
	"--explanation": {
		type: "string",
		description: "Optional narrated free-text explanation (redaction-gated).",
	},
	"--generated-ts": {
		type: "string",
		required: true,
		description: "Passed-in ISO timestamp; never an ambient-clock read.",
	},
} as const satisfies SkillFeedbackCommandContract["flags"];

const resultContract = {
	id: SKILL_FEEDBACK_CONTRACT_ID,
	kind: "Software Learning Report record envelope.",
	schema_version: SKILL_FEEDBACK_SCHEMA_VERSION,
} as const satisfies NonNullable<
	SkillFeedbackCommandContract["resultContract"]
>;

const exitCodes = {
	"0": "Record captured (possibly degraded) and written.",
	"1": "Capture blocked before any write (gate refused or unsafe input).",
	"2": "Invalid record usage.",
} as const satisfies SkillFeedbackCommandContract["exitCodes"];

/**
 * Facade-backed command metadata for the skill-feedback CLI.
 */
export const skillFeedbackContracts = defineCommandFacadeContract(
	{
		record: {
			script: "skill-feedback-runner",
			summary: "Capture one Software Learning Report from a skill-run receipt.",
			usage: [
				"record --skill <id> --goal <text> --outcome <confirmed|failed|ambiguous> --friction <text> --generated-ts <iso> [--explanation <text>]",
			],
			json: true,
			audience: "agent",
			mutation: "capture",
			sideEffects: ["write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Capture is the terminal write; a dry-run record would duplicate the inbox semantics it gates.",
			},
			outputModes: ["json"],
			interactivity: "none",
			resultContract,
			flags: recordFlags,
			exitCodes,
		},
	} as const satisfies Record<
		SkillFeedbackCommand,
		SkillFeedbackCommandContract
	>,
	{
		path: "skills/skill-feedback/src/command-contract.ts",
		writeImplyingMutations: new Set(["capture"]),
	},
);
