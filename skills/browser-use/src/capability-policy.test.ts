import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	OPERATION_CLASS_CAPABILITY,
	authorizesOperationClass,
} from "./capability-policy";

// =========================================================================
// Capability policy (migration U2, KTD4). The live class->capability policy
// hoisted out of the dormant router engine: each Browser Operation class
// authorizes only when its required capability is in the binding's authorized
// set, and live modules carry no import edge back into the dormant cluster.
// =========================================================================

describe("authorizesOperationClass", () => {
	test("authorizes snapshot for a binding carrying snapshot_refs", () => {
		expect(
			authorizesOperationClass(
				{ authorized_capabilities: ["snapshot_refs"] },
				"snapshot",
			),
		).toBe(true);
	});

	test("authorizes screenshot for a binding carrying screenshot_media", () => {
		expect(
			authorizesOperationClass(
				{ authorized_capabilities: ["screenshot_media"] },
				"screenshot",
			),
		).toBe(true);
	});

	test("authorizes emulate for a binding carrying viewport_emulation", () => {
		expect(
			authorizesOperationClass(
				{ authorized_capabilities: ["viewport_emulation"] },
				"emulate",
			),
		).toBe(true);
	});

	test("rejects emulate for a binding without viewport_emulation", () => {
		expect(
			authorizesOperationClass(
				{ authorized_capabilities: ["snapshot_refs", "screenshot_media"] },
				"emulate",
			),
		).toBe(false);
	});

	test("every operation class maps to a distinct capability", () => {
		const capabilities = Object.values(OPERATION_CLASS_CAPABILITY);
		expect(new Set(capabilities).size).toBe(capabilities.length);
	});
});

// R7 import-boundary sweep (migration U2). Live modules must not import from
// the dormant browser-adapter-router-* cluster; only one-way dormant->live
// edges are allowed. Sweeps every live .ts source in src/ (dormant cluster and
// prototype dirs excepted) for an import/export-from pointing at the cluster.
describe("R7 — no live import edge into the dormant router cluster", () => {
	const srcDir = import.meta.dir;

	async function liveModulePaths(): Promise<string[]> {
		const entries = await readdir(srcDir, { withFileTypes: true });
		return entries
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.endsWith(".ts") &&
					!entry.name.startsWith("browser-adapter-router-") &&
					!entry.name.startsWith("prototype-"),
			)
			.map((entry) => join(srcDir, entry.name));
	}

	test("no live module imports a browser-adapter-router-* path", async () => {
		const paths = await liveModulePaths();
		// Sanity: the sweep must actually scan the live surface, not an empty dir.
		expect(paths.length).toBeGreaterThan(10);
		const offenders: string[] = [];
		for (const path of paths) {
			const source = await Bun.file(path).text();
			for (const [index, line] of source.split("\n").entries()) {
				const isImportEdge =
					/(?:import|export)[^"']*from\s*["'][^"']*browser-adapter-router-/.test(
						line,
					) || /import\s*\(\s*["'][^"']*browser-adapter-router-/.test(line);
				if (isImportEdge) {
					offenders.push(`${path}:${index + 1}: ${line.trim()}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
