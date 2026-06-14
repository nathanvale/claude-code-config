import {
	NARRATED_FIELDS,
	type ReportCardSoftwareLearningReport,
	type SoftwareLearningReport,
} from "./command-contract";

export type RedactionResult<T> = {
	value: T;
	redactions: number;
};

const REDACTION = "[redacted]";
const URL_REDACTION = "[redacted-url]";

type RedactionPattern = {
	pattern: RegExp;
	replacement: string | ((match: string, ...groups: string[]) => string);
};

const SECRET_PATTERNS: readonly RedactionPattern[] = [
	{
		pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
		replacement: `Bearer ${REDACTION}`,
	},
	{
		pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
		replacement: REDACTION,
	},
	{
		pattern:
			/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		replacement: REDACTION,
	},
	{
		pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
		replacement: (_match, scheme: string) => `${scheme}[redacted-credentials]@`,
	},
	{
		pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
		replacement: REDACTION,
	},
	{
		pattern: /\bghp_[A-Za-z0-9_]{20,}\b/g,
		replacement: REDACTION,
	},
	{
		pattern: /\bxox[bapr]-[A-Za-z0-9-]{16,}\b/g,
		replacement: REDACTION,
	},
	{
		pattern: /\bAKIA[0-9A-Z]{16}\b/g,
		replacement: REDACTION,
	},
	{
		pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
		replacement: REDACTION,
	},
	{
		pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
		replacement: REDACTION,
	},
];

/**
 * Redact agent-authored narration plus public stdin telemetry that can carry
 * arbitrary strings before the report reaches disk.
 */
export function redactSoftwareLearningReport(
	report: SoftwareLearningReport,
): RedactionResult<SoftwareLearningReport> {
	let redactions = 0;
	const redacted: SoftwareLearningReport = { ...report };
	for (const field of NARRATED_FIELDS) {
		const value = redacted[field];
		if (typeof value !== "string") continue;
		const result = redactText(value);
		assignNarratedReportField(redacted, field, result.value);
		redactions += result.redactions;
	}
	const model = redactText(redacted.model);
	redacted.model = model.value;
	redactions += model.redactions;
	redacted.redactions = redactions;
	return { value: redacted, redactions };
}

export function redactReportCardSoftwareLearningReport(
	report: ReportCardSoftwareLearningReport,
): RedactionResult<ReportCardSoftwareLearningReport> {
	let redactions = 0;
	const redacted = structuredClone(report) as ReportCardSoftwareLearningReport;
	const reportCard = redacted.report_card;

	for (const apply of [
		() => redactOptionalString(reportCard.goal, (value) => {
			reportCard.goal = value;
		}),
		() =>
			redactOptionalString(reportCard.friction?.note, (value) => {
				if (reportCard.friction) reportCard.friction.note = value;
			}),
		() =>
			redactOptionalString(reportCard.verification_burden?.note, (value) => {
				if (reportCard.verification_burden) {
					reportCard.verification_burden.note = value;
				}
			}),
	]) {
		const result = apply();
		redactions += result.redactions;
	}

	for (const target of reportCard.touched_surfaces ?? []) {
		const result = redactText(target.value);
		target.value = result.value;
		redactions += result.redactions;
	}

	for (const observation of reportCard.observations ?? []) {
		if (observation.target) {
			const result = redactText(observation.target.value);
			observation.target.value = result.value;
			redactions += result.redactions;
		}
		const summary = redactText(observation.summary);
		observation.summary = summary.value;
		redactions += summary.redactions;
	}

	return { value: redacted, redactions };
}

function redactOptionalString(
	value: string | undefined,
	assign: (value: string) => void,
): RedactionResult<string> {
	if (value === undefined) return { value: "", redactions: 0 };
	const result = redactText(value);
	assign(result.value);
	return result;
}

function assignNarratedReportField(
	report: SoftwareLearningReport,
	field: (typeof NARRATED_FIELDS)[number],
	value: string,
): void {
	switch (field) {
		case "goal":
			report.goal = value;
			return;
		case "friction":
			report.friction = value;
			return;
		case "explanation":
			report.explanation = value;
			return;
	}
}

function redactText(input: string): RedactionResult<string> {
	let value = input;
	let redactions = 0;

	for (const { pattern, replacement } of SECRET_PATTERNS) {
		value = value.replace(pattern, (match: string, ...args: unknown[]) => {
			redactions += 1;
			if (typeof replacement !== "function") {
				return replacement;
			}
			const groups = args.filter(
				(arg): arg is string => typeof arg === "string",
			);
			return replacement(match, ...groups);
		});
	}

	value = redactAuthUrls(value, (count) => {
		redactions += count;
	});
	return { value, redactions };
}

function redactAuthUrls(
	input: string,
	countRedactions: (count: number) => void,
): string {
	return input.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (rawUrl) => {
		const protocol = rawUrl.slice(0, rawUrl.indexOf(":")).toLowerCase();
		if (protocol !== "http" && protocol !== "https") {
			if (rawUrl.includes("[redacted-credentials]@")) {
				return rawUrl;
			}
			countRedactions(1);
			return URL_REDACTION;
		}

		let parsed: URL;
		try {
			parsed = new URL(rawUrl);
		} catch {
			return rawUrl;
		}

		let changed = false;
		for (const key of [...parsed.searchParams.keys()]) {
			if (isSensitiveQueryKey(key)) {
				parsed.searchParams.delete(key);
				changed = true;
			}
		}
		if (parsed.hash !== "") {
			parsed.hash = "";
			changed = true;
		}
		if (changed) {
			countRedactions(1);
		}
		return parsed.toString();
	});
}

function isSensitiveQueryKey(key: string): boolean {
	return /token|secret|auth|api[-_]?key|credential|password|passwd/i.test(key);
}
