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
		`setup ${escapeHuman(result.command)}`,
		`scope: ${escapeHuman(result.scope)}`,
		`state: ${escapeHuman(result.state)}`,
		`catalog: ${escapeHuman(result.catalog_root)}`,
		`destinations: ${result.destination_roots.map(escapeHuman).join(", ")}`,
		`counts: catalog=${result.counts.catalog} managed=${result.counts.managed} external=${result.counts.external} planned=${result.counts.planned} blockers=${result.counts.blockers}`,
	];
	if (options.verbose) {
		for (const domain of result.domains) {
			lines.push(`domain: ${escapeHuman(domain.domain)}`);
			for (const category of ["planned", "applied", "deferred", "preserved", "failed"] as const) {
				const paths = domain[category];
				if (paths.length === 0) lines.push(`  ${category}: (none)`);
				for (const path of paths) lines.push(`  ${category}: ${escapeHuman(path)}`);
			}
		}
		for (const operation of result.operations) {
			lines.push(`${escapeHuman(operation.action)}: ${escapeHuman(operation.destination)} -> ${escapeHuman(operation.desired_source)}`);
		}
		for (const finding of result.findings) {
			lines.push(`finding: ${escapeHuman(finding.id)}${finding.path ? ` ${escapeHuman(finding.path)}` : ""}`);
		}
	}
	lines.push(`next: ${escapeHuman(result.next_action ?? "setup_healthy")}`);
	return `${lines.join("\n")}\n`;
}

/** Render doctor evidence with ownership, impact, and repair guidance. */
export function renderDoctor(result: SetupResult): string {
	const lines = ["setup doctor", `scope: ${escapeHuman(result.scope)}`, `state: ${escapeHuman(result.state)}`];
	for (const finding of result.findings) {
		lines.push(`${escapeHuman(finding.id)}: ${escapeHuman(finding.summary)}`);
		lines.push(`  owner: ${escapeHuman(finding.owner)}`);
		lines.push(`  why: ${escapeHuman(finding.why ?? "Inspect the recorded evidence before changing state.")}`);
		lines.push(`  repair: ${escapeHuman(finding.repair)}`);
		if (finding.path) lines.push(`  path: ${escapeHuman(finding.path)}`);
	}
	lines.push(`next: ${escapeHuman(result.next_action ?? "setup_healthy")}`);
	return `${lines.join("\n")}\n`;
}

/** Render catalog entries and occupancy decisions. */
export function renderCatalog(result: SetupResult): string {
	const lines = ["setup catalog", `root: ${escapeHuman(result.catalog_root)}`];
	for (const entry of result.catalog_entries ?? []) {
		lines.push(`${escapeHuman(entry.id)}\t${escapeHuman(entry.state)}\t${entry.occupancy.map(escapeHuman).join(",") || "unoccupied"}`);
	}
	lines.push(`next: ${escapeHuman(result.next_action ?? "inspect_catalog")}`);
	return `${lines.join("\n")}\n`;
}

function escapeHuman(value: string): string {
	let escaped = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		escaped += codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
			? `\\x${codePoint.toString(16).padStart(2, "0")}`
			: character;
	}
	return escaped;
}
