/**
 * Extract a string field from an unknown JSON object.
 *
 * @param raw - Unknown parsed value.
 * @param field - Field name to read.
 * @returns The field value when the input is a plain object with a string field.
 *
 * @example
 * ```typescript
 * const reportId = rawStringField(rawReport, "report_id")
 * ```
 */
export function rawStringField(raw: unknown, field: string): string | undefined {
	if (!isRawObject(raw)) return undefined;
	const value = raw[field];
	return typeof value === "string" ? value : undefined;
}

/**
 * Identify object-shaped JSON values without accepting arrays.
 *
 * @param raw - Unknown parsed value.
 * @returns True when the value can be safely read as a string-keyed object.
 *
 * @example
 * ```typescript
 * if (isRawObject(rawReport)) console.log(rawReport.report_id)
 * ```
 */
export function isRawObject(raw: unknown): raw is Record<string, unknown> {
	return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/**
 * Return a string value from an unknown field candidate.
 *
 * @param value - Unknown field value.
 * @returns The string value when present; otherwise undefined.
 *
 * @example
 * ```typescript
 * const source = stringFromUnknown(raw.evidence_source)
 * ```
 */
export function stringFromUnknown(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/**
 * Return only strings that appear more than once.
 *
 * @param values - Optional string values to count.
 * @returns Unique duplicated values in insertion order.
 *
 * @example
 * ```typescript
 * const duplicateIds = duplicateStringSet(reports.map((report) => report.id))
 * ```
 */
export function duplicateStringSet(
	values: readonly (string | undefined)[],
): ReadonlySet<string> {
	const counts = new Map<string, number>();
	for (const value of values) {
		if (!value) continue;
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return new Set(
		[...counts.entries()]
			.filter(([, count]) => count > 1)
			.map(([value]) => value),
	);
}
