// bad-vacuous-match-masked: the R11 HARD masking case.
//
// A "fix" that injects one dummy owner path so the resolved set is never empty —
// literally making `referenced.size > 0` true without restoring real coverage.
// This is the cheapest-to-satisfy form of a naive "set is non-empty" assertion.
//
// The vacuous-match clause asserts the ANTI-PATTERN (an ok return with no
// empty-set guard), not merely "set is non-empty". The masking fix adds a member
// but still has no guard and still returns ok unconditionally, so the clause
// remains tripped — it RESISTS this masking fix. If the clause had been written
// as "size > 0" it would have been masked; that contrast is the point of R11.

export interface Finding {
	status: "ok" | "finding";
	summary: string;
}

export function checkOwnerPaths(md: string): Finding {
	const referenced = new Set(
		[...md.matchAll(/\bskills\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g)].map((m) => m[0]),
	);
	// MASKING FIX: inject a dummy path so the set is never empty. This defeats a
	// naive "size > 0" check but NOT the real intent (every referenced path
	// resolves) — the dummy resolves nothing real.
	referenced.add("skills/__dummy__/placeholder.ts");
	// Still no empty-set guard, still returns ok unconditionally — the
	// anti-pattern the clause targets is intact.
	return {
		status: "ok",
		summary: `${referenced.size} owner path(s) resolve`,
	};
}
