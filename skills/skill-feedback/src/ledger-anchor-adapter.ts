import type {
	NormalizedSoftwareLearningReport,
	ReportCardTarget,
	ReviewAnchorStrength,
	ReviewWeakAnchorReason,
} from "./command-contract";

/**
 * Report surface facts consumed by the anchor Adapter before ledger reduction.
 *
 * @internal The adapter ignores non-anchor review fields so reducer grouping
 * cannot drift with source, runtime, timestamp, or report identity changes.
 */
export type LedgerAnchorInput = Pick<
	NormalizedSoftwareLearningReport,
	"report_id" | "touched_surfaces" | "observations"
>;

/**
 * Canonical anchor facts passed to the v2 review reducer.
 *
 * @internal Strong anchors carry a mergeable key; weak anchors carry only
 * attempted target context and a quarantine reason.
 */
export type LedgerAnchorFacts = {
	/** Report that produced these anchor facts. */
	report_id: string;
	/** Mergeable key for strong repo path anchors only. */
	ledger_anchor_key?: string;
	/** Safety level for reducer grouping. */
	anchor_strength: ReviewAnchorStrength;
	/** Reason a weak anchor cannot produce a merge key. */
	weak_anchor_reason?: ReviewWeakAnchorReason;
	/** Targets inspected while deriving the anchor. */
	attempted_targets: readonly ReportCardTarget[];
	/** Canonical repo-contained owner paths for strong anchors. */
	owner_paths: readonly string[];
};

type CanonicalPathResult =
	| { kind: "ok"; path: string }
	| { kind: "weak"; reason: "out_of_repo" | "unverifiable" };

/**
 * Derive claim-safe ledger anchor facts from normalized report surfaces.
 *
 * @param input - Normalized report surface facts to inspect for anchor paths.
 * @returns Strong path anchor facts or weak quarantine facts for the reducer.
 *
 * @example
 * ```typescript
 * const facts = deriveLedgerAnchorFacts(report)
 * if (facts.anchor_strength === "strong_path") use(facts.ledger_anchor_key)
 * ```
 */
export function deriveLedgerAnchorFacts(
	input: LedgerAnchorInput,
): LedgerAnchorFacts {
	const observationTargets = input.observations.flatMap((observation) =>
		observation.target ? [observation.target] : [],
	);
	const allTargets = [...input.touched_surfaces, ...observationTargets];
	const touchedPathTargets = pathTargets(input.touched_surfaces);
	const observationPathTargets = pathTargets(observationTargets);
	const selectedPathTargets =
		touchedPathTargets.length > 0 ? touchedPathTargets : observationPathTargets;

	if (selectedPathTargets.length === 0) {
		return weakAnchorFacts(
			input.report_id,
			allTargets,
			allTargets.length === 0 ? "missing_anchor" : "label_only",
		);
	}

	const canonicalPaths: string[] = [];
	for (const target of selectedPathTargets) {
		const canonical = canonicalOwnerPath(target.value);
		if (canonical.kind === "weak") {
			return weakAnchorFacts(input.report_id, selectedPathTargets, canonical.reason);
		}
		canonicalPaths.push(canonical.path);
	}

	const ownerPaths = [...new Set(canonicalPaths)].sort();
	if (ownerPaths.length === 0) {
		return weakAnchorFacts(input.report_id, selectedPathTargets, "unverifiable");
	}

	return {
		report_id: input.report_id,
		ledger_anchor_key: `path:${ownerPaths.join("|")}`,
		anchor_strength: "strong_path",
		attempted_targets: selectedPathTargets,
		owner_paths: ownerPaths,
	};
}

function pathTargets(targets: readonly ReportCardTarget[]): ReportCardTarget[] {
	return targets.filter((target) => target.type === "path");
}

function weakAnchorFacts(
	reportId: string,
	attemptedTargets: readonly ReportCardTarget[],
	reason: ReviewWeakAnchorReason,
): LedgerAnchorFacts {
	return {
		report_id: reportId,
		anchor_strength: "weak",
		weak_anchor_reason: reason,
		attempted_targets: attemptedTargets,
		owner_paths: [],
	};
}

function canonicalOwnerPath(rawPath: string): CanonicalPathResult {
	const trimmedPath = rawPath.trim();
	if (trimmedPath === "" || trimmedPath.includes("\0")) {
		return { kind: "weak", reason: "unverifiable" };
	}

	const slashPath = trimmedPath.replaceAll("\\", "/");
	if (
		slashPath.startsWith("/") ||
		slashPath.startsWith("~") ||
		/^[A-Za-z]:\//.test(slashPath)
	) {
		return { kind: "weak", reason: "out_of_repo" };
	}

	const parts: string[] = [];
	for (const part of slashPath.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length === 0) return { kind: "weak", reason: "out_of_repo" };
			parts.pop();
			continue;
		}
		parts.push(part);
	}

	if (parts.length === 0) return { kind: "weak", reason: "unverifiable" };
	return { kind: "ok", path: parts.join("/") };
}
