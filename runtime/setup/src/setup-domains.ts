import { join } from "node:path";

import { applySetup } from "./apply.ts";
import {
	applyHookTopology,
	inspectHookTopology,
	projectHookTopologyPlan,
	resolveGitHookPath,
	type HookMutationPhase,
} from "./hook-topology.ts";
import { checkInstructionHealth, type InstructionRunner } from "./instruction-health.ts";
import type { SetupDomainResult, SetupFinding, SetupResult } from "./model.ts";
import { acquireOperationLock, inspectOperationLock } from "./operation-lock.ts";
import { checkRunbookHealth } from "./runbook-health.ts";
import { resolveSetupScope } from "./scope.ts";
import { applyStartupTopology, inspectRemovableStartupLinks, inspectStartupTopology } from "./startup-topology.ts";
import { inspectSetup, type SetupInspection, type SetupInspectionInput } from "./inspection.ts";
import { planSetup } from "./planner.ts";
import { unlinkSetup } from "./unlink.ts";
import { rm } from "node:fs/promises";

export interface ApplySetupDomainsOptions {
	readonly stateRoot: string;
	readonly inspect?: (input: SetupInspectionInput) => Promise<SetupInspection>;
	readonly instructionRunner?: InstructionRunner;
	readonly hookPath?: (repoRoot: string) => Promise<string>;
	/** Deterministic pre-syscall seam used to prove apply-time races and failures. */
	readonly beforeSymlink?: (source: string, destination: string) => Promise<void>;
	/** Deterministic hook transaction seam used to prove lock and race behavior. */
	readonly beforeHookMutation?: (phase: HookMutationPhase, path: string) => Promise<void>;
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
	readonly beforeRemove?: (path: string) => Promise<void>;
}

/** Add read-only user-domain evidence to sync check without probing project scope. */
export async function checkSetupDomains(
	input: SetupInspectionInput,
	base: SetupResult,
	options: CheckSetupDomainsOptions,
): Promise<SetupResult> {
	const scope = await resolveSetupScope(input);
	if (base.command === "doctor") {
		const lock = await inspectOperationLock({
			scope: input.scope,
			targetAnchor: scope.target_anchor,
			stateRoot: options.stateRoot,
		});
		if (lock.status === "stale") {
			return {
				...base,
				findings: [...base.findings, {
					id: "stale_operation_lock",
					owner: "setup.operation-lock",
					path: lock.path,
					summary: "An unreclaimed stale setup mutation lock requires inspection.",
					repair: "inspect_lock",
				}],
			};
		}
	}
	if (input.scope === "project") return base;
	const [startupPlan, hookInspection, instruction] = await Promise.all([
		inspectStartupTopology(input.sourceRepoRoot, scope.target_anchor),
		inspectHookDomain(input.sourceRepoRoot, options.stateRoot, options.hookPath),
		checkInstructionHealth(input.sourceRepoRoot, options.instructionRunner),
	]);
	const findings: SetupFinding[] = [...startupPlan.findings, ...hookInspection.findings];
	if (instruction.finding) findings.push(instruction.finding);
	const runbook = checkRunbookHealth(join(input.sourceRepoRoot, "runbooks/issue-to-pr-v2"));
	if (runbook.finding) findings.push(runbook.finding);
	const domains: SetupDomainResult[] = [
		{ domain: "startup", planned: startupPlan.operations.map((item) => item.destination), applied: [], deferred: [], preserved: startupPlan.preserved, failed: [] },
		hookInspection.domain,
		domainWithFailures("instruction", instruction.healthy ? [] : [join(input.sourceRepoRoot, "scripts/agent-instructions.sh")]),
		domainWithFailures("runbook", runbook.healthy ? [] : runbook.missing.map((tag) => `runbook:${tag}`)),
	];
	const planned = [...base.domains, ...domains].reduce((sum, domain) => sum + domain.planned.length, 0);
	const blocked = findings.length > 0 || base.state === "blocked";
	const fresh = base.command === "status" && base.state === "clean_slate";
	const station = base.command === "status"
		? blocked ? "status.blocked" : fresh ? "status.clean_slate" : planned > 0 ? "status.drift" : "status.healthy"
		: blocked ? "sync.check_blocked" : planned > 0 ? "sync.check_changes" : "sync.check_clean";
	const state = base.command === "status"
		? blocked ? "blocked" : fresh ? "clean_slate" : planned > 0 ? "drift" : "healthy"
		: blocked ? "blocked" : planned > 0 ? "changes" : "healthy";
	return {
		...base,
		state,
		station,
		findings: [...base.findings, ...findings],
		domains: [...base.domains, ...domains],
		counts: { ...base.counts, planned, blockers: base.counts.blockers + findings.length },
		next_action: blocked ? "run_doctor" : fresh ? "preview_sync" : planned > 0 ? "run_sync" : "setup_healthy",
		child_output: `${instruction.stdout}${instruction.stderr}`,
	};
}

