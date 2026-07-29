import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	readdirSync,
	readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importBrowserUseCorpus } from "./browser-use-corpus-import";
import { runForTest } from "./browser-use";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

const disposables: Array<{ dispose(): void }> = [];
const fixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"full-root-corpus",
);

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

function sourceBytes(root: string): readonly (readonly [string, string])[] {
	const rows: Array<readonly [string, string]> = [];
	const walk = (directory: string, prefix: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
			(left, right) => left.name.localeCompare(right.name),
		)) {
			const path = join(directory, entry.name);
			const relativePath =
				prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(path, relativePath);
			} else {
				rows.push([
					relativePath,
					createHash("sha256").update(readFileSync(path)).digest("hex"),
				]);
			}
		}
	};
	walk(root, "");
	return rows;
}

describe("importBrowserUseCorpus", () => {
	test("public import, activate, and run reach every migrated target", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		const imported = await runForTest(
			["migration", "import", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(imported.exitCode).toBe(0);
		const importData = parseJson(imported.stdout).data as {
			contract: string;
			generation_id: string;
			source_entry_count: number;
			canonical_target_count: number;
			auth_candidate_count: number;
			auth_route_count: number;
		};
		expect(importData).toMatchObject({
			contract: "browser-use.corpus-import",
			source_entry_count: 11,
			canonical_target_count: 5,
			auth_candidate_count: 0,
			auth_route_count: 0,
		});
		expect(importData.generation_id).toMatch(/^corpus-snapshot-/);
		const status = parseJson(
			(
				await runForTest(["migration", "status", "--json"], runtime)
			).stdout,
		).data as {
			canonical_targets: Array<{ canonical_target_id: string }>;
		};

		const activated = await runForTest(
			[
				"migration",
				"activate",
				"--generation",
				importData.generation_id,
				"--json",
			],
			runtime,
		);
		expect(activated.exitCode).toBe(0);

		for (const target of status.canonical_targets) {
			const [service, flow] = target.canonical_target_id.split("/");
			const run = await runForTest(
				["runbook", "run", "--service", service, "--flow", flow, "--json"],
				runtime,
			);
			expect(run.exitCode).toBe(20);
			expect(parseJson(run.stdout).error).toMatchObject({
				code: "runbook_inactive",
			});
		}
	});

	test("imports a real-shaped corpus end to end, preserves source bytes, and converges on rerun", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const deps = {
			fs,
			paths: opened.paths,
			clock: () => 1_774_848_000_000,
		};
		const before = sourceBytes(fixtureRoot);

		const first = await importBrowserUseCorpus(deps, fixtureRoot);
		expect(first.ok).toBe(true);
		if (!first.ok) throw new Error(first.code);
		expect(first.state.phase).toBe("verified");
		expect(first.state.activation_state).toBe("unchanged");
		expect(first.generation).toMatchObject({
			source_entry_count: before.length,
			canonical_target_count: first.state.canonical_targets.length,
			active_target_count: 0,
			inactive_target_count: first.state.canonical_targets.length,
			auth_candidate_count: 0,
			auth_route_count: 0,
			verified_noop: false,
		});
		expect(first.generation.canonical_target_count).toBeGreaterThan(0);
		expect(first.generation.file_count).toBeGreaterThan(
			first.generation.canonical_target_count,
		);
		expect(first.generation.shipped_catalog_digest).toMatch(/^[0-9a-f]{64}$/);
		expect(first.next_action).toEqual({
			action_id: "activate_staged_generation",
			generation_id: first.generation.generation_id,
		});
		expect(sourceBytes(fixtureRoot)).toEqual(before);

		const second = await importBrowserUseCorpus(deps, fixtureRoot);
		expect(second.ok).toBe(true);
		if (!second.ok) throw new Error(second.code);
		expect(second.generation.generation_id).toBe(
			first.generation.generation_id,
		);
		expect(second.generation.source_snapshot_digest).toBe(
			first.generation.source_snapshot_digest,
		);
		expect(second.generation.verified_noop).toBe(true);
		expect(second.state.activation_state).toBe("unchanged");
		expect(sourceBytes(fixtureRoot)).toEqual(before);
	});

	test("refuses a relative source before touching migration state", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const fs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(fs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);

		const result = await importBrowserUseCorpus(
			{ fs, paths: opened.paths, clock: () => 1_774_848_000_000 },
			"legacy/browser-automation",
		);

		expect(result).toEqual({
			ok: false,
			code: "migration_source_invalid",
			message: "migration source must be an absolute path.",
		});
	});
});
