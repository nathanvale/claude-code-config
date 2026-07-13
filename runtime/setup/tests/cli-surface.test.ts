import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { SetupInspection } from "../src/inspection.ts";
import { main, type SetupCliRuntime } from "../src/cli.ts";
import type { SetupResult } from "../src/model.ts";

describe("setup CLI read-only surface", () => {
	test("routes flag-only invocation to status and emits one JSON envelope", async () => {
		const io = capture();
		const exit = await main(["--json"], { ...io, runtime: runtime(inspection()) });

		expect(exit).toBe(0);
		expect(io.stderr.text).toBe("");
		const envelope = JSON.parse(io.stdout.text);
		expect(envelope).toMatchObject({
			status: "ok",
			data: { contract_id: "setup.result", command: "status", station: "status.healthy" },
		});
		expect(io.stdout.text.trim().split("\n").filter((line) => line.startsWith("{")).length).toBe(1);
	});

	test("keeps status drift and blockers successful while naming one next action", async () => {
		const missing = capture();
		const blocked = capture();
		const missingInspection = inspection({ catalogIds: ["alpha"] });
		const blockedInspection = inspection({
			catalogIds: ["alpha"],
			blocked: true,
			findings: [{ id: "invalid_skill", owner: "setup.catalog", path: "/repo/skills/draft", summary: "Invalid skill.", repair: "human_repair" }],
		});

		expect(await main(["status"], { ...missing, runtime: runtime(missingInspection) })).toBe(0);
		expect(missing.stdout.text).toContain("state: clean_slate");
		expect(missing.stdout.text).toContain("next: preview_sync");
		expect(await main(["status"], { ...blocked, runtime: runtime(blockedInspection) })).toBe(0);
		expect(blocked.stdout.text).toContain("state: blocked");
		expect(blocked.stdout.text).toContain("next: run_doctor");
	});

	test("composes user-domain health into default status and doctor", async () => {
		let checks = 0;
		const domainFinding = { id: "hook_unhealthy" as const, owner: "setup.hooks", summary: "Hook differs.", repair: "repair_hooks" as const };
		const checkDomains: NonNullable<SetupCliRuntime["checkDomains"]> = async (_input, base) => {
			checks += 1;
			return { ...base, state: "blocked", station: base.command === "status" ? "status.blocked" : base.station, findings: [domainFinding], next_action: "run_doctor" };
		};
		const statusIo = capture();
		const doctorIo = capture();
		expect(await main(["status", "--json"], { ...statusIo, runtime: { ...runtime(inspection()), checkDomains } })).toBe(0);
		expect(JSON.parse(statusIo.stdout.text).data.station).toBe("status.blocked");
		expect(await main(["doctor", "--json"], { ...doctorIo, runtime: { ...runtime(inspection()), checkDomains } })).toBe(1);
		expect(JSON.parse(doctorIo.stdout.text).data).toMatchObject({ station: "doctor.setup_dependency_unhealthy", findings: [{ id: "hook_unhealthy" }] });
		expect(checks).toBe(2);
	});

	test("renders compact output by default and path evidence with verbose", async () => {
		const compact = capture();
		const verbose = capture();
		const state = inspection({ catalogIds: ["alpha"] });

		await main(["status"], { ...compact, runtime: runtime(state) });
		await main(["status", "--verbose"], { ...verbose, runtime: runtime(state) });

		expect(compact.stdout.text).not.toContain("/home/.agents/skills/alpha");
		expect(verbose.stdout.text).toContain("/home/.agents/skills/alpha");
		expect(verbose.stderr.text).toContain("setup inspection complete");
	});

	test("wires TTY color through flag and environment controls", async () => {
		const enabled = capture();
		await main(["status"], {
			...enabled,
			runtime: runtime(inspection(), { env: { TERM: "xterm-256color" }, stdoutIsTTY: true }),
		});
		expect(enabled.stdout.text).toContain("\u001b[");

		for (const scenario of [
			{ argv: ["status", "--no-color"], env: { TERM: "xterm-256color" } },
			{ argv: ["status"], env: { TERM: "xterm-256color", NO_COLOR: "1" } },
			{ argv: ["status"], env: { TERM: "dumb" } },
		] as const) {
			const io = capture();
			await main(scenario.argv, {
				...io,
				runtime: runtime(inspection(), { env: scenario.env, stdoutIsTTY: true }),
			});
			expect(io.stdout.text).not.toContain("\u001b[");
		}
	});

	test("catalog explains named match and named miss", async () => {
		const matched = capture();
		const missed = capture();
		const state = inspection({ catalogIds: ["Fallow"] });

		expect(await main(["catalog", "fallow", "--json"], { ...matched, runtime: runtime(state) })).toBe(0);
		expect(JSON.parse(matched.stdout.text).data).toMatchObject({
			station: "catalog.matched",
			catalog_entries: [{ id: "Fallow", state: "valid" }],
		});
		expect(await main(["catalog", "missing", "--json"], { ...missed, runtime: runtime(state) })).toBe(1);
		expect(JSON.parse(missed.stdout.text)).toMatchObject({
			status: "ok",
			data: { station: "catalog.not_found", next_action: "discover_external" },
		});
	});

	test("blocks named invalid, escaped, and colliding catalog entries", async () => {
		const cases: readonly SetupInspection["catalog"]["entries"][] = [
			[{ id: "alpha", canonical_id: "alpha", path: "/repo/skills/alpha", state: "invalid" }],
			[{ id: "alpha", canonical_id: "alpha", path: "/repo/skills/alpha", state: "escape" }],
			[
				{ id: "Alpha", canonical_id: "alpha", path: "/repo/skills/Alpha", state: "collision" },
				{ id: "alpha", canonical_id: "alpha", path: "/repo/skills/alpha", state: "collision" },
			],
		];
		for (const catalogEntries of cases) {
			const io = capture();
			expect(await main(["catalog", "alpha", "--json"], {
				...io,
				runtime: runtime(inspection({ catalogEntries })),
			})).toBe(1);
			expect(JSON.parse(io.stdout.text)).toMatchObject({
				status: "error",
				error: { code: "blocked" },
				data: { state: "blocked", station: "catalog.blocked", next_action: "human_repair" },
			});
		}
	});

	test("sync check is read-only and plain sync delegates to the mutation engine", async () => {
		const check = capture();
		const write = capture();
		let inspections = 0;
		const applied = { ...inspectionResult("sync", "applied", "sync.applied"), domains: [{ domain: "skill_projection", planned: ["/home/.claude/skills/alpha"], applied: ["/home/.claude/skills/alpha"], deferred: [], preserved: [], failed: [] }] };
		const adapter = runtime(inspection({ catalogIds: ["alpha"] }), {
			onInspect: () => { inspections += 1; },
			apply: async () => applied,
		});

		expect(await main(["sync", "--check", "--json"], { ...check, runtime: adapter })).toBe(1);
		expect(JSON.parse(check.stdout.text).data.station).toBe("sync.check_changes");
		expect(await main(["sync", "--json"], { ...write, runtime: adapter })).toBe(0);
		expect(inspections).toBe(1);
		expect(JSON.parse(write.stdout.text)).toMatchObject({ status: "ok", data: { station: "sync.applied" } });
	});

	test("renders every write-domain path category only in verbose human output", async () => {
		const compact = capture();
		const verbose = capture();
		const result = {
			...inspectionResult("sync", "partial", "sync.partial"),
			domains: [{
				domain: "skill_projection",
				planned: ["/paths/planned"],
				applied: ["/paths/applied"],
				deferred: ["/paths/deferred"],
				preserved: ["/paths/preserved"],
				failed: ["/paths/failed"],
			}],
		};
		const adapter = runtime(inspection(), { apply: async () => result });

		await main(["sync"], { ...compact, runtime: adapter });
		await main(["sync", "--verbose"], { ...verbose, runtime: adapter });

		for (const category of ["planned", "applied", "deferred", "preserved", "failed"]) {
			expect(compact.stdout.text).not.toContain(`/paths/${category}`);
			expect(verbose.stdout.text).toContain(`  ${category}: /paths/${category}`);
		}
	});

	test("keeps verbose JSON diagnostics on stderr", async () => {
		const io = capture();
		await main(["status", "--json", "--verbose"], { ...io, runtime: runtime(inspection()) });

		expect(() => JSON.parse(io.stdout.text)).not.toThrow();
		expect(io.stderr.text).toContain("setup inspection complete");
	});

	test("keeps captured child stdout out of the JSON envelope", async () => {
		const io = capture();
		const result = { ...inspectionResult("sync", "partial", "sync.partial"), child_output: "child prose\n" };
		const exit = await main(["sync", "--json"], {
			...io,
			runtime: runtime(inspection(), { apply: async () => result }),
		});
		expect(exit).toBe(1);
		expect(() => JSON.parse(io.stdout.text)).not.toThrow();
		expect(io.stdout.text).not.toContain("child prose");
		expect(io.stderr.text).toContain("child prose");
	});

	test("emits command discovery directly from the facade contract", async () => {
		const io = capture();
		expect(await main(["commands", "--json"], { ...io, runtime: runtime(inspection()) })).toBe(0);

		const data = JSON.parse(io.stdout.text).data;
		expect(data.contract_id).toBe("setup.commands");
		expect(data.commands.status.summary).toContain("bounded setup health");
	});

	test("returns a typed invalid-target envelope without inspecting a missing project", async () => {
		const io = capture();
		const exit = await main([
			"status", "--scope", "project", "--repo", "/definitely/missing/setup-project", "--json",
		], {
			...io,
			runtime: { sourceRepoRoot: "/repo", homeDir: "/home", now: () => 100 },
		});

		expect(exit).toBe(1);
		expect(JSON.parse(io.stdout.text)).toMatchObject({
			status: "error",
			error: { code: "invalid_target", message: "The selected project target is invalid." },
			data: { scope: "project", next_action: "change_input" },
		});
	});

	test("renders change_input for a plain invalid project target", async () => {
		const io = capture();
		expect(await main([
			"status", "--scope", "project", "--repo", "/definitely/missing/setup-project",
		], {
			...io,
			runtime: { sourceRepoRoot: "/repo", homeDir: "/home", now: () => 100 },
		})).toBe(1);
		expect(io.stderr.text).toContain("next: change_input");
	});

	test("doctor explains blockers and exits with findings", async () => {
		const io = capture();
		const state = inspection({
			blocked: true,
			findings: [{ id: "duplicate_scope", owner: "setup.scope", summary: "Duplicate.", repair: "human_repair" }],
		});

		expect(await main(["doctor", "--json"], { ...io, runtime: runtime(state) })).toBe(1);
		expect(JSON.parse(io.stdout.text).data).toMatchObject({
			station: "doctor.duplicate_scope",
			next_action: "human_repair",
			findings: [{ id: "duplicate_scope", why: expect.any(String) }],
		});
	});

	test("rejects existing non-repositories and repository roots without skills", async () => {
		const nonRepo = await mkdtemp(join(tmpdir(), "setup-cli-non-repo-"));
		await mkdir(join(nonRepo, "skills"));
		const noSkills = await mkdtemp(join(tmpdir(), "setup-cli-no-skills-"));
		await mkdir(join(noSkills, ".git"));

		for (const target of [nonRepo, noSkills]) {
			const io = capture();
			const exit = await main([
				"status", "--scope", "project", "--repo", target, "--json",
			], {
				...io,
				runtime: { sourceRepoRoot: "/repo", homeDir: "/home", now: () => 100 },
			});
			expect(exit).toBe(1);
			expect(JSON.parse(io.stdout.text).error.code).toBe("invalid_target");
		}
	});

	test("rejects a forged Git marker", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-cli-forged-git-"));
		await writeFile(join(root, ".git"), "gitdir: /tmp/fixture-git-dir\n");
		await mkdir(join(root, "skills"));
		const io = capture();

		const exit = await main([
			"status", "--scope", "project", "--repo", root, "--json",
		], {
			...io,
			runtime: { sourceRepoRoot: "/repo", homeDir: "/home", now: () => 100 },
		});

		expect(exit).toBe(1);
		expect(JSON.parse(io.stdout.text).error.code).toBe("invalid_target");
	});

	test("resolves a Git root from a child path", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-cli-git-root-"));
		const initialized = Bun.spawnSync(["git", "init", "--quiet", root]);
		expect(initialized.exitCode).toBe(0);
		await mkdir(join(root, "skills"));
		await mkdir(join(root, "nested"));
		const io = capture();

		const exit = await main([
			"status", "--scope", "project", "--repo", join(root, "nested"), "--json",
		], {
			...io,
			runtime: { sourceRepoRoot: "/repo", homeDir: "/home", now: () => 100 },
		});

		expect(exit).toBe(0);
		expect(JSON.parse(io.stdout.text).data.catalog_root).toBe(
			await realpath(join(root, "skills")),
		);
	});

	test("preserves control characters inside the Git root record", async () => {
		const parent = await mkdtemp(join(tmpdir(), "setup-cli-control-root-"));
		const root = join(parent, "repo\nname");
		await mkdir(root);
		expect(Bun.spawnSync(["git", "init", "--quiet", root]).exitCode).toBe(0);
		await mkdir(join(root, "skills"));
		await mkdir(join(root, "nested"));
		const io = capture();

		expect(await main([
			"status", "--scope", "project", "--repo", join(root, "nested"), "--json",
		], {
			...io,
			runtime: { sourceRepoRoot: "/repo", homeDir: "/home", now: () => 100 },
		})).toBe(0);
		expect(JSON.parse(io.stdout.text).data.catalog_root).toBe(await realpath(join(root, "skills")));
	});

	test("escapes terminal controls in human catalog output while preserving JSON ids", async () => {
		const id = "alpha\u001b[31m";
		const state = inspection({ catalogIds: [id] });
		const human = capture();
		const json = capture();

		await main(["catalog"], { ...human, runtime: runtime(state) });
		await main(["catalog", "--json"], { ...json, runtime: runtime(state) });

		expect(human.stdout.text).not.toContain("\u001b");
		expect(human.stdout.text).toContain("alpha\\x1b[31m");
		expect(JSON.parse(json.stdout.text).data.catalog_entries[0].id).toBe(id);
	});

	test("retains unexpected JSON failure diagnostics", async () => {
		const io = capture();
		const cause = "catalog read failed at fixture boundary";
		expect(await main(["status", "--json"], {
			...io,
			runtime: {
				sourceRepoRoot: "/repo",
				homeDir: "/home",
				now: () => 100,
				inspect: async () => { throw new Error(cause); },
			},
		})).toBe(1);
		expect(JSON.parse(io.stdout.text).error.message).toBe(cause);
		expect(io.stderr.text).toContain(cause);
	});

	test("renders status help from the command contract", async () => {
		const io = capture();
		expect(await main(["status", "--help"], io)).toBe(0);
		expect(io.stdout.text).toContain("Usage: setup status");
		expect(io.stdout.text).toContain("--scope");
	});

	test("handles an unknown help command as invalid usage", async () => {
		const io = capture();
		expect(await main(["bogus", "--help"], io)).toBe(2);
		expect(io.stderr.text).toContain("Unknown command: bogus");
	});
});

