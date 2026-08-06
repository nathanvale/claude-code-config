import { describe, expect, test } from "bun:test";

import {
	CliRuntimeContractError,
	COMMAND_FACADE_BASELINE_EXIT_CODES,
	COMMAND_FACADE_CAPABILITY_ROLES,
	type CommandFacadeContract,
	defineCommandFacadeContract,
	DIAGNOSTIC_TRAIL_SURFACE_KINDS,
	findCommandDiscoveryTreeDrift,
	findCommandFacadeMetadataDrift,
	matchSensitiveEnvVarName,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";

type TestCommand = "inspect" | "inspect:json" | "verify:check";

// Legacy-shaped compatibility fixtures (BA-style / Memory OS-style). These keep
// the older command shapes honest through migration; the greenfield
// `createCliContracts` fixture below is the first-class cli-author evidence path
// (KTD2, R3). Both fixtures now satisfy Baseline Exit Semantics (0/1/2) and
// Write Preview Capability so they survive the runtime-backed slice.
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

// Greenfield cli-author-style command set: a read command, a write command with
// a `dry_run` preview path, and a diagnostic-capability command whose route name
// is NOT `doctor` (proving Diagnostic Capability is a role, not a route spelling,
// per KTD5). This is the first-class evidence path for the runtime-backed
// candidates (baseline exits, diagnostic role, diagnostic trail, write preview).
type CreateCliCommand = "config:get" | "config:set" | "runtime:inspect";

const createCliContracts: Record<
	CreateCliCommand,
	CommandFacadeContract<CreateCliCommand>
> = {
	"config:get": {
		script: "cli/config-get.ts",
		summary: "Read a configuration value.",
		usage: ["config get <key> [--json]"],
		json: true,
		audience: "agent",
		mutation: "read-only",
		sideEffects: ["read"],
		flags: {
			"--json": { type: "boolean", description: "Emit JSON." },
		},
		exitCodes: {
			"0": "value returned",
			"1": "read failed",
			"2": "usage error",
		},
	},
	"config:set": {
		script: "cli/config-set.ts",
		summary: "Write a configuration value.",
		usage: ["config set <key> <value> [--dry-run]"],
		json: true,
		audience: "agent",
		mutation: "write",
		sideEffects: ["write"],
		executionModes: ["normal", "dry_run"],
		flags: {
			"--dry-run": { type: "boolean", description: "Preview the write." },
			"--json": { type: "boolean" },
		},
		exitCodes: {
			"0": "value written",
			"1": "write failed",
			"2": "usage error",
		},
	},
	"runtime:inspect": {
		script: "cli/runtime-inspect.ts",
		summary: "Check runtime readiness across config, auth, and dependencies.",
		usage: ["runtime inspect [--json]"],
		json: true,
		audience: "agent",
		mutation: "read-only",
		sideEffects: ["read", "check"],
		// Diagnostic Capability declared by role, not by a `doctor` route name.
		capabilityRoles: ["diagnostic"],
		flags: {
			"--json": { type: "boolean" },
		},
		exitCodes: {
			"0": "runtime ready",
			"1": "runtime not ready",
			"2": "usage error",
		},
	},
};

describe("CLI command facade", () => {
	// Integration: projecting the greenfield contract into the discovery tree
	// preserves package-owned command names and produces no discovery drift.
	test("projects the greenfield cli-author contract without discovery drift", () => {
		const tree = projectCommandDiscoveryTree(
			Object.entries(createCliContracts) as Array<
				[CreateCliCommand, CommandFacadeContract<CreateCliCommand>]
			>,
		);
		expect(Object.keys(tree.commands).sort()).toEqual([
			"config:get",
			"config:set",
			"runtime:inspect",
		]);
		expect(findCommandDiscoveryTreeDrift(tree)).toEqual([]);
	});

	// U2: Baseline Exit Semantics (KTD4) — 0/1/2 are required exit-code meanings
	// for agent-native command contracts; additional codes stay package-owned.
	describe("baseline exit semantics", () => {
		test("accepts 0/1/2 plus an extra package-owned exit code", () => {
			const withExtra = {
				inspect: {
					...contracts.inspect,
					exitCodes: {
						"0": "status returned",
						"1": "inspection failed",
						"2": "usage error",
						"73": "package-owned partial failure",
					},
				},
			};

			expect(findCommandFacadeMetadataDrift(withExtra)).toEqual([]);
		});

		test("missing exit 1 reports the failure baseline category", () => {
			const missingFailure = {
				inspect: {
					...contracts.inspect,
					exitCodes: { "0": "status returned", "2": "usage error" },
				},
			};

			const drift = findCommandFacadeMetadataDrift(missingFailure);
			const baseline = drift.filter((finding) =>
				finding.category.startsWith("command-baseline-exit-"),
			);
			expect(baseline.map((finding) => finding.category)).toEqual([
				"command-baseline-exit-failure-missing",
			]);
			expect(baseline[0]?.action).toContain(
				"1 generic or runtime failure",
			);
		});

		test("missing exit 2 reports the invalid-usage baseline category", () => {
			const missingUsage = {
				inspect: {
					...contracts.inspect,
					exitCodes: { "0": "status returned", "1": "inspection failed" },
				},
			};

			const drift = findCommandFacadeMetadataDrift(missingUsage);
			expect(
				drift
					.filter((finding) =>
						finding.category.startsWith("command-baseline-exit-"),
					)
					.map((finding) => finding.category),
			).toEqual(["command-baseline-exit-usage-missing"]);
		});

		test("using `success` instead of `\"0\"` reports both numeric-key and baseline drift", () => {
			const aliasedZero = {
				inspect: {
					...contracts.inspect,
					exitCodes: {
						success: "status returned",
						"1": "inspection failed",
						"2": "usage error",
					},
				},
			};

			const drift = findCommandFacadeMetadataDrift(aliasedZero);
			const categories = drift.map((finding) => finding.category);
			// The non-numeric key trips the numeric-key check, and `0` is still an
			// absent baseline — the two checks are independent and both fire.
			expect(categories).toContain("command-exit-code-invalid");
			expect(categories).toContain("command-baseline-exit-success-missing");
		});

		test("defineCommandFacadeContract fails fast for a missing baseline exit", () => {
			const missingFailure = {
				inspect: {
					...contracts.inspect,
					exitCodes: { "0": "status returned", "2": "usage error" },
				},
			};

			const issues = captureRuntimeContractIssues(() =>
				defineCommandFacadeContract(missingFailure),
			);
			expect(
				issues.some((issue) =>
					issue.startsWith("command-baseline-exit-failure-missing:"),
				),
			).toBe(true);
		});

		test("discovery drift mirrors metadata drift for missing baseline exits", () => {
			const tree = projectCommandDiscoveryTree([
				[
					"inspect",
					{
						...contracts.inspect,
						exitCodes: { "0": "status returned", "2": "usage error" },
					},
				],
			]);

			const drift = findCommandDiscoveryTreeDrift(tree);
			expect(
				drift
					.filter((finding) =>
						finding.category.startsWith("command-discovery-baseline-exit-"),
					)
					.map((finding) => finding.category),
			).toEqual(["command-discovery-baseline-exit-failure-missing"]);
		});
	});

	// U3: Diagnostic Capability is a Command Capability Role (KTD5), not a route
	// spelling. The facade validates the role; packages own the command name.
	describe("diagnostic capability role", () => {
		test("accepts a `doctor`-named command carrying the diagnostic role", () => {
			const doctorContract = {
				doctor: {
					...createCliContracts["runtime:inspect"],
					capabilityRoles: ["diagnostic"] as const,
				},
			};

			expect(findCommandFacadeMetadataDrift(doctorContract)).toEqual([]);
		});

		test("accepts a non-`doctor` route carrying the diagnostic role", () => {
			// `runtime:inspect` proves route-name independence: the role is honored
			// without any `doctor` spelling.
			expect(
				findCommandFacadeMetadataDrift({
					"runtime:inspect": createCliContracts["runtime:inspect"],
				}),
			).toEqual([]);
		});

		test("reports command-capability-role-invalid for an unknown role", () => {
			const drift = findCommandFacadeMetadataDrift({
				bad: {
					...contracts.inspect,
					capabilityRoles: ["wizard"] as never,
				},
			});

			expect(drift.map((finding) => finding.category)).toEqual([
				"command-capability-role-invalid",
			]);
		});

		test("projects the diagnostic role and preserves the package-owned command name and route", () => {
			const tree = projectCommandDiscoveryTree(
				[
					["runtime:inspect", createCliContracts["runtime:inspect"]],
				] as Array<[CreateCliCommand, CommandFacadeContract<CreateCliCommand>]>,
				{
					routesByCommand: new Map([
						[
							"runtime:inspect",
							{
								executable: "cli-author",
								route: ["runtime", "inspect"],
								canonical: "cli-author runtime inspect",
							},
						],
					]),
				},
			);

			const command = tree.commands["runtime:inspect"];
			if (!command) throw new Error("expected projected command");
			expect(command.capability_roles).toEqual(["diagnostic"]);
			expect(command.script).toBe("cli/runtime-inspect.ts");
			expect(command.unified_route?.canonical).toBe(
				"cli-author runtime inspect",
			);
			expect(findCommandDiscoveryTreeDrift(tree)).toEqual([]);
		});

		test("discovery drift reports an unknown projected capability role", () => {
			const tree = projectCommandDiscoveryTree([
				["runtime:inspect", createCliContracts["runtime:inspect"]],
			]);
			const entry = tree.commands["runtime:inspect"];
			if (!entry) throw new Error("expected projected command");

			const drift = findCommandDiscoveryTreeDrift({
				commands: {
					"runtime:inspect": {
						...entry,
						capability_roles: ["wizard"] as never,
					},
				},
			});

			expect(drift.map((finding) => finding.category)).toEqual([
				"command-discovery-capability-role-invalid",
			]);
		});
	});

	test("accepts and projects declared output modes", () => {
		const outputContracts = {
			inspect: {
				...contracts.inspect,
				outputModes: ["json", "plain"] as const,
			},
		};

		expect(findCommandFacadeMetadataDrift(outputContracts)).toEqual([]);

		const tree = projectCommandDiscoveryTree([
			["inspect", outputContracts.inspect],
		]);
		expect(tree.commands.inspect).toMatchObject({
			output_modes: ["json", "plain"],
		});
	});

	test("omits output_modes when no output modes are declared", () => {
		expect(findCommandFacadeMetadataDrift(contracts)).toEqual([]);

		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		expect(tree.commands.inspect).not.toHaveProperty("output_modes");
	});

	test("reports discovery drift for an unknown output mode", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift({
			commands: {
				inspect: {
					...inspect,
					output_modes: ["xml"] as never,
				},
			},
		});

		expect(drift.map((finding) => finding.category)).toEqual([
			"command-discovery-output-mode-invalid",
		]);
	});

	test("accepts and projects declared interactivity", () => {
		const interactivityContracts = {
			inspect: {
				...contracts.inspect,
				interactivity: "none" as const,
			},
		};

		expect(findCommandFacadeMetadataDrift(interactivityContracts)).toEqual([]);

		const tree = projectCommandDiscoveryTree([
			["inspect", interactivityContracts.inspect],
		]);
		expect(tree.commands.inspect).toMatchObject({
			interactivity: "none",
		});
	});

	test("omits interactivity when none is declared", () => {
		expect(findCommandFacadeMetadataDrift(contracts)).toEqual([]);

		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		expect(tree.commands.inspect).not.toHaveProperty("interactivity");
	});

	test("reports discovery drift for an unknown interactivity", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift({
			commands: {
				inspect: {
					...inspect,
					interactivity: "sometimes" as never,
				},
			},
		});

		expect(drift.map((finding) => finding.category)).toEqual([
			"command-discovery-interactivity-invalid",
		]);
	});

	const SENSITIVE_ENV_VAR_NAMES = [
		"XERO_CLIENT_SECRET",
		"PASSWORD",
		"API_KEY",
		"API_TOKEN",
		"PRIVATE_KEY",
		"GH_PAT",
		"ACCESS_TOKEN",
		"PASSPHRASE",
		"DB_PASSPHRASE",
		"SESSION",
		"SESSION_KEY",
		// Underscore-less fused names (#63): each decomposes into a known prefix
		// plus a sensitive token, or two adjacent tokens, so the bounded scan hits.
		"APITOKEN", // API + TOKEN
		"SECRETKEY", // SECRET + KEY (token + token)
		"GHPAT", // GH + PAT
		"DBPASSWD", // DB + PASSWD
		"MYSECRET", // MY + SECRET
	] as const;

	const BENIGN_ENV_VAR_NAMES = [
		"TENANT_ID",
		"ACCOUNT_ID",
		"CONFIG_ROOT",
		"PATH",
		"AUTHOR_NAME",
		"PASSPHRASELESS_MODE",
		// Suffix-collision guards (#63): each segment ends with a sensitive token
		// by coincidence, but the leading remainder is not a known fused prefix, so
		// the bounded scan must NOT fire. A bare `endsWith` would wrongly reject all
		// three. OAUTH_SCOPE also guards the AUTH-class false-positive (owned by #68).
		"MONKEY_CONFIG", // MONKEY ends with KEY; MON is not a prefix
		"OBSESSION_FLAG", // OBSESSION ends with SESSION; OBSE is not a prefix
		"OAUTH_SCOPE", // OAUTH ends with AUTH; O is not a prefix
		"SECRETARY_POOL", // SECRETARY does not end in a token at all
		// Prefix-arm guards: a KNOWN_FUSED_PREFIX followed by a NON-token tail must
		// stay benign. Without these, a regression loosening the prefix anchor (e.g.
		// matching the prefix alone) would slip through silently.
		"USERNAME", // USER is a prefix; NAME is not a token
		"APIVERSION", // API is a prefix; VERSION is not a token
		// Prefix-fused names are out of scope for #63 (KTD5): the secret noun leads,
		// so the suffix-anchored scan leaves them passing. Guards the boundary — a
		// future prefix-fix flips this to sensitive and this fixture fails loudly.
		"TOKENFILE_PATH",
	] as const;

	for (const name of SENSITIVE_ENV_VAR_NAMES) {
		test(`matchSensitiveEnvVarName rejects ${name}`, () => {
			expect(matchSensitiveEnvVarName(name)).toBe(true);
		});

		test(`facade gate flags sensitive env-var name ${name}`, () => {
			const drift = findCommandFacadeMetadataDrift({
				bad: {
					...contracts.inspect,
					envVars: [{ name }],
				},
			});
			expect(drift.map((finding) => finding.category)).toEqual([
				"command-env-var-name-sensitive",
			]);
		});
	}

	for (const name of BENIGN_ENV_VAR_NAMES) {
		test(`matchSensitiveEnvVarName passes ${name}`, () => {
			expect(matchSensitiveEnvVarName(name)).toBe(false);
		});

		test(`facade gate accepts benign env-var name ${name}`, () => {
			const envContracts = {
				inspect: {
					...contracts.inspect,
					envVars: [{ name }],
				},
			};
			expect(findCommandFacadeMetadataDrift(envContracts)).toEqual([]);

			const tree = projectCommandDiscoveryTree([
				["inspect", envContracts.inspect],
			]);
			expect(tree.commands.inspect?.env_vars).toEqual([{ name }]);
		});
	}

	test("accepts and projects declared env vars", () => {
		const envContracts = {
			inspect: {
				...contracts.inspect,
				envVars: [
					{
						name: "CONFIG_ROOT",
						required: true,
						description: "Root config dir.",
					},
				] as const,
			},
		};

		expect(findCommandFacadeMetadataDrift(envContracts)).toEqual([]);

		const tree = projectCommandDiscoveryTree([
			["inspect", envContracts.inspect],
		]);
		expect(tree.commands.inspect?.env_vars).toEqual([
			{
				name: "CONFIG_ROOT",
				required: true,
				description: "Root config dir.",
			},
		]);
	});

	test("omits env_vars when no env vars are declared", () => {
		expect(findCommandFacadeMetadataDrift(contracts)).toEqual([]);

		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		expect(tree.commands.inspect).not.toHaveProperty("env_vars");
	});

	test("projection stays pure for a sensitive env-var name (KTD3a)", () => {
		const sensitiveContract = {
			...contracts.inspect,
			envVars: [{ name: "API_TOKEN" }] as const,
		};

			expect(() => {
				projectCommandDiscoveryTree([["x", sensitiveContract]]);
			}).not.toThrow();
			const tree = projectCommandDiscoveryTree([["x", sensitiveContract]]);
			expect(tree?.commands.x?.env_vars).toEqual([{ name: "API_TOKEN" }]);
		});

	test("discovery drift backstops a sensitive env-var name", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift({
			commands: {
				inspect: {
					...inspect,
					env_vars: [{ name: "API_TOKEN" }],
				},
			},
		});

		expect(drift.map((finding) => finding.category)).toEqual([
			"command-discovery-env-var-name-sensitive",
		]);
	});

	test("discovery drift backstops a secret in summary (R6 mirror)", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift({
			commands: {
				inspect: {
					...inspect,
					summary: "Build with token sk-live, set the api_key first.",
				},
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("credential");
	});

	test("discovery drift backstops a control character in summary (R6/R4 mirror)", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift({
			commands: {
				inspect: {
					...inspect,
					summary: "\x1b[31mred",
				},
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("control characters");
	});

	test("discovery drift backstops a non-string summary (R6/R5 mirror)", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift({
			commands: {
				inspect: {
					...inspect,
					summary: { evil: "<script>" } as unknown as string,
				},
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("must be a string");
	});

	test("discovery drift mirrors all five free-text fields in canonical order (R6)", () => {
		const tree = projectCommandDiscoveryTree([["inspect", contracts.inspect]]);
		const inspect = tree.commands.inspect;
		if (!inspect) throw new Error("expected projected command");

		const drift = findCommandDiscoveryTreeDrift({
			commands: {
				inspect: {
					...inspect,
					summary: "Use the api_key to authenticate.",
					usage: ["inspect --secret sk-live-abc123"],
					flags: {
						"--x": {
							type: "boolean",
							description: "Pass the client_secret here.",
						},
					},
					exit_codes: { "0": "leaked /Users/nathanvale/.ssh path" },
					env_vars: [
						{ name: "CONFIG_ROOT", description: "Holds the password value." },
					],
				},
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-discovery-summary-unsafe-text",
			"command-discovery-usage-unsafe-text",
			"command-discovery-env-var-description-unsafe-text",
			"command-discovery-flag-description-unsafe-text",
			"command-discovery-exit-code-unsafe-text",
		]);
	});

	describe("source candidate traceability", () => {
		const DISPOSITIONS = [
			"runtime-backed", // enforced by facade runtime this slice
			"hardened-boundary", // boundary hardened, not a new runtime field
			"future-product", // reserved for a later product decision
			"downstream-sync", // doc-only follow-up in the cli-author repo
		] as const;
		type Disposition = (typeof DISPOSITIONS)[number];

		// Keyed by the cli-author design-layer candidate name. Mirrors the plan's
		// "Candidate Disposition" section; the runtime-backed rows name the live
		// owner so the link to code is verifiable, not prose-only.
		const SOURCE_CANDIDATE_DISPOSITIONS: Record<
			string,
			{ disposition: Disposition; runtimeOwner?: () => unknown }
		> = {
			"baseline exits": {
				disposition: "runtime-backed",
				runtimeOwner: () => COMMAND_FACADE_BASELINE_EXIT_CODES,
			},
			"diagnostic capability role": {
				disposition: "runtime-backed",
				runtimeOwner: () => COMMAND_FACADE_CAPABILITY_ROLES,
			},
			"diagnostic trail reference": {
				disposition: "runtime-backed",
				runtimeOwner: () => DIAGNOSTIC_TRAIL_SURFACE_KINDS,
			},
			"write preview capability": {
				disposition: "runtime-backed",
				// Owner is the metadata cross-check. Return whether the rule actually
				// fires (not just a defined array) so deleting the check fails this
				// ledger loudly rather than passing on an empty-but-defined result.
				runtimeOwner: () =>
					findCommandFacadeMetadataDrift({
						danger: {
							...contracts.inspect,
							mutation: "write",
							sideEffects: ["write"] as const,
							executionModes: ["normal"] as const,
						},
					}).some(
						(finding) => finding.category === "command-write-preview-missing",
					),
			},
			"projected discovery text": { disposition: "hardened-boundary" },
			"persisted diagnostics exposure boundary": {
				disposition: "hardened-boundary",
			},
			"persisted diagnostics access": { disposition: "future-product" },
			"idempotency/checkpoint posture": { disposition: "future-product" },
			"cli-author docs sync": { disposition: "downstream-sync" },
		};

		test("every source candidate has exactly one recognized disposition", () => {
			for (const [candidate, entry] of Object.entries(
				SOURCE_CANDIDATE_DISPOSITIONS,
			)) {
				expect(
					DISPOSITIONS.includes(entry.disposition),
					`candidate "${candidate}" has an unrecognized disposition "${entry.disposition}"`,
				).toBe(true);
			}
		});

		test("every runtime-backed candidate is linked to a live runtime owner", () => {
			for (const [candidate, entry] of Object.entries(
				SOURCE_CANDIDATE_DISPOSITIONS,
			)) {
				if (entry.disposition !== "runtime-backed") continue;
				expect(
					typeof entry.runtimeOwner,
					`runtime-backed candidate "${candidate}" must name a runtime owner`,
				).toBe("function");
				// Evaluating the owner must yield a truthy result: a non-empty
				// vocabulary const, or `true` from a validator owner that proves its
				// rule fires. A renamed/deleted export (undefined) or a no-longer-
				// firing validator (false/empty) turns this into a loud failure.
				expect(entry.runtimeOwner?.()).toBeTruthy();
			}
		});

		test("covers the four candidate groups the plan classifies", () => {
			const present = new Set(
				Object.values(SOURCE_CANDIDATE_DISPOSITIONS).map(
					(entry) => entry.disposition,
				),
			);
			expect([...present].sort()).toEqual([...DISPOSITIONS].sort());
		});
	});
});

function captureRuntimeContractIssues(fn: () => unknown): readonly string[] {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(CliRuntimeContractError);
		return (error as CliRuntimeContractError).issues;
	}
	throw new Error("expected CliRuntimeContractError");
}
