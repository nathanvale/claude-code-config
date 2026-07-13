import { join } from "node:path";

import { applySetup } from "./apply.ts";
import { applyHookTopology, inspectHookTopology, resolveGitHookPath } from "./hook-topology.ts";
import { checkInstructionHealth, type InstructionRunner } from "./instruction-health.ts";
import type { SetupDomainResult, SetupFinding, SetupResult } from "./model.ts";
import { acquireOperationLock } from "./operation-lock.ts";
import { checkRunbookHealth } from "./runbook-health.ts";
import { resolveSetupScope } from "./scope.ts";
import { applyStartupTopology, inspectStartupTopology } from "./startup-topology.ts";
import { removableStartupLinks } from "./startup-topology.ts";
import type { SetupInspection, SetupInspectionInput } from "./inspection.ts";
import { unlinkSetup } from "./unlink.ts";
import { rm } from "node:fs/promises";

export interface ApplySetupDomainsOptions {
	readonly stateRoot: string;
	readonly inspect?: (input: SetupInspectionInput) => Promise<SetupInspection>;
	readonly instructionRunner?: InstructionRunner;
	readonly hookPath?: (repoRoot: string) => Promise<string>;
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
	options: Omit<ApplySetupDomainsOptions, "stateRoot">,
): Promise<SetupResult> {
	if (input.scope === "project") return base;
	const scope = await resolveSetupScope(input);
	const startupPlan = await inspectStartupTopology(input.sourceRepoRoot, scope.target_anchor);
	let hook = emptyDomain("hooks");
	const findings: SetupFinding[] = [...startupPlan.findings];
	try {
		const hookRoot = await (options.hookPath ?? resolveGitHookPath)(input.sourceRepoRoot);
		const hookPlan = await inspectHookTopology(join(input.sourceRepoRoot, "scripts/hooks"), hookRoot);
		hook = { domain: "hooks", planned: hookPlan.operations.map((item) => item.destination), applied: [], deferred: [], preserved: hookPlan.preserved, failed: [] };
		findings.push(...hookPlan.findings);
	} catch (error) {
		findings.push({ id: "hook_unhealthy", owner: "setup.hooks", summary: error instanceof Error ? error.message : String(error), repair: "repair_hooks" });
	}
	const instruction = await checkInstructionHealth(input.sourceRepoRoot, options.instructionRunner);
	if (instruction.finding) findings.push(instruction.finding);
	const runbook = checkRunbookHealth(join(input.sourceRepoRoot, "runbooks/issue-to-pr-v2"));
	if (runbook.finding) findings.push(runbook.finding);
	const domains: SetupDomainResult[] = [
		{ domain: "startup", planned: startupPlan.operations.map((item) => item.destination), applied: [], deferred: [], preserved: startupPlan.preserved, failed: [] },
		hook,
		{ ...emptyDomain("instruction"), failed: instruction.healthy ? [] : [join(input.sourceRepoRoot, "scripts/agent-instructions.sh")] },
		{ ...emptyDomain("runbook"), failed: runbook.healthy ? [] : runbook.missing.map((tag) => `runbook:${tag}`) },
	];
	const planned = [...base.domains, ...domains].reduce((sum, domain) => sum + domain.planned.length, 0);
	const blocked = findings.length > 0 || base.state === "blocked";
	const fresh = base.command === "status" && base.state === "clean_slate";
	const station = base.command === "status"
		? blocked ? "status.blocked" : fresh ? "status.clean_slate" : planned > 0 ? "status.drift" : "status.healthy"
		: blocked ? "sync.check_blocked" : planned > 0 ? "sync.check_changes" : "sync.check_clean";
	const state = base.command === "status"
		? blocked ? "blocked" : fresh ? "clean_slate" : planned > 0 ? "drift" : "healthy"
		: blocked ? "blocked" : planned > 0 ? "changes" : "noop";
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
	const removable = await removableStartupLinks(input.sourceRepoRoot, scope.target_anchor);
	if (options.check) {
		const projection = await unlinkSetup(input, options);
		const startup = { domain: "startup", planned: removable, applied: [], deferred: [], preserved: [], failed: [] } satisfies SetupDomainResult;
		return { ...projection, domains: [...projection.domains, startup], counts: { ...projection.counts, planned: projection.counts.planned + removable.length }, state: removable.length > 0 ? "changes" : projection.state, station: removable.length > 0 ? "unlink.check_removable" : projection.station, next_action: removable.length > 0 ? "run_unlink" : projection.next_action };
	}
	const lock = await acquireOperationLock({ scope: "user", targetAnchor: scope.target_anchor, stateRoot: options.stateRoot });
	if (lock.status !== "acquired") return unlinkSetup(input, options);
	try {
		const projection = await unlinkSetup(input, { ...options, lockHeld: true });
		const applied: string[] = [];
		const failed: string[] = [];
		let concurrent = false;
		for (const path of removable) {
			if (!(await removableStartupLinks(input.sourceRepoRoot, scope.target_anchor)).includes(path)) { failed.push(path); break; }
			try {
				await options.beforeRemove?.(path);
				if (!(await removableStartupLinks(input.sourceRepoRoot, scope.target_anchor)).includes(path)) {
					failed.push(path);
					concurrent = true;
					break;
				}
				await rm(path);
				applied.push(path);
			} catch { failed.push(path); break; }
		}
		const startup: SetupDomainResult = { domain: "startup", planned: removable, applied, deferred: removable.slice(applied.length + failed.length), preserved: [], failed };
		const incomplete = projection.state === "partial" || projection.state === "blocked" || failed.length > 0;
		const any = projection.domains.some((domain) => domain.applied.length > 0) || applied.length > 0;
		return { ...projection, domains: [...projection.domains, startup], state: incomplete ? "partial" : any ? "removed" : "noop", station: concurrent ? "unlink.concurrent_change" : incomplete ? "unlink.partial_failure" : any ? "unlink.removed" : "unlink.noop", counts: { ...projection.counts, planned: projection.counts.planned + removable.length }, next_action: concurrent ? "rerun_check" : incomplete ? "inspect_results" : "clean_state" };
	} finally { await lock.release(); }
}