function capture() {
	const stdout = { text: "", write(chunk: string) { this.text += chunk; } };
	const stderr = { text: "", write(chunk: string) { this.text += chunk; } };
	return { stdout, stderr };
}

function runtime(
	state: SetupInspection,
	options: {
		env?: Record<string, string | undefined>;
		stdoutIsTTY?: boolean;
		onInspect?: () => void;
		apply?: SetupCliRuntime["apply"];
	} = {},
) {
	return {
		sourceRepoRoot: "/repo",
		homeDir: "/home",
		now: () => 100,
		env: options.env ?? {},
		stdoutIsTTY: options.stdoutIsTTY ?? false,
		inspect: async () => {
			options.onInspect?.();
			return state;
		},
		...(options.apply ? { apply: options.apply } : {}),
	};
}

function inspectionResult(command: "sync" | "unlink", state: SetupResult["state"], station: string): SetupResult {
	return { command, scope: "user", state, findings: [], domains: [], operations: [], projection_targets: [], counts: { catalog: 0, managed: 0, external: 0, planned: 0, blockers: 0 }, catalog_root: "/repo/skills", destination_roots: [], station, next_action: "setup_healthy" };
}

function inspection(options: {
	catalogIds?: readonly string[];
	catalogEntries?: SetupInspection["catalog"]["entries"];
	findings?: SetupInspection["findings"];
	blocked?: boolean;
} = {}): SetupInspection {
	return {
		scope: {
			scope: "user", source_anchor: "/repo", target_anchor: "/home",
			catalog_root: "/repo/skills", provider_evidence_root: "/repo",
			projection_roots: [
				{ id: "claude", path: "/home/.claude/skills", safe: true },
				{ id: "codex", path: "/home/.agents/skills", safe: true },
			],
			legacy_roots: [],
		},
		catalog: {
			root: "/repo/skills",
			entries: options.catalogEntries ?? (options.catalogIds ?? []).map((id) => ({
				id, canonical_id: id.toLowerCase(), path: `/repo/skills/${id}`,
				state: "valid" as const, name: id, description: `${id} skill`,
			})),
			findings: [],
		},
		provider_evidence: { path: "/repo/skills-lock.json", entries: [] },
		ownership: { entries: [], findings: [] },
		duplicate_scope_ids: [],
		findings: options.findings ?? [],
		blocked: options.blocked ?? false,
	};
}
