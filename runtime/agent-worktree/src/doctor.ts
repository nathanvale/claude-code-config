import {
	AGENT_WORKTREE_COMMANDS,
	AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS,
	type AgentWorktreeCommand,
	type AgentWorktreeMutationReadiness,
	type AgentWorktreeSeam,
	type AgentWorktreeStatus,
} from "./model.ts";
import {
	type DiscoverRepoOptions,
	defaultGitRunner,
	type RepoDiscovery,
	discoverRepo,
} from "./discovery.ts";
import { mutationReadinessFromBranchSafetyDecision } from "./merge-intelligence.ts";
import { createFileStore } from "./store.ts";
import {
	type WorktreeStatus,
	statusWorktreesForDiscovery,
} from "./worktrees.ts";

/**
 * Doctor check ids for the repo operability map.
 */
export const DOCTOR_CHECK_IDS = [
	"repo",
	"worktrees",
	"store",
	"contracts",
	"dependencies",
	"mutations",
] as const;

/**
 * Doctor check id.
 */
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

/**
 * One readable check inside the doctor map.
 *
 * Checks should return `unknown` instead of throwing when partial state can
 * still orient the next agent.
 */
export interface DoctorCheck {
	/** Stable check id. */
	id: DoctorCheckId;
	/** Check owner path or domain label. */
	owner: string;
	/** Check status. */
	status: AgentWorktreeStatus;
	/** Short machine-safe summary. */
	summary: string;
	/** Mutation blockers found by this check. */
	blockers: readonly string[];
	/** Actions that remain safe after this check. */
	nextActions: readonly AgentWorktreeCommand[];
}

/**
 * Aggregate doctor map consumed before mutation.
 */
export interface DoctorMap {
	/** Aggregate status across checks. */
	status: AgentWorktreeStatus;
	/** Whether mutation is allowed from this map. */
	mutationReadiness: AgentWorktreeMutationReadiness;
	/** Check list that produced the aggregate. */
	checks: readonly DoctorCheck[];
	/** Safe actions derived from non-ok checks. */
	nextActions: readonly AgentWorktreeCommand[];
	/** Raw repo discovery facts. */
	repo: DoctorRepoSummary;
	/** Commands available from the facade contract. */
	availableCommands: readonly string[];
}

/**
 * Compact repo facts carried in doctor output.
 *
 * @example
 * ```typescript
 * const repo: DoctorRepoSummary = { linkedWorktreeCount: 1, staleDirCount: 0 }
 * ```
 */
export interface DoctorRepoSummary {
	/** Git top-level root, when available. */
	gitRoot?: string;
	/** Main owner root where `.agent-worktree` lives. */
	mainOwnerRoot?: string;
	/** Active worktree path for the current cwd. */
	activeWorktree?: string;
	/** Current branch in the active worktree. */
	currentBranch?: string;
	/** Default branch when known. */
	defaultBranch?: string;
	/** Main-owner durable store root. */
	storeRoot?: string;
	/** Number of linked worktrees. */
	linkedWorktreeCount: number;
	/** Number of stale dirs under `.worktrees`. */
	staleDirCount: number;
}

interface DoctorRuntimeContext {
	mutationStatuses?: readonly WorktreeStatus[];
	retention?: {
		agedRecordCount: number;
		agedBackupRefCount: number;
	};
}

/**
 * Build a doctor map from live repo discovery.
 *
 * @param options - Discovery cwd and optional git runner
 * @returns Agent-operability map; readable blocked maps are still successful data
 *
 * @example
 * ```typescript
 * const doctor = await runDoctor({ cwd: process.cwd() })
 * ```
 */
export async function runDoctor(
	options: DiscoverRepoOptions & { now?: () => number },
): Promise<DoctorMap> {
	const run = options.run ?? defaultGitRunner;
	const discovery = await discoverRepo({ cwd: options.cwd, run });
	const [mutationStatuses, retention] = await Promise.all([
		discovery.gitRoot
			? statusWorktreesForDiscovery(discovery, { cwd: options.cwd, run })
			: Promise.resolve([] as readonly WorktreeStatus[]),
		collectRetentionSummary(discovery, run, options.now ?? Date.now),
	]);
	return doctorMapFromDiscoveryWithContext(discovery, {
		mutationStatuses,
		retention,
	});
}

/**
 * Build a doctor map from already-collected discovery.
 *
 * @param discovery - Repo discovery facts
 * @returns Aggregated doctor map
 *
 * @example
 * ```typescript
 * const map = doctorMapFromDiscovery(discovery)
 * ```
 */
export function doctorMapFromDiscovery(discovery: RepoDiscovery): DoctorMap {
	return doctorMapFromDiscoveryWithContext(discovery, {});
}

