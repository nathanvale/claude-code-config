import type { SetupResult } from "./model.ts";

/** Human rendering options kept separate from result semantics. */
export interface SetupRenderOptions {
	verbose: boolean;
}

/** Render the bounded status or check dashboard. */
export function renderSetupResult(
	result: SetupResult,
	options: SetupRenderOptions,
): string {
	const lines = [
		`setup ${result.command}`,
		`scope: ${result.scope}`,
		`state: ${result.state}`,
		`catalog: ${result.catalog_root}`,
		`destinations: ${result.destination_roots.join(", ")}`,
		`counts: catalog=${result.counts.catalog} managed=${result.counts.managed} external=${result.counts.external} planned=${result.counts.planned} blockers=${result.counts.blockers}`,
	];
	if (options.verbose) {
		for (const operation of result.operations) {
			lines.push(`${operation.action}: ${operation.destination} -> ${operation.desired_source}`);
		}
		for (const finding of result.findings) {
			lines.push(`finding: ${finding.id}${finding.path ? ` ${finding.path}` : ""}`);
		}
	}
	lines.push(`next: ${result.next_action ?? "setup_healthy"}`);
	return `${lines.join("\n")}\n`;
}

/** Render doctor evidence with ownership, impact, and repair guidance. */
export function renderDoctor(result: SetupResult): string {
	const lines = ["setup doctor", `scope: ${result.scope}`, `state: ${result.state}`];
	for (const finding of result.findings) {
		lines.push(`${finding.id}: ${finding.summary}`);
		lines.push(`  owner: ${finding.owner}`);
		lines.push(`  why: ${finding.why ?? "Inspect the recorded evidence before changing state."}`);
		lines.push(`  repair: ${finding.repair}`);
		if (finding.path) lines.push(`  path: ${finding.path}`);
	}
	lines.push(`next: ${result.next_action ?? "setup_healthy"}`);
	return `${lines.join("\n")}\n`;
}

/** Render catalog entries and occupancy decisions. */
export function renderCatalog(result: SetupResult): string {
	const lines = ["setup catalog", `root: ${result.catalog_root}`];
	for (const entry of result.catalog_entries ?? []) {
		lines.push(`${entry.id}\t${entry.state}\t${entry.occupancy.join(",") || "unoccupied"}`);
	}
	lines.push(`next: ${result.next_action ?? "inspect_catalog"}`);
	return `${lines.join("\n")}\n`;
}