/** Remove proven startup and skill links under one user lock; copied hooks remain. */
export async function unlinkSetupDomains(input: SetupInspectionInput, options: UnlinkSetupDomainsOptions): Promise<SetupResult> {
	if (input.scope === "project") return unlinkSetup(input, options);
	const scope = await resolveSetupScope(input);
	const startupInspection = await inspectRemovableStartupLinks(input.sourceRepoRoot, scope.target_anchor);
	const removable = startupInspection.removable;
	if (options.check) {
		const projection = await unlinkSetup(input, options);
		const startup = { domain: "startup", planned: removable, applied: [], deferred: [], preserved: startupInspection.preserved, failed: [] } satisfies SetupDomainResult;
		const findings = [...projection.findings, ...startupInspection.findings];
		const blocked = startupInspection.findings.length > 0 || projection.station === "unlink.check_blocked";
		return {
			...projection,
			findings,
			domains: [...projection.domains, startup],
			counts: {
				...projection.counts,
				planned: projection.counts.planned + removable.length,
				blockers: projection.counts.blockers + startupInspection.findings.length,
			},
			state: blocked ? "blocked" : removable.length > 0 ? "changes" : projection.state,
			station: blocked ? "unlink.check_blocked" : removable.length > 0 ? "unlink.check_removable" : projection.station,
			next_action: blocked ? "human_repair" : removable.length > 0 ? "run_unlink" : projection.next_action,
		};
	}
	const lock = await acquireOperationLock({ scope: "user", targetAnchor: scope.target_anchor, stateRoot: options.stateRoot });
	if (lock.status !== "acquired") return unlinkSetup(input, options);
	try {
		const projection = await unlinkSetup(input, { ...options, lockHeld: true });
		const applied: string[] = [];
		const failed: string[] = [];
		const preserved: string[] = [...startupInspection.preserved];
		const findings: SetupFinding[] = [...startupInspection.findings];
		let deferred: readonly string[] = [];
		let concurrent = false;
		for (let index = 0; index < removable.length; index += 1) {
			const path = removable[index];
			if (!path) continue;
			const before = await inspectRemovableStartupLinks(input.sourceRepoRoot, scope.target_anchor);
			mergeStartupEvidence(before, findings, preserved);
			if (!before.removable.includes(path)) { failed.push(path); deferred = removable.slice(index + 1); concurrent = true; break; }
			try {
				await options.beforeRemove?.(path);
				const immediate = await inspectRemovableStartupLinks(input.sourceRepoRoot, scope.target_anchor);
				mergeStartupEvidence(immediate, findings, preserved);
				if (!immediate.removable.includes(path)) {
					failed.push(path);
					deferred = removable.slice(index + 1);
					concurrent = true;
					break;
				}
				await rm(path);
				applied.push(path);
			} catch { failed.push(path); deferred = removable.slice(index + 1); break; }
		}
		const startup: SetupDomainResult = { domain: "startup", planned: removable, applied, deferred, preserved, failed };
		const allFindings = [...projection.findings, ...findings];
		const incomplete = projection.state === "partial" || projection.state === "blocked" || failed.length > 0 || findings.length > 0;
		const any = projection.domains.some((domain) => domain.applied.length > 0) || applied.length > 0;
		return {
			...projection,
			findings: allFindings,
			domains: [...projection.domains, startup],
			state: incomplete ? any ? "partial" : "blocked" : any ? "removed" : "noop",
			station: concurrent ? "unlink.concurrent_change" : incomplete ? "unlink.partial_failure" : any ? "unlink.removed" : "unlink.noop",
			counts: {
				...projection.counts,
				planned: projection.counts.planned + removable.length,
				blockers: projection.counts.blockers + findings.length,
			},
			next_action: concurrent ? "rerun_check" : incomplete ? "inspect_results" : "clean_state",
		};
	} finally { await lock.release(); }
}