function doctorMapFromDiscoveryWithContext(
	discovery: RepoDiscovery,
	context: DoctorRuntimeContext,
): DoctorMap {
	const issueChecks = checksFromDiscoveryIssues(discovery);
	const checks: DoctorCheck[] = [
		repoCheck(discovery),
		worktreesCheck(discovery),
		storeCheck(discovery, context),
		contractCheck(),
		dependenciesCheck(discovery),
		mutationsCheck(discovery, context),
		...issueChecks,
	];
	const aggregate = aggregateDoctorMap(checks);
	return {
		...aggregate,
		repo: {
			gitRoot: discovery.gitRoot,
			mainOwnerRoot: discovery.mainOwnerRoot,
			activeWorktree: discovery.activeWorktree?.path,
			currentBranch: discovery.currentBranch,
			defaultBranch: discovery.defaultBranch,
			storeRoot: discovery.storeRoot,
			linkedWorktreeCount: discovery.linkedWorktrees.length,
			staleDirCount: discovery.staleDirs.length,
		},
		availableCommands: AGENT_WORKTREE_COMMANDS,
	};
}

/**
 * Aggregate doctor checks into a repo-operability map.
 *
 * @param checks - Individual doctor checks
 * @returns Aggregate map for the CLI envelope
 *
 * @example
 * ```typescript
 * const map = aggregateDoctorMap([
 *   { id: "repo", owner: "discovery", status: "ok", summary: "repo found", blockers: [], nextActions: [] },
 * ])
 * ```
 */
export function aggregateDoctorMap(checks: readonly DoctorCheck[]): {
	status: AgentWorktreeStatus;
	mutationReadiness: AgentWorktreeMutationReadiness;
	checks: readonly DoctorCheck[];
	nextActions: readonly AgentWorktreeCommand[];
} {
	const status = aggregateDoctorStatus(checks);
	return {
		status,
		mutationReadiness: mutationReadinessForStatus(status),
		checks,
		nextActions: checks.flatMap((check) =>
			check.status === "ok" ? [] : check.nextActions,
		),
	};
}

function repoCheck(discovery: RepoDiscovery): DoctorCheck {
	if (!discovery.gitRoot) {
		return {
			id: "repo",
			owner: "discovery",
			status: "blocked",
			summary: "Git repo root unavailable.",
			blockers: ["repo_unreadable"],
			nextActions: ["handoff"],
		};
	}
	return {
		id: "repo",
		owner: "discovery",
		status: "ok",
		summary: "Git repo root resolved.",
		blockers: [],
		nextActions: [],
	};
}

function worktreesCheck(discovery: RepoDiscovery): DoctorCheck {
	const worktreeIssue = discovery.issues.find(
		(issue) => issue.code === "worktree_list_failed",
	);
	if (worktreeIssue) {
		return {
			id: "worktrees",
			owner: "discovery",
			status: "unknown",
			summary: "Worktree list could not be read.",
			blockers: ["worktrees_unknown"],
			nextActions: ["doctor"],
		};
	}
	const staleSummary =
		discovery.staleDirs.length === 0
			? "No stale worktree dirs found."
			: `${discovery.staleDirs.length} stale worktree dirs found.`;
	return {
		id: "worktrees",
		owner: "discovery",
		status: discovery.staleDirs.length > 0 ? "warn" : "ok",
		summary: staleSummary,
		blockers: [],
		nextActions: discovery.staleDirs.length > 0 ? ["clean"] : [],
	};
}

function storeCheck(
	discovery: RepoDiscovery,
	context: DoctorRuntimeContext,
): DoctorCheck {
	const agedRecordCount = context.retention?.agedRecordCount ?? 0;
	const agedBackupRefCount = context.retention?.agedBackupRefCount ?? 0;
	const agedCount = agedRecordCount + agedBackupRefCount;
	return {
		id: "store",
		owner: "store",
		status: discovery.storeRoot ? (agedCount > 0 ? "warn" : "ok") : "unknown",
		summary: discovery.storeRoot
			? agedCount > 0
				? `${agedCount} durable records or backup refs exceed the ${AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS}-day retention warning threshold.`
				: `Store root resolved; no records exceed the ${AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS}-day retention warning threshold.`
			: "Store root unknown until repo ownership is resolved.",
		blockers: [],
		nextActions: discovery.storeRoot ? [] : ["doctor"],
	};
}

function contractCheck(): DoctorCheck {
	return {
		id: "contracts",
		owner: "command-contract",
		status: "ok",
		summary: "Facade command catalog constructed.",
		blockers: [],
		nextActions: [],
	};
}

function dependenciesCheck(discovery: RepoDiscovery): DoctorCheck {
	const gitMissing = discovery.issues.some(
		(issue) => issue.code === "git_root_failed",
	);
	return {
		id: "dependencies",
		owner: "discovery",
		status: gitMissing ? "blocked" : "ok",
		summary: gitMissing ? "Git command unavailable or repo missing." : "Git readable.",
		blockers: gitMissing ? ["git_unavailable"] : [],
		nextActions: gitMissing ? ["handoff"] : [],
	};
}

