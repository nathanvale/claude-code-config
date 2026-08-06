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

	// Parse, don't pattern-match: the transpiler's import scan sees exactly the
	// module edges the runtime would resolve — single-line, multiline, dynamic,
	// and export-from forms — and cannot be fooled by comments or string
	// literals that merely mention the cluster.
	function routerImportEdges(source: string): string[] {
		const transpiler = new Bun.Transpiler({ loader: "ts" });
		// The transpiler rejects a shebang (bin entrypoints carry one); the
		// runtime strips it before parsing, so mirror that here.
		return transpiler
			.scanImports(source.replace(/^#!.*\n/, ""))
			.map((edge) => edge.path)
			.filter((specifier) => specifier.includes("browser-adapter-router-"));
	}

	test("no live module imports a browser-adapter-router-* path", async () => {
		const paths = await liveModulePaths();
		// Sanity: the sweep must actually scan the live surface, not an empty dir.
		expect(paths.length).toBeGreaterThan(10);
		const offenders: string[] = [];
		for (const path of paths) {
			const source = await Bun.file(path).text();
			for (const specifier of routerImportEdges(source)) {
				offenders.push(`${path}: imports ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("the edge scanner flags real declarations and ignores comments and strings", () => {
		// Negative: prose mentions of the cluster are not module edges.
		expect(
			routerImportEdges(
				[
					`// import { x } from "./browser-adapter-router-model";`,
					`const note = 'see ./browser-adapter-router-engine for history';`,
					"const template = `import x from \"./browser-adapter-router-model\"`;",
				].join("\n"),
			),
		).toEqual([]);
		// Positive: single-line, multiline, export-from, and dynamic forms all
		// register as edges.
		expect(
			routerImportEdges(`import { a } from "./browser-adapter-router-model";`),
		).toEqual(["./browser-adapter-router-model"]);
		expect(
			routerImportEdges(
				`import {\n\ta,\n\tb,\n} from "./browser-adapter-router-engine";`,
			),
		).toEqual(["./browser-adapter-router-engine"]);
		expect(
			routerImportEdges(`export { a } from "./browser-adapter-router-model";`),
		).toEqual(["./browser-adapter-router-model"]);
		expect(
			routerImportEdges(`const m = await import("./browser-adapter-router-recovery");`),
		).toEqual(["./browser-adapter-router-recovery"]);
	});
});
