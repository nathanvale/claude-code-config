import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";

import {
	main,
	type SetupCliRuntime,
} from "../src/cli.ts";
import type { SetupResult } from "../src/model.ts";
import type {
	VaultGitHostEnrollment,
	VaultGitHostEnrollmentResult,
} from "../src/vault-git-host-enrollment.ts";

const APPLIED_RESULT = {
	state: "applied",
	station: "vault_git.runtime_selected",
	hostHandle: "host_11111111111111111111111111111111",
	installedRuntime: { digest: "a".repeat(64) },
	selectedRuntime: { digest: "a".repeat(64) },
	priorRuntime: null,
} as const satisfies VaultGitHostEnrollmentResult;

const ROLLBACK_READY_RESULT = {
	state: "changes",
	station: "vault_git.rollback_ready",
	selectedRuntime: { digest: "a".repeat(64) },
	priorRuntime: { digest: "b".repeat(64) },
} as const satisfies VaultGitHostEnrollmentResult;

const PRIVATE_VALUES = {
	ssh_identity_file_path: "/private/identity-do-not-echo",
	ssh_public_key_path: "/private/public-do-not-echo",
	ssh_known_hosts_path: "/private/known-hosts-do-not-echo",
} as const;

describe("Setup Vault Git Host Enrollment CLI", () => {
	test("explicit check projects the domain status without generic Setup mutation", async () => {
		const calls: string[] = [];
		const owner = fakeOwner(calls);
		const io = capture();
		const runtime = domainRuntime(calls);

		const exit = await main(
			["sync", "--domain", "vault-git", "--check", "--json"],
			{
				...io,
				runtime: Object.assign(runtime, { vaultGitHostEnrollment: owner }),
			},
		);

		expect(exit).toBe(0);
		expect(calls).toEqual(["vault_git.inspect"]);
		expect(JSON.parse(io.stdout.text).data).toMatchObject({
			command: "sync",
			state: "clean_slate",
			station: "sync.vault_git_inputs_required",
			next_action: "provide_host_enrollment_inputs",
			vault_git: {
				state: "not_enrolled",
				installedRuntime: null,
				selectedRuntime: null,
			},
		});
	});

	test("private stdin binds exact fields to apply and never returns their values", async () => {
		const calls: string[] = [];
		let appliedInput: unknown;
		const owner = fakeOwner(calls, {
			apply: async (input) => {
				calls.push("vault_git.apply");
				appliedInput = input;
				return APPLIED_RESULT;
			},
		});
		const io = capture();
		const runtime = Object.assign(domainRuntime(calls), {
			vaultGitHostEnrollment: owner,
			readPrivateStdin: async () => JSON.stringify(PRIVATE_VALUES),
		});

		expect(await main([
			"sync",
			"--domain",
			"vault-git",
			"--input-stdin",
			"setup.vault-git.host-enrollment",
			"--json",
		], { ...io, runtime })).toBe(0);
		expect(appliedInput).toEqual({
			sshIdentityFilePath: PRIVATE_VALUES.ssh_identity_file_path,
			sshPublicKeyPath: PRIVATE_VALUES.ssh_public_key_path,
			sshKnownHostsPath: PRIVATE_VALUES.ssh_known_hosts_path,
		});
		expect(calls).toEqual(["vault_git.apply"]);
		for (const value of Object.values(PRIVATE_VALUES)) {
			expect(io.stdout.text).not.toContain(value);
			expect(io.stderr.text).not.toContain(value);
		}
		expect(JSON.parse(io.stdout.text).data).toMatchObject({
			state: "applied",
			station: "sync.vault_git_applied",
			next_action: "setup_healthy",
			vault_git: { selectedRuntime: { digest: "a".repeat(64) } },
		});
	});

	const projectionRows: readonly {
		name: string;
		argv: readonly string[];
		owner: Partial<VaultGitHostEnrollment>;
		stdin?: boolean;
		exit: 0 | 1;
		station: string;
		state: string;
		nextAction: string;
	}[] = [
		{
			name: "enrolled inspection",
			argv: ["sync", "--domain", "vault-git", "--check", "--json"],
			owner: {
				inspect: async () => ({
					state: "enrolled",
					station: "vault_git.runtime_selected",
					hostHandle: APPLIED_RESULT.hostHandle,
					installedRuntime: APPLIED_RESULT.installedRuntime,
					selectedRuntime: APPLIED_RESULT.selectedRuntime,
					priorRuntime: null,
				}),
			},
			exit: 0,
			station: "sync.vault_git_selected",
			state: "healthy",
			nextAction: "setup_healthy",
		},
		{
			name: "preview prerequisite stop",
			argv: ["sync", "--domain", "vault-git", "--check", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
			owner: {
				preview: async () => ({
					state: "needs_human",
					station: "vault_git.repository_ssh_prerequisite",
					nextAction: {
						kind: "needs_human",
						actionId: "provision_repository_ssh",
						owner: "repository_ssh_owner",
						condition: "dedicated_identity_ready",
					},
					missingPrerequisites: ["ssh_identity_file"],
					installedRuntime: null,
					selectedRuntime: null,
					priorRuntime: null,
				}),
			},
			stdin: true,
			exit: 1,
			station: "sync.vault_git_ssh_prerequisite",
			state: "blocked",
			nextAction: "provision_repository_ssh",
		},
		{
			name: "preview ready for explicit apply",
			argv: ["sync", "--domain", "vault-git", "--check", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
			owner: {
				preview: async () => ({
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
				}),
			},
			stdin: true,
			exit: 1,
			station: "sync.vault_git_enrollment_ready",
			state: "changes",
			nextAction: "apply_host_enrollment",
		},
		{
			name: "repeat apply no-op",
			argv: ["sync", "--domain", "vault-git", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
			owner: {
				apply: async () => ({ ...APPLIED_RESULT, state: "noop" }),
			},
			stdin: true,
			exit: 0,
			station: "sync.vault_git_noop",
			state: "noop",
			nextAction: "setup_healthy",
		},
		{
			name: "selection blocked by active work",
			argv: ["sync", "--domain", "vault-git", "--input-stdin", "setup.vault-git.host-enrollment", "--json"],
			owner: {
				apply: async () => ({
					state: "blocked",
					station: "vault_git.runtime_selection_blocked",
					nextAction: {
						kind: "needs_human",
						actionId: "wait_for_vault_git_idle",
						owner: "vault_git_operator",
						condition: "no_active_or_uncertain_work",
					},
					installedRuntime: APPLIED_RESULT.installedRuntime,
					selectedRuntime: null,
					priorRuntime: null,
				}),
			},
			stdin: true,
			exit: 1,
			station: "sync.vault_git_selection_blocked",
			state: "blocked",
			nextAction: "wait_for_vault_git_idle",
		},
		{
			name: "rollback preview",
			argv: ["sync", "--domain", "vault-git", "--rollback", "--check", "--json"],
			owner: { rollback: async () => ROLLBACK_READY_RESULT },
			exit: 1,
			station: "sync.vault_git_rollback_ready",
			state: "changes",
			nextAction: "apply_vault_git_rollback",
		},
		{
			name: "rollback applied",
			argv: ["sync", "--domain", "vault-git", "--rollback", "--json"],
			owner: {
				rollback: async () => ({
					state: "applied",
					station: "vault_git.rollback_applied",
					selectedRuntime: ROLLBACK_READY_RESULT.priorRuntime,
					priorRuntime: ROLLBACK_READY_RESULT.selectedRuntime,
				}),
			},
			exit: 0,
			station: "sync.vault_git_rollback_applied",
			state: "applied",
			nextAction: "setup_healthy",
		},
		{
			name: "rollback blocked by active work",
			argv: ["sync", "--domain", "vault-git", "--rollback", "--json"],
			owner: {
				rollback: async () => ({
					state: "blocked",
					station: "vault_git.rollback_blocked",
					nextAction: {
						kind: "needs_human",
						actionId: "wait_for_vault_git_idle",
						owner: "vault_git_operator",
						condition: "no_active_or_uncertain_work",
					},
					selectedRuntime: ROLLBACK_READY_RESULT.selectedRuntime,
					priorRuntime: ROLLBACK_READY_RESULT.priorRuntime,
				}),
			},
			exit: 1,
			station: "sync.vault_git_rollback_blocked",
			state: "blocked",
			nextAction: "wait_for_vault_git_idle",
		},
	];

	test("projects one aligned terminal station for every Host Enrollment outcome", async () => {
		for (const row of projectionRows) {
			const calls: string[] = [];
			const io = capture();
			const runtime = Object.assign(domainRuntime(calls), {
				vaultGitHostEnrollment: fakeOwner(calls, row.owner),
				...(row.stdin
					? { readPrivateStdin: async () => JSON.stringify(PRIVATE_VALUES) }
					: {}),
			});

			expect(await main([...row.argv], { ...io, runtime }), row.name).toBe(row.exit);
			const envelope = JSON.parse(io.stdout.text);
			expect(envelope.status, row.name).toBe("ok");
			expect(envelope.data, row.name).toMatchObject({
				command: "sync",
				scope: "user",
				station: row.station,
				state: row.state,
				next_action: row.nextAction,
			});
			expect(calls.every((call) => call.startsWith("vault_git.")), row.name).toBe(true);
		}
	});

	test("malformed or missing private input fails usage-closed without owner dispatch", async () => {
		const rows = [
			JSON.stringify({ ssh_identity_file_path: PRIVATE_VALUES.ssh_identity_file_path }),
			JSON.stringify({ ...PRIVATE_VALUES, extra_field: "x" }),
			JSON.stringify({ ...PRIVATE_VALUES, ssh_public_key_path: 7 }),
			"not json",
			JSON.stringify({ ...PRIVATE_VALUES, ssh_known_hosts_path: "x".repeat(20_000) }),
		];
		for (const source of rows) {
			const calls: string[] = [];
			const io = capture();
			const runtime = Object.assign(domainRuntime(calls), {
				vaultGitHostEnrollment: fakeOwner(calls),
				readPrivateStdin: async () => source,
			});

			expect(await main([
				"sync",
				"--domain",
				"vault-git",
				"--input-stdin",
				"setup.vault-git.host-enrollment",
				"--json",
			], { ...io, runtime })).toBe(2);
			expect(calls).toEqual([]);
			for (const value of Object.values(PRIVATE_VALUES)) {
				expect(io.stdout.text).not.toContain(value);
				expect(io.stderr.text).not.toContain(value);
			}
			expect(JSON.parse(io.stdout.text)).toMatchObject({
				status: "error",
				error: { code: "invalid_usage" },
			});
		}
	});

	test("oversized private input reports only the 16,384-byte limit; missing input stays unavailable", async () => {
		const secret = "private-oversized-do-not-echo";
		const oversized = JSON.stringify({
			...PRIVATE_VALUES,
			ssh_known_hosts_path: `/${secret}/${"x".repeat(17_000)}`,
		});
		const argv = [
			"sync",
			"--domain",
			"vault-git",
			"--input-stdin",
			"setup.vault-git.host-enrollment",
		] as const;

		const oversizedIo = capture();
		const oversizedCalls: string[] = [];
		expect(await main([...argv], {
			...oversizedIo,
			runtime: Object.assign(domainRuntime(oversizedCalls), {
				vaultGitHostEnrollment: fakeOwner(oversizedCalls),
				readPrivateStdin: async () => oversized,
			}),
		})).toBe(2);
		expect(oversizedCalls).toEqual([]);
		expect(oversizedIo.stderr.text).toContain(
			"Private Host Enrollment input exceeds the 16,384-byte limit",
		);
		expect(oversizedIo.stderr.text).not.toContain("unavailable");
		for (const text of [oversizedIo.stdout.text, oversizedIo.stderr.text]) {
			expect(text).not.toContain(secret);
			expect(text).not.toContain(String(oversized.length));
			for (const value of Object.values(PRIVATE_VALUES)) {
				expect(text).not.toContain(value);
			}
		}

		const missingIo = capture();
		const missingCalls: string[] = [];
		expect(await main([...argv], {
			...missingIo,
			runtime: Object.assign(domainRuntime(missingCalls), {
				vaultGitHostEnrollment: fakeOwner(missingCalls),
				readPrivateStdin: undefined,
			}),
		})).toBe(2);
		expect(missingCalls).toEqual([]);
		expect(missingIo.stderr.text).toContain(
			"Private Host Enrollment input is unavailable",
		);
		expect(missingIo.stderr.text).not.toContain("16,384");
	});

	test("the private input limit measures UTF-8 bytes, not UTF-16 length", async () => {
		const secret = "private-multibyte-do-not-echo";
		// "€" is one UTF-16 code unit but three UTF-8 bytes, so this payload is
		// under the limit by string length while over it by encoded bytes.
		const multibyte = JSON.stringify({
			...PRIVATE_VALUES,
			ssh_known_hosts_path: `/${secret}/${"€".repeat(6_000)}`,
		});
		expect(multibyte.length).toBeLessThanOrEqual(16_384);
		expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(16_384);

		const io = capture();
		const calls: string[] = [];
		expect(await main([
			"sync",
			"--domain",
			"vault-git",
			"--input-stdin",
			"setup.vault-git.host-enrollment",
		], {
			...io,
			runtime: Object.assign(domainRuntime(calls), {
				vaultGitHostEnrollment: fakeOwner(calls),
				readPrivateStdin: async () => multibyte,
			}),
		})).toBe(2);
		expect(calls).toEqual([]);
		expect(io.stderr.text).toContain(
			"Private Host Enrollment input exceeds the 16,384-byte limit",
		);
		for (const text of [io.stdout.text, io.stderr.text]) {
			expect(text).not.toContain(secret);
			expect(text).not.toContain(String(multibyte.length));
			expect(text).not.toContain(String(Buffer.byteLength(multibyte, "utf8")));
			for (const value of Object.values(PRIVATE_VALUES)) {
				expect(text).not.toContain(value);
			}
		}
	});

	test("plain user sync projects Vault Git domain status without enrollment dispatch", async () => {
		const calls: string[] = [];
		const io = capture();
		const runtime = Object.assign(domainRuntime(calls), {
			vaultGitHostEnrollment: fakeOwner(calls),
			apply: async () => {
				calls.push("generic.apply");
				return genericSyncResult();
			},
		});

		expect(await main(["sync", "--json"], { ...io, runtime })).toBe(0);
		expect(calls).toEqual(["generic.apply", "vault_git.inspect"]);
		expect(JSON.parse(io.stdout.text).data).toMatchObject({
			station: "sync.applied",
			vault_git: { state: "not_enrolled" },
		});
	});

	test("project-scope sync never touches the Vault Git domain", async () => {
		const calls: string[] = [];
		const io = capture();
		const runtime = Object.assign(domainRuntime(calls), {
			vaultGitHostEnrollment: fakeOwner(calls),
			apply: async () => {
				calls.push("generic.apply");
				return genericSyncResult();
			},
		});

		expect(await main(
			["sync", "--scope", "project", "--repo", "/tmp/project", "--json"],
			{ ...io, runtime },
		)).toBe(0);
		expect(calls).toEqual(["generic.apply"]);
		expect(JSON.parse(io.stdout.text).data.vault_git).toBeUndefined();
	});
});

function genericSyncResult(): SetupResult {
	return {
		command: "sync",
		scope: "user",
		state: "applied",
		findings: [],
		domains: [],
		operations: [],
		projection_targets: [],
		counts: { catalog: 0, managed: 0, external: 0, planned: 0, blockers: 0 },
		catalog_root: "/repo",
		destination_roots: [],
		station: "sync.applied",
		next_action: "setup_healthy",
	};
}

function domainRuntime(calls: string[]): SetupCliRuntime {
	return {
		sourceRepoRoot: "/repo",
		homeDir: "/home",
		now: () => 100,
		env: {},
		stdoutIsTTY: false,
		inspect: async () => {
			calls.push("generic.inspect");
			throw new Error("generic Setup inspection must not own the Vault Git domain");
		},
		apply: async () => {
			calls.push("generic.apply");
			throw new Error("generic Setup apply must not own the Vault Git domain");
		},
		unlink: async () => {
			throw new Error("unlink is not used");
		},
	};
}

function fakeOwner(
	calls: string[],
	overrides: Partial<VaultGitHostEnrollment> = {},
): VaultGitHostEnrollment {
	return {
		inspect: async () => {
			calls.push("vault_git.inspect");
			return {
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
			};
		},
		preview: async () => {
			throw new Error("preview is not used");
		},
		apply: async () => {
			throw new Error("apply is not configured");
		},
		rollback: async () => {
			throw new Error("rollback is not used");
		},
		...overrides,
	};
}

function capture() {
	const stdout = { text: "", write(value: string) { this.text += value; } };
	const stderr = { text: "", write(value: string) { this.text += value; } };
	return { stdout, stderr };
}