function mutationsCheck(
	discovery: RepoDiscovery,
	context: DoctorRuntimeContext,
): DoctorCheck {
	const discoveryBlockers = discovery.issues
		.filter((issue) => issue.status === "blocked")
		.map((issue) => issue.code);
	const safetyBlockers = (context.mutationStatuses ?? []).flatMap((status) => {
		if (status.dirty) {
			return [`${status.worktree.branch ?? status.worktree.path}:dirty`];
		}
		if (status.safety) {
			if (status.safety.reason === "protected_branch") return [];
			return mutationReadinessFromBranchSafetyDecision(status.safety) ===
				"blocked"
				? [`${status.worktree.branch ?? status.worktree.path}:${status.safety.reason}`]
				: [];
		}
		return [];
	});
	const unknownBlockers =
		discovery.worktrees.some((worktree) => worktree.branch) &&
		!discovery.defaultBranch
			? ["default_branch_unknown"]
			: [];
	const blockers = [...discoveryBlockers, ...safetyBlockers, ...unknownBlockers];
	const status =
		discoveryBlockers.length > 0 || safetyBlockers.length > 0
			? "blocked"
			: unknownBlockers.length > 0
				? "unknown"
				: "ok";
	return {
		id: "mutations",
		owner: "doctor",
		status,
		summary:
			blockers.length > 0
				? "Mutation is blocked until repo checks pass."
				: "Mutation checks can proceed.",
		blockers,
		nextActions: status === "ok" ? [] : ["handoff"],
	};
}

function checksFromDiscoveryIssues(discovery: RepoDiscovery): DoctorCheck[] {
	return discovery.issues
		.filter(
			(issue) =>
				issue.code !== "git_root_failed" &&
				issue.code !== "worktree_list_failed",
		)
		.map((issue) => ({
			id: "repo",
			owner: "discovery",
			status: issue.status,
			summary: issue.summary,
			blockers: issue.status === "blocked" ? [issue.code] : [],
			nextActions: ["doctor"],
		}));
}

function aggregateDoctorStatus(
	checks: readonly DoctorCheck[],
): AgentWorktreeStatus {
	if (checks.some((check) => check.status === "blocked")) return "blocked";
	if (checks.some((check) => check.status === "unknown")) return "unknown";
	if (checks.some((check) => check.status === "warn")) return "warn";
	return "ok";
}

function mutationReadinessForStatus(
	status: AgentWorktreeStatus,
): AgentWorktreeMutationReadiness {
	if (status === "ok" || status === "warn") return "ready";
	if (status === "blocked") return "blocked";
	return "unknown";
}

async function collectRetentionSummary(
	discovery: RepoDiscovery,
	run: NonNullable<DiscoverRepoOptions["run"]>,
	now: () => number,
): Promise<{ agedRecordCount: number; agedBackupRefCount: number }> {
	if (!discovery.storeRoot) {
		return { agedRecordCount: 0, agedBackupRefCount: 0 };
	}
	const cutoffMs =
		now() - AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS * 24 * 60 * 60 * 1000;
	const store = createFileStore(discovery.storeRoot);
	const [runs, worktrees, backupRefs] = await Promise.all([
		store.listRuns().catch(() => []),
		store.listWorktrees().catch(() => []),
		listBackupRefTimes(discovery.gitRoot ?? discovery.requestedRoot, run).catch(
			() => [],
		),
	]);
	const agedRecordCount = [
		...runs.flatMap((record) =>
			record.createdAtMs === undefined ? [] : [record.createdAtMs],
		),
		...worktrees.map((record) => record.observedAtMs),
	].filter((timestamp) => timestamp < cutoffMs).length;
	const agedBackupRefCount = backupRefs.filter(
		(timestamp) => timestamp < cutoffMs,
	).length;
	return { agedRecordCount, agedBackupRefCount };
}

async function listBackupRefTimes(
	cwd: string,
	run: NonNullable<DiscoverRepoOptions["run"]>,
): Promise<readonly number[]> {
	const result = await run(
		[
			"git",
			"for-each-ref",
			"--format=%(committerdate:unix)",
			"refs/agent-worktree/backups",
		],
		{ cwd },
	);
	if (!result.ok) return [];
	return result.stdout
		.split(/\r?\n/)
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter(Number.isFinite)
		.map((seconds) => seconds * 1000);
}

/**
 * Scaffold shell: doctor owns repo-operability aggregation.
 *
 * Status: earned.
 * Deletion test: deleting this seam scatters status aggregation, blockers, and
 * next-safe-action routing across every mutation command.
 */
export const DOCTOR_SEAM = {
	id: "doctor",
	ownerPath: "runtime/agent-worktree/src/doctor.ts",
	status: "earned",
	deletionTest:
		"Deleting doctor scatters repo-operability aggregation across mutations.",
	nextUnit: "U2",
} as const satisfies AgentWorktreeSeam;
