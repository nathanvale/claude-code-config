// PROTOTYPE — cli-probe-loop convergence ledger. Throwaway shell; this module is
// the bit worth keeping if the question checks out.
//
// QUESTION: does a finding-convergence loop (the self-audit-loop pattern,
// generalised from instruction-contradictions to CLI-branch bugs) converge
// correctly? Specifically:
//   (a) findings carry a stable signature so re-discovering one is a dedup, not a new finding
//   (b) the loop tracks new-this-pass vs already-seen
//   (c) fixing a finding resolves it without deleting history
//   (d) the stop oracle fires on "zero NEW accepted findings in a full pass"
//       — never "zero total", never agent self-report
//
// Pure: no I/O, no terminal code. The TUI drives it.

/** A bug class the probe loop accepts (the CLI analogue of the audit loop's contradiction shapes). */
export type FindingShape =
	| "wrong-exit-code"
	| "unguarded-spawn"
	| "silent-coverage-gap"
	| "raw-runner-violation"
	| "false-pass"
	| "input-unvalidated";

export type FindingStatus = "open" | "resolved" | "rejected" | "duplicate";

export interface Finding {
	/** Stable identity: same branch + same shape ⇒ same signature ⇒ dedup, not new. */
	signature: string;
	shape: FindingShape;
	branch: string; // e.g. "repair --execute on clean log"
	summary: string;
	status: FindingStatus;
	firstSeenPass: number;
	resolvedPass?: number;
}

export interface Pass {
	n: number;
	newAccepted: number;
	dedup: number;
	rejected: number;
}

export type Convergence = "not_started" | "active" | "converged";

export interface LoopState {
	findings: Finding[];
	passes: Pass[];
	convergence: Convergence;
}

export function initLoop(): LoopState {
	return { findings: [], passes: [], convergence: "not_started" };
}

/** A raw probe result fed into a pass, before dedup/accept logic. */
export interface ProbeResult {
	signature: string;
	shape: FindingShape;
	branch: string;
	summary: string;
	/** Whether this result fits an accepted shape (rejected results never count as findings). */
	accepted: boolean;
}

/**
 * Run one pass: feed it the probe results gathered this round. Returns the
 * updated state. New accepted findings are added; repeats dedup against existing
 * open findings by signature; non-accepted results are counted as rejected.
 */
export function runPass(state: LoopState, results: ProbeResult[]): LoopState {
	const n = state.passes.length + 1;
	const bySig = new Map(state.findings.map((f) => [f.signature, f]));
	let newAccepted = 0;
	let dedup = 0;
	let rejected = 0;

	const findings = [...state.findings];
	for (const r of results) {
		if (!r.accepted) {
			rejected += 1;
			continue;
		}
		const existing = bySig.get(r.signature);
		if (existing) {
			// Already known — dedup regardless of its status. A resolved finding that
			// reappears is a regression, but for convergence it is NOT new.
			dedup += 1;
			continue;
		}
		const finding: Finding = {
			signature: r.signature,
			shape: r.shape,
			branch: r.branch,
			summary: r.summary,
			status: "open",
			firstSeenPass: n,
		};
		findings.push(finding);
		bySig.set(r.signature, finding);
		newAccepted += 1;
	}

	const passes = [...state.passes, { n, newAccepted, dedup, rejected }];
	// Stop oracle: converged when THIS pass added zero new accepted findings.
	// Not "zero total open" — open findings can remain unfixed and the loop has
	// still converged on discovery. Convergence is about discovery, repair is separate.
	const convergence: Convergence = newAccepted === 0 ? "converged" : "active";
	return { findings, passes, convergence };
}

/** Mark a finding resolved (a fix landed). Keeps it in history; does not delete. */
export function resolveFinding(state: LoopState, signature: string): LoopState {
	const findings = state.findings.map((f) =>
		f.signature === signature && f.status === "open"
			? { ...f, status: "resolved" as const, resolvedPass: state.passes.length }
			: f,
	);
	return { ...state, findings };
}

export function openFindings(state: LoopState): Finding[] {
	return state.findings.filter((f) => f.status === "open");
}

/** A signature scheme so the TUI/real probe agree: branch + shape. */
export function signatureOf(branch: string, shape: FindingShape): string {
	return `${branch}::${shape}`;
}
