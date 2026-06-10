// good-vacuous-fixed: the genuine fix for heal bug b (R11 contrast case). Adds a
// real empty-set guard: when the referenced set is empty, the check reports a
// finding instead of ok, so a regex that matches nothing is no longer a vacuous
// pass. The vacuous-match clause MUST PASS this — the finding closes correctly,
// proving the clause is not a blanket flagger of any set-resolving check.

export interface Finding {
	status: "ok" | "finding";
	summary: string;
}

export function checkOwnerPaths(md: string): Finding {
	const referenced = new Set(
		[...md.matchAll(/\bskills\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g)].map((m) => m[0]),
	);
	if (referenced.size === 0) {
		return {
			status: "finding",
			summary: "no owner paths referenced — check resolved zero, not a healthy state",
		};
	}
	return {
		status: "ok",
		summary: `${referenced.size} owner path(s) resolve`,
	};
}