function mergeStartupEvidence(
	inspection: Awaited<ReturnType<typeof inspectRemovableStartupLinks>>,
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

/** Compose all user domains under one lock; project scope remains skill-only. */
export async function applySetupDomains(input: SetupInspectionInput, options: ApplySetupDomainsOptions): Promise<SetupResult> {
	if (input.scope === "project") return applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect, beforeSymlink: options.beforeSymlink });
	const scope = await resolveSetupScope(input);
	const homeDir = scope.target_anchor;
	const lock = await acquireOperationLock({ scope: "user", targetAnchor: homeDir, stateRoot: options.stateRoot });
	if (lock.status !== "acquired") {
		return applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect });
	}
	try {
		const inspect = options.inspect ?? inspectSetup;
		const projectionPlan = planSetup(await inspect(input), "sync");
		const startupPlan = await inspectStartupTopology(input.sourceRepoRoot, homeDir);
		const startupPreview: SetupDomainResult = {
			...emptyDomain("startup"),
			planned: startupPlan.operations.map((item) => item.destination),
			preserved: startupPlan.preserved,
		};
		let hookPlan: Awaited<ReturnType<typeof inspectHookTopology>> | undefined;
		let hookPreview = emptyDomain("hooks");
		const extraFindings: SetupFinding[] = [...startupPlan.findings];
		try {
			const hookRoot = await (options.hookPath ?? resolveGitHookPath)(input.sourceRepoRoot);
			hookPlan = await inspectHookTopology(join(input.sourceRepoRoot, "scripts/hooks"), hookRoot, options.stateRoot);
			hookPreview = projectHookTopologyPlan(hookPlan);
			extraFindings.push(...hookPlan.findings);
		} catch (error) {
			extraFindings.push({ id: "hook_unhealthy", owner: "setup.hooks", summary: error instanceof Error ? error.message : String(error), repair: "repair_hooks" });
			hookPreview = { ...hookPreview, failed: ["git-hook-path"] };
		}
		const runbook = checkRunbookHealth(join(input.sourceRepoRoot, "runbooks/issue-to-pr-v2"));
		if (runbook.finding) extraFindings.push(runbook.finding);
		const runbookDomain = domainWithFailures(
			"runbook",
			runbook.healthy ? [] : runbook.missing.map((tag) => `runbook:${tag}`),
		);
		const preMutationBlocked = extraFindings.some((finding) =>
			finding.id === "hook_unhealthy"
			|| finding.id === "runbook_artifact_unhealthy");
		if (preMutationBlocked) {
			const instruction = await checkInstructionHealth(input.sourceRepoRoot, options.instructionRunner);
			if (instruction.finding) extraFindings.push(instruction.finding);
			return aggregate(
				projectionPlan,
				[startupPreview, hookPreview, instructionResultDomain(input.sourceRepoRoot, instruction.healthy), runbookDomain],
				extraFindings,
				`${instruction.stdout}${instruction.stderr}`,
			);
		}

		const startup = await applyStartupTopology(startupPlan);
		const instruction = await checkInstructionHealth(input.sourceRepoRoot, options.instructionRunner);
		if (instruction.finding) extraFindings.push(instruction.finding);
		const instructionDomain = instructionResultDomain(input.sourceRepoRoot, instruction.healthy);
		if (!instruction.healthy) {
			return aggregate(
				projectionPlan,
				[startup, hookPreview, instructionDomain, runbookDomain],
				extraFindings,
				`${instruction.stdout}${instruction.stderr}`,
			);
		}

		const projection = await applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect, lockHeld: true, beforeSymlink: options.beforeSymlink });
		const hook = hookPlan
			? await applyHookTopology(hookPlan, { beforeMutation: options.beforeHookMutation })
			: hookPreview;
		return aggregate(projection, [startup, hook, instructionDomain, runbookDomain], extraFindings, `${instruction.stdout}${instruction.stderr}`);
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

