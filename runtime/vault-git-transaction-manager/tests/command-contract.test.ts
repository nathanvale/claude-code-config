import { readFileSync, readdirSync } from "node:fs";
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
import {
	type VAULT_GIT_STATION_IDS,
	vaultGitBranchStationCatalog,
} from "../src/branch-station-catalog.ts";
import { renderVaultGitHelp, runVaultGitForTest } from "../src/cli.ts";
import {
	VAULT_GIT_CHANGED_STATES,
	VAULT_GIT_COMMANDS_CONTRACT_ID,
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
		expect(
			findCommandFacadeMetadataDrift(vaultGitContracts, contractOptions),
		).toEqual([]);
		expect(
			findCommandDiscoveryTreeDrift(projectVaultGitCommandDiscoveryTree()),
		).toEqual([]);
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
				expect(() =>
					parseVaultGitInvocation(argvForFlag(command, flag)),
				).not.toThrow();
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
		expect(JSON.stringify(discovery)).not.toMatch(
			/claude|codex|scheduled_caller/i,
		);
	});

	test("contract construction rejects drifted flags", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<
			string,
			unknown
		>;
		const status = drifted.status as { flags: Record<string, unknown> };
		status.flags["--force"] = {
			type: "boolean",
			description: "Bypass policy.",
		};
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("contract construction rejects unsafe text", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<
			string,
			unknown
		>;
		(drifted.status as { summary: string }).summary =
			"Read private state at /Users/example/private-vault.";
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("contract construction rejects foreign result contracts", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<
			string,
			unknown
		>;
		(drifted.status as { resultContract: { id: string } }).resultContract.id =
			"foreign.result";
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("contract construction rejects drifted result schema versions", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<
			string,
			unknown
		>;
		(
			drifted.status as { resultContract: { schema_version: string } }
		).resultContract.schema_version = "999";
		expect(() => defineVaultGitCommandContracts(drifted as never)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("contract construction rejects missing side-effect metadata", () => {
		const drifted = structuredClone(vaultGitContracts) as Record<
			string,
			unknown
		>;
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
		expect(
			run.stdout
				.trim()
				.split("\n")
				.filter((line) => line.startsWith("next:")),
		).toEqual(["next: wait_for_runtime"]);
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
		expect(JSON.stringify(envelope)).not.toMatch(
			/\/Users\/|\/private\/|capability/i,
		);
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

	test("usage-failure JSON never echoes private path values", () => {
		const rejectedEnum = runVaultGitForTest(
			["begin", "--event", "/Users/example/private-vault", "--json"],
			{ runId: "run-usage-event" },
		);
		expect(rejectedEnum.exitCode).toBe(2);
		const rejectedEnvelope = JSON.parse(rejectedEnum.stdout);
		expect(rejectedEnvelope.error.message).toContain("--event must be one of:");
		expect(JSON.stringify(rejectedEnvelope)).not.toMatch(
			/\/Users\/|\/private\//,
		);

		const unknownCommand = runVaultGitForTest(
			["/Users/example/private-vault", "--json"],
			{ runId: "run-usage-unknown" },
		);
		expect(unknownCommand.exitCode).toBe(2);
		const unknownEnvelope = JSON.parse(unknownCommand.stdout);
		expect(JSON.stringify(unknownEnvelope)).not.toMatch(
			/\/Users\/|\/private\//,
		);
		expect(unknownEnvelope.data.command).toBe("status");
	});

	test("usage-failure JSON attributes the alias command, not a flag value", () => {
		const run = runVaultGitForTest(["--transaction-id", "t1", "--json"], {
			runId: "run-usage-alias",
		});
		expect(run.exitCode).toBe(2);
		expect(JSON.parse(run.stdout).data.command).toBe("status");
	});

	test("capability input accepts only a numeric inherited descriptor", () => {
		expect(
			parseVaultGitInvocation(["join", "--capability-fd", "7"]),
		).toMatchObject({
			command: "join",
			capabilityFd: 7,
		});
		expect(() =>
			parseVaultGitInvocation(["join", "--capability-fd", "owner-secret"]),
		).toThrow("numeric inherited file descriptor");
		expect(() =>
			parseVaultGitInvocation(["join", "--capability", "secret"]),
		).toThrow("Unsupported flag");
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
				next_action: {
					id: "wait_for_runtime",
					summary: "Wait for the runtime implementation.",
				},
			}),
		).toThrow("phase");
		expect(VAULT_GIT_TRANSACTION_PHASES).toContain("closed");
		expect(VAULT_GIT_WRITE_PERMISSIONS).toEqual(["denied", "join", "owner"]);
		expect(VAULT_GIT_CHANGED_STATES).toContain("partial");
		expect(VAULT_GIT_RETRY_SAFETIES).toContain("operator_required");
	});
});

describe("vault-git Branch Station runtime coverage", () => {
	test("preview and doctor stay read-only through the runtime in json and plain output", () => {
		for (const command of ["preview", "doctor"] as const) {
			const station = stationById(`${command}.read_only`);
			const json = runVaultGitForTest([command, "--json"], {
				runId: `run-${command}-json`,
			});
			expect(json.exitCode).toBe(station.expectedExitCode);
			expect(json.stderr).toBe("");
			const envelope = JSON.parse(json.stdout);
			expect(envelope).toMatchObject({
				status: station.expectedEnvelopeStatus,
				run_id: `run-${command}-json`,
				data: {
					contract_id: station.expectedResultContractId,
					command,
					outcome: "read_only",
					phase: "unavailable",
					write_permission: "denied",
					changed_state: "none",
					retry_safety: "same_input_safe",
					next_action: { id: "wait_for_runtime" },
				},
				continuation: { next_action_id: "wait_for_runtime" },
			});

			const plain = runVaultGitForTest([command], {
				runId: `run-${command}-plain`,
			});
			expect(plain.exitCode).toBe(station.expectedExitCode);
			expect(plain.stderr).toBe("");
			expect(plain.stdout).toContain(`command: ${command}`);
			expect(plain.stdout).toContain("outcome: read_only");
			expect(plain.stdout).toContain("write_permission: denied");
			expect(plain.stdout).toContain("changed_state: none");
			expect(plain.stdout).toContain("next: wait_for_runtime");
		}
	});

	test("usage failures land on the invalid_usage stations with exit 2", () => {
		const cases = [
			{ argv: ["status", "--force"], stationId: "status.invalid_usage" },
			{ argv: ["tidy"], stationId: "tidy.invalid_usage" },
		] as const;
		for (const { argv, stationId } of cases) {
			const station = stationById(stationId);
			expect(station.expectedActionId).toBe("change_input");

			const json = runVaultGitForTest([...argv, "--json"], {
				runId: `run-${stationId}`,
			});
			expect(json.exitCode).toBe(station.expectedExitCode);
			const envelope = JSON.parse(json.stdout);
			expect(envelope.status).toBe(station.expectedEnvelopeStatus);
			expect(envelope.error.code).toBe(station.expectedErrorCode);
			expect(envelope.data).toMatchObject({
				command: station.command,
				outcome: "invalid_usage",
				write_permission: "denied",
				changed_state: "none",
				next_action: { id: "change_input" },
			});
			expect(envelope.continuation.next_action_id).toBe(
				station.expectedContinuationId,
			);

			const plain = runVaultGitForTest(argv, {
				runId: `run-${stationId}-plain`,
			});
			expect(plain.exitCode).toBe(station.expectedExitCode);
			expect(plain.stdout).toBe("");
			expect(plain.stderr).toContain("next: change_input");
		}
	});

	test("commands --json round-trips full discovery through main", () => {
		const station = stationById("commands.discovery");
		const run = runVaultGitForTest(["commands", "--json"], {
			runId: "run-commands-discovery",
		});
		expect(run.exitCode).toBe(station.expectedExitCode);
		expect(run.stderr).toBe("");
		const envelope = JSON.parse(run.stdout);
		expect(envelope.status).toBe(station.expectedEnvelopeStatus);
		expect(envelope.data.contract_id).toBe(VAULT_GIT_COMMANDS_CONTRACT_ID);
		expect(envelope.data.outcome).toBe("discovered");
		expect(envelope.data.changed_state).toBe("none");
		expect(Object.keys(envelope.data.commands)).toEqual([
			...VAULT_GIT_COMMANDS,
		]);
		expect(envelope.data.commands).toEqual(
			JSON.parse(
				JSON.stringify(projectVaultGitCommandDiscoveryTree().commands),
			),
		);
		expect(envelope.data.next_action.id).toBe("inspect_commands");
		expect(envelope.continuation.next_action_id).toBe("inspect_commands");
	});

	test("help routing exits 0 through main for --help, -h, and help <command>", () => {
		const root = runVaultGitForTest(["--help"], { runId: "run-help-root" });
		expect(root.exitCode).toBe(0);
		expect(root.stderr).toBe("");
		expect(root.stdout).toContain("vault-git tidy now");

		const short = runVaultGitForTest(["-h"], { runId: "run-help-short" });
		expect(short.exitCode).toBe(0);
		expect(short.stderr).toBe("");
		expect(short.stdout).toContain("read-only dashboard");

		const named = runVaultGitForTest(["help", "begin"], {
			runId: "run-help-begin",
		});
		expect(named.exitCode).toBe(0);
		expect(named.stderr).toBe("");
		expect(named.stdout).toContain("vault-git begin");

		const bare = runVaultGitForTest(["help"], { runId: "run-help-bare" });
		expect(bare.exitCode).toBe(0);
		expect(bare.stderr).toBe("");
		expect(bare.stdout).toContain("vault-git tidy now");
	});
});

describe("vault-git KTD16 boundaries", () => {
	const srcModules = enumerateSourceModules();
	const graph = buildModuleGraph(srcModules);
	const pureLayerLocalImports = new Map<string, ReadonlySet<string>>([
		["model.ts", new Set<string>()],
		["ports.ts", new Set(["model.ts"])],
	]);
	const layeredLocalImports = new Map<string, ReadonlySet<string>>([
		["git-adapter.ts", new Set(["model.ts", "ports.ts"])],
		["remote-ledger.ts", new Set(["model.ts", "ports.ts"])],
		["clock.ts", new Set(["ports.ts"])],
		["store.ts", new Set(["model.ts"])],
		[
			"engine.ts",
			new Set(["model.ts", "ports.ts", "remote-ledger.ts", "store.ts"]),
		],
	]);

	test("keeps model and ports independent from facade, process, filesystem, and Git adapters", () => {
		expect(srcModules).toContain("cli.ts");
		const findings = [...pureLayerLocalImports].flatMap(([file, allowed]) => {
			const imports = graph.get(file);
			if (!imports)
				return [`${file} is missing from the enumerated source graph`];
			return [
				...imports.external.map((specifier) => `${file} imports ${specifier}`),
				...imports.unresolved,
				...imports.local
					.filter((dependency) => !allowed.has(dependency))
					.map((dependency) => `${file} imports ./${dependency}`),
			];
		});
		expect(findings).toEqual([]);
	});

	test("keeps the remote engine behind ports and the Git adapter at the process edge", () => {
		const findings = [...layeredLocalImports].flatMap(([file, allowed]) => {
			const imports = graph.get(file);
			if (!imports)
				return [`${file} is missing from the enumerated source graph`];
			return imports.local
				.filter((dependency) => !allowed.has(dependency))
				.map((dependency) => `${file} imports ./${dependency}`);
		});
		expect(findings).toEqual([]);
		expect(graph.get("remote-ledger.ts")?.external).toEqual(["node:crypto"]);
		expect(graph.get("git-adapter.ts")?.external).toEqual([
			"node:child_process",
			"node:crypto",
		]);
	});

	test("keeps the enumerated source import graph fully resolved and acyclic", () => {
		const unresolved = [...graph.values()].flatMap(
			(imports) => imports.unresolved,
		);
		expect(unresolved).toEqual([]);
		const localGraph = new Map(
			[...graph].map(([file, imports]) => [file, imports.local] as const),
		);
		expect(findCycles(localGraph)).toEqual([]);
	});
});

function argvForFlag(
	command: (typeof VAULT_GIT_COMMANDS)[number],
	flag: string,
): string[] {
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

function stationById(id: (typeof VAULT_GIT_STATION_IDS)[number]) {
	const station = vaultGitBranchStationCatalog.find((entry) => entry.id === id);
	if (!station) throw new Error(`Missing Branch Station: ${id}`);
	const { expectedExitCode, expectedEnvelopeStatus } = station;
	if (expectedExitCode === undefined || expectedEnvelopeStatus === undefined) {
		throw new Error(`Branch Station ${id} omits runtime expectations`);
	}
	return { ...station, expectedExitCode, expectedEnvelopeStatus };
}

function enumerateSourceModules(): string[] {
	return readdirSync(resolve(packageRoot, "src"))
		.filter((entry) => entry.endsWith(".ts"))
		.sort();
}

interface ModuleImports {
	/** Relative dependencies resolved to enumerated src module names. */
	readonly local: readonly string[];
	/** Package and node builtin specifiers. */
	readonly external: readonly string[];
	/** Relative dependencies that resolve to no enumerated src module. */
	readonly unresolved: readonly string[];
}

function buildModuleGraph(
	modules: readonly string[],
): Map<string, ModuleImports> {
	const known = new Set(modules);
	return new Map(
		modules.map((file) => {
			const source = readFileSync(resolve(packageRoot, "src", file), "utf8");
			const local: string[] = [];
			const external: string[] = [];
			const unresolved: string[] = [];
			for (const specifier of new Set(importSpecifiers(source))) {
				if (!specifier.startsWith(".")) {
					external.push(specifier);
					continue;
				}
				const relative = specifier.startsWith("./")
					? specifier.slice(2)
					: specifier;
				const target = `${relative.replace(extname(relative), "")}.ts`;
				if (known.has(target)) local.push(target);
				else
					unresolved.push(
						`${file} imports unresolved relative module ${specifier}`,
					);
			}
			return [file, { local, external, unresolved }] as const;
		}),
	);
}

function importSpecifiers(source: string): string[] {
	const patterns = [
		/import(?:\s+type)?[\s\S]*?from\s+["']([^"']+)["']/g,
		/import\s+["']([^"']+)["']/g,
		/export\s[\s\S]*?from\s+["']([^"']+)["']/g,
		/import\s*\(\s*["']([^"']+)["']\s*\)/g,
		/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
	];
	return patterns.flatMap((pattern) =>
		[...source.matchAll(pattern)].map((match) => match[1] ?? ""),
	);
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
			visit(dependency, [...path, node]);
		}
	};
	for (const node of graph.keys()) visit(node, []);
	return [...new Set(cycles)].sort();
}
