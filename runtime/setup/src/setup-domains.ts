import { join } from "node:path";

import { applyLockResult, applySetup } from "./apply.ts";
import {
	applyBinTopology,
	inspectBinTopology,
	inspectRemovableBins,
	type BinTopologyOptions,
} from "./bin-topology.ts";
import {
	applyHookTopology,
	inspectHookTopology,
	projectHookTopologyPlan,
	resolveGitHookPath,
	type HookMutationPhase,
} from "./hook-topology.ts";
import type { SetupActionId, SetupDomainResult, SetupFinding, SetupFindingId, SetupResult } from "./model.ts";
import { acquireOperationLock, inspectOperationLock, inspectStaleVisibilityLocks } from "./operation-lock.ts";
import { checkRunbookHealth } from "./runbook-health.ts";
import { resolveSetupScope } from "./scope.ts";
import { inspectSetup, type SetupInspection, type SetupInspectionInput } from "./inspection.ts";
import { planSetup } from "./planner.ts";
import { unlinkLockResult, unlinkSetup } from "./unlink.ts";
import { rm } from "node:fs/promises";

const RUNBOOK_SUBPATH = "runbooks/issue-to-pr-v2";
const HOOK_SOURCE_SUBPATH = "scripts/hooks";

export interface ApplySetupDomainsOptions {
	readonly stateRoot: string;
	readonly inspect?: (input: SetupInspectionInput) => Promise<SetupInspection>;
	/** Deterministic lock seam used to prove composed busy outcomes never retry a projection-only apply. */
	readonly acquireLock?: typeof acquireOperationLock;
	readonly hookPath?: (repoRoot: string) => Promise<string>;
	/** Deterministic pre-syscall seam used to prove apply-time races and failures. */
	readonly beforeSymlink?: (source: string, destination: string) => Promise<void>;
	/** Deterministic hook transaction seam used to prove lock and race behavior. */
	readonly beforeHookMutation?: (phase: HookMutationPhase, path: string) => Promise<void>;
	/** Destination and PATH seams so tests never touch the real `~/.bun/bin`. */
	readonly binTopology?: BinTopologyOptions;
	/** Deterministic bin mutation seam used to prove concurrent-change deferral. */
	readonly beforeBinMutation?: (phase: "remove" | "symlink", destination: string) => Promise<void>;
}

/** Read-only composition options, including lock and provenance state diagnostics. */
export interface CheckSetupDomainsOptions extends Omit<ApplySetupDomainsOptions, "stateRoot"> {
	/** Existing Setup state root inspected without creating provenance or lock state. */
	readonly stateRoot: string;
}

export interface UnlinkSetupDomainsOptions {
	readonly check?: boolean;
	readonly stateRoot: string;
	readonly inspect?: (input: SetupInspectionInput) => Promise<SetupInspection>;
	/** Deterministic lock seam used to prove composed busy outcomes never retry a projection-only unlink. */
	readonly acquireLock?: typeof acquireOperationLock;
	readonly beforeRemove?: (path: string) => Promise<void>;
	/** Destination and PATH seams so tests never touch the real `~/.bun/bin`. */
	readonly binTopology?: BinTopologyOptions;
}

/** Add read-only user-domain evidence to sync check without probing project scope. */
export async function checkSetupDomains(
	input: SetupInspectionInput,
	base: SetupResult,
	options: CheckSetupDomainsOptions,
): Promise<SetupResult> {
	const scope = await resolveSetupScope(input);
	const lockFindings = await inspectReadOnlyLockFindings(input, scope.target_anchor, options.stateRoot, base.command);
	if (input.scope === "project") return mergeReadOnlyLockFindings(base, lockFindings);
	const [binPlan, hookInspection] = await Promise.all([
		inspectBinTopology(input.sourceRepoRoot, scope.target_anchor, options.binTopology),
		inspectHookDomain(input.sourceRepoRoot, options.stateRoot, options.hookPath),
	]);
	const findings: SetupFinding[] = [...lockFindings, ...binPlan.findings, ...hookInspection.findings];
	const runbook = checkRunbookHealth(join(input.sourceRepoRoot, RUNBOOK_SUBPATH));
	if (runbook.finding) findings.push(runbook.finding);
	const domains: SetupDomainResult[] = [
		{ domain: "bins", planned: binPlan.operations.map((item) => item.destination), applied: [], deferred: [], preserved: binPlan.preserved, failed: [] },
		hookInspection.domain,
		domainWithFailures("runbook", runbook.healthy ? [] : runbook.missing.map((tag) => `runbook:${tag}`)),
	];
	const planned = [...base.domains, ...domains].reduce((sum, domain) => sum + domain.planned.length, 0);
	const blocked = findings.length > 0 || base.state === "blocked";
	const busy = findings.some((finding) => finding.id === "operation_busy");
	const fresh = base.command === "status" && base.state === "clean_slate";
	const station = base.command === "status"
		? blocked ? "status.blocked" : fresh ? "status.clean_slate" : planned > 0 ? "status.drift" : "status.healthy"
		: busy ? "sync.operation_busy" : blocked ? "sync.check_blocked" : planned > 0 ? "sync.check_changes" : "sync.check_clean";
	const state = base.command === "status"
		? blocked ? "blocked" : fresh ? "clean_slate" : planned > 0 ? "drift" : "healthy"
		: blocked ? "blocked" : planned > 0 ? "changes" : "healthy";
	return {
		...base,
		state,
		station,
		findings: [...base.findings, ...findings, ...binPlan.advisories],
		domains: [...base.domains, ...domains],
		counts: { ...base.counts, planned, blockers: base.counts.blockers + findings.length },
		next_action: busy ? "retry" : blocked ? "run_doctor" : fresh ? "preview_sync" : planned > 0 ? "run_sync" : "setup_healthy",
	};
}

