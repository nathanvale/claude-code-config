import { afterEach, describe, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createVaultGitHostEnrollment } from "../src/vault-git-host-enrollment.ts";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("Vault Git Host Enrollment", () => {
	test("fresh host requires private enrollment inputs without mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const configRoot = join(root, "config");
		const dataRoot = join(root, "data");
		const selectorPath = join(root, "bin", "vault-git");
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
		});

		expect(await enrollment.inspect()).toEqual({
			state: "not_enrolled",
			station: "vault_git.host_enrollment_inputs_required",
			nextAction: {
				kind: "needs_input",
				actionId: "provide_host_enrollment_inputs",
				inputContractId: "setup.vault-git.host-enrollment",
				fields: [
					{ id: "ssh_identity_file_path", inputChannel: "private_stdin" },
					{ id: "ssh_public_key_path", inputChannel: "private_stdin" },
					{ id: "ssh_known_hosts_path", inputChannel: "private_stdin" },
				],
			},
			installedRuntime: null,
			selectedRuntime: null,
			priorRuntime: null,
		});

		for (const path of [configRoot, dataRoot, selectorPath]) {
			expect(await Bun.file(path).exists()).toBe(false);
		}
	});

	test("missing SSH prerequisites stop at the external owner without mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const configRoot = join(root, "config");
		const dataRoot = join(root, "data");
		const selectorPath = join(root, "bin", "vault-git");
		const privatePaths = {
			sshIdentityFilePath: join(root, "private-identity-do-not-echo"),
			sshPublicKeyPath: join(root, "private-public-key-do-not-echo"),
			sshKnownHostsPath: join(root, "private-known-hosts-do-not-echo"),
		};
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
		});

		const result = await enrollment.preview(privatePaths);

		expect(result).toEqual({
			state: "needs_human",
			station: "vault_git.repository_ssh_prerequisite",
			nextAction: {
				kind: "needs_human",
				actionId: "provision_repository_ssh",
				owner: "repository_ssh_owner",
				condition: "dedicated_identity_ready",
			},
			missingPrerequisites: [
				"ssh_identity_file",
				"ssh_public_key",
				"ssh_known_hosts",
			],
			installedRuntime: null,
			selectedRuntime: null,
			priorRuntime: null,
		});
		const publicText = JSON.stringify(result);
		for (const privatePath of Object.values(privatePaths)) {
			expect(publicText).not.toContain(privatePath);
		}
		for (const path of [configRoot, dataRoot, selectorPath]) {
			expect(await Bun.file(path).exists()).toBe(false);
		}
	});

	test("matching owner-only SSH inputs are ready for explicit enrollment", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const configRoot = join(root, "config");
		const dataRoot = join(root, "data");
		const selectorPath = join(root, "bin", "vault-git");
		const sshIdentityFilePath = join(root, "repository-writer");
		const generated = Bun.spawnSync([
			"/usr/bin/ssh-keygen",
			"-q",
			"-t",
			"ed25519",
			"-N",
			"",
			"-f",
			sshIdentityFilePath,
		]);
		expect(generated.exitCode).toBe(0);
		const sshPublicKeyPath = `${sshIdentityFilePath}.pub`;
		const sshKnownHostsPath = join(root, "known_hosts");
		await writeFile(
			sshKnownHostsPath,
			"github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureReviewedHostKey\n",
		);
		await chmod(sshIdentityFilePath, 0o600);
		await chmod(sshKnownHostsPath, 0o600);
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
		});

		expect(
			await enrollment.preview({
				sshIdentityFilePath,
				sshPublicKeyPath,
				sshKnownHostsPath,
			}),
		).toEqual({
			state: "ready",
			station: "vault_git.host_enrollment_ready",
			nextAction: {
				kind: "needs_input",
				actionId: "apply_host_enrollment",
				inputContractId: "setup.vault-git.host-enrollment",
				fields: [
					{ id: "ssh_identity_file_path", inputChannel: "private_stdin" },
					{ id: "ssh_public_key_path", inputChannel: "private_stdin" },
					{ id: "ssh_known_hosts_path", inputChannel: "private_stdin" },
				],
			},
			installedRuntime: null,
			selectedRuntime: null,
			priorRuntime: null,
		});
		for (const path of [configRoot, dataRoot, selectorPath]) {
			expect(await Bun.file(path).exists()).toBe(false);
		}
	});

	test("explicit apply installs and selects one content-addressed runtime", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const sourceRepoRoot = join(root, "source");
		const runtimeEntrypoint = join(sourceRepoRoot, "src", "cli.ts");
		await mkdir(join(sourceRepoRoot, "src"), { recursive: true });
		await writeFile(runtimeEntrypoint, '#!/usr/bin/env bun\nconsole.log("fixture vault git");\n');
		git(sourceRepoRoot, ["init", "--initial-branch=main"]);
		git(sourceRepoRoot, ["add", "."]);
		git(sourceRepoRoot, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "fixture"]);
		git(sourceRepoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const dataRoot = join(root, "data", "context", "vault-git");
		const selectorPath = join(root, "bin", "vault-git");
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
			sourceRepoRoot,
			runtimeEntrypoint,
			inspectWorkState: async () => "clear",
		});

		const first = await enrollment.apply(privateInput);
		expect(first.state).toBe("applied");
		if (first.state !== "applied") throw new Error("expected applied enrollment");
		expect(first.station).toBe("vault_git.runtime_selected");
		expect(first.hostHandle).toMatch(/^host_[a-f0-9]{32}$/);
		expect(first.installedRuntime?.digest).toMatch(/^[a-f0-9]{64}$/);
		expect(first.selectedRuntime).toEqual(first.installedRuntime);
		expect(first.priorRuntime).toBeNull();
		const publicText = JSON.stringify(first);
		for (const privatePath of Object.values(privateInput)) {
			expect(publicText).not.toContain(privatePath);
		}

		const activationPath = join(configRoot, "activation.json");
		const activation = JSON.parse(await readFile(activationPath, "utf8"));
		expect(activation).toEqual({
			schema_version: 1,
			host_handle: first.hostHandle,
			ssh_identity_file_path: await realpath(privateInput.sshIdentityFilePath),
			ssh_public_key_path: await realpath(privateInput.sshPublicKeyPath),
			ssh_known_hosts_path: await realpath(privateInput.sshKnownHostsPath),
		});
		expect((await lstat(configRoot)).mode & 0o777).toBe(0o700);
		expect((await lstat(activationPath)).mode & 0o777).toBe(0o600);
		const selectedPath = await realpath(selectorPath);
		expect(selectedPath).toBe(
			join(await realpath(dataRoot), "runtimes", first.installedRuntime.digest, "vault-git"),
		);
		expect((await lstat(selectedPath)).mode & 0o111).not.toBe(0);

		const second = await enrollment.apply(privateInput);
		expect(second.state).toBe("noop");
		if (second.state !== "noop") throw new Error("expected no-op enrollment");
		expect(second.hostHandle).toBe(first.hostHandle);
		expect(second.selectedRuntime).toEqual(first.selectedRuntime);
		expect(second.priorRuntime).toBeNull();
		expect(await enrollment.inspect()).toEqual({
			state: "enrolled",
			station: "vault_git.runtime_selected",
			hostHandle: first.hostHandle,
			installedRuntime: first.installedRuntime,
			selectedRuntime: first.selectedRuntime,
			priorRuntime: null,
		});
	});

	test("active work allows installation but refuses Runtime Selection", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root);
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const dataRoot = join(root, "data", "context", "vault-git");
		const selectorPath = join(root, "bin", "vault-git");
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
			sourceRepoRoot,
			runtimeEntrypoint,
			inspectWorkState: async () => "active",
		});

		const result = await enrollment.apply(privateInput);
		expect(result.state).toBe("blocked");
		if (result.state !== "blocked") throw new Error("expected blocked selection");
		expect(result).toEqual({
			state: "blocked",
			station: "vault_git.runtime_selection_blocked",
			nextAction: {
				kind: "needs_human",
				actionId: "wait_for_vault_git_idle",
				owner: "vault_git_operator",
				condition: "no_active_or_uncertain_work",
			},
			installedRuntime: result.installedRuntime,
			selectedRuntime: null,
			priorRuntime: null,
		});
		expect(result.installedRuntime.digest).toMatch(/^[a-f0-9]{64}$/);
		expect(
			await Bun.file(
				join(dataRoot, "runtimes", result.installedRuntime.digest, "vault-git"),
			).exists(),
		).toBe(true);
		expect(await Bun.file(join(configRoot, "activation.json")).exists()).toBe(false);
		expect(await Bun.file(selectorPath).exists()).toBe(false);
	});

	test("uncertain work refuses Runtime Selection while retaining the installation", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root);
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const dataRoot = join(root, "data", "context", "vault-git");
		const selectorPath = join(root, "bin", "vault-git");
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
			sourceRepoRoot,
			runtimeEntrypoint,
			inspectWorkState: async () => "uncertain",
		});

		const result = await enrollment.apply(privateInput);
		expect(result.state).toBe("blocked");
		if (result.state !== "blocked") throw new Error("expected blocked selection");
		expect(result.station).toBe("vault_git.runtime_selection_blocked");
		expect(
			await Bun.file(
				join(dataRoot, "runtimes", result.installedRuntime.digest, "vault-git"),
			).exists(),
		).toBe(true);
		expect(await Bun.file(join(configRoot, "activation.json")).exists()).toBe(false);
		expect(await Bun.file(selectorPath).exists()).toBe(false);
	});

	test("a missing work-state seam refuses Runtime Selection", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root);
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const dataRoot = join(root, "data", "context", "vault-git");
		const selectorPath = join(root, "bin", "vault-git");
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
			sourceRepoRoot,
			runtimeEntrypoint,
		});

		const result = await enrollment.apply(privateInput);
		expect(result.state).toBe("blocked");
		expect(await Bun.file(selectorPath).exists()).toBe(false);
	});

	test("upgrade retains one verified prior runtime and rollback is preview-first", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root, "runtime one");
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const dataRoot = join(root, "data", "context", "vault-git");
		const selectorPath = join(root, "bin", "vault-git");
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
			sourceRepoRoot,
			runtimeEntrypoint,
			inspectWorkState: async () => "clear",
		});
		const first = await enrollment.apply(privateInput);
		if (first.state !== "applied") throw new Error("expected first selection");
		await writeFile(runtimeEntrypoint, '#!/usr/bin/env bun\nconsole.log("runtime two");\n');
		git(sourceRepoRoot, ["add", "."]);
		git(sourceRepoRoot, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "runtime two"]);
		git(sourceRepoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

		const second = await enrollment.apply(privateInput);
		if (second.state !== "applied") throw new Error("expected upgraded selection");
		expect(second.selectedRuntime.digest).not.toBe(first.selectedRuntime.digest);
		expect(second.priorRuntime).toEqual(first.selectedRuntime);

		const preview = await enrollment.rollback(true);
		expect(preview).toEqual({
			state: "changes",
			station: "vault_git.rollback_ready",
			selectedRuntime: second.selectedRuntime,
			priorRuntime: first.selectedRuntime,
		});
		expect(await realpath(selectorPath)).toContain(second.selectedRuntime.digest);

		const rolledBack = await enrollment.rollback(false);
		expect(rolledBack).toEqual({
			state: "applied",
			station: "vault_git.rollback_applied",
			selectedRuntime: first.selectedRuntime,
			priorRuntime: second.selectedRuntime,
		});
		expect(await realpath(selectorPath)).toContain(first.selectedRuntime.digest);
	});

	test("foreign selector is preserved and blocks enrollment", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root);
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const dataRoot = join(root, "data", "context", "vault-git");
		const selectorPath = join(root, "bin", "vault-git");
		const foreign = join(root, "foreign-vault-git");
		await writeFile(foreign, "foreign\n", { mode: 0o755 });
		await mkdir(join(root, "bin"), { recursive: true });
		await symlink(foreign, selectorPath);
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
			sourceRepoRoot,
			runtimeEntrypoint,
			inspectWorkState: async () => "clear",
		});

		await expect(enrollment.apply(privateInput)).rejects.toThrow(
			"foreign Vault Git selector",
		);
		expect(await readlink(selectorPath)).toBe(foreign);
		expect(await readFile(foreign, "utf8")).toBe("foreign\n");
		expect(await Bun.file(join(configRoot, "activation.json")).exists()).toBe(false);
	});

	test("corrupt selected runtime digest fails closed without replacement", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root);
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const dataRoot = join(root, "data", "context", "vault-git");
		const selectorPath = join(root, "bin", "vault-git");
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot,
			selectorPath,
			sourceRepoRoot,
			runtimeEntrypoint,
			inspectWorkState: async () => "clear",
		});
		const applied = await enrollment.apply(privateInput);
		if (applied.state !== "applied") throw new Error("expected selected runtime");
		const selectedPath = await realpath(selectorPath);
		await writeFile(selectedPath, "corrupt runtime\n", { mode: 0o755 });

		await expect(enrollment.apply(privateInput)).rejects.toThrow(
			"runtime digest mismatch",
		);
		expect(await realpath(selectorPath)).toBe(selectedPath);
		expect(await readFile(selectedPath, "utf8")).toBe("corrupt runtime\n");
	});

	test("rollback apply during active or uncertain work returns a structured refusal", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		let workState: "clear" | "active" | "uncertain" = "clear";
		const fixture = await createEnrollmentFixture(root, async () => workState);
		const first = await fixture.enrollment.apply(fixture.privateInput);
		if (first.state !== "applied") throw new Error("expected first selection");
		await commitRuntimeSource(fixture.sourceRepoRoot, fixture.runtimeEntrypoint, "runtime two");
		const second = await fixture.enrollment.apply(fixture.privateInput);
		if (second.state !== "applied") throw new Error("expected upgraded selection");

		workState = "active";
		const refused = await fixture.enrollment.rollback(false);
		expect(refused).toEqual({
			state: "blocked",
			station: "vault_git.rollback_blocked",
			nextAction: {
				kind: "needs_human",
				actionId: "wait_for_vault_git_idle",
				owner: "vault_git_operator",
				condition: "no_active_or_uncertain_work",
			},
			selectedRuntime: second.selectedRuntime,
			priorRuntime: first.selectedRuntime,
		});
		workState = "uncertain";
		expect((await fixture.enrollment.rollback(false)).state).toBe("blocked");
		expect(await realpath(fixture.selectorPath)).toContain(second.selectedRuntime.digest);
	});

	test("rollback swaps a broken selected runtime onto the verified prior runtime", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const fixture = await createEnrollmentFixture(root);
		const first = await fixture.enrollment.apply(fixture.privateInput);
		if (first.state !== "applied") throw new Error("expected first selection");
		await commitRuntimeSource(fixture.sourceRepoRoot, fixture.runtimeEntrypoint, "runtime two");
		const second = await fixture.enrollment.apply(fixture.privateInput);
		if (second.state !== "applied") throw new Error("expected upgraded selection");
		const selectedPath = await realpath(fixture.selectorPath);
		await writeFile(selectedPath, "broken selected runtime\n", { mode: 0o755 });

		expect(await fixture.enrollment.rollback(true)).toEqual({
			state: "changes",
			station: "vault_git.rollback_ready",
			selectedRuntime: second.selectedRuntime,
			priorRuntime: first.selectedRuntime,
		});
		expect(await fixture.enrollment.rollback(false)).toEqual({
			state: "applied",
			station: "vault_git.rollback_applied",
			selectedRuntime: first.selectedRuntime,
			priorRuntime: second.selectedRuntime,
		});
		expect(await realpath(fixture.selectorPath)).toContain(first.selectedRuntime.digest);
	});

	test("rollback without a prior runtime fails closed without mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const fixture = await createEnrollmentFixture(root);
		const first = await fixture.enrollment.apply(fixture.privateInput);
		if (first.state !== "applied") throw new Error("expected first selection");

		await expect(fixture.enrollment.rollback(false)).rejects.toThrow(
			"prior Runtime Selection is unavailable",
		);
		expect(await realpath(fixture.selectorPath)).toContain(first.selectedRuntime.digest);
	});

	test("rollback with a corrupt prior runtime fails closed without mutation", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const fixture = await createEnrollmentFixture(root);
		const first = await fixture.enrollment.apply(fixture.privateInput);
		if (first.state !== "applied") throw new Error("expected first selection");
		await commitRuntimeSource(fixture.sourceRepoRoot, fixture.runtimeEntrypoint, "runtime two");
		const second = await fixture.enrollment.apply(fixture.privateInput);
		if (second.state !== "applied") throw new Error("expected upgraded selection");
		await writeFile(
			join(fixture.dataRoot, "runtimes", first.selectedRuntime.digest, "vault-git"),
			"corrupt prior runtime\n",
			{ mode: 0o755 },
		);

		await expect(fixture.enrollment.rollback(false)).rejects.toThrow(
			"prior runtime is invalid",
		);
		expect(await realpath(fixture.selectorPath)).toContain(second.selectedRuntime.digest);
	});

	test("apply replaces a managed-but-corrupt selected runtime from proven new source", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const fixture = await createEnrollmentFixture(root);
		const first = await fixture.enrollment.apply(fixture.privateInput);
		if (first.state !== "applied") throw new Error("expected first selection");
		const selectedPath = await realpath(fixture.selectorPath);
		await writeFile(selectedPath, "corrupt selected runtime\n", { mode: 0o755 });
		await commitRuntimeSource(fixture.sourceRepoRoot, fixture.runtimeEntrypoint, "runtime two");

		const second = await fixture.enrollment.apply(fixture.privateInput);
		if (second.state !== "applied") throw new Error("expected replacement selection");
		expect(second.selectedRuntime.digest).not.toBe(first.selectedRuntime.digest);
		expect(second.priorRuntime).toEqual(first.selectedRuntime);
		expect(await realpath(fixture.selectorPath)).toContain(second.selectedRuntime.digest);
	});

	test("unclean, unmerged, or uncompilable source fails closed without corrupting the selection", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const fixture = await createEnrollmentFixture(root);
		const first = await fixture.enrollment.apply(fixture.privateInput);
		if (first.state !== "applied") throw new Error("expected first selection");

		await writeFile(join(fixture.sourceRepoRoot, "untracked.txt"), "dirty\n");
		await expect(fixture.enrollment.apply(fixture.privateInput)).rejects.toThrow("not clean");
		await rm(join(fixture.sourceRepoRoot, "untracked.txt"));

		await writeFile(fixture.runtimeEntrypoint, '#!/usr/bin/env bun\nconsole.log("ahead");\n');
		git(fixture.sourceRepoRoot, ["add", "."]);
		git(fixture.sourceRepoRoot, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "ahead"]);
		await expect(fixture.enrollment.apply(fixture.privateInput)).rejects.toThrow("not merged");

		git(fixture.sourceRepoRoot, ["update-ref", "-d", "refs/remotes/origin/main"]);
		await expect(fixture.enrollment.apply(fixture.privateInput)).rejects.toThrow("not ready");

		await writeFile(fixture.runtimeEntrypoint, "this is not a compilable entrypoint ((((\n");
		git(fixture.sourceRepoRoot, ["add", "."]);
		git(fixture.sourceRepoRoot, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "broken"]);
		git(fixture.sourceRepoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
		await expect(fixture.enrollment.apply(fixture.privateInput)).rejects.toThrow("not ready");

		expect(await realpath(fixture.selectorPath)).toContain(first.selectedRuntime.digest);
		const record = JSON.parse(
			await readFile(join(fixture.configRoot, "runtime-selection.json"), "utf8"),
		);
		expect(record.selected_digest).toBe(first.selectedRuntime.digest);
	});

	test("a symlinked configuration root refuses enrollment writes", async () => {
		const root = await mkdtemp(join(tmpdir(), "setup-vault-git-enrollment-"));
		temporaryRoots.push(root);
		const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root);
		const privateInput = await createSshFixture(root);
		const configRoot = join(root, "config", "context", "vault-git");
		const elsewhere = join(root, "elsewhere");
		await mkdir(elsewhere, { recursive: true });
		await mkdir(join(root, "config", "context"), { recursive: true });
		await symlink(elsewhere, configRoot);
		const enrollment = createVaultGitHostEnrollment({
			configRoot,
			dataRoot: join(root, "data", "context", "vault-git"),
			selectorPath: join(root, "bin", "vault-git"),
			sourceRepoRoot,
			runtimeEntrypoint,
			inspectWorkState: async () => "clear",
		});

		await expect(enrollment.apply(privateInput)).rejects.toThrow("unsafe");
		expect(await readdir(elsewhere)).toEqual([]);
		expect(await Bun.file(join(root, "bin", "vault-git")).exists()).toBe(false);
	});
});

