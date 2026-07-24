// Shared connection-only sweep helpers (R2, auth plan U1): ONE auth-shaped
// vocabulary and ONE recursive key walker for every producer-side drift gate
// in this package, so growing the vocabulary updates all gates together.
// (browser-use keeps its own consumer-side copy across the package boundary
// as compatibility coverage.)

export const AUTH_SHAPED_KEY =
	/(auth|credential|secret|password|passwd|token|otp|vault|passkey)/i;

/**
 * Recursively collect every object key path whose key name matches the
 * auth-shaped vocabulary. Function values are skipped (Adapter Definitions
 * carry behavior alongside data); keys are checked, values are walked.
 */
export function collectAuthShapedKeyPaths(
	value: unknown,
	path: string,
	offenders: string[],
): void {
	if (typeof value === "function") return;
	if (Array.isArray(value)) {
		for (const [index, entry] of value.entries()) {
			collectAuthShapedKeyPaths(entry, `${path}[${index}]`, offenders);
		}
		return;
	}
	if (typeof value === "object" && value !== null) {
		for (const [key, entry] of Object.entries(value)) {
			if (AUTH_SHAPED_KEY.test(key)) offenders.push(`${path}.${key}`);
			collectAuthShapedKeyPaths(entry, `${path}.${key}`, offenders);
		}
	}
}
