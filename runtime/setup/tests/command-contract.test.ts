import { describe, expect, test } from "bun:test";
import {
	findCommandDiscoveryTreeDrift,
	findCommandFacadeMetadataDrift,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import {
	parseSetupInvocation,
	projectSetupCommandDiscoveryTree,
	setupContractEntries,
	setupContracts,
} from "../src/command-contract.ts";
import { SETUP_COMMANDS } from "../src/model.ts";

describe("setup command contract", () => {
	test("declares the complete facade-owned public surface", () => {
		expect(Object.keys(setupContracts)).toEqual([...SETUP_COMMANDS]);
		expect(setupContractEntries.map(([command]) => command)).toEqual([
			...SETUP_COMMANDS,
		]);
		expect(findCommandFacadeMetadataDrift(setupContracts, {
			path: "runtime/setup/src/command-contract.ts",
			writeImplyingMutations: new Set(["write"]),
		})).toEqual([]);
		expect(findCommandDiscoveryTreeDrift(projectSetupCommandDiscoveryTree())).toEqual([]);
	});

	test("renders every advertised flag from the contract", () => {
		for (const command of SETUP_COMMANDS) {
			assertCommandHelpFlagSurface({
				command,
				contract: setupContracts[command],
				help: renderCommandUsage(setupContracts[command]),
			});
		}
	});

	test("advertises the global diagnostic flag wherever the parser accepts it", () => {
		for (const command of SETUP_COMMANDS) {
			expect(renderCommandUsage(setupContracts[command])).toContain("--verbose");
			expect(() => parseSetupInvocation(argvForFlag(command, "--verbose"))).not.toThrow();
		}
	});

	test("keeps command-foreign flags out of help and parser acceptance", () => {
		expect(renderCommandUsage(setupContracts.status)).not.toContain("--check");
		expect(renderCommandUsage(setupContracts.commands)).not.toContain("--scope");
		expect(() => parseSetupInvocation(["status", "--check"])).toThrow(
			"Unsupported flag for status: --check",
		);
		expect(parseSetupInvocation(["commands", "--json", "--verbose"]).verbose).toBe(true);
	});

	test("accepts every command flag advertised by discovery and rejects foreign flags", () => {
		const discovery = projectSetupCommandDiscoveryTree();
		const allFlags = new Set<string>();
		for (const metadata of Object.values(discovery.commands)) {
			for (const flag of Object.keys(metadata.flags)) allFlags.add(flag);
			for (const flag of metadata.global_diagnostic_flags) allFlags.add(flag);
		}

		for (const command of SETUP_COMMANDS) {
			const metadata = discovery.commands[command];
			if (!metadata) throw new Error(`Missing discovery metadata for ${command}`);
			const advertised = new Set([
				...Object.keys(metadata.flags),
				...metadata.global_diagnostic_flags,
			]);
			for (const flag of advertised) {
				expect(() => parseSetupInvocation(argvForFlag(command, flag))).not.toThrow();
			}
			for (const flag of allFlags) {
				if (advertised.has(flag)) continue;
				expect(() => parseSetupInvocation(argvForFlag(command, flag))).toThrow();
			}
		}
	});

	test("routes no arguments to read-only user status", () => {
		expect(parseSetupInvocation([])).toEqual({
			command: "status",
			scope: "user",
			positionals: [],
			json: false,
			verbose: false,
			noColor: false,
			check: false,
			rollback: false,
			alias: "no_args",
		});
	});

	test("accepts every advertised flag with explicit project scope", () => {
		expect(parseSetupInvocation([
			"sync",
			"--check",
			"--scope",
			"project",
			"--repo",
			"/tmp/project",
			"--json",
			"--verbose",
			"--no-color",
		])).toMatchObject({
			command: "sync",
			scope: "project",
			repo: "/tmp/project",
			json: true,
			verbose: true,
			noColor: true,
			check: true,
		});
	});

	test("accepts the explicit Vault Git enrollment and rollback grammar only on sync", () => {
		expect(parseSetupInvocation([
			"sync",
			"--domain",
			"vault-git",
			"--check",
			"--json",
		])).toMatchObject({
			command: "sync",
			domain: "vault-git",
			check: true,
			rollback: false,
		});
		expect(parseSetupInvocation([
			"sync",
			"--domain",
			"vault-git",
			"--input-stdin",
			"setup.vault-git.host-enrollment",
			"--json",
		])).toMatchObject({
			domain: "vault-git",
			inputStdin: "setup.vault-git.host-enrollment",
		});
		expect(parseSetupInvocation([
			"sync",
			"--domain",
			"vault-git",
			"--rollback",
			"--check",
		])).toMatchObject({ domain: "vault-git", rollback: true, check: true });
		expect(() => parseSetupInvocation(["status", "--domain", "vault-git"])).toThrow(
			"Unsupported flag for status: --domain",
		);
		expect(() => parseSetupInvocation(["sync", "--rollback"])).toThrow(
			"--rollback requires --domain vault-git",
		);
		expect(() => parseSetupInvocation([
			"sync",
			"--domain",
			"vault-git",
			"--input-stdin",
			"forged.contract",
		])).toThrow("Unsupported --input-stdin contract");
	});

	test("discovery declares private-input application as a write and keeps the repair preview read-only", () => {
		const sync = projectSetupCommandDiscoveryTree().commands.sync;
		const contract = sync?.input_contracts?.find(
			(candidate) => candidate.id === "setup.vault-git.host-enrollment",
		);
		expect(contract?.action_id).toBe("provide_host_enrollment_inputs");
		const continuations = sync?.action_affordances?.continuations ?? [];
		const byId = new Map(continuations.map((action) => [action.id, action]));
		expect(byId.get("provide_host_enrollment_inputs")?.side_effects).toEqual([
			"read",
			"check",
			"write",
		]);
		expect(byId.get("apply_host_enrollment")?.side_effects).toEqual([
			"read",
			"check",
			"write",
		]);
		expect(byId.get("preview_host_enrollment_repair")?.side_effects).toEqual([
			"read",
			"check",
		]);
	});

	test("rejects inline values for boolean flags", () => {
		for (const [command, flag] of [
			["status", "--json"],
			["status", "--verbose"],
			["status", "--no-color"],
			["sync", "--check"],
		] as const) {
			expect(() => parseSetupInvocation([command, `${flag}=true`])).toThrow(
				`${flag} does not accept a value`,
			);
		}
	});

	test("rejects invalid scope and repo combinations", () => {
		expect(() => parseSetupInvocation(["status", "--scope", "other"])).toThrow(
			"--scope must be one of: user, project",
		);
		expect(() => parseSetupInvocation(["status", "--scope", "project"])).toThrow(
			"--scope project requires --repo",
		);
		expect(() => parseSetupInvocation(["status", "--repo", "/tmp/project"])).toThrow(
			"--repo requires --scope project",
		);
	});

	test("limits catalog to one optional skill and commands to JSON only", () => {
		expect(parseSetupInvocation(["catalog", "fallow"])).toMatchObject({
			command: "catalog",
			positionals: ["fallow"],
		});
		expect(() => parseSetupInvocation(["catalog", "one", "two"])).toThrow(
			"catalog accepts at most one skill id",
		);
		expect(() => parseSetupInvocation(["commands"])).toThrow(
			"commands requires --json",
		);
		expect(parseSetupInvocation(["commands", "--json"])).toMatchObject({
			command: "commands",
			json: true,
		});
	});
});

function argvForFlag(command: (typeof SETUP_COMMANDS)[number], flag: string): string[] {
	const argv: string[] = [command];
	if (command === "commands" && flag !== "--json") argv.push("--json");
	switch (flag) {
		case "--scope": argv.push(flag, "user"); break;
		case "--repo": argv.push("--scope", "project", flag, "/tmp/project"); break;
		case "--domain": argv.push(flag, "vault-git"); break;
		case "--input-stdin": argv.push("--domain", "vault-git", flag, "setup.vault-git.host-enrollment"); break;
		case "--rollback": argv.push("--domain", "vault-git", flag); break;
		default: argv.push(flag);
	}
	return argv;
}