async function inspectReadOnlyLockFindings(
	input: SetupInspectionInput,
	targetAnchor: string,
	stateRoot: string,
	command: SetupResult["command"],
): Promise<readonly SetupFinding[]> {
	if (command !== "doctor" && command !== "sync") return [];
	const stalePaths = (await inspectStaleVisibilityLocks({ stateRoot })).map((lock) => lock.path);
	const scopeLock = await inspectOperationLock({
		scope: input.scope,
		targetAnchor,
		stateRoot,
	});
	const scopeFindings = scopeLock.status === "missing"
		? []
		: command === "sync" || scopeLock.status === "stale"
			? [operationLockFinding(scopeLock.status, scopeLock.path)]
			: [];
	return [...new Map([
		...scopeFindings,
		...stalePaths.map((path) => operationLockFinding("stale", path)),
	].map((finding) => [finding.path, finding])).values()];
}

function operationLockFinding(status: "busy" | "stale", path: string): SetupFinding {
	return {
		id: status === "busy" ? "operation_busy" : "stale_operation_lock",
		owner: "setup.operation-lock",
		path,
		summary: status === "busy"
			? "Another setup mutation owns this lock."
			: "An unreclaimed stale setup mutation lock requires inspection.",
		repair: status === "busy" ? "retry" : "inspect_lock",
	};
}

function mergeReadOnlyLockFindings(base: SetupResult, findings: readonly SetupFinding[]): SetupResult {
	if (findings.length === 0) return base;
	const blocked = base.command === "sync";
	const busy = findings.some((finding) => finding.id === "operation_busy");
	return {
		...base,
		...(blocked ? {
			state: "blocked" as const,
			station: busy ? "sync.operation_busy" : "sync.check_blocked",
			next_action: busy ? "retry" as const : "run_doctor" as const,
		} : {}),
		findings: [...base.findings, ...findings],
		counts: { ...base.counts, blockers: base.counts.blockers + findings.length },
	};
}

type SyncBlockedFindingId = Extract<
	SetupFindingId,
	"hook_ownership_unproven" | "hook_unhealthy" | "runbook_artifact_unhealthy"
>;

const SYNC_BLOCKED_ROUTES = {
	hook_ownership_unproven: { station: "sync.blocked", next_action: "human_repair" },
	hook_unhealthy: { station: "sync.hook_failure", next_action: "repair_hooks" },
	runbook_artifact_unhealthy: { station: "sync.runbook_failure", next_action: "repair_runbook" },
} as const satisfies Record<SyncBlockedFindingId, { readonly station: string; readonly next_action: SetupActionId }>;

