import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { applyHookTopology, inspectHookTopology, resolveGitHookPath } from "../src/hook-topology.ts";
import {
	HOOK_PROVENANCE_SCHEMA_VERSION,
	hashHookBytes,
	hookProvenanceIdentity,
	readHookProvenance,
	writeHookProvenance,
} from "../src/hook-provenance.ts";

describe("hook topology", () => {
	test("resolves the default hook path inside the repository Git directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-hook-default-path-"));
		const repository = join(root, "repository");
		await mkdir(repository);
		expect(Bun.spawnSync(["git", "init", "--quiet", repository]).exitCode).toBe(0);

		expect(await resolveGitHookPath(repository)).toBe(await realpath(join(repository, ".git/hooks")));
	});

	test("rejects a configured hook path outside the repository Git directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-hook-path-"));
		const repository = join(root, "repository");
		const externalHooks = join(root, "global-hooks");
		await mkdir(repository);
		await mkdir(externalHooks);
		expect(Bun.spawnSync(["git", "init", "--quiet", repository]).exitCode).toBe(0);
		expect(Bun.spawnSync(["git", "-C", repository, "config", "core.hooksPath", externalHooks]).exitCode).toBe(0);

		await expect(resolveGitHookPath(repository)).rejects.toThrow("Git hook path escapes this repository's Git directory");
	});

	test("reports a missing hook source as unhealthy", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-hook-missing-"));
		const source = join(root, "missing");
		await mkdir(join(root, "hooks"));
		const plan = await inspectHookTopology(source, join(root, "hooks"), join(root, "state"));
		expect(plan.operations).toEqual([]);
		expect(plan.findings).toEqual([
			expect.objectContaining({
				id: "hook_unhealthy",
				owner: "setup.hooks",
				path: source,
				summary: "Git hook source directory is missing.",
				repair: "repair_hooks",
			}),
		]);
	});

	test("distinguishes an unreadable hook source", async () => {
		const source = "/repo/scripts/hooks";
		const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
		const root = await mkdtemp(join(tmpdir(), "setup-hook-denied-"));
		const destination = join(root, "hooks");
		await mkdir(destination);
		const plan = await inspectHookTopology(source, destination, join(root, "state"), async () => { throw denied; });
		expect(plan.operations).toEqual([]);
		expect(plan.findings).toEqual([
			expect.objectContaining({
				id: "hook_unhealthy",
				path: source,
				summary: "Git hook source directory is unreadable.",
				why: "permission denied",
				repair: "repair_hooks",
			}),
		]);
	});

	test("copies a missing hook and treats equal content as healthy", async () => {
		const fixture = await hookFixture();
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations[0]?.kind).toBe("install");
		expect(plan.operations).toHaveLength(1);
		const identity = await identityFor(fixture);
		expect((await applyHookTopology(plan)).applied).toEqual([identity.receipt_path, identity.destination]);
		expect(await readFile(join(fixture.destination, "pre-commit"), "utf8")).toBe("hook\n");
		expect((await inspectHookTopology(fixture.source, fixture.destination, fixture.state)).operations).toEqual([]);
		expect((await readHookProvenance(await identityFor(fixture))).status).toBe("valid");
	});

	test("plans only supported hook names and ignores sibling files in the source directory", async () => {
		const fixture = await hookFixture();
		await writeFile(join(fixture.source, "pre-commit.test.ts"), "not a hook\n");
		await writeFile(join(fixture.source, "README.md"), "docs\n");
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations.map((operation) => operation.identity.hook)).toEqual(["pre-commit"]);
		expect(plan.findings).toEqual([]);
		expect(plan.preserved).toEqual([]);
	});

	test("backfills equal current bytes without replacing the hook", async () => {
		const fixture = await hookFixture();
		const destination = join(fixture.destination, "pre-commit");
		await writeFile(destination, "hook\n", { mode: 0o755 });
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations[0]?.kind).toBe("backfill_receipt");
		let replaced = false;
		const result = await applyHookTopology(plan, {
			beforeMutation: async (phase) => { if (phase === "hook_replace") replaced = true; },
		});
		expect(replaced).toBe(false);
		expect(result.applied).toEqual([(await identityFor(fixture)).receipt_path]);
	});

	test.each([
		"pre-commit-setup-v1",
		"pre-commit-legacy-installer",
	] as const)("migrates the pinned %s payload and records current ownership", async (fixtureName) => {
		const fixture = await hookFixture();
		const destination = join(fixture.destination, "pre-commit");
		await Bun.write(destination, Bun.file(join(import.meta.dir, `fixtures/${fixtureName}`)));
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations[0]?.kind).toBe("migrate");
		expect((await applyHookTopology(plan)).failed).toEqual([]);
		expect(await readFile(destination, "utf8")).toBe("hook\n");
	});

	test("reconciles a receipt-proven stale copy and preserves a locally edited copy", async () => {
		const fixture = await hookFixture();
		const destination = join(fixture.destination, "pre-commit");
		await writeFile(destination, "old hook\n", { mode: 0o755 });
		await writeStableReceipt(fixture, hashHookBytes("old hook\n"));
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations[0]?.kind).toBe("reconcile");
		await applyHookTopology(plan);

		await writeFile(destination, "local edit\n", { mode: 0o755 });
		const edited = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(edited.operations).toEqual([]);
		expect(edited.findings).toContainEqual(expect.objectContaining({
			id: "hook_ownership_unproven",
			repair: "human_repair",
		}));
		expect(edited.preserved).toContain((await identityFor(fixture)).destination);
	});

	test("recovers pending desired bytes before reconciling to the selected source", async () => {
		const fixture = await hookFixture();
		const destination = join(fixture.destination, "pre-commit");
		const identity = await identityFor(fixture);
		const interruptedBytes = "other worktree hook\n";
		const interruptedDigest = hashHookBytes(interruptedBytes);
		await writeFile(destination, interruptedBytes, { mode: 0o755 });
		await writeHookProvenance(identity, {
			schema_version: HOOK_PROVENANCE_SCHEMA_VERSION,
			state: "pending",
			hook: identity.hook,
			destination: identity.destination,
			prior: { state: "missing" },
			desired_digest: interruptedDigest,
			source_digest: interruptedDigest,
		}, { expected: { status: "missing", path: identity.receipt_path } });

		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations[0]?.kind).toBe("recover_pending");
		expect((await applyHookTopology(plan)).failed).toEqual([]);
		expect(await readFile(destination, "utf8")).toBe("hook\n");
		expect((await readHookProvenance(identity))).toMatchObject({
			status: "valid",
			receipt: { state: "stable", installed_digest: hashHookBytes("hook\n") },
		});
	});

	test.each([
		{ name: "missing prior", prior: { state: "missing" } as const, bytes: undefined },
		{ name: "digest prior", prior: { state: "digest", digest: hashHookBytes("prior hook\n") } as const, bytes: "prior hook\n" },
	])("recovers a pending $name before installing current bytes", async ({ prior, bytes }) => {
		const fixture = await hookFixture();
		const identity = await identityFor(fixture);
		if (bytes) await writeFile(identity.destination, bytes, { mode: 0o755 });
		await writeHookProvenance(identity, {
			schema_version: HOOK_PROVENANCE_SCHEMA_VERSION,
			state: "pending",
			hook: identity.hook,
			destination: identity.destination,
			prior,
			desired_digest: hashHookBytes("interrupted desired\n"),
			source_digest: hashHookBytes("interrupted desired\n"),
		}, { expected: { status: "missing", path: identity.receipt_path } });

		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations[0]?.kind).toBe("recover_pending");
		expect((await applyHookTopology(plan)).failed).toEqual([]);
		expect(await readFile(identity.destination, "utf8")).toBe("hook\n");
		expect((await readHookProvenance(identity))).toMatchObject({
			status: "valid",
			receipt: { state: "stable", installed_digest: hashHookBytes("hook\n") },
		});
	});

	test.each(["missing", "stable"] as const)("repairs executable mode with a %s receipt", async (receipt) => {
		const fixture = await hookFixture();
		const identity = await identityFor(fixture);
		await writeFile(identity.destination, "hook\n", { mode: 0o644 });
		await chmod(identity.destination, 0o644);
		if (receipt === "stable") await writeStableReceipt(fixture, hashHookBytes("hook\n"));

		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		expect(plan.operations[0]?.kind).toBe("repair_mode");
		expect((await applyHookTopology(plan)).failed).toEqual([]);
		expect((await lstat(identity.destination)).mode & 0o111).not.toBe(0);
		expect(await readFile(identity.destination, "utf8")).toBe("hook\n");
		expect((await readHookProvenance(identity))).toMatchObject({
			status: "valid",
			receipt: { state: "stable", installed_digest: hashHookBytes("hook\n") },
		});
	});

	test("preserves differing files and every symlink", async () => {
		const fixture = await hookFixture();
		await writeFile(join(fixture.destination, "pre-commit"), "foreign\n");
		expect((await inspectHookTopology(fixture.source, fixture.destination, fixture.state)).findings[0]?.id).toBe("hook_ownership_unproven");
		await import("node:fs/promises").then(({ rm }) => rm(join(fixture.destination, "pre-commit")));
		await symlink(join(fixture.source, "pre-commit"), join(fixture.destination, "pre-commit"));
		expect((await inspectHookTopology(fixture.source, fixture.destination, fixture.state)).findings[0]?.id).toBe("hook_ownership_unproven");
	});

	test("preserves malformed receipt state without adopting equal current bytes", async () => {
		const fixture = await hookFixture();
		const identity = await identityFor(fixture);
		await writeFile(identity.destination, "hook\n", { mode: 0o755 });
		await mkdir(join(fixture.state, "hook-provenance"), { recursive: true });
		await writeFile(identity.receipt_path, "not json\n", { mode: 0o600 });

		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);

		expect(plan.operations).toEqual([]);
		expect(plan.findings).toContainEqual(expect.objectContaining({ id: "hook_ownership_unproven" }));
		expect(plan.preserved).toEqual([identity.destination, identity.receipt_path]);
	});

	test("stops when source bytes change before the pending receipt mutation", async () => {
		const fixture = await hookFixture();
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		const source = join(fixture.source, "pre-commit");

		const result = await applyHookTopology(plan, {
			beforeMutation: async (phase) => { if (phase === "pending_receipt") await writeFile(source, "changed source\n"); },
		});

		expect(result.failed).toEqual([source]);
		expect(await Bun.file((await identityFor(fixture)).destination).exists()).toBe(false);
	});

	test("leaves pending evidence when stable finalization is interrupted", async () => {
		const fixture = await hookFixture();
		const identity = await identityFor(fixture);
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);

		const result = await applyHookTopology(plan, {
			beforeMutation: async (phase) => { if (phase === "stable_receipt") throw new Error("interrupted"); },
		});

		expect(result.applied).toEqual([identity.receipt_path, identity.destination]);
		expect(result.failed).toEqual([identity.receipt_path]);
		expect(await readHookProvenance(identity)).toMatchObject({ status: "valid", receipt: { state: "pending" } });
	});

	test("preserves a receipt replacement introduced after inspection", async () => {
		const fixture = await hookFixture();
		const identity = await identityFor(fixture);
		await writeFile(identity.destination, "hook\n", { mode: 0o755 });
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);

		const result = await applyHookTopology(plan, {
			beforeMutation: async (phase) => {
				if (phase === "stable_receipt") await writeFile(identity.receipt_path, "foreign receipt\n", { mode: 0o600 });
			},
		});

		expect(result.failed).toEqual([identity.receipt_path]);
		expect(await readFile(identity.receipt_path, "utf8")).toBe("foreign receipt\n");
		expect(await readFile(identity.destination, "utf8")).toBe("hook\n");
	});

	test("preserves a concurrent replacement", async () => {
		const fixture = await hookFixture();
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		const result = await applyHookTopology(plan, {
			beforeMutation: async (phase, path) => { if (phase === "hook_replace") await writeFile(path, "arrived\n"); },
		});
		expect(result.failed).toEqual([(await identityFor(fixture)).destination]);
		expect(await readFile(join(fixture.destination, "pre-commit"), "utf8")).toBe("arrived\n");
	});

	test("refuses a hook directory replaced by a symlink before installation", async () => {
		const fixture = await hookFixture();
		const moved = `${fixture.destination}-moved`;
		const replacement = `${fixture.destination}-replacement`;
		await mkdir(replacement);
		const identity = await identityFor(fixture);
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);

		const result = await applyHookTopology(plan, {
			beforeMutation: async (phase) => {
				if (phase !== "pending_receipt") return;
				await rename(fixture.destination, moved);
				await symlink(replacement, fixture.destination);
			},
		});

		expect(result.failed).toEqual([identity.destination]);
		expect(await Bun.file(join(replacement, "pre-commit")).exists()).toBe(false);
	});

	test("revalidates equal bytes immediately before executable repair", async () => {
		const fixture = await hookFixture();
		await writeFile(join(fixture.destination, "pre-commit"), "hook\n", { mode: 0o644 });
		await chmod(join(fixture.destination, "pre-commit"), 0o644);
		const plan = await inspectHookTopology(fixture.source, fixture.destination, fixture.state);
		const result = await applyHookTopology(plan, {
			beforeMutation: async (phase, path) => { if (phase === "hook_replace") await writeFile(path, "foreign replacement\n"); },
		});
		expect(result.failed).toEqual([(await identityFor(fixture)).destination]);
		expect(await readFile(join(fixture.destination, "pre-commit"), "utf8")).toBe("foreign replacement\n");
	});
});

async function hookFixture() {
	const root = await mkdtemp(join(tmpdir(), "setup-hook-"));
	const source = join(root, "source");
	const destination = join(root, "hooks");
	await mkdir(source);
	await mkdir(destination);
	await writeFile(join(source, "pre-commit"), "hook\n");
	await chmod(join(source, "pre-commit"), 0o755);
	return { source, destination, state: join(root, "state") };
}

async function identityFor(fixture: Awaited<ReturnType<typeof hookFixture>>) {
	return hookProvenanceIdentity({
		stateRoot: fixture.state,
		hookDirectory: fixture.destination,
		hookName: "pre-commit",
	});
}

async function writeStableReceipt(fixture: Awaited<ReturnType<typeof hookFixture>>, digest: string) {
	const identity = await identityFor(fixture);
	await writeHookProvenance(identity, {
		schema_version: HOOK_PROVENANCE_SCHEMA_VERSION,
		state: "stable",
		hook: identity.hook,
		destination: identity.destination,
		installed_digest: digest,
		source_digest: digest,
	}, { expected: { status: "missing", path: identity.receipt_path } });
}