function instructionResultDomain(repoRoot: string, healthy: boolean): SetupDomainResult {
	return domainWithFailures("instruction", healthy ? [] : [join(repoRoot, "scripts/agent-instructions.sh")]);
}

async function inspectHookDomain(
	repoRoot: string,
	stateRoot: string,
	hookPath?: (repoRoot: string) => Promise<string>,
): Promise<{ domain: SetupDomainResult; findings: readonly SetupFinding[] }> {
	try {
		const hookRoot = await (hookPath ?? resolveGitHookPath)(repoRoot);
		const plan = await inspectHookTopology(join(repoRoot, "scripts/hooks"), hookRoot, stateRoot);
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

function aggregate(base: SetupResult, domains: readonly SetupDomainResult[], findings: readonly SetupFinding[], childOutput: string): SetupResult {
	const all = [...base.domains, ...domains];
	const allFindings = [...base.findings, ...findings];
	const applied = all.some((domain) => domain.applied.length > 0);
	const incomplete = base.state === "blocked" || base.state === "partial" || base.counts.blockers > 0 || findings.length > 0 || all.some((domain) => domain.failed.length > 0 || domain.deferred.length > 0);
	const partial = base.state === "partial" || (incomplete && applied);
	const state = incomplete ? (partial ? "partial" : "blocked") : applied ? "applied" : "noop";
	const station = incomplete ? (partial ? "sync.partial" : healthStation(allFindings)) : applied ? "sync.applied" : "sync.noop";
	return {
		...base,
		state,
		station,
		findings: allFindings,
		domains: all,
		counts: { ...base.counts, planned: all.reduce((sum, domain) => sum + domain.planned.length, 0), blockers: base.counts.blockers + findings.length },
		next_action: incomplete
			? partial ? "inspect_results" : repairAction(allFindings)
			: "setup_healthy",
		child_output: childOutput,
	};
}

function repairAction(findings: readonly SetupFinding[]) {
	if (findings.some((finding) => finding.id === "hook_ownership_unproven")) return "human_repair" as const;
	if (findings.some((finding) => finding.id === "hook_unhealthy")) return "repair_hooks" as const;
	if (findings.some((finding) => finding.id === "instruction_unhealthy")) return "repair_instructions" as const;
	if (findings.some((finding) => finding.id === "runbook_artifact_unhealthy")) return "repair_runbook" as const;
	return "run_doctor" as const;
}

function healthStation(findings: readonly SetupFinding[]): string {
	if (findings.some((finding) => finding.id === "hook_ownership_unproven")) return "sync.blocked";
	if (findings.some((finding) => finding.id === "hook_unhealthy")) return "sync.hook_failure";
	if (findings.some((finding) => finding.id === "instruction_unhealthy")) return "sync.instruction_failure";
	if (findings.some((finding) => finding.id === "runbook_artifact_unhealthy")) return "sync.runbook_failure";
	return "sync.blocked";
}
