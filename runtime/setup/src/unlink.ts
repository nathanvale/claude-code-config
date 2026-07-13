import { rm } from "node:fs/promises";

import { inspectSetup, type SetupInspection, type SetupInspectionInput } from "./inspection.ts";
import type { SetupDomainResult, SetupFinding, SetupResult } from "./model.ts";
import { classifyProjectionPath } from "./ownership.ts";
import { acquireOperationLock } from "./operation-lock.ts";
import { resolveSetupScope } from "./scope.ts";

export interface UnlinkSetupOptions {
	readonly check?: boolean;
	readonly stateRoot: string;
	readonly inspect?: (input: SetupInspectionInput) => Promise<SetupInspection>;
	readonly beforeRemove?: (path: string) => Promise<void>;
	readonly lockHeld?: boolean;
}

/** Preview or remove only links whose current target proves selected-catalog ownership. */
export async function unlinkSetup(
	input: SetupInspectionInput,
	options: UnlinkSetupOptions,
): Promise<SetupResult> {
	const scope = await resolveSetupScope(input);
	if (options.check) return unlinkWithInspection(input, await (options.inspect ?? inspectSetup)(input), true);
	const lock = options.lockHeld ? { status: "acquired" as const, path: "caller-owned", release: async () => {} } : await acquireOperationLock({ scope: input.scope, targetAnchor: scope.target_anchor, stateRoot: options.stateRoot });
	if (lock.status !== "acquired") return unlinkLockResult(input, scope, lock.status, lock.path);
	try {
		return unlinkWithInspection(input, await (options.inspect ?? inspectSetup)(input), false, options.beforeRemove);
	} finally {
		await lock.release();
	}
}

async function unlinkWithInspection(
	input: SetupInspectionInput,
	inspection: SetupInspection,
	check: boolean,
	beforeRemove?: (path: string) => Promise<void>,
): Promise<SetupResult> {
	const removable = inspection.ownership.entries
		.filter((entry) => entry.shape === "symlink" && (entry.ownership === "managed_link" || entry.ownership === "broken_managed_link"))
		.map((entry) => entry.path)
		.sort();
	const removablePaths = new Set(removable);
	const preserved = inspection.ownership.entries
		.filter((entry) => !removablePaths.has(entry.path))
		.map((entry) => entry.path)
		.sort();
	if (inspection.findings.some((finding) => finding.id === "unsafe_root")) {
		return unlinkResult({ input, inspection, planned: removable, applied: [], deferred: removable, preserved, station: "unlink.check_blocked" });
	}
	if (check || removable.length === 0) {
		return unlinkResult({
			input, inspection, planned: removable, applied: [], deferred: [], preserved,
			station: check && removable.length > 0 ? "unlink.check_removable" : check ? "unlink.check_noop" : "unlink.noop",
		});
	}
	const applied: string[] = [];
	for (let index = 0; index < removable.length; index += 1) {
		const path = removable[index];
		if (!path) continue;
		const entry = inspection.ownership.entries.find((candidate) => candidate.path === path);
		const root = inspection.scope.projection_roots.find((candidate) => candidate.id === entry?.root_id);
		const freshScope = await resolveSetupScope(input);
		const freshRoot = freshScope.projection_roots.find((candidate) => candidate.id === entry?.root_id);
		if (!entry || !root || !freshRoot?.safe || freshRoot.path !== root.path) {
			return unlinkResult({ input, inspection, planned: removable, applied, deferred: removable.slice(index), preserved, station: "unlink.concurrent_change" });
		}
		const current = await classifyProjectionPath({ root: freshRoot, path, id: entry.id, catalogRoot: freshScope.catalog_root, providerEvidence: inspection.provider_evidence });
		if (current?.shape !== "symlink" || (current.ownership !== "managed_link" && current.ownership !== "broken_managed_link")) {
			return unlinkResult({ input, inspection, planned: removable, applied, deferred: removable.slice(index), preserved, station: "unlink.concurrent_change" });
		}
		try {
			await beforeRemove?.(path);
			const revalidated = await classifyProjectionPath({
				root: freshRoot,
				path,
				id: entry.id,
				catalogRoot: freshScope.catalog_root,
				providerEvidence: inspection.provider_evidence,
			});
			if (
				revalidated?.shape !== "symlink" ||
				(revalidated.ownership !== "managed_link" &&
					revalidated.ownership !== "broken_managed_link")
			) {
				return unlinkResult({
					input, inspection, planned: removable, applied,
					deferred: removable.slice(index), preserved, station: "unlink.concurrent_change",
				});
			}
			await rm(path);
			applied.push(path);
		} catch {
			return unlinkResult({
				input, inspection, planned: removable, applied,
				deferred: removable.slice(index), preserved, station: "unlink.partial_failure", failed: [path],
			});
		}
	}
	return unlinkResult({ input, inspection, planned: removable, applied, deferred: [], preserved, station: "unlink.removed" });
}

interface UnlinkResultInput {
	readonly input: SetupInspectionInput;
	readonly inspection: SetupInspection;
	readonly planned: readonly string[];
	readonly applied: readonly string[];
	readonly deferred: readonly string[];
	readonly preserved: readonly string[];
	readonly station: string;
	readonly failed?: readonly string[];
}

function unlinkResult({
	input, inspection, planned, applied, deferred, preserved, station, failed = [],
}: UnlinkResultInput): SetupResult {
	const domain: SetupDomainResult = { domain: "skill_projection", planned, applied, deferred, preserved, failed };
	const state = station === "unlink.removed" ? "removed" : station === "unlink.noop" || station === "unlink.check_noop" ? "noop" : station === "unlink.check_removable" ? "changes" : "partial";
	return {
		command: "unlink", scope: input.scope, state, findings: inspection.findings, domains: [domain], operations: [], projection_targets: [],
		counts: { catalog: inspection.catalog.entries.length, managed: removableCount(inspection), external: inspection.ownership.entries.filter((entry) => entry.ownership === "external_entry").length, planned: planned.length, blockers: 0 },
		catalog_root: inspection.catalog.root, destination_roots: inspection.scope.projection_roots.map((root) => root.path), station,
		next_action: station === "unlink.check_removable" ? "run_unlink"
			: station === "unlink.check_blocked" ? "human_repair"
				: station === "unlink.concurrent_change" ? "rerun_check"
					: station === "unlink.partial_failure" ? "inspect_results" : "clean_state",
	};
}

function removableCount(inspection: SetupInspection): number {
	return inspection.ownership.entries.filter((entry) => entry.ownership === "managed_link" || entry.ownership === "broken_managed_link").length;
}

function unlinkLockResult(
	input: SetupInspectionInput,
	scope: Awaited<ReturnType<typeof resolveSetupScope>>,
	status: "busy" | "stale",
	path: string,
): SetupResult {
	const finding: SetupFinding = { id: status === "busy" ? "operation_busy" : "stale_operation_lock", owner: "setup.operation-lock", path, summary: "Setup mutation lock prevents unlink.", repair: status === "busy" ? "retry" : "inspect_lock" };
	return { command: "unlink", scope: input.scope, state: "blocked", findings: [finding], domains: [], operations: [], projection_targets: [], counts: { catalog: 0, managed: 0, external: 0, planned: 0, blockers: 1 }, catalog_root: scope.catalog_root, destination_roots: scope.projection_roots.map((root) => root.path), station: status === "busy" ? "unlink.operation_busy" : "unlink.check_blocked", next_action: status === "busy" ? "retry" : "inspect_lock" };
}
