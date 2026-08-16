import { describe, expect, test } from "bun:test";

import {
	bindVaultGitPrivateSetupInput,
	type VaultGitSetupDiscoveryResult,
	type VaultGitSetupResult,
	type VaultGitSetupSpawn,
} from "../src/next-safe-action.ts";

// Distinctive private values. A newline-delimited stdin would corrupt field
// boundaries and a value with JSON metacharacters could break a naive envelope,
// so the stdin envelope is canonical JSON keyed by field id. The known-hosts
// value carries a quote + backslash to prove the envelope escapes them safely
// (a real SSH path has no newline, which the value validator rejects separately).
const SECRET_IDENTITY = "/private/secret-fixture/id_ed25519";
const SECRET_PUBLIC = "/private/secret-fixture/id_ed25519.pub";
const SECRET_KNOWN_HOSTS = '/private/secret-fixture/known_hosts "q\\b';

const DISCOVERY: VaultGitSetupDiscoveryResult = {
	action_argv: ["sync", "--domain", "vault-git"],
	input_contract_id: "setup.vault-git.host-enrollment",
	fields: [
		{ id: "ssh_identity_file_path", input_channel: "private_stdin" },
		{ id: "ssh_public_key_path", input_channel: "private_stdin" },
		{ id: "ssh_known_hosts_path", input_channel: "private_stdin" },
	],
};

const VALID_VALUES = [
	{ id: "ssh_identity_file_path", value: SECRET_IDENTITY },
	{ id: "ssh_public_key_path", value: SECRET_PUBLIC },
	{ id: "ssh_known_hosts_path", value: SECRET_KNOWN_HOSTS },
];

// Independent expected stdin: canonical JSON keyed by field id, values verbatim
// (newline preserved), computed WITHOUT the binder.
const EXPECTED_STDIN = JSON.stringify({
	ssh_identity_file_path: SECRET_IDENTITY,
	ssh_public_key_path: SECRET_PUBLIC,
	ssh_known_hosts_path: SECRET_KNOWN_HOSTS,
});

function recordingSpawn(
	result: VaultGitSetupResult = {
		status: "applied",
		public_summary: "Host Enrollment applied.",
	},
): {
	spawn: VaultGitSetupSpawn;
	calls: Array<{ argv: readonly string[]; stdin: string }>;
} {
	const calls: Array<{ argv: readonly string[]; stdin: string }> = [];
	const spawn: VaultGitSetupSpawn = async ({ argv, stdin }) => {
		calls.push({ argv: [...argv], stdin });
		return result;
	};
	return { spawn, calls };
}

