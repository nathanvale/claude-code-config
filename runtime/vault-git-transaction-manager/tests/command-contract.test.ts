import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";
import {
	CliRuntimeContractError,
	findCommandDiscoveryTreeDrift,
	findCommandFacadeMetadataDrift,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import {
	VAULT_GIT_COMMANDS,
	VAULT_GIT_GLOBAL_DIAGNOSTIC_FLAGS,
	defineVaultGitCommandContracts,
	parseVaultGitInvocation,
	projectVaultGitCommandDiscoveryTree,
	vaultGitContractEntries,
	vaultGitContracts,
} from "../src/command-contract.ts";
import { renderVaultGitHelp, runVaultGitForTest } from "../src/cli.ts";
import {
	VAULT_GIT_CHANGED_STATES,
	VAULT_GIT_RESULT_CONTRACT_ID,
	VAULT_GIT_RETRY_SAFETIES,
	VAULT_GIT_TRANSACTION_PHASES,
	VAULT_GIT_WRITE_PERMISSIONS,
	createVaultGitLifecycleResult,
} from "../src/model.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractOptions = {
	path: "runtime/vault-git-transaction-manager/src/command-contract.ts",
	writeImplyingMutations: new Set(["local_write", "remote_write", "recovery"]),
} as const;

describe("vault-git command contract", () => {
	test("declares the complete facade-owned public surface", () => {
		expect(Object.keys(vaultGitContracts)).toEqual([...VAULT_GIT_COMMANDS]);
		expect(vaultGitContractEntries.map(([command]) => command)).toEqual([
			...VAULT_GIT_COMMANDS,
		]);
		expect(findCommandFacadeMetadataDrift(vaultGitContracts, contractOptions)).toEqual([]);
		expect(findCommandDiscoveryTreeDrift(projectVaultGitCommandDiscoveryTree())).toEqual([]);
	});

	test("keeps rendered help, parser acceptance, and discovery flags aligned", () => {
		const discovery = projectVaultGitCommandDiscoveryTree();
		for (const command of VAULT_GIT_COMMANDS) {
			const help = renderCommandUsage(vaultGitContracts[command]);
			assertCommandHelpFlagSurface({
				command,
				contract: vaultGitContracts[command],
				help,
			});
			const advertised = Object.keys(discovery.commands[command]?.flags ?? {});
			for (const flag of advertised) {
				expect(() => parseVaultGitInvocation(argvForFlag(command, flag))).not.toThrow();
			}
		}
	});

	test("advertises the same command set in human help and discovery", () => {
		const help = renderVaultGitHelp();
		const discovery = projectVaultGitCommandDiscoveryTree();
		expect(Object.keys(discovery.commands)).toEqual([...VAULT_GIT_COMMANDS]);
		for (const command of VAULT_GIT_COMMANDS) {
			expect(help).toContain(vaultGitContracts[command].usage[0] ?? command);
		}
		expect(help).toContain("vault-git tidy now");
	});

	test("accepts facade diagnostics for every command without caller-specific policy", () => {
		const discovery = projectVaultGitCommandDiscoveryTree();
		for (const command of VAULT_GIT_COMMANDS) {
			expect(discovery.commands[command]?.global_diagnostic_flags).toEqual(
				VAULT_GIT_GLOBAL_DIAGNOSTIC_FLAGS,
			);
			for (const flag of VAULT_GIT_GLOBAL_DIAGNOSTIC_FLAGS) {
				expect(renderCommandUsage(vaultGitContracts[command])).toContain(flag);
			}
		}
		expect(JSON.stringify(discovery)).not.toMatch(/claude|codex|scheduled_caller/i);
	});

	test("contract construction rejects drifted flags", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<string, unknown>;
		const status = drifted.status as { flags: Record<string, unknown> };
		status.flags["--force"] = { type: "boolean", description: "Bypass policy." };
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("contract construction rejects unsafe text", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<string, unknown>;
		(drifted.status as { summary: string }).summary =
			"Read private state at /Users/example/private-vault.";
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("contract construction rejects foreign result contracts", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<string, unknown>;
		(drifted.status as { resultContract: { id: string } }).resultContract.id =
			"foreign.result";
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("contract construction rejects missing side-effect metadata", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<string, unknown>;
		delete (drifted.status as { sideEffects?: unknown }).sideEffects;
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});
});

describe("vault-git U1 read-only runtime", () => {
	test("routes no args to one bounded read-only dashboard action", () => {
		const run = runVaultGitForTest([], { runId: "run-dashboard" });
		expect(run.exitCode).toBe(0);
		expect(run.stderr).toBe("");
		expect(run.stdout.trim().split("\n").filter((line) => line.startsWith("next:"))).toEqual([
			"next: wait_for_runtime",
		]);
		expect(run.stdout).toContain("write_permission: denied");
		expect(run.stdout).toContain("changed_state: none");
	});

	test("status JSON exposes the complete safe lifecycle result", () => {
		const run = runVaultGitForTest(["status", "--json"], {
			runId: "run-status",
		});
		expect(run.exitCode).toBe(0);
		expect(run.stderr).toBe("");
		const envelope = JSON.parse(run.stdout);
		expect(envelope).toMatchObject({
			status: "ok",
			run_id: "run-status",
			data: {
				contract_id: VAULT_GIT_RESULT_CONTRACT_ID,
				command: "status",
				outcome: "read_only",
				phase: "unavailable",
				write_permission: "denied",
				changed_state: "none",
				retry_safety: "same_input_safe",
				next_action: { id: "wait_for_runtime" },
			},
			continuation: { next_action_id: "wait_for_runtime" },
		});
		expect(envelope.data.blockers).toEqual(["runtime_unavailable"]);
		expect(JSON.stringify(envelope)).not.toMatch(/\/Users\/|\/private\/|capability/i);
	});

	test("every mutating station refuses explicitly without reporting a change", () => {
		for (const argv of [
			["begin"],
			["join"],
			["complete"],
			["repair"],
			["tidy", "now"],
			["janitor"],
		] as const) {
			const run = runVaultGitForTest([...argv, "--json"], {
				runId: `run-${argv.join("-")}`,
			});
			expect(run.exitCode).toBe(1);
			const envelope = JSON.parse(run.stdout);
			expect(envelope).toMatchObject({
				status: "error",
				error: { code: "runtime_unavailable", retryable: false },
				data: {
					outcome: "unavailable",
					write_permission: "denied",
					changed_state: "none",
					next_action: { id: "inspect_status" },
				},
			});
		}
	});

	test("capability input accepts only a numeric inherited descriptor", () => {
		expect(parseVaultGitInvocation(["join", "--capability-fd", "7"])).toMatchObject({
			command: "join",
			capabilityFd: 7,
		});
		expect(() =>
			parseVaultGitInvocation(["join", "--capability-fd", "owner-secret"]),
		).toThrow("numeric inherited file descriptor");
		expect(() => parseVaultGitInvocation(["join", "--capability", "secret"])).toThrow(
			"Unsupported flag",
		);
	});

	test("result construction rejects literals outside package vocabulary", () => {
		expect(() =>
			createVaultGitLifecycleResult({
				command: "status",
				outcome: "read_only",
				phase: "foreign" as never,
				write_permission: "denied",
				changed_state: "none",
				retry_safety: "same_input_safe",
				blockers: ["runtime_unavailable"],
				next_action: { id: "wait_for_runtime", summary: "Wait for the runtime implementation." },
			}),
		).toThrow("phase");
		expect(VAULT_GIT_TRANSACTION_PHASES).toContain("closed");
		expect(VAULT_GIT_WRITE_PERMISSIONS).toEqual(["denied", "join", "owner"]);
		expect(VAULT_GIT_CHANGED_STATES).toContain("partial");
		expect(VAULT_GIT_RETRY_SAFETIES).toContain("operator_required");
	});
});

describe("vault-git KTD16 boundaries", () => {
	test("keeps model and ports independent from facade, process, filesystem, and Git adapters", () => {
		const findings = ["model.ts", "ports.ts"].flatMap((file) => {
			const source = readFileSync(resolve(packageRoot, "src", file), "utf8");
			return importSpecifiers(source)
				.filter((specifier) => {
					if (file === "ports.ts" && specifier === "./model.ts") return false;
					return true;
				})
				.map((specifier) => `${file} imports ${specifier}`);
		});
		expect(findings).toEqual([]);
	});

	test("keeps the package-local source import graph acyclic", () => {
		const modules = [
			"model.ts",
			"ports.ts",
			"command-contract.ts",
			"branch-station-catalog.ts",
			"cli.ts",
			"index.ts",
		];
		const graph = new Map(
			modules.map((file) => {
				const source = readFileSync(resolve(packageRoot, "src", file), "utf8");
				const dependencies = importSpecifiers(source)
					.filter((specifier) => specifier.startsWith("./"))
					.map((specifier) => `${specifier.slice(2).replace(extname(specifier), "")}.ts`);
				return [file, dependencies] as const;
			}),
		);
		expect(findCycles(graph)).toEqual([]);
	});
});

function argvForFlag(command: (typeof VAULT_GIT_COMMANDS)[number], flag: string): string[] {
	const argv = command === "tidy" ? [command, "now"] : [command];
	switch (flag) {
		case "--capability-fd":
			return [...argv, flag, "7"];
		case "--event":
			return [...argv, flag, "note_created"];
		case "--path":
			return [...argv, flag, "notes/example.md"];
		case "--summary":
			return [...argv, flag, "docs(vault): record example"];
		case "--transaction-id":
			return [...argv, flag, "txn-example"];
		default:
			return [...argv, flag];
	}
}

function importSpecifiers(source: string): string[] {
	return [
		...source.matchAll(
			/import(?:\s+type)?[\s\S]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|export[\s\S]*?from\s+["']([^"']+)["']/g,
		),
	].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function findCycles(graph: ReadonlyMap<string, readonly string[]>): string[] {
	const cycles: string[] = [];
	const visit = (node: string, path: readonly string[]): void => {
		const index = path.indexOf(node);
		if (index >= 0) {
			cycles.push([...path.slice(index), node].join(" -> "));
			return;
		}
		for (const dependency of graph.get(node) ?? []) {
			if (graph.has(dependency)) visit(dependency, [...path, node]);
		}
	};
	for (const node of graph.keys()) visit(node, []);
	return [...new Set(cycles)].sort();
}
