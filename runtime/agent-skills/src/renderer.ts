import type { SkillVisibility } from "./model.ts";
import type { AgentSkillsProjectionPlan } from "./projection.ts";

/**
 * Result from a list command.
 */
export interface AgentSkillsListResult {
	/** Listed entries after filters. */
	entries: readonly SkillVisibility[];
	/** Whether explanations are included. */
	why: boolean;
	/** List mode used for rendering. */
	mode: "all" | "visible" | "ignored" | "new";
	/** One concise next action summary. */
	next_action_summary: string;
}

/**
 * Result from an ignore command.
 */
export interface AgentSkillsIgnoreResult {
	/** Ignore subcommand. */
	action: "add" | "remove" | "list" | "suggest";
	/** Configured or suggested patterns. */
	patterns: readonly string[];
	/** Changed pattern for add/remove. */
	changed_pattern?: string;
	/** One concise next action summary. */
	next_action_summary: string;
}

/**
 * Result from unlink command.
 */
export interface AgentSkillsUnlinkResult {
	/** True when running as preview. */
	check: boolean;
	/** Links removed or planned for removal. */
	links: readonly string[];
	/** One concise next action summary. */
	next_action_summary: string;
}

/**
 * Render compact human status output.
 *
 * @param plan - Projection plan from the engine
 * @returns Human-readable status dashboard
 *
 * @example
 * ```typescript
 * const text = renderStatus(plan)
 * ```
 */
export function renderStatus(plan: AgentSkillsProjectionPlan): string {
	const status = plan.status;
	const lines = [
		"agent-skills status",
		`repo: ${status.repo_root}`,
		`catalog: ${status.catalog_root}`,
		`visible: ${status.visible_count}`,
		`ignored: ${status.ignored_count}`,
		`invalid: ${status.invalid_count}`,
		`external: ${status.external_count}`,
		`health: ${status.health}`,
		`last projected: ${status.last_projected_at ?? "none"}`,
		`changes: +${status.newly_visible.length} -${status.removed_since_snapshot.length} write:${status.changes.create_or_update.length + status.changes.remove.length + status.changes.broken.length}`,
		`roots: ${status.checked_roots.join(", ")}`,
	];
	if (status.missing_external_ids.length > 0) {
		lines.push(
			`missing external: ${status.missing_external_ids.length} (${status.missing_external_ids.join(", ")}); restore with: bunx skills experimental_install`,
		);
	}
	for (const broken of status.changes.broken) {
		lines.push(`broken: ${broken}`);
	}
	for (const blocker of status.blockers) {
		lines.push(`blocker: ${blocker.root}/${blocker.id} (${blocker.reason})`);
		if (blocker.why) lines.push(`  why: ${blocker.why}`);
	}
	if (status.lock_parse_failure) {
		lines.push(`note: ${status.lock_parse_failure}`);
	}
	for (const external of status.externals) {
		if (external.shape === "real_entry" && !external.has_hash) {
			lines.push(
				`note: external ${external.root}/${external.id} has no content hash in skills-lock.json`,
			);
		}
	}
	if (status.noise_hint) {
		lines.push(`note: ${status.noise_hint}`);
	}
	lines.push(`next: ${status.next_action_summary}`);
	return `${lines.join("\n")}\n`;
}

/**
 * Render sync or sync check output.
 *
 * @param plan - Projection plan from the engine
 * @param check - Whether writes were previewed only
 * @returns Human-readable sync summary
 *
 * @example
 * ```typescript
 * renderSync(plan, true)
 * ```
 */
export function renderSync(plan: AgentSkillsProjectionPlan, check: boolean): string {
	const prefix = check ? "sync check" : "sync";
	const changes = plan.status.changes;
	return [
		`agent-skills ${prefix}`,
		`health: ${plan.status.health}`,
		`create/update: ${changes.create_or_update.length}`,
		`remove: ${changes.remove.length}`,
		`broken: ${changes.broken.length}`,
		`blockers: ${plan.status.blockers.length}`,
		`next: ${plan.status.next_action_summary}`,
		"",
	].join("\n");
}

/**
 * Render list output.
 *
 * @param result - Filtered list model
 * @returns Human-readable skill list
 *
 * @example
 * ```typescript
 * renderList({ entries, why: true, mode: "all", next_action_summary: "Projection clean." })
 * ```
 */
export function renderList(result: AgentSkillsListResult): string {
	const lines = [`agent-skills list ${result.mode}`];
	// Ignored mode always names the matching rule so the blacklist stays legible.
	const withReason = result.why || result.mode === "ignored";
	for (const entry of result.entries) {
		lines.push(
			withReason
				? `${entry.id}\t${entry.state}\t${entry.reason}`
				: `${entry.id}\t${entry.state}`,
		);
	}
	lines.push(`next: ${result.next_action_summary}`);
	return `${lines.join("\n")}\n`;
}

/**
 * Render ignore command output.
 *
 * @param result - Ignore command model
 * @returns Human-readable ignore summary
 *
 * @example
 * ```typescript
 * renderIgnore({ action: "list", patterns: [], next_action_summary: "No rules." })
 * ```
 */
export function renderIgnore(result: AgentSkillsIgnoreResult): string {
	const lines = [`agent-skills ignore ${result.action}`];
	if (result.changed_pattern) lines.push(`changed: ${result.changed_pattern}`);
	for (const pattern of result.patterns) lines.push(pattern);
	lines.push(`next: ${result.next_action_summary}`);
	return `${lines.join("\n")}\n`;
}

/**
 * Render unlink output.
 *
 * @param result - Unlink command model
 * @returns Human-readable unlink summary
 *
 * @example
 * ```typescript
 * renderUnlink({ check: true, links: [], next_action_summary: "No links." })
 * ```
 */
export function renderUnlink(result: AgentSkillsUnlinkResult): string {
	const lines = [`agent-skills unlink${result.check ? " check" : ""}`];
	lines.push(`links: ${result.links.length}`);
	for (const link of result.links) lines.push(link);
	lines.push(`next: ${result.next_action_summary}`);
	return `${lines.join("\n")}\n`;
}
