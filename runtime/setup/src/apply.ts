import { mkdir, realpath, rm, symlink } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import { canonicalSkillId } from "./catalog.ts";
import { inspectSetup, type SetupInspection, type SetupInspectionInput } from "./inspection.ts";
import type { SetupDomainResult, SetupFinding, SetupOperation, SetupResult } from "./model.ts";
import { classifyProjectionPath } from "./ownership.ts";
import { acquireOperationLock, acquireVisibilityLocks } from "./operation-lock.ts";
import { isInsideOrEqual } from "./path-safety.ts";
import { planSetup } from "./planner.ts";
import { resolveSetupScope } from "./scope.ts";

export interface ApplySetupOptions {
	readonly stateRoot: string;
	readonly inspect?: (input: SetupInspectionInput) => Promise<SetupInspection>;
	readonly beforeSymlink?: (source: string, destination: string) => Promise<void>;
	/** Caller already owns the scope lock while composing independent domains. */
	readonly lockHeld?: boolean;
}

/** Reinspect, lock, preflight the full projection, then apply serially. */
export async function applySetup(
	input: SetupInspectionInput,
	options: ApplySetupOptions,
): Promise<SetupResult> {
	const initialScope = await resolveSetupScope(input);
	const lock = options.lockHeld ? { status: "acquired" as const, path: "caller-owned", release: async () => {} } : await acquireOperationLock({
		scope: input.scope,
		targetAnchor: initialScope.target_anchor,
		stateRoot: options.stateRoot,
	});
	if (lock.status !== "acquired") return lockResult(input, initialScope, lock.status, lock.path);
	let visibilityLock: Awaited<ReturnType<typeof acquireVisibilityLocks>> | undefined;
	try {
		const inspect = options.inspect ?? inspectSetup;
		const preliminary = await inspect(input);
		const lockedIds = visibilityIds(preliminary);
		visibilityLock = await acquireVisibilityLocks({ canonicalIds: lockedIds, stateRoot: options.stateRoot });
		if (visibilityLock.status !== "acquired") {
			return lockResult(input, initialScope, visibilityLock.status, visibilityLock.path);
		}
		const inspection = await inspect(input);
		const plan = planSetup(inspection, "sync");
		if (visibilityIds(inspection).some((id) => !lockedIds.includes(id))) {
			return mutationResult(plan, [], plan.operations.map((item) => item.destination), [], "sync.concurrent_change");
		}
		if (plan.state === "blocked") {
			return { ...plan, state: "blocked", station: "sync.blocked", next_action: "human_repair" };
		}
		if (plan.operations.length === 0) {
			return { ...plan, state: "noop", station: "sync.noop", next_action: "setup_healthy" };
		}

		for (const operation of plan.operations) {
			if (!(await operationMatches(input, inspection, operation, operation.expected_ownership))) {
				return mutationResult(plan, [], plan.operations.map((item) => item.destination), [], "sync.concurrent_change");
			}
		}

		const applied: string[] = [];
		for (let index = 0; index < plan.operations.length; index += 1) {
			const operation = plan.operations[index];
			if (!operation) continue;
			const remaining = plan.operations.slice(index).map((item) => item.destination);
			try {
				if (!(await operationMatches(input, inspection, operation, operation.expected_ownership))) {
					return mutationResult(plan, applied, remaining, [], "sync.concurrent_change");
				}
				await ensureRoot(input, operation);
				if (operation.action === "relink") {
					if (!(await operationMatches(input, inspection, operation, operation.expected_ownership))) {
						return mutationResult(plan, applied, remaining, [], "sync.concurrent_change");
					}
					await rm(operation.destination);
				}
				await options.beforeSymlink?.(linkValue(operation), operation.destination);
				if (!(await operationMatches(input, inspection, operation, "missing"))) {
					return mutationResult(plan, applied, remaining, [], "sync.concurrent_change");
				}
				await symlink(linkValue(operation), operation.destination);
				applied.push(operation.destination);
			} catch {
				return mutationResult(plan, applied, remaining.slice(1), [operation.destination], "sync.apply_failure");
			}
		}
		return mutationResult(plan, applied, [], [], "sync.applied");
	} finally {
		try {
			if (visibilityLock?.status === "acquired") await visibilityLock.release();
		} finally {
			await lock.release();
		}
	}
}

