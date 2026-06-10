// bad-vacuous-match: injects heal bug b — an owner-paths check that resolves a
// referenced set and reports "ok" even when the set is EMPTY (a vacuous pass).
// The vacuous-match clause MUST flag this: there is no empty-set guard before
// the ok branch, so a regex that matches nothing reads as healthy.

export interface Finding {
	status: "ok" | "finding";
	summary: string;
}

export function checkOwnerPaths(md: string): Finding {
	// Defect: if the regex matches nothing, `referenced` is empty and the check
	// still returns ok — zero owner paths reads as "all owner paths resolve".
	const referenced = new Set(
		[...md.matchAll(/\bskills\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g)].map((m) => m[0]),
	);
	return {
		status: "ok",
		summary: `${referenced.size} owner path(s) resolve`,
	};
}
