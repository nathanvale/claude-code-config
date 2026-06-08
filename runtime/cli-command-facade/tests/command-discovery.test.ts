import { describe, expect, test } from "bun:test";

import {
	type CommandFacadeContract,
	findCommandDiscoveryTreeDrift,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";

type TestCommand = "inspect" | "inspect:json" | "verify:check";

const contracts: Record<TestCommand, CommandFacadeContract<TestCommand>> = {
	inspect: {
		script: "tools/inspect.ts",
		summary: "Inspect command state.",
		usage: ["inspect [--json]"],
		json: true,
		audience: "agent",
		mutation: "read-only",
		sideEffects: ["read"],
		flags: {
			"--json": { type: "boolean", description: "Emit JSON." },
			"--format": {
				type: "enum",
				values: ["json", "human"],
			},
		},
		exitCodes: {
			"0": "status returned",
			"1": "inspection failed",
			"2": "usage error",
		},
	},
	"inspect:json": {
		script: "tools/inspect.ts",
		summary: "Inspect command state as JSON.",
		usage: ["inspect [--json]"],
		json: true,
		audience: "operator",
		mutation: "repairs-runtime",
		sideEffects: ["write"],
		executionModes: ["normal", "dry_run"],
		flags: {
			"--repair": { type: "boolean" },
			"--json": { type: "boolean" },
		},
		exitCodes: {
			"0": "repair completed",
			"1": "repair failed",
			"2": "usage error",
		},
		alias: {
			command: "inspect",
			defaultArgs: ["--json"],
		},
	},
	"verify:check": {
		script: "tools/verify.ts",
		summary: "Check command registry drift.",
		usage: ["verify --json"],
		json: true,
		audience: "governance",
		mutation: "check-only",
		sideEffects: ["check"],
		flags: {
			"--json": { type: "boolean" },
		},
		exitCodes: {
			"0": "registry current",
			"1": "registry drift found",
			"2": "usage error",
		},
	},
};

describe("CLI command facade discovery", () => {
	test("projects package-agnostic command discovery trees", () => {
		const tree = projectCommandDiscoveryTree(
			Object.entries(contracts) as Array<
				[TestCommand, CommandFacadeContract<TestCommand>]
			>,
			{
				include: (command) => command !== "verify:check",
				routesByCommand: new Map([
					[
						"inspect",
						{
							executable: "example",
							route: ["inspect"],
							canonical: "example inspect",
						},
					],
				]),
				canonicalUsageByCommand: new Map([
					["inspect", ["example inspect [--json]"]],
				]),
				augment: (command) => ({
					owner: command === "inspect" ? "runtime" : "governance",
					preview: command === "inspect",
				}),
			},
		);

		expect(tree).toEqual({
			commands: {
				inspect: {
					script: "tools/inspect.ts",
					summary: "Inspect command state.",
					json: true,
					audience: "agent",
					mutation: "read-only",
					side_effects: ["read"],
					usage: ["inspect [--json]"],
					flags: {
						"--json": { type: "boolean", description: "Emit JSON." },
						"--format": { type: "enum", values: ["json", "human"] },
					},
					exit_codes: {
						"0": "status returned",
						"1": "inspection failed",
						"2": "usage error",
					},
					unified_route: {
						executable: "example",
						route: ["inspect"],
						canonical: "example inspect",
					},
					canonical_usage: ["example inspect [--json]"],
					owner: "runtime",
					preview: true,
				},
				"inspect:json": {
					script: "tools/inspect.ts",
					summary: "Inspect command state as JSON.",
					json: true,
					audience: "operator",
					mutation: "repairs-runtime",
					side_effects: ["write"],
					execution_modes: ["normal", "dry_run"],
					usage: ["inspect [--json]"],
					flags: {
						"--repair": { type: "boolean" },
						"--json": { type: "boolean" },
					},
					exit_codes: {
						"0": "repair completed",
						"1": "repair failed",
						"2": "usage error",
					},
					alias_of: "inspect",
					default_args: ["--json"],
					owner: "governance",
					preview: false,
				},
			},
		});
		expect(tree.commands).not.toHaveProperty("verify:check");
		expect(findCommandDiscoveryTreeDrift(tree)).toEqual([]);
	});

	test("projects optional result contracts and grouped action affordances", () => {
		const tree = projectCommandDiscoveryTree([
			[
				"inspect",
				{
					...contracts.inspect,
					resultContract: {
						id: "example.managed-workflow-preflight@1",
						kind: "managed_workflow_structural_preflight",
						schema_version: 1,
					},
					actionAffordances: {
						launch: [
							{
								id: "example.launch-managed-workflow",
								summary: "Proceed through managed browser admission.",
								sideEffects: ["browser"],
							},
						],
						blocked: [
							{
								id: "example.repair-auth-material",
								summary: "Repair touchless auth material readiness.",
								sideEffects: ["auth", "write"],
							},
							{
								id: "example.inspect-readiness",
								summary: "Inspect structural readiness blockers.",
								sideEffects: ["check"],
							},
						],
					},
				},
			],
			["verify:check", contracts["verify:check"]],
		] as Array<[TestCommand, CommandFacadeContract<TestCommand>]>);

		expect(tree.commands.inspect).toMatchObject({
			result_contract: {
				id: "example.managed-workflow-preflight@1",
				kind: "managed_workflow_structural_preflight",
				schema_version: 1,
			},
			action_affordances: {
				launch: [
					{
						id: "example.launch-managed-workflow",
						summary: "Proceed through managed browser admission.",
						side_effects: ["browser"],
					},
				],
				blocked: [
					{
						id: "example.repair-auth-material",
						summary: "Repair touchless auth material readiness.",
						side_effects: ["auth", "write"],
					},
					{
						id: "example.inspect-readiness",
						summary: "Inspect structural readiness blockers.",
						side_effects: ["check"],
					},
				],
			},
		});
		expect(tree.commands["verify:check"]).not.toHaveProperty("result_contract");
		expect(tree.commands["verify:check"]).not.toHaveProperty(
			"action_affordances",
		);
		expect(findCommandDiscoveryTreeDrift(tree)).toEqual([]);
	});

	test("rejects package augmentation that overwrites discovery fields", () => {
		for (const field of ["flags", "result_contract", "action_affordances"]) {
			expect(() =>
				projectCommandDiscoveryTree([["inspect", contracts.inspect]], {
					augment: () => ({ [field]: {} }) as never,
				}),
			).toThrow(
				`Command discovery augment for inspect cannot override core field ${field}.`,
			);
		}
	});

	test("projects command discovery values without sharing mutable contract objects", () => {
		const route = {
			executable: "example",
			route: ["inspect"],
			canonical: "example inspect",
		} as const;
		const canonicalUsage = ["example inspect [--json]"] as const;
		const resultContract = {
			id: "example.inspect@1",
			schema_version: 1,
		} as const;
		const actionAffordances = {
			ok: [
				{
					id: "example.inspect.follow-up",
					summary: "Inspect another state view.",
					sideEffects: ["read"],
				},
			],
		} as const;
		const tree = projectCommandDiscoveryTree(
			[
				[
					"inspect",
					{
						...contracts.inspect,
						resultContract,
						actionAffordances,
					},
				],
			],
			{
				routesByCommand: new Map([["inspect", route]]),
				canonicalUsageByCommand: new Map([["inspect", canonicalUsage]]),
			},
		);
		const command = tree.commands.inspect;
		if (!command) throw new Error("expected inspect command");

		expect(command.exit_codes).toEqual(contracts.inspect.exitCodes);
		expect(command.exit_codes).not.toBe(contracts.inspect.exitCodes);
		expect(command.usage).toEqual(contracts.inspect.usage);
		expect(command.usage).not.toBe(contracts.inspect.usage);
		expect(command.unified_route?.route).toEqual(["inspect"]);
		expect(command.unified_route?.route).not.toBe(route.route);
		expect(command.canonical_usage).toEqual(["example inspect [--json]"]);
		expect(command.canonical_usage).not.toBe(canonicalUsage);
		expect(command.result_contract).toEqual(resultContract);
		expect(command.result_contract).not.toBe(resultContract);
		expect(command.action_affordances?.ok[0]?.side_effects).toEqual(["read"]);
		expect(command.action_affordances?.ok).not.toBe(actionAffordances.ok);
		expect(command.action_affordances?.ok[0]?.side_effects).not.toBe(
			actionAffordances.ok[0]?.sideEffects,
		);
	});

	test("reports package-agnostic command discovery drift", () => {
		const tree = projectCommandDiscoveryTree(
			[
				["inspect", contracts.inspect],
				["inspect:json", contracts["inspect:json"]],
			] as Array<[TestCommand, CommandFacadeContract<TestCommand>]>,
			{
				routesByCommand: new Map([
					[
						"inspect",
						{
							route: ["inspect"],
							canonical: "example inspect",
						},
					],
					[
						"inspect:json",
						{
							route: ["inspect"],
							canonical: "example inspect",
						},
					],
				]),
			},
		);
		const inspect = tree.commands.inspect;
		const inspectJson = tree.commands["inspect:json"];
		if (!inspect || !inspectJson) {
			throw new Error("expected projected commands");
		}
		const drift = findCommandDiscoveryTreeDrift(
			{
				commands: {
					...tree.commands,
					inspect: {
						...inspect,
						side_effects: ["spicy"] as never,
						execution_modes: ["sometimes"] as never,
						output_modes: ["xml"] as never,
						interactivity: "sometimes" as never,
						env_vars: [{ name: "API_TOKEN" }],
						flags: {
							mode: { type: "string" },
							"--empty": { type: "enum", values: [] },
						},
						exit_codes: { ok: "bad" },
					},
					"inspect:json": {
						...inspectJson,
						alias_of: "missing",
					},
				},
			},
			{
				path: "package-context.json",
			},
		);

		expect(drift).toEqual([
			{
				category: "command-discovery-side-effect-invalid",
				path: "package-context.json",
				action:
					"Use a known side effect for inspect: read, check, write, destructive, auth, network, browser.",
			},
			{
				category: "command-discovery-execution-mode-invalid",
				path: "package-context.json",
				action:
					"Use a known execution mode for inspect: normal, check, dry_run.",
			},
			{
				category: "command-discovery-output-mode-invalid",
				path: "package-context.json",
				action: "Use a known output mode for inspect: json, plain, jsonl.",
			},
			{
				category: "command-discovery-interactivity-invalid",
				path: "package-context.json",
				action:
					"Use a known interactivity for inspect: required, optional, none.",
			},
			{
				category: "command-discovery-env-var-name-sensitive",
				path: "package-context.json",
				action:
					"Environment variable name API_TOKEN for command inspect implies a secret and must not be declared (it would leak into agent-facing discovery).",
			},
			{
				category: "command-discovery-flag-name-invalid",
				path: "package-context.json",
				action: "Rename inspect flag mode so it starts with --.",
			},
			{
				category: "command-discovery-enum-flag-values-missing",
				path: "package-context.json",
				action: "Add enum values for inspect --empty.",
			},
			{
				category: "command-discovery-exit-code-invalid",
				path: "package-context.json",
				action: "Rename inspect exit code ok to a numeric string.",
			},
			// The mutated inspect entry's lone non-numeric `ok` exit code declares
			// none of the baseline 0/1/2 meanings, so the discovery validator
			// mirrors the metadata baseline drift (U2) before the alias checks.
			{
				category: "command-discovery-baseline-exit-success-missing",
				path: "package-context.json",
				action:
					'Declare baseline exit code "0" (0 success) for command inspect.',
			},
			{
				category: "command-discovery-baseline-exit-failure-missing",
				path: "package-context.json",
				action:
					'Declare baseline exit code "1" (1 generic or runtime failure) for command inspect.',
			},
			{
				category: "command-discovery-baseline-exit-usage-missing",
				path: "package-context.json",
				action:
					'Declare baseline exit code "2" (2 invalid usage) for command inspect.',
			},
			{
				category: "command-discovery-alias-target-missing",
				path: "package-context.json",
				action:
					"Point alias command inspect:json at a command in the discovery tree, or exclude the alias from this projection.",
			},
			{
				category: "command-discovery-route-duplicate",
				path: "package-context.json",
				action:
					"Route example inspect is projected by both inspect and inspect:json.",
			},
		]);
	});

	test("reports package-agnostic result contract discovery drift", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift(
			{
				commands: {
					inspect: {
						...inspect,
						result_contract: { id: "" },
						action_affordances: {
							blocked: [
								null,
								"not an action",
								{
									id: "example.repair",
									summary: "Repair the blocker.",
									side_effects: ["check"],
								},
								{
									id: "example.repair",
									summary: "Repair the duplicate blocker.",
									side_effects: ["write"],
								},
								{
									id: "",
									summary: "",
									side_effects: ["spicy"] as never,
									command_template: ["do", "not", "emit"],
								} as never,
							],
						},
					},
				},
			},
			{ path: "agent-context.json" },
		);

		expect(drift.map((finding) => finding.category)).toEqual([
			"command-discovery-result-contract-id-invalid",
			"command-discovery-action-affordance-invalid",
			"command-discovery-action-affordance-invalid",
			"command-discovery-action-id-duplicate",
			"command-discovery-action-id-invalid",
			"command-discovery-action-summary-missing",
			"command-discovery-action-side-effect-invalid",
			"command-discovery-action-command-template-unsupported",
		]);
	});

	test("U6: discovery secret in an action summary emits command-discovery-action-summary-unsafe-text", () => {
		const tree = projectCommandDiscoveryTree([
			[
				"inspect",
				{
					...contracts.inspect,
					resultContract: { id: "example.inspect@1", schema_version: 1 },
					actionAffordances: {
						ok: [
							{
								id: "example.inspect.follow-up",
								summary: "Pass the api_key sk-live-abc123 here.",
								sideEffects: ["read"],
							},
						],
					},
				},
			],
		] as Array<[TestCommand, CommandFacadeContract<TestCommand>]>);

		const drift = findCommandDiscoveryTreeDrift(tree);
		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-action-summary-unsafe-text",
		]);
	});

	test("U6: discovery secret in result_contract.kind / schema_version emits the mirrored unsafe-text drift", () => {
		const tree = projectCommandDiscoveryTree([
			[
				"inspect",
				{
					...contracts.inspect,
					resultContract: {
						id: "example.inspect@1",
						kind: "uses client_secret material",
						schema_version: "v1 password hunter2",
					},
				},
			],
		] as Array<[TestCommand, CommandFacadeContract<TestCommand>]>);

		const drift = findCommandDiscoveryTreeDrift(tree);
		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-result-contract-kind-unsafe-text",
			"command-discovery-result-contract-schema-version-unsafe-text",
		]);
	});

	// PR #66 review (CodeRabbit, Major): a non-string result_contract.kind must
	// be caught by the discovery backstop, mirroring findCommandFacadeMetadataDrift
	// (which guards `kind !== undefined`, not `typeof === "string"`). The previous
	// `typeof === "string"` guard let a type-confused kind bypass the mirror.
	test("discovery backstop rejects a non-string result_contract.kind (mirror parity)", () => {
		const tree = projectCommandDiscoveryTree([
			[
				"inspect",
				{
					...contracts.inspect,
					resultContract: {
						id: "example.inspect@1",
						kind: { evil: "<script>" } as never as string,
					},
				},
			],
		] as Array<[TestCommand, CommandFacadeContract<TestCommand>]>);

		const unsafe = findCommandDiscoveryTreeDrift(tree).filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-result-contract-kind-unsafe-text",
		]);
	});

	// PR #66 review (CodeRabbit, Major): same type-confusion guard for
	// schema_version on the discovery backstop. A non-string non-number value is
	// type-rejected; a number stays clean.
	test("discovery backstop rejects a non-string non-number result_contract.schema_version", () => {
		const tree = projectCommandDiscoveryTree([
			[
				"inspect",
				{
					...contracts.inspect,
					resultContract: {
						id: "example.inspect@1",
						schema_version: { evil: "<script>" } as never as number,
					},
				},
			],
		] as Array<[TestCommand, CommandFacadeContract<TestCommand>]>);

		const unsafe = findCommandDiscoveryTreeDrift(tree).filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-result-contract-schema-version-unsafe-text",
		]);
	});

	test("U6: discovery benign affordances + result contract emit no unsafe-text drift", () => {
		const tree = projectCommandDiscoveryTree([
			[
				"inspect",
				{
					...contracts.inspect,
					resultContract: {
						id: "example.inspect@1",
						kind: "managed_workflow_structural_preflight",
						schema_version: 1,
					},
					actionAffordances: {
						ok: [
							{
								id: "example.inspect.follow-up",
								summary: "Inspect another state view.",
								sideEffects: ["read"],
							},
						],
					},
				},
			],
		] as Array<[TestCommand, CommandFacadeContract<TestCommand>]>);

		const drift = findCommandDiscoveryTreeDrift(tree);
		expect(
			drift.filter((finding) => finding.category.endsWith("-unsafe-text")),
		).toEqual([]);
	});

});