/** Remove proven skill and bin links under one user lock; copied hooks remain. */
export async function unlinkSetupDomains(input: SetupInspectionInput, options: UnlinkSetupDomainsOptions): Promise<SetupResult> {
	if (input.scope === "project") return unlinkSetup(input, options);
	const scope = await resolveSetupScope(input);
	const binsInspection = await inspectRemovableBins(input.sourceRepoRoot, scope.target_anchor, options.binTopology);
	const binsRemovable = binsInspection.removable;
	if (options.check) {
		const projection = await unlinkSetup(input, options);
		const bins = { domain: "bins", planned: binsRemovable, applied: [], deferred: [], preserved: binsInspection.preserved, failed: [] } satisfies SetupDomainResult;
		const findings = [...projection.findings, ...binsInspection.findings];
		const blocked = binsInspection.findings.length > 0 || projection.station === "unlink.check_blocked";
		const plannedRemovals = binsRemovable.length;
		return {
			...projection,
			findings,
			domains: [...projection.domains, bins],
			counts: {
				...projection.counts,
				planned: projection.counts.planned + plannedRemovals,
				blockers: projection.counts.blockers + binsInspection.findings.length,
			},
			state: blocked ? "blocked" : plannedRemovals > 0 ? "changes" : projection.state,
			station: blocked ? "unlink.check_blocked" : plannedRemovals > 0 ? "unlink.check_removable" : projection.station,
			next_action: blocked ? "human_repair" : plannedRemovals > 0 ? "run_unlink" : projection.next_action,
		};
	}
	const lock = await (options.acquireLock ?? acquireOperationLock)({ scope: "user", targetAnchor: scope.target_anchor, stateRoot: options.stateRoot });
	if (lock.status !== "acquired") return unlinkLockResult(input, scope, lock.status, lock.path);
	try {
		const projection = await unlinkSetup(input, { ...options, lockHeld: true });
		const findings: SetupFinding[] = [...binsInspection.findings];
		let concurrent = false;
		const binsApplied: string[] = [];
		const binsFailed: string[] = [];
		const binsPreserved: string[] = [...binsInspection.preserved];
		let binsDeferred: readonly string[] = [];
		for (let index = 0; index < binsRemovable.length; index += 1) {
			const path = binsRemovable[index];
			if (!path) continue;
			const before = await inspectRemovableBins(input.sourceRepoRoot, scope.target_anchor, options.binTopology);
			mergeRemovableEvidence(before, findings, binsPreserved);
			if (!before.removable.includes(path)) { binsFailed.push(path); binsDeferred = binsRemovable.slice(index + 1); concurrent = true; break; }
			try {
				await options.beforeRemove?.(path);
				const immediate = await inspectRemovableBins(input.sourceRepoRoot, scope.target_anchor, options.binTopology);
				mergeRemovableEvidence(immediate, findings, binsPreserved);
				if (!immediate.removable.includes(path)) {
					binsFailed.push(path);
					binsDeferred = binsRemovable.slice(index + 1);
					concurrent = true;
					break;
				}
				await rm(path);
				binsApplied.push(path);
			} catch { binsFailed.push(path); binsDeferred = binsRemovable.slice(index + 1); break; }
		}
		const bins: SetupDomainResult = { domain: "bins", planned: binsRemovable, applied: binsApplied, deferred: binsDeferred, preserved: binsPreserved, failed: binsFailed };
		const allFindings = [...projection.findings, ...findings];
		const incomplete = projection.state === "partial" || projection.state === "blocked" || binsFailed.length > 0 || findings.length > 0;
		const any = projection.domains.some((domain) => domain.applied.length > 0) || binsApplied.length > 0;
		return {
			...projection,
			findings: allFindings,
			domains: [...projection.domains, bins],
			state: incomplete ? any ? "partial" : "blocked" : any ? "removed" : "noop",
			station: concurrent ? "unlink.concurrent_change" : incomplete ? "unlink.partial_failure" : any ? "unlink.removed" : "unlink.noop",
			counts: {
				...projection.counts,
				planned: projection.counts.planned + binsRemovable.length,
				blockers: projection.counts.blockers + findings.length,
			},
			next_action: concurrent ? "rerun_check" : incomplete ? "inspect_results" : "clean_state",
		};
	} finally { await lock.release(); }
}

function mergeRemovableEvidence(
	inspection: { readonly findings: readonly SetupFinding[]; readonly preserved: readonly string[] },
	findings: SetupFinding[],
	preserved: string[],
): void {
	for (const finding of inspection.findings) {
		if (!findings.some((item) => item.id === finding.id && item.path === finding.path)) findings.push(finding);
	}
	for (const path of inspection.preserved) {
		if (!preserved.includes(path)) preserved.push(path);
	}
}