describe("vault-git private Setup binder", () => {
	test("derives argv from discovery, appends --input-stdin, streams a keyed envelope", async () => {
		const { spawn, calls } = recordingSpawn();
		const result = await bindVaultGitPrivateSetupInput(
			{ action_id: "provide_host_enrollment_inputs" },
			VALID_VALUES,
			{ discovery: DISCOVERY, spawn },
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].argv).toEqual([
			"sync",
			"--domain",
			"vault-git",
			"--input-stdin",
			"setup.vault-git.host-enrollment",
		]);
		expect(calls[0].stdin).toBe(EXPECTED_STDIN);
		expect(result).toEqual({
			status: "applied",
			public_summary: "Host Enrollment applied.",
		});
	});

	test("private values never appear in argv or the returned result", async () => {
		const { spawn, calls } = recordingSpawn();
		const result = await bindVaultGitPrivateSetupInput(
			{ action_id: "provide_host_enrollment_inputs" },
			VALID_VALUES,
			{ discovery: DISCOVERY, spawn },
		);
		const argvText = calls[0].argv.join(" ");
		const resultText = JSON.stringify(result);
		for (const secret of [SECRET_IDENTITY, SECRET_PUBLIC, SECRET_KNOWN_HOSTS]) {
			expect(argvText).not.toContain(secret);
			expect(resultText).not.toContain(secret);
		}
	});

	test("a hostile spawn result carrying a private value fails closed with a nonleaking error", async () => {
		const { spawn } = recordingSpawn({
			status: "applied",
			public_summary: `leaked ${SECRET_KNOWN_HOSTS}`,
		});
		let message = "";
		await expect(
			(async () => {
				try {
					return await bindVaultGitPrivateSetupInput(
						{ action_id: "provide_host_enrollment_inputs" },
						VALID_VALUES,
						{ discovery: DISCOVERY, spawn },
					);
				} catch (error) {
					message = (error as Error).message;
					throw error;
				}
			})(),
		).rejects.toThrow();
		expect(message).not.toContain(SECRET_KNOWN_HOSTS);
		expect(message).not.toContain(
			JSON.stringify(SECRET_KNOWN_HOSTS).slice(1, -1),
		);
	});

	test("a hostile thrown error carrying a JSON-escaped private value never leaks outward", async () => {
		const escapedKnownHosts = JSON.stringify(SECRET_KNOWN_HOSTS).slice(1, -1);
		const spawn: VaultGitSetupSpawn = async () => {
			throw new Error(`child failed with ${escapedKnownHosts}`);
		};
		let message = "";
		try {
			await bindVaultGitPrivateSetupInput(
				{ action_id: "provide_host_enrollment_inputs" },
				VALID_VALUES,
				{ discovery: DISCOVERY, spawn },
			);
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message.length).toBeGreaterThan(0);
		for (const secret of [SECRET_IDENTITY, SECRET_PUBLIC, SECRET_KNOWN_HOSTS]) {
			expect(message).not.toContain(secret);
		}
		expect(message).not.toContain(escapedKnownHosts);
	});

	test("refuses missing, unknown, and duplicate field ids before spawning", async () => {
		const cases: Array<[Array<{ id: string; value: string }>, RegExp]> = [
			[
				[
					{ id: "ssh_identity_file_path", value: SECRET_IDENTITY },
					{ id: "ssh_public_key_path", value: SECRET_PUBLIC },
				],
				/ssh_known_hosts_path|missing/i,
			],
			[
				[...VALID_VALUES, { id: "surprise", value: "x" }],
				/surprise|unknown|extra/i,
			],
			[
				[
					{ id: "ssh_identity_file_path", value: SECRET_IDENTITY },
					{ id: "ssh_identity_file_path", value: SECRET_PUBLIC },
					{ id: "ssh_public_key_path", value: SECRET_PUBLIC },
					{ id: "ssh_known_hosts_path", value: SECRET_KNOWN_HOSTS },
				],
				/duplicate/i,
			],
		];
		for (const [values, pattern] of cases) {
			const { spawn, calls } = recordingSpawn();
			await expect(
				bindVaultGitPrivateSetupInput(
					{ action_id: "provide_host_enrollment_inputs" },
					values,
					{ discovery: DISCOVERY, spawn },
				),
			).rejects.toThrow(pattern);
			expect(calls).toHaveLength(0); // refuse before spawn
		}
	});

	test("refuses a divergent discovery contract/field/argv before spawning", async () => {
		const divergent: VaultGitSetupDiscoveryResult[] = [
			{ ...DISCOVERY, input_contract_id: "setup.vault-git.forged" },
			// Unexpected action argv (wrong command / wrong domain).
			{ ...DISCOVERY, action_argv: ["status"] },
			{ ...DISCOVERY, action_argv: ["sync", "--domain", "forged"] },
			{
				...DISCOVERY,
				fields: [
					{ id: "ssh_public_key_path", input_channel: "private_stdin" },
					{ id: "ssh_identity_file_path", input_channel: "private_stdin" },
					{ id: "ssh_known_hosts_path", input_channel: "private_stdin" },
				],
			},
			{
				...DISCOVERY,
				fields: [
					{ id: "ssh_identity_file_path", input_channel: "public" },
					{ id: "ssh_public_key_path", input_channel: "private_stdin" },
					{ id: "ssh_known_hosts_path", input_channel: "private_stdin" },
				],
			},
		];
		for (const discovery of divergent) {
			const { spawn, calls } = recordingSpawn();
			await expect(
				bindVaultGitPrivateSetupInput(
					{ action_id: "provide_host_enrollment_inputs" },
					VALID_VALUES,
					{ discovery, spawn },
				),
			).rejects.toThrow(/divergen|contract|field|channel|argv/i);
			expect(calls).toHaveLength(0);
		}
	});

	test("refuses a public (non-private) contract through the Setup lane before spawning", async () => {
		const publicDiscovery: VaultGitSetupDiscoveryResult = {
			action_argv: ["begin"],
			input_contract_id: "vault-git.begin",
			fields: [{ id: "event", input_channel: "public" }],
		};
		const { spawn, calls } = recordingSpawn();
		await expect(
			bindVaultGitPrivateSetupInput(
				{ action_id: "begin_transaction" },
				[{ id: "event", value: "note_created" }],
				{ discovery: publicDiscovery, spawn },
			),
		).rejects.toThrow(/private|public|lane/i);
		expect(calls).toHaveLength(0);
	});
});
