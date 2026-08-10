import type { ReceiptResultSummary } from "./model.ts";
import { fingerprintValue } from "./pre-image.ts";
import type { ProviderResultClassification } from "./result-classifier.ts";

const SENSITIVE_KEY =
	/(?:^|[_-])(?:api[_-]?key|secret|token|password|passwd|credential|authorization|cookie|session|tenant|account|payment|scope|local[_-]?path|command[_-]?example|browser[_-]?debugger)(?:$|[_-])/i;
const SENSITIVE_VALUE =
	/(?:^|[\s?&#,;{])(?:api[_-]?key|secret|token|password|passwd|credential|authorization|cookie|session(?:id)?|access[_-]?token|refresh[_-]?token)\s*[:=]/i;

export function redactValue(value: unknown, key = ""): unknown {
	if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
	if (Array.isArray(value)) {
		return value.map((entry) => redactValue(entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [
				entryKey,
				redactValue(entry, entryKey),
			]),
		);
	}
	if (
		typeof value === "string" &&
		(/^(?:bearer\s+|basic\s+|op:\/\/)/i.test(value) ||
			SENSITIVE_VALUE.test(value))
	) {
		return "[REDACTED]";
	}
	return value;
}

export function summarizeClassification(
	classification: ProviderResultClassification,
): ReceiptResultSummary {
	switch (classification.class) {
		case "transport_or_client_policy_failure":
			return {
				class: classification.class,
				code: classification.code,
			};
		case "jsonrpc_protocol_or_server_error":
			return {
				class: classification.class,
				...classificationCode(classification.error),
				result_fingerprint: fingerprintValue(
					redactValue(classification.error),
				),
			};
		case "tool_error":
		case "successful_tool_result":
			return {
				class: classification.class,
				result_fingerprint: fingerprintValue(
					redactValue(classification.result),
				),
			};
	}
}

function classificationCode(value: unknown): { code?: string } {
	if (!value || typeof value !== "object" || !("code" in value)) return {};
	const code = (value as { code?: unknown }).code;
	return Number.isInteger(code) ? { code: String(code) } : {};
}