async function createEnrollmentFixture(
	root: string,
	inspectWorkState: () => Promise<"clear" | "active" | "uncertain"> = async () => "clear",
) {
	const { sourceRepoRoot, runtimeEntrypoint } = await createSourceFixture(root);
	const privateInput = await createSshFixture(root);
	const configRoot = join(root, "config", "context", "vault-git");
	const dataRoot = join(root, "data", "context", "vault-git");
	const selectorPath = join(root, "bin", "vault-git");
	const enrollment = createVaultGitHostEnrollment({
		configRoot,
		dataRoot,
		selectorPath,
		sourceRepoRoot,
		runtimeEntrypoint,
		inspectWorkState,
	});
	return {
		enrollment,
		sourceRepoRoot,
		runtimeEntrypoint,
		privateInput,
		configRoot,
		dataRoot,
		selectorPath,
	};
}

async function commitRuntimeSource(
	sourceRepoRoot: string,
	runtimeEntrypoint: string,
	source: string,
): Promise<void> {
	await writeFile(runtimeEntrypoint, `#!/usr/bin/env bun\nconsole.log(${JSON.stringify(source)});\n`);
	git(sourceRepoRoot, ["add", "."]);
	git(sourceRepoRoot, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", source]);
	git(sourceRepoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

async function createSourceFixture(root: string, source = "fixture vault git") {
	const sourceRepoRoot = join(root, "source");
	const runtimeEntrypoint = join(sourceRepoRoot, "src", "cli.ts");
	await mkdir(join(sourceRepoRoot, "src"), { recursive: true });
	await writeFile(runtimeEntrypoint, `#!/usr/bin/env bun\nconsole.log(${JSON.stringify(source)});\n`);
	git(sourceRepoRoot, ["init", "--initial-branch=main"]);
	git(sourceRepoRoot, ["add", "."]);
	git(sourceRepoRoot, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "fixture"]);
	git(sourceRepoRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
	return { sourceRepoRoot, runtimeEntrypoint };
}

async function createSshFixture(root: string) {
	const sshIdentityFilePath = join(root, "repository-writer");
	const generated = Bun.spawnSync([
		"/usr/bin/ssh-keygen",
		"-q",
		"-t",
		"ed25519",
		"-N",
		"",
		"-f",
		sshIdentityFilePath,
	]);
	if (generated.exitCode !== 0) throw new Error("fixture ssh-keygen failed");
	const sshPublicKeyPath = `${sshIdentityFilePath}.pub`;
	const sshKnownHostsPath = join(root, "known_hosts");
	await writeFile(
		sshKnownHostsPath,
		"github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureReviewedHostKey\n",
	);
	await chmod(sshIdentityFilePath, 0o600);
	await chmod(sshKnownHostsPath, 0o600);
	return { sshIdentityFilePath, sshPublicKeyPath, sshKnownHostsPath };
}

function git(cwd: string, args: readonly string[]): void {
	const result = Bun.spawnSync(["/usr/bin/git", ...args], {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
	});
	if (result.exitCode !== 0) {
		throw new Error(`git ${args[0] ?? "command"} failed`);
	}
}