function visibilityIds(inspection: SetupInspection): string[] {
	return inspection.catalog.entries
		.filter((entry) => entry.state === "valid")
		.map((entry) => entry.canonical_id)
		.sort((left, right) => left.localeCompare(right));
}

function linkValue(operation: SetupOperation): string {
	return operation.link_form === "absolute"
		? resolve(operation.desired_source)
		: relative(dirname(operation.destination), resolve(operation.desired_source));
}

async function ensureRoot(input: SetupInspectionInput, operation: SetupOperation): Promise<void> {
	const scope = await resolveSetupScope(input);
	const root = scope.projection_roots.find((entry) => entry.id === operation.root_id);
	if (!root?.safe || resolve(root.path) !== resolve(operation.root_path)) throw new Error("unsafe_root");
	await mkdir(operation.root_path, { recursive: true });
}

async function operationMatches(
	input: SetupInspectionInput,
	inspection: SetupInspection,
	operation: SetupOperation,
	expected: SetupOperation["expected_ownership"] | "missing",
): Promise<boolean> {
	const scope = await resolveSetupScope(input);
	const root = scope.projection_roots.find((entry) => entry.id === operation.root_id);
	if (!root?.safe || resolve(root.path) !== resolve(operation.root_path)) return false;
	let source: string;
	let catalog: string;
	let repository: string;
	try {
		[source, catalog, repository] = await Promise.all([
			realpath(operation.desired_source),
			realpath(scope.catalog_root),
			realpath(scope.source_anchor),
		]);
	} catch {
		return false;
	}
	if (!isInsideOrEqual(repository, catalog)) return false;
	if (!isInsideOrEqual(catalog, source)) return false;
	if (canonicalSkillId(basename(source)) !== operation.canonical_id) return false;
	const current = await classifyProjectionPath({
		root,
		path: operation.destination,
		id: operation.id,
		catalogRoot: scope.catalog_root,
		providerEvidence: inspection.provider_evidence,
	});
	return expected === "missing" ? current === undefined : current?.ownership === expected;
}

function mutationResult(
	plan: SetupResult,
	applied: readonly string[],
	deferred: readonly string[],
	failed: readonly string[],
	station: "sync.applied" | "sync.concurrent_change" | "sync.apply_failure",
): SetupResult {
	const domain: SetupDomainResult = {
		domain: "skill_projection",
		planned: plan.operations.map((operation) => operation.destination),
		applied: [...applied],
		deferred: [...deferred],
		preserved: plan.domains[0]?.preserved ?? [],
		failed: [...failed],
	};
	const state = station === "sync.applied" ? "applied" : "partial";
	return {
		...plan,
		state,
		station,
		next_action: station === "sync.applied" ? "setup_healthy"
			: station === "sync.concurrent_change" ? "rerun_check" : "inspect_results",
		domains: [domain],
	};
}

function lockResult(
	input: SetupInspectionInput,
	scope: Awaited<ReturnType<typeof resolveSetupScope>>,
	status: "busy" | "stale",
	path: string,
): SetupResult {
	const finding: SetupFinding = {
		id: status === "busy" ? "operation_busy" : "stale_operation_lock",
		owner: "setup.operation-lock",
		path,
		summary: status === "busy" ? "Another setup mutation owns this lock." : "An unreclaimed stale setup mutation lock requires inspection.",
		repair: status === "busy" ? "retry" : "inspect_lock",
	};
	return {
		command: "sync", scope: input.scope, state: "blocked", findings: [finding], domains: [], operations: [], projection_targets: [],
		counts: { catalog: 0, managed: 0, external: 0, planned: 0, blockers: 1 },
		catalog_root: scope.catalog_root, destination_roots: scope.projection_roots.map((root) => root.path),
		station: status === "busy" ? "sync.operation_busy" : "sync.blocked",
		next_action: status === "busy" ? "retry" : "inspect_lock",
	};
}