/** Compose retained user domains under one lock; project scope remains skill-only. */
export async function applySetupDomains(input: SetupInspectionInput, options: ApplySetupDomainsOptions): Promise<SetupResult> {
	if (input.scope === "project") return applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect, beforeSymlink: options.beforeSymlink });
	const scope = await resolveSetupScope(input);
	const homeDir = scope.target_anchor;
	const lock = await (options.acquireLock ?? acquireOperationLock)({ scope: "user", targetAnchor: homeDir, stateRoot: options.stateRoot });
	if (lock.status !== "acquired") {
		return applyLockResult(input, scope, lock.status, lock.path);
	}
	try {
		const inspect = options.inspect ?? inspectSetup;
		const projectionPlan = planSetup(await inspect(input), "sync");
		const binPlan = await inspectBinTopology(input.sourceRepoRoot, homeDir, options.binTopology);
		const binsPreview: SetupDomainResult = {
			...emptyDomain("bins"),
			planned: binPlan.operations.map((item) => item.destination),
			preserved: binPlan.preserved,
		};
		const advisories = binPlan.advisories;
		let hookPlan: Awaited<ReturnType<typeof inspectHookTopology>> | undefined;
		let hookPreview = emptyDomain("hooks");
		const extraFindings: SetupFinding[] = [...binPlan.findings];
		try {
			const hookRoot = await (options.hookPath ?? resolveGitHookPath)(input.sourceRepoRoot);
			hookPlan = await inspectHookTopology(join(input.sourceRepoRoot, HOOK_SOURCE_SUBPATH), hookRoot, options.stateRoot);
			hookPreview = projectHookTopologyPlan(hookPlan);
			extraFindings.push(...hookPlan.findings);
		} catch (error) {
			extraFindings.push({ id: "hook_unhealthy", owner: "setup.hooks", summary: error instanceof Error ? error.message : String(error), repair: "repair_hooks" });
			hookPreview = { ...hookPreview, failed: ["git-hook-path"] };
		}
		const runbook = checkRunbookHealth(join(input.sourceRepoRoot, RUNBOOK_SUBPATH));
		if (runbook.finding) extraFindings.push(runbook.finding);
		const runbookDomain = domainWithFailures(
			"runbook",
			runbook.healthy ? [] : runbook.missing.map((tag) => `runbook:${tag}`),
		);
		const preMutationBlocked = extraFindings.some((finding) =>
			finding.id === "hook_unhealthy"
			|| finding.id === "runbook_artifact_unhealthy");
		if (preMutationBlocked) {
			return aggregate(
				projectionPlan,
				[binsPreview, hookPreview, runbookDomain],
				extraFindings,
				advisories,
			);
		}

		const bins = await applyBinTopology(binPlan, { beforeMutation: options.beforeBinMutation });

		const projection = await applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect, lockHeld: true, beforeSymlink: options.beforeSymlink });
		const hook = hookPlan
			? await applyHookTopology(hookPlan, { beforeMutation: options.beforeHookMutation })
			: hookPreview;
		return aggregate(projection, [bins, hook, runbookDomain], extraFindings, advisories);
	} finally {
		await lock.release();
	}
}

function emptyDomain(domain: string): SetupDomainResult {
	return { domain, planned: [], applied: [], deferred: [], preserved: [], failed: [] };
}

function domainWithFailures(domain: string, failed: readonly string[]): SetupDomainResult {
	return { ...emptyDomain(domain), failed };
}

async function inspectHookDomain(
	repoRoot: string,
	stateRoot: string,
	hookPath?: (repoRoot: string) => Promise<string>,
): Promise<{ domain: SetupDomainResult; findings: readonly SetupFinding[] }> {
	try {
		const hookRoot = await (hookPath ?? resolveGitHookPath)(repoRoot);
		const plan = await inspectHookTopology(join(repoRoot, HOOK_SOURCE_SUBPATH), hookRoot, stateRoot);
		return {
			domain: projectHookTopologyPlan(plan),
			findings: plan.findings,
		};
	} catch (error) {
		return {
			domain: emptyDomain("hooks"),
			findings: [{
				id: "hook_unhealthy",
				owner: "setup.hooks",
				summary: error instanceof Error ? error.message : String(error),
				repair: "repair_hooks",
			}],
		};
	}
}

function aggregate(
	base: SetupResult,
	domains: readonly SetupDomainResult[],
	findings: readonly SetupFinding[],
	advisories: readonly SetupFinding[],
	childOutput = "",
): SetupResult {
	const all = [...base.domains, ...domains];
	// Advisories surface in findings but never join the blocked/blockers computation (KTD: advisory channel).
	const allFindings = [...base.findings, ...findings, ...advisories];
	const applied = all.some((domain) => domain.applied.length > 0);
	const incomplete = base.state === "blocked" || base.state === "partial" || base.counts.blockers > 0 || findings.length > 0 || all.some((domain) => domain.failed.length > 0 || domain.deferred.length > 0);
	const partial = base.state === "partial" || (incomplete && applied);
	const blockedRoute = syncBlockedRoute(allFindings);
	const state = incomplete ? (partial ? "partial" : "blocked") : applied ? "applied" : "noop";
	const station = incomplete ? (partial ? "sync.partial" : blockedRoute.station) : applied ? "sync.applied" : "sync.noop";
	return {
		...base,
		state,
		station,
		findings: allFindings,
		domains: all,
		counts: { ...base.counts, planned: all.reduce((sum, domain) => sum + domain.planned.length, 0), blockers: base.counts.blockers + findings.length },
		next_action: incomplete
			? partial ? "inspect_results" : blockedRoute.next_action
			: "setup_healthy",
		child_output: childOutput,
	};
}

function syncBlockedRoute(findings: readonly SetupFinding[]): {
	readonly station: string;
	readonly next_action: SetupActionId;
} {
	for (const [id, route] of Object.entries(SYNC_BLOCKED_ROUTES)) {
		if (findings.some((finding) => finding.id === id)) return route;
	}
	return { station: "sync.blocked", next_action: "human_repair" };
}