/** Compose all user domains under one lock; project scope remains skill-only. */
export async function applySetupDomains(input: SetupInspectionInput, options: ApplySetupDomainsOptions): Promise<SetupResult> {
	if (input.scope === "project") return applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect });
	const scope = await resolveSetupScope(input);
	const homeDir = scope.target_anchor;
	const lock = await acquireOperationLock({ scope: "user", targetAnchor: homeDir, stateRoot: options.stateRoot });
	if (lock.status !== "acquired") {
		return applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect });
	}
	try {
		const projection = await applySetup(input, { stateRoot: options.stateRoot, inspect: options.inspect, lockHeld: true });
		const startupPlan = await inspectStartupTopology(input.sourceRepoRoot, homeDir);
		const startup = await applyStartupTopology(startupPlan);
		let hook: SetupDomainResult = emptyDomain("hooks");
		const extraFindings: SetupFinding[] = [...startupPlan.findings];
		try {
			const hookRoot = await (options.hookPath ?? resolveGitHookPath)(input.sourceRepoRoot);
			const hookPlan = await inspectHookTopology(join(input.sourceRepoRoot, "scripts/hooks"), hookRoot);
			hook = await applyHookTopology(hookPlan);
			extraFindings.push(...hookPlan.findings);
		} catch (error) {
			extraFindings.push({ id: "hook_unhealthy", owner: "setup.hooks", summary: error instanceof Error ? error.message : String(error), repair: "repair_hooks" });
			hook = { ...hook, failed: ["git-hook-path"] };
		}
		const instruction = await checkInstructionHealth(input.sourceRepoRoot, options.instructionRunner);
		if (instruction.finding) extraFindings.push(instruction.finding);
		const instructionDomain: SetupDomainResult = {
			domain: "instruction", planned: [], applied: [], deferred: [], preserved: [],
			failed: instruction.healthy ? [] : [join(input.sourceRepoRoot, "scripts/agent-instructions.sh")],
		};
		const runbook = checkRunbookHealth(join(input.sourceRepoRoot, "runbooks/issue-to-pr-v2"));
		if (runbook.finding) extraFindings.push(runbook.finding);
		const runbookDomain: SetupDomainResult = {
			domain: "runbook", planned: [], applied: [], deferred: [], preserved: [],
			failed: runbook.healthy ? [] : runbook.missing.map((tag) => `runbook:${tag}`),
		};
		return aggregate(projection, [startup, hook, instructionDomain, runbookDomain], extraFindings, `${instruction.stdout}${instruction.stderr}`);
	} finally {
		await lock.release();
	}
}

function emptyDomain(domain: string): SetupDomainResult {
	return { domain, planned: [], applied: [], deferred: [], preserved: [], failed: [] };
}

function aggregate(base: SetupResult, domains: readonly SetupDomainResult[], findings: readonly SetupFinding[], childOutput: string): SetupResult {
	const all = [...base.domains, ...domains];
	const applied = all.some((domain) => domain.applied.length > 0);
	const incomplete = findings.length > 0 || all.some((domain) => domain.failed.length > 0 || domain.deferred.length > 0);
	const state = incomplete ? (applied ? "partial" : "blocked") : applied ? "applied" : "noop";
	const station = incomplete ? (applied ? "sync.partial" : healthStation(findings, base.station)) : applied ? "sync.applied" : "sync.noop";
	return {
		...base,
		state,
		station,
		findings: [...base.findings, ...findings],
		domains: all,
		counts: { ...base.counts, planned: all.reduce((sum, domain) => sum + domain.planned.length, 0), blockers: base.counts.blockers + findings.length },
		next_action: incomplete ? (applied ? "inspect_results" : "run_doctor") : "setup_healthy",
		child_output: childOutput,
	};
}

function healthStation(findings: readonly SetupFinding[], fallback: string): string {
	if (findings.some((finding) => finding.id === "hook_unhealthy")) return "sync.hook_failure";
	if (findings.some((finding) => finding.id === "instruction_unhealthy")) return "sync.instruction_failure";
	if (findings.some((finding) => finding.id === "runbook_artifact_unhealthy")) return "sync.runbook_failure";
	return fallback === "sync.blocked" ? fallback : "sync.blocked";
}
