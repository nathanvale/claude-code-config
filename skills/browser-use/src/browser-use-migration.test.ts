import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";
import { stageGeneration } from "./browser-use-retention";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { runForTest } from "./browser-use";

const disposables: { dispose(): void }[] = [];
const fixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"safe-corpus",
);
const classificationFixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"classification-corpus",
);
const duplicateYamlFixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"duplicate-yaml",
);
const malformedYamlFixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"malformed-yaml",
);

afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

describe("clean-break migration public commands", () => {
	test("inventory freezes one source snapshot before status reports any staged generation", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });

		const inventoried = await runForTest(
			["migration", "inventory", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(inventoried.exitCode).toBe(0);
		const inventoryData = parseJson(inventoried.stdout).data as Record<
			string,
			unknown
		>;
		expect(inventoryData).toMatchObject({
			contract: "browser-use.migration-status",
			phase: "inventoried",
			source_entry_count: 1,
			disposition_count: 0,
			staged_generation: null,
			activation_state: "unchanged",
		});
		expect(inventoryData.snapshot_id).toMatch(/^snapshot-[0-9a-f]{16}$/);
		expect(inventoryData.snapshot_digest).toMatch(/^[0-9a-f]{64}$/);

		const status = await runForTest(
			["migration", "status", "--json"],
			runtime,
		);
		expect(status.exitCode).toBe(0);
		expect(parseJson(status.stdout).data).toMatchObject({
			phase: "inventoried",
			source_entry_count: 1,
			disposition_count: 0,
			staged_generation: null,
			activation_state: "unchanged",
		});
	});

	test("plan dispositions every frozen entry and quarantines backups, secrets, executables, unsupported, and obsolete owners", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });
		expect(
			(
				await runForTest(
					[
						"migration",
						"inventory",
						"--source",
						classificationFixtureRoot,
						"--json",
					],
					runtime,
				)
			).exitCode,
		).toBe(0);

		const planned = await runForTest(
			["migration", "plan", "--source", classificationFixtureRoot, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(0);
		const data = parseJson(planned.stdout).data as Record<string, unknown>;
		expect(data).toMatchObject({
			phase: "planned",
			source_entry_count: 8,
			disposition_count: 8,
			staged_generation: null,
			activation_state: "unchanged",
		});
		const dispositions = data.dispositions as Array<Record<string, unknown>>;
		expect(
			Object.fromEntries(
				dispositions.map((row) => [
					row.source_relative_path,
					row.disposition,
				]),
			),
		).toEqual({
			"browser-domain-memory.md": "quarantine-obsolete",
			// Finding #3: broadened secret classifier catches client_secret in
			// value form, not just the narrow line-anchored key list.
			"client-secret.env": "quarantine-secret",
			"credentials.txt": "quarantine-secret",
			"legacy.js": "quarantine-executable",
			// Finding #4: executable MODE bits on a non-code extension take the
			// mode arm, distinct from legacy.js's extension arm.
			"tool.bin": "quarantine-executable",
			// Finding #4: unsupported extension (regular file, no exec bits).
			"report.png": "quarantine-unsupported",
			"service.yml": "stage",
			"service.yml.bak": "quarantine-backup",
		});
		for (const disposition of dispositions) {
			expect(disposition.source_content_hash).toMatch(/^[0-9a-f]{64}$/);
			expect(disposition.transform_version).toBe("copy-v1");
			if (disposition.disposition === "stage") {
				expect(disposition.logical_destination_id).toBe(
					"knowledge/service.yml",
				);
				expect(disposition.expected_hash).toBe(
					disposition.source_content_hash,
				);
			} else {
				expect(disposition.logical_destination_id).toBeNull();
				expect(disposition.expected_hash).toBeNull();
			}
		}
	});

	test("plan rejects duplicate YAML keys before writing any disposition", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });
		expect(
			(
				await runForTest(
					[
						"migration",
						"inventory",
						"--source",
						duplicateYamlFixtureRoot,
						"--json",
					],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const planned = await runForTest(
			["migration", "plan", "--source", duplicateYamlFixtureRoot, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(20);
		expect(parseJson(planned.stdout).error).toMatchObject({
			code: "migration_yaml_duplicate_key",
		});
		const status = await runForTest(
			["migration", "status", "--json"],
			runtime,
		);
		expect(parseJson(status.stdout).data).toMatchObject({
			phase: "inventoried",
			disposition_count: 0,
		});
	});

	test("plan quarantines a non-file symlink entry as unsupported", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const source = join(xdg.base, "symlink-source");
		mkdirSync(source, { recursive: true, mode: 0o700 });
		writeFileSync(join(source, "service.yml"), "service_id: real\n");
		symlinkSync("service.yml", join(source, "alias.yml"));
		const runtime = makeRuntime({ env: xdg.env });
		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", source, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const planned = await runForTest(
			["migration", "plan", "--source", source, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(0);
		const dispositions = (
			parseJson(planned.stdout).data as Record<string, unknown>
		).dispositions as Array<Record<string, unknown>>;
		const alias = dispositions.find(
			(row) => row.source_relative_path === "alias.yml",
		);
		expect(alias?.disposition).toBe("quarantine-unsupported");
	});

	test("plan rejects malformed non-duplicate YAML with migration_yaml_invalid", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });
		expect(
			(
				await runForTest(
					[
						"migration",
						"inventory",
						"--source",
						malformedYamlFixtureRoot,
						"--json",
					],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const planned = await runForTest(
			["migration", "plan", "--source", malformedYamlFixtureRoot, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(20);
		expect(parseJson(planned.stdout).error).toMatchObject({
			code: "migration_yaml_invalid",
		});
		const status = await runForTest(
			["migration", "status", "--json"],
			runtime,
		);
		expect(parseJson(status.stdout).data).toMatchObject({
			phase: "inventoried",
			disposition_count: 0,
		});
	});

	test("apply stages inactive deterministic output and verify proves complete provenance without activation", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });
		for (const phase of ["inventory", "plan"] as const) {
			const result = await runForTest(
				["migration", phase, "--source", fixtureRoot, "--json"],
				runtime,
			);
			expect(result.exitCode).toBe(0);
		}

		const firstApply = await runForTest(
			["migration", "apply", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(firstApply.exitCode).toBe(0);
		expect(parseJson(firstApply.stdout).data).toMatchObject({
			phase: "staged",
			staged_generation: expect.stringMatching(/^generation-[0-9a-f]{16}$/),
			last_apply_verified_noop: false,
			activation_state: "unchanged",
		});

		const secondApply = await runForTest(
			["migration", "apply", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(secondApply.exitCode).toBe(0);
		expect(parseJson(secondApply.stdout).data).toMatchObject({
			phase: "staged",
			last_apply_verified_noop: true,
			activation_state: "unchanged",
		});

		const verified = await runForTest(
			["migration", "verify", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(verified.exitCode).toBe(0);
		expect(parseJson(verified.stdout).data).toMatchObject({
			phase: "verified",
			source_entry_count: 1,
			disposition_count: 1,
			staged_generation: expect.stringMatching(/^generation-[0-9a-f]{16}$/),
			activation_state: "unchanged",
		});
	});

	test("plan refuses source drift after the frozen snapshot", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const source = join(xdg.base, "drift-source");
		mkdirSync(source, { recursive: true, mode: 0o700 });
		writeFileSync(join(source, "service.yml"), "service_id: before\n");
		const runtime = makeRuntime({ env: xdg.env });
		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", source, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		writeFileSync(join(source, "service.yml"), "service_id: after\n");
		const planned = await runForTest(
			["migration", "plan", "--source", source, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(20);
		expect(parseJson(planned.stdout).error).toMatchObject({
			code: "migration_source_drift",
		});
	});

	test("apply refuses an existing deterministic generation with different content", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });
		const inventoried = await runForTest(
			["migration", "inventory", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(inventoried.exitCode).toBe(0);
		expect(
			(
				await runForTest(
					["migration", "plan", "--source", fixtureRoot, "--json"],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const snapshotDigest = (
			parseJson(inventoried.stdout).data as Record<string, unknown>
		).snapshot_digest as string;
		const platformFs = createDefaultPlatformFs();
		const opened = await openBrowserUsePaths(platformFs, xdg.env);
		if (!opened.ok) throw new Error(opened.refusal.code);
		const seeded = await stageGeneration(
			{ fs: platformFs, paths: opened.paths, clock: () => 1_000 },
			{
				generationId: `generation-${snapshotDigest.slice(0, 16)}`,
				files: [{ relPath: "knowledge/collision.txt", contents: "different" }],
			},
		);
		expect(seeded.ok).toBe(true);
		const applied = await runForTest(
			["migration", "apply", "--source", fixtureRoot, "--json"],
			runtime,
		);
		expect(applied.exitCode).toBe(20);
		expect(parseJson(applied.stdout).error).toMatchObject({
			code: "migration_collision",
		});
	});
});
