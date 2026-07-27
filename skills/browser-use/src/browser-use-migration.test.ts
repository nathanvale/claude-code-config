import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
const nonUtf8FixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"non-utf8-corpus",
);
const blockScalarYamlFixtureRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"browser-use-migration",
	"block-scalar-yaml",
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

	test("plan returns a typed drift refusal when a source file becomes unreadable after the frozen snapshot", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const source = join(xdg.base, "unreadable-plan-source");
		mkdirSync(source, { recursive: true, mode: 0o700 });
		const targetPath = join(source, "service.yml");
		writeFileSync(targetPath, "service_id: frozen\n");
		// Real fs freezes the snapshot; a wrapping fs then throws on the source
		// read so the hash-preserving digest check still passes and the guarded
		// readTextFile is exercised — not the inventory walk.
		const realFs = createDefaultPlatformFs();
		const inventoried = await runForTest(
			["migration", "inventory", "--source", source, "--json"],
			makeRuntime({ env: xdg.env, platformFs: realFs }),
		);
		expect(inventoried.exitCode).toBe(0);
		const throwingFs = {
			...realFs,
			async readTextFile(path: string) {
				if (path === targetPath) {
					const error = new Error(`EACCES: permission denied, open '${path}'`);
					(error as Error & { code: string }).code = "EACCES";
					throw error;
				}
				return realFs.readTextFile(path);
			},
		};
		const planned = await runForTest(
			["migration", "plan", "--source", source, "--json"],
			makeRuntime({ env: xdg.env, platformFs: throwingFs }),
		);
		expect(planned.exitCode).toBe(20);
		expect(parseJson(planned.stdout).error).toMatchObject({
			code: "migration_source_drift",
		});
	});

	test("apply returns a typed drift refusal when a staged source file becomes unreadable after the frozen snapshot", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const source = join(xdg.base, "unreadable-apply-source");
		mkdirSync(source, { recursive: true, mode: 0o700 });
		const targetPath = join(source, "note.txt");
		writeFileSync(targetPath, "safe text\n");
		const realFs = createDefaultPlatformFs();
		const realRuntime = makeRuntime({ env: xdg.env, platformFs: realFs });
		expect(
			(
				await runForTest(
					["migration", "inventory", "--source", source, "--json"],
					realRuntime,
				)
			).exitCode,
		).toBe(0);
		expect(
			(
				await runForTest(
					["migration", "plan", "--source", source, "--json"],
					realRuntime,
				)
			).exitCode,
		).toBe(0);
		// A source that became unreadable after the snapshot fails apply's
		// byte-hash drift check (apply reads source bytes via hashFile, then
		// byte-copies), so the throw surfaces as the typed drift refusal.
		const throwingFs = {
			...realFs,
			async hashFile(path: string) {
				if (path === targetPath) {
					const error = new Error(`EACCES: permission denied, open '${path}'`);
					(error as Error & { code: string }).code = "EACCES";
					throw error;
				}
				return realFs.hashFile(path);
			},
		};
		const applied = await runForTest(
			["migration", "apply", "--source", source, "--json"],
			makeRuntime({ env: xdg.env, platformFs: throwingFs }),
		);
		expect(applied.exitCode).toBe(20);
		expect(parseJson(applied.stdout).error).toMatchObject({
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

	test("apply stages a non-UTF-8 source without a spurious drift, and a genuine byte change still drifts", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });
		// The .txt fixture holds a raw 0xFF byte, so its byte hash (expected_hash)
		// differs from a sha256 of the UTF-8-decoded text. Hashing decoded text at
		// apply time would report an unclearable migration_source_drift.
		for (const phase of ["inventory", "plan"] as const) {
			expect(
				(
					await runForTest(
						["migration", phase, "--source", nonUtf8FixtureRoot, "--json"],
						runtime,
					)
				).exitCode,
			).toBe(0);
		}
		const applied = await runForTest(
			["migration", "apply", "--source", nonUtf8FixtureRoot, "--json"],
			runtime,
		);
		expect(applied.exitCode).toBe(0);
		expect(parseJson(applied.stdout).data).toMatchObject({
			phase: "staged",
			activation_state: "unchanged",
		});

		// verify re-hashes the staged file bytes against expected_hash (raw source
		// bytes). A UTF-8-decoded stage would have written U+FFFD bytes, so verify
		// would refuse with an unclearable migration_verify_failed. A byte-faithful
		// stage must verify CLEAN.
		const verified = await runForTest(
			["migration", "verify", "--source", nonUtf8FixtureRoot, "--json"],
			runtime,
		);
		expect(verified.exitCode).toBe(0);
		expect(parseJson(verified.stdout).data).toMatchObject({
			phase: "verified",
			activation_state: "unchanged",
		});

		// The staged file's bytes must equal the source bytes VERBATIM (a
		// migration must not corrupt non-UTF-8 bytes). Locate the single staged
		// file under the generations tree and byte-compare it to the fixture.
		const stagedPaths = await openBrowserUsePaths(
			createDefaultPlatformFs(),
			xdg.env,
		);
		if (!stagedPaths.ok) throw new Error(stagedPaths.refusal.code);
		const stagedFiles: string[] = [];
		const walkStaged = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const child = join(dir, entry.name);
				if (entry.isDirectory()) walkStaged(child);
				else if (entry.isFile()) stagedFiles.push(child);
			}
		};
		walkStaged(stagedPaths.paths.state.generationsDir);
		const sourceBytes = readFileSync(join(nonUtf8FixtureRoot, "note.txt"));
		expect(
			stagedFiles.some((path) => readFileSync(path).equals(sourceBytes)),
		).toBe(true);

		// Genuine drift: a real byte change to the staged source after freeze must
		// still refuse with migration_source_drift.
		const driftSource = join(xdg.base, "non-utf8-drift");
		mkdirSync(driftSource, { recursive: true, mode: 0o700 });
		const driftTarget = join(driftSource, "note.txt");
		writeFileSync(driftTarget, Buffer.from([0x61, 0xff, 0x0a]));
		const driftRuntime = makeRuntime({ env: xdg.env });
		for (const phase of ["inventory", "plan"] as const) {
			expect(
				(
					await runForTest(
						["migration", phase, "--source", driftSource, "--json"],
						driftRuntime,
					)
				).exitCode,
			).toBe(0);
		}
		writeFileSync(driftTarget, Buffer.from([0x62, 0xff, 0x0a]));
		const drifted = await runForTest(
			["migration", "apply", "--source", driftSource, "--json"],
			driftRuntime,
		);
		expect(drifted.exitCode).toBe(20);
		expect(parseJson(drifted.stdout).error).toMatchObject({
			code: "migration_source_drift",
		});
	});

	test("plan does not read block-scalar content lines as duplicate mapping keys", async () => {
		const xdg = makeTempXdgEnv();
		disposables.push(xdg);
		const runtime = makeRuntime({ env: xdg.env });
		// notes.yml carries a `|` block scalar whose literal content repeats
		// `status: ok`; those are content lines, not duplicate keys.
		expect(
			(
				await runForTest(
					[
						"migration",
						"inventory",
						"--source",
						blockScalarYamlFixtureRoot,
						"--json",
					],
					runtime,
				)
			).exitCode,
		).toBe(0);
		const planned = await runForTest(
			["migration", "plan", "--source", blockScalarYamlFixtureRoot, "--json"],
			runtime,
		);
		expect(planned.exitCode).toBe(0);
		const dispositions = (
			parseJson(planned.stdout).data as Record<string, unknown>
		).dispositions as Array<Record<string, unknown>>;
		expect(
			dispositions.find((row) => row.source_relative_path === "notes.yml")
				?.disposition,
		).toBe("stage");

		// The genuine duplicate-key fixture must still refuse.
		const dupRuntime = makeRuntime({ env: xdg.env });
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
					dupRuntime,
				)
			).exitCode,
		).toBe(0);
		const dupPlanned = await runForTest(
			["migration", "plan", "--source", duplicateYamlFixtureRoot, "--json"],
			dupRuntime,
		);
		expect(dupPlanned.exitCode).toBe(20);
		expect(parseJson(dupPlanned.stdout).error).toMatchObject({
			code: "migration_yaml_duplicate_key",
		});
	});
});
