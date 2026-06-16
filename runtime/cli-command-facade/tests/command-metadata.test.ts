import { describe, expect, test } from "bun:test";

import {
	CliRuntimeContractError,
	type CommandFacadeContract,
	defineCommandFacadeContract,
	findCommandFacadeMetadataDrift,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";

type TestCommand = "inspect" | "inspect:json" | "verify:check";

// Legacy-shaped compatibility fixtures (BA-style / Memory OS-style). These keep
// the older command shapes honest through migration; the greenfield
// `createCliContracts` fixture below is the first-class create-cli evidence path
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

// Greenfield create-cli-style command set: a read command, a write command with
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

// The mutations the greenfield write command treats as write-implying, used to
// exercise the Write Preview Capability cross-check (U5).
const createCliWriteImplyingMutations = new Set<string>(["write"]);

describe("command metadata", () => {

	// Secondary compatibility scan: the legacy-shaped fixtures stay drift-free so
	// migrating consumers keep a known-good shape, but they are no longer the
	// baseline evidence — the greenfield create-cli fixture below is (KTD2, R3).
	test("keeps legacy-shaped command contracts drift-free for compatibility", () => {
		expect(findCommandFacadeMetadataDrift(contracts)).toEqual([]);
	});

	// First-class evidence: a greenfield create-cli-style command set (read,
	// write-with-dry_run, diagnostic readiness) is the primary proof for the
	// runtime-backed candidates. It must pass with no metadata drift, including
	// when write-implying mutations are declared (Write Preview Capability).
	test("treats the greenfield create-cli contract as first-class drift-free evidence", () => {
		expect(
			findCommandFacadeMetadataDrift(createCliContracts, {
				writeImplyingMutations: createCliWriteImplyingMutations,
			}),
		).toEqual([]);
		expect(
			defineCommandFacadeContract(createCliContracts, {
				writeImplyingMutations: createCliWriteImplyingMutations,
			}),
		).toBe(createCliContracts);
	});

	test("reports package-agnostic command metadata drift", () => {
		const drift = findCommandFacadeMetadataDrift({
			bad: {
				...contracts.inspect,
				audience: "private",
				flags: {
					mode: { type: "string" },
					"--mode": { type: "enum", values: [] },
					"--debug": { type: "boolean" },
				},
				sideEffects: ["spicy"] as never,
				executionModes: ["sometimes"] as never,
				outputModes: ["xml"] as never,
				interactivity: "sometimes" as never,
				envVars: [{ name: "API_TOKEN" }],
				exitCodes: {
					ok: "not numeric",
				},
				alias: {
					command: "absent",
					defaultArgs: [],
				},
				},
				missing: {
					...contracts.inspect,
					audience: undefined as never,
				},
			});

		// Exact emitted order pins the canonical per-command loop sequence:
		// audience -> side_effect -> execution_mode -> output_mode ->
		// interactivity -> env_var -> flags -> exit_code -> baseline_exit ->
		// alias. The lone non-numeric `ok` exit code declares none of the
		// baseline 0/1/2 meanings, so all three baseline categories follow the
		// per-code numeric-key drift (U2). The trailing command-audience-missing
		// comes from the separate no-audience fixture, so it lands last despite
		// the audience check being first per contract.
		expect(drift.map((finding) => finding.category)).toEqual([
			"command-audience-invalid",
			"command-side-effect-invalid",
			"command-execution-mode-invalid",
			"command-output-mode-invalid",
			"command-interactivity-invalid",
			"command-env-var-name-sensitive",
			"command-flag-name-invalid",
			"command-enum-flag-values-missing",
			"command-reserved-diagnostic-flag",
			"command-exit-code-invalid",
			"command-baseline-exit-success-missing",
			"command-baseline-exit-failure-missing",
			"command-baseline-exit-usage-missing",
			"command-alias-target-missing",
			"command-alias-default-args-missing",
			"command-audience-missing",
		]);
	});

	test("pins the unsafe-text drift order across all five free-text fields", () => {
		// Plant unsafe content in every scanned free-text field in ONE contract and
		// pin the canonical per-command loop order: summary -> usage -> env_var
		// description (within the env_var loop) -> flag description (within the flag
		// loop) -> exit_code value (within the exit_code loop). A reorder of the
		// per-field blocks in findCommandFacadeMetadataDrift must break this.
		const drift = findCommandFacadeMetadataDrift({
			bad: {
				...contracts.inspect,
				summary: "Use the api_key to authenticate.",
				usage: ["inspect --secret sk-live-abc123"],
				envVars: [
					{ name: "CONFIG_ROOT", description: "Holds the password value." },
				],
				flags: {
					"--x": {
						type: "boolean",
						description: "Pass the client_secret here.",
					},
				},
				exitCodes: { "0": "leaked /Users/nathanvale/.ssh path" },
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-summary-unsafe-text",
			"command-usage-unsafe-text",
			"command-env-var-description-unsafe-text",
			"command-flag-description-unsafe-text",
			"command-exit-code-unsafe-text",
		]);
	});

	test("reserves run-id as facade-owned diagnostic metadata", () => {
		const drift = findCommandFacadeMetadataDrift({
			bad: {
				...contracts.inspect,
				flags: {
					"--run-id": { type: "string" },
				},
			},
		});

		expect(drift).toEqual([
			{
				category: "command-reserved-diagnostic-flag",
				path: "command-contract",
				action:
					"Rename bad flag --run-id; --run-id is reserved for facade-owned CLI diagnostics.",
			},
		]);
	});

	// #62 — a contract missing `flags` or `exitCodes` must emit recoverable drift,
	// not crash with a raw TypeError. A crash has no `action` string, so the
	// autonomous self-correction loop (parse -> apply action -> re-parse) can't
	// heal it. Mirror the existing `command-audience-missing` recoverable shape.
	test("reports recoverable drift when flags is missing instead of crashing", () => {
		const { flags: _flags, ...withoutFlags } = contracts.inspect;
		const drift = findCommandFacadeMetadataDrift({
			bad: withoutFlags as never as CommandFacadeContract<string>,
		});

		expect(drift).toEqual([
			{
				category: "command-flags-missing",
				path: "command-contract",
				action: "Declare a flags record for command bad (use {} for none).",
			},
		]);
	});

	test("reports recoverable drift when exitCodes is missing instead of crashing", () => {
		const { exitCodes: _exitCodes, ...withoutExitCodes } = contracts.inspect;
		const drift = findCommandFacadeMetadataDrift({
			bad: withoutExitCodes as never as CommandFacadeContract<string>,
		});

		expect(drift).toEqual([
			{
				category: "command-exit-codes-missing",
				path: "command-contract",
				action: "Declare an exitCodes record for command bad.",
			},
		]);
	});

	test("missing flags and exitCodes both surface as recoverable drift", () => {
		const { flags: _f, exitCodes: _e, ...bare } = contracts.inspect;
		const drift = findCommandFacadeMetadataDrift({
			bad: bare as never as CommandFacadeContract<string>,
		});

		expect(drift.map((d) => d.category).sort()).toEqual([
			"command-exit-codes-missing",
			"command-flags-missing",
		]);
	});

	test("parseCommandFacadeContract returns recoverable drift (no throw) for missing flags", () => {
		const { flags: _flags, ...withoutFlags } = contracts.inspect;
		const result = parseCommandFacadeContract({
			bad: withoutFlags as never as CommandFacadeContract<string>,
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected drift result");
		expect(result.issues.map((i) => i.category)).toContain(
			"command-flags-missing",
		);
	});

	test("defineCommandFacadeContract throws CliRuntimeContractError (not TypeError) for missing flags", () => {
		const { flags: _flags, ...withoutFlags } = contracts.inspect;
		const issues = captureRuntimeContractIssues(() =>
			defineCommandFacadeContract({
				bad: withoutFlags,
			} as never as Record<string, CommandFacadeContract<string>>),
		);

		// The crash path emitted a raw TypeError with no serializable issues;
		// the fix routes it through the normal drift-throw plumbing instead.
		expect(issues).toEqual([
			"command-flags-missing: Declare a flags record for command bad (use {} for none).",
		]);
	});

	test("parseCommandFacadeContract returns ok with the same record for valid contracts", () => {
		const result = parseCommandFacadeContract(contracts);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.contracts).toBe(contracts);
	});

	test("parseCommandFacadeContract returns the checker's structured drift on failure", () => {
		const driftContracts = {
			bad: {
				...contracts.inspect,
				audience: "private",
				flags: {
					"--mode": { type: "enum", values: [] },
				},
				exitCodes: {
					ok: "not numeric",
				},
				alias: {
					command: "absent",
					defaultArgs: [],
				},
			},
		} as const;

		const result = parseCommandFacadeContract(
			driftContracts as never as Record<string, CommandFacadeContract<string>>,
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected drift result");
		expect(result.issues).toEqual(
			findCommandFacadeMetadataDrift(
				driftContracts as never as Record<
					string,
					CommandFacadeContract<string>
				>,
			),
		);
		expect(result.issues.map((finding) => finding.category)).toEqual([
			"command-audience-invalid",
			"command-enum-flag-values-missing",
			"command-exit-code-invalid",
			// The lone non-numeric `ok` exit code declares no baseline meaning, so
			// all three baseline categories follow the per-code numeric-key drift.
			"command-baseline-exit-success-missing",
			"command-baseline-exit-failure-missing",
			"command-baseline-exit-usage-missing",
			"command-alias-target-missing",
			"command-alias-default-args-missing",
		]);
	});

	test("defineCommandFacadeContract returns the validated record unchanged", () => {
		expect(defineCommandFacadeContract(contracts)).toBe(contracts);
	});

	test("defineCommandFacadeContract throws CliRuntimeContractError on drift", () => {
		const issues = captureRuntimeContractIssues(() =>
			defineCommandFacadeContract({
				bad: {
					...contracts.inspect,
					audience: "private",
				},
			} as never as Record<string, CommandFacadeContract<string>>),
		);

		expect(issues.length).toBeGreaterThan(0);
		expect(issues.every((issue) => typeof issue === "string")).toBe(true);
		// Pin the `${category}: ${action}` serialization contract exactly — a
		// change to the separator or field order must break this test.
		expect(issues).toEqual([
			"command-audience-invalid: Audience for command bad must be one of agent, operator, smoke, governance.",
		]);
	});

	test("both validators accept a command that declares --json", () => {
		const jsonContracts = {
			inspect: {
				...contracts.inspect,
				flags: {
					"--json": { type: "boolean" as const },
				},
			},
		};

		expect(parseCommandFacadeContract(jsonContracts).ok).toBe(true);
		expect(() => defineCommandFacadeContract(jsonContracts)).not.toThrow();
	});

	test("validators forward allowedAudiences to the drift checker", () => {
		const customAudience = {
			inspect: {
				...contracts.inspect,
				audience: "gateway",
			},
		};

		expect(parseCommandFacadeContract(customAudience).ok).toBe(false);
		expect(
			parseCommandFacadeContract(customAudience, {
				allowedAudiences: new Set(["gateway"]),
			}).ok,
		).toBe(true);
		expect(() =>
			defineCommandFacadeContract(customAudience, {
				allowedAudiences: new Set(["gateway"]),
			}),
		).not.toThrow();
		expect(() => defineCommandFacadeContract(customAudience)).toThrow(
			CliRuntimeContractError,
		);
	});

	test("flags a write-implying mutation whose sideEffects under-declare danger", () => {
		const underDeclared = {
			danger: {
				...contracts.inspect,
				mutation: "write",
				sideEffects: ["read"] as const,
			},
		};

		const result = parseCommandFacadeContract(underDeclared, {
			writeImplyingMutations: new Set(["write"]),
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected drift result");
		const mismatch = result.issues.find(
			(finding) => finding.category === "command-mutation-sideeffect-mismatch",
		);
		expect(mismatch).toBeDefined();
		expect(mismatch?.action).toContain("danger");
	});

	test("accepts a write-implying mutation that honestly declares write", () => {
		const honestWrite = {
			danger: {
				...contracts.inspect,
				mutation: "write",
				sideEffects: ["write"] as const,
			},
		};

		const drift = findCommandFacadeMetadataDrift(honestWrite, {
			writeImplyingMutations: new Set(["write"]),
		});

		expect(drift).not.toContainEqual(
			expect.objectContaining({
				category: "command-mutation-sideeffect-mismatch",
			}),
		);
	});

	test("accepts a write-implying mutation that honestly declares destructive", () => {
		const honestDestructive = {
			danger: {
				...contracts.inspect,
				mutation: "write",
				sideEffects: ["destructive"] as const,
			},
		};

		const drift = findCommandFacadeMetadataDrift(honestDestructive, {
			writeImplyingMutations: new Set(["write"]),
		});

		expect(drift).not.toContainEqual(
			expect.objectContaining({
				category: "command-mutation-sideeffect-mismatch",
			}),
		);
	});

	test("ignores a non-write mutation with read-only sideEffects", () => {
		const benign = {
			safe: {
				...contracts.inspect,
				mutation: "read-only",
				sideEffects: ["read"] as const,
			},
		};

		const drift = findCommandFacadeMetadataDrift(benign, {
			writeImplyingMutations: new Set(["write"]),
		});

		expect(drift).not.toContainEqual(
			expect.objectContaining({
				category: "command-mutation-sideeffect-mismatch",
			}),
		);
	});

	test("emits no mismatch finding when writeImplyingMutations is not supplied", () => {
		const underDeclared = {
			danger: {
				...contracts.inspect,
				mutation: "write",
				sideEffects: ["read"] as const,
			},
		};

		const drift = findCommandFacadeMetadataDrift(underDeclared);

		expect(drift).not.toContainEqual(
			expect.objectContaining({
				category: "command-mutation-sideeffect-mismatch",
			}),
		);
	});

	test("defineCommandFacadeContract throws on a write/sideEffect mismatch when the set is supplied", () => {
		const underDeclared = {
			danger: {
				...contracts.inspect,
				mutation: "write",
				sideEffects: ["read"] as const,
			},
		};

		expect(() =>
			defineCommandFacadeContract(underDeclared, {
				writeImplyingMutations: new Set(["write"]),
			}),
		).toThrow(CliRuntimeContractError);

		const issues = captureRuntimeContractIssues(() =>
			defineCommandFacadeContract(underDeclared, {
				writeImplyingMutations: new Set(["write"]),
			}),
		);
		expect(
			issues.some((issue) =>
				issue.startsWith("command-mutation-sideeffect-mismatch:"),
			),
		).toBe(true);
	});

	test("treats writeImplyingMutations as set membership, not a single string", () => {
		const underDeclared = {
			purge: {
				...contracts.inspect,
				mutation: "delete",
				sideEffects: ["read"] as const,
			},
		};

		const drift = findCommandFacadeMetadataDrift(underDeclared, {
			writeImplyingMutations: new Set(["write", "delete"]),
		});

		expect(drift).toContainEqual(
			expect.objectContaining({
				category: "command-mutation-sideeffect-mismatch",
			}),
		);
	});

	// U5: Write Preview Capability (KTD7) — a command declaring a write or
	// destructive side effect must offer a `check`/`dry_run` preview path, or a
	// narrow package-owned exemption. Keyed on the declared side effect.
	describe("write preview capability", () => {
		const writeBase = {
			...contracts.inspect,
			mutation: "write" as const,
			sideEffects: ["write"] as const,
		};

		test("accepts a write command with normal + dry_run execution modes", () => {
			const drift = findCommandFacadeMetadataDrift({
				danger: { ...writeBase, executionModes: ["normal", "dry_run"] as const },
			});
			expect(drift).not.toContainEqual(
				expect.objectContaining({ category: "command-write-preview-missing" }),
			);
		});

		test("accepts a destructive command with a check execution mode", () => {
			const drift = findCommandFacadeMetadataDrift({
				purge: {
					...contracts.inspect,
					mutation: "delete" as const,
					sideEffects: ["destructive"] as const,
					executionModes: ["check"] as const,
				},
			});
			expect(drift).not.toContainEqual(
				expect.objectContaining({ category: "command-write-preview-missing" }),
			);
		});

		test("accepts a write command with a safe package-owned preview exemption", () => {
			const drift = findCommandFacadeMetadataDrift({
				danger: {
					...writeBase,
					previewExemption: {
						reason: "Remote API has no preview endpoint for this resource.",
					},
				},
			});
			expect(drift).toEqual([]);
		});

		test("reports write-preview drift for a write command with only normal", () => {
			const drift = findCommandFacadeMetadataDrift({
				danger: { ...writeBase, executionModes: ["normal"] as const },
			});
			expect(
				drift
					.filter((finding) => finding.category === "command-write-preview-missing")
					.map((finding) => finding.action),
			).toEqual([
				"Declare a 'check' or 'dry_run' execution mode for command danger, or a non-empty, safe-text package-owned previewExemption reason (it declares a write/destructive side effect).",
			]);
		});

		test("reports write-preview drift for a write command with no execution modes", () => {
			const drift = findCommandFacadeMetadataDrift({ danger: writeBase });
			expect(drift).toContainEqual(
				expect.objectContaining({ category: "command-write-preview-missing" }),
			);
		});

		test("does not require preview for a read-only command", () => {
			expect(
				findCommandFacadeMetadataDrift({
					"config:get": createCliContracts["config:get"],
				}),
			).toEqual([]);
		});

		test("rejects a preview exemption reason containing a local path", () => {
			const drift = findCommandFacadeMetadataDrift({
				danger: {
					...writeBase,
					executionModes: ["normal"] as const,
					previewExemption: {
						reason: "See /Users/nathanvale/.config/cli/preview.json instead.",
					},
				},
			});
			expect(
				drift
					.filter(
						(finding) =>
							finding.category === "command-write-preview-exemption-unsafe-text",
					)
					.map((finding) => finding.action.includes("local-path")),
			).toContain(true);
			// An unsafe reason is not a valid exemption, so it must NOT suppress the
			// missing-preview requirement: both categories fire together.
			expect(drift).toContainEqual(
				expect.objectContaining({ category: "command-write-preview-missing" }),
			);
		});

		test("a control-char-only exemption reason does not satisfy the preview requirement", () => {
			// A reason that is only control characters trims to a non-empty string but
			// is semantically empty and unsafe to project, so it must not exempt.
			const drift = findCommandFacadeMetadataDrift({
				danger: {
					...writeBase,
					previewExemption: { reason: "\u0007\u0007\u0007" },
				},
			});
			expect(drift).toContainEqual(
				expect.objectContaining({ category: "command-write-preview-missing" }),
			);
			expect(drift).toContainEqual(
				expect.objectContaining({
					category: "command-write-preview-exemption-unsafe-text",
				}),
			);
		});

		test("defineCommandFacadeContract fails fast for a write command without preview", () => {
			const issues = captureRuntimeContractIssues(() =>
				defineCommandFacadeContract({
					danger: { ...writeBase, executionModes: ["normal"] as const },
				}),
			);
			expect(
				issues.some((issue) => issue.startsWith("command-write-preview-missing:")),
			).toBe(true);
		});

		test("a blank exemption reason does not satisfy the preview requirement", () => {
			// A present-but-empty reason must not silently escape the check.
			const drift = findCommandFacadeMetadataDrift({
				danger: {
					...writeBase,
					previewExemption: { reason: "   " },
				},
			});
			expect(drift).toContainEqual(
				expect.objectContaining({ category: "command-write-preview-missing" }),
			);
		});
	});

	test("reports facade drift for an unknown output mode", () => {
		const drift = findCommandFacadeMetadataDrift({
			bad: {
				...contracts.inspect,
				outputModes: ["xml"] as never,
			},
		});

		expect(drift.map((finding) => finding.category)).toEqual([
			"command-output-mode-invalid",
		]);
	});

	test("both validators reject an unknown output mode", () => {
		const badContracts = {
			bad: {
				...contracts.inspect,
				outputModes: ["xml"] as never,
			},
		} as never as Record<string, CommandFacadeContract<string>>;

		const issues = captureRuntimeContractIssues(() =>
			defineCommandFacadeContract(badContracts),
		);
		expect(issues.length).toBeGreaterThan(0);

		const result = parseCommandFacadeContract(badContracts);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected drift result");
		expect(result.issues.map((finding) => finding.category)).toEqual([
			"command-output-mode-invalid",
		]);
	});

	test("reports facade drift for an unknown interactivity", () => {
		const drift = findCommandFacadeMetadataDrift({
			bad: {
				...contracts.inspect,
				interactivity: "sometimes" as never,
			},
		});

		expect(drift.map((finding) => finding.category)).toEqual([
			"command-interactivity-invalid",
		]);
	});

	test("both validators reject an unknown interactivity", () => {
		const badContracts = {
			bad: {
				...contracts.inspect,
				interactivity: "sometimes" as never,
			},
		} as never as Record<string, CommandFacadeContract<string>>;

		const issues = captureRuntimeContractIssues(() =>
			defineCommandFacadeContract(badContracts),
		);
		expect(issues.length).toBeGreaterThan(0);

		const result = parseCommandFacadeContract(badContracts);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected drift result");
		expect(result.issues.map((finding) => finding.category)).toEqual([
			"command-interactivity-invalid",
		]);
	});

	for (const name of ["config-root", "1BAD", "HAS SPACE"]) {
		test(`malformed env-var name ${JSON.stringify(name)} short-circuits to one finding`, () => {
			const drift = findCommandFacadeMetadataDrift({
				bad: {
					...contracts.inspect,
					envVars: [{ name }],
				},
			});
			expect(drift.map((finding) => finding.category)).toEqual([
				"command-env-var-name-invalid",
			]);
		});
	}

	test("secret: true does not exempt a sensitive env-var name", () => {
		const drift = findCommandFacadeMetadataDrift({
			bad: {
				...contracts.inspect,
				envVars: [{ name: "API_TOKEN", secret: true }],
			},
		});
		expect(drift.map((finding) => finding.category)).toEqual([
			"command-env-var-name-sensitive",
		]);
	});

	test("both validators reject a sensitive env-var name", () => {
		const badContracts = {
			bad: {
				...contracts.inspect,
				envVars: [{ name: "API_TOKEN" }],
			},
		} as never as Record<string, CommandFacadeContract<string>>;

		const issues = captureRuntimeContractIssues(() =>
			defineCommandFacadeContract(badContracts),
		);
		expect(issues.length).toBeGreaterThan(0);

		const result = parseCommandFacadeContract(badContracts);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected drift result");
		expect(result.issues.map((finding) => finding.category)).toEqual([
			"command-env-var-name-sensitive",
		]);
	});

	test("free-text scan: benign content in all five fields emits no unsafe-text drift", () => {
		const benignContracts = {
			inspect: {
				...contracts.inspect,
				summary: "Inspect the current command state and report status.",
				usage: ["inspect [--json]", "inspect --format human"],
				flags: {
					"--json": { type: "boolean", description: "Emit machine output." },
				},
				exitCodes: {
					"0": "status returned",
					"2": "usage error",
				},
				envVars: [
					{ name: "CONFIG_ROOT", description: "Root configuration dir." },
				] as const,
			},
		};

			const drift = findCommandFacadeMetadataDrift(
				benignContracts satisfies Record<
					"inspect",
					CommandFacadeContract<string, string, string>
				>,
			);
		expect(
			drift.filter((finding) => finding.category.endsWith("-unsafe-text")),
		).toEqual([]);
	});

	test("free-text scan: secret in summary emits command-summary-unsafe-text with credential label", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				summary: "Build with token sk-live-abc123 secret value.",
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("credential");
	});

	test("free-text scan: secret in a usage element emits command-usage-unsafe-text", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				usage: ["inspect [--json]", "inspect --password hunter2"],
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-usage-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("usage[1]");
	});

	test("free-text scan: secret in a flag description emits command-flag-description-unsafe-text", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				flags: {
					"--json": {
						type: "boolean" as const,
						description: "Pass the api_key to authorize.",
					},
				},
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-flag-description-unsafe-text",
		]);
	});

	test("free-text scan: secret in an exitCodes value emits command-exit-code-unsafe-text", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				exitCodes: {
					"0": "status returned",
					"2": "failed: client_secret rejected",
				},
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-exit-code-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("exitCodes.2");
	});

	test("free-text scan: secret in an env-var description emits command-env-var-description-unsafe-text", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				envVars: [
					{
						name: "CONFIG_ROOT",
						description: "Holds the bearer abc123 value.",
					},
				] as const,
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-env-var-description-unsafe-text",
		]);
	});

	test("free-text scan: local-path leak in summary emits unsafe drift with local-path label", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				summary: "Reads /Users/nathanvale/config to inspect state.",
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("local-path");
	});

	test("free-text scan: ANSI escape control char in summary is rejected", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				summary: "\x1b[31mred",
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("control characters");
	});

	for (const [label, value] of [
		["NUL", "a\x00b"],
		["BEL", "\x07"],
	] as const) {
		test(`free-text scan: ${label} control char in summary is rejected`, () => {
			const drift = findCommandFacadeMetadataDrift({
				inspect: {
					...contracts.inspect,
					summary: value,
				},
			});

			const unsafe = drift.filter((finding) =>
				finding.category.endsWith("-unsafe-text"),
			);
			expect(unsafe.map((finding) => finding.category)).toEqual([
				"command-summary-unsafe-text",
			]);
			expect(unsafe[0]?.action).toContain("control characters");
		});
	}

	test("free-text scan: RTL-override control char in summary is rejected", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				summary: "‮evil",
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("control characters");
	});

	// U6 — affordance summary + result contract free-text scanning (construction gate).
	const affordanceContract = (overrides: {
		summary?: string;
		kind?: string | number;
		schemaVersion?: string | number;
	}) =>
		({
			inspect: {
				...contracts.inspect,
				resultContract: {
					id: "example.inspect@1",
					...(overrides.kind !== undefined ? { kind: overrides.kind } : {}),
					...(overrides.schemaVersion !== undefined
						? { schema_version: overrides.schemaVersion }
						: {}),
				},
				actionAffordances: {
					ok: [
						{
							id: "example.inspect.follow-up",
							summary: overrides.summary ?? "Inspect another state view.",
							sideEffects: ["read"],
						},
					],
				},
			},
		}) as never as Record<string, CommandFacadeContract<string>>;

	test("U6: secret in an actionAffordances summary emits command-action-summary-unsafe-text", () => {
		const drift = findCommandFacadeMetadataDrift(
			affordanceContract({ summary: "Pass the api_key sk-live-abc123 here." }),
		);

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-action-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("ok[0]");
	});

	test("U6: secret in resultContract.kind emits command-result-contract-kind-unsafe-text", () => {
		const drift = findCommandFacadeMetadataDrift(
			affordanceContract({ kind: "uses client_secret material" }),
		);

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-result-contract-kind-unsafe-text",
		]);
	});

	test("U6: secret in a string resultContract.schema_version emits command-result-contract-schema-version-unsafe-text", () => {
		const drift = findCommandFacadeMetadataDrift(
			affordanceContract({ schemaVersion: "v1 password hunter2" }),
		);

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-result-contract-schema-version-unsafe-text",
		]);
	});

	test("U6: numeric resultContract.schema_version is not scanned and emits no drift", () => {
		const drift = findCommandFacadeMetadataDrift(
			affordanceContract({ schemaVersion: 1 }),
		);

		expect(
			drift.filter((finding) => finding.category.endsWith("-unsafe-text")),
		).toEqual([]);
	});

	// PR #66 review (CodeRabbit, Major): a non-string, non-number schema_version
	// (object/boolean/null) must be type-rejected, not silently skipped. The prior
	// `typeof === "string"` guard let type-confused values bypass the scan. Numbers
	// stay clean (covered above); only string and other types are scanned.
	test("construction rejects a non-string non-number resultContract.schema_version", () => {
		const drift = findCommandFacadeMetadataDrift(
			affordanceContract({
				schemaVersion: { evil: "<script>" } as never as number,
			}),
		);

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-result-contract-schema-version-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("must be a string");
	});

	test("U6: benign affordance summary + benign resultContract emits no unsafe-text drift", () => {
		const drift = findCommandFacadeMetadataDrift(
			affordanceContract({
				summary: "Inspect another state view.",
				kind: "managed_workflow_structural_preflight",
				schemaVersion: 1,
			}),
		);

		expect(
			drift.filter((finding) => finding.category.endsWith("-unsafe-text")),
		).toEqual([]);
	});

	for (const [label, code] of [
		["U+200E LRM", "200E"],
		["U+2028 LS", "2028"],
		["U+FEFF BOM", "FEFF"],
	] as const) {
		test(`U6 (m1): ${label} in a summary is rejected as a control character`, () => {
			const drift = findCommandFacadeMetadataDrift({
				inspect: {
					...contracts.inspect,
					summary: `safe${String.fromCodePoint(Number.parseInt(code, 16))}text`,
				},
			});

			const unsafe = drift.filter((finding) =>
				finding.category.endsWith("-unsafe-text"),
			);
			expect(unsafe.map((finding) => finding.category)).toEqual([
				"command-summary-unsafe-text",
			]);
			expect(unsafe[0]?.action).toContain("control characters");
		});
	}

	test("free-text scan: tab and newline whitespace in usage is NOT rejected", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				usage: ["inspect [--json]\n\tcolumn one\tcolumn two"],
			},
		});

		expect(
			drift.filter((finding) => finding.category.endsWith("-unsafe-text")),
		).toEqual([]);
	});

	test("free-text scan: non-string flag description is rejected as a type error", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				flags: {
					"--x": {
						type: "boolean" as const,
						// Localized cast simulating a type-confusion contract author error.
						description: { evil: "<script>" } as unknown as string,
					},
				},
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-flag-description-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("must be a string");
	});

	test("free-text scan: a value that is both non-string and pattern-matching emits exactly one drift", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				// Non-string whose nested text would also match the credential pattern;
				// the type reject must short-circuit before the pattern scan.
				summary: { password: "sk-live-abc123" } as unknown as string,
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-summary-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("must be a string");
	});

	const CLEANLY_BENIGN_FREE_TEXT = [
		{ field: "summary", text: "Inspect the current command state." },
		{ field: "summary", text: "List available items with optional filters." },
		{ field: "usage", text: "inspect [--json]" },
		{ field: "usage", text: "inspect --format human" },
		{ field: "flag-description", text: "Emit machine output." },
		{ field: "flag-description", text: "Validate before running." },
		{ field: "exit-code", text: "status returned" },
		{ field: "exit-code", text: "usage error" },
		{ field: "env-var-description", text: "Root configuration dir." },
		{ field: "env-var-description", text: "Show a summary of the run." },
	] as const;

	// Bucket 2: content that is CLOSE to a trigger but should NOT trip, because
	// the patterns require word boundaries (`\bscope\b`, command-example's
	// leading-whitespace anchor) or a hyphen/underscore-joined token
	// (`tenant-id`, `account_x`, `session-id`). Each was verified against
	// RUNTIME_CONTRACT_UNSAFE_TEXT_PATTERNS before listing — these are genuine
	// near-misses, not fabricated ones. Proves boundaries don't over-trigger.
	//
	// NOTE (U2 finding): `OAUTH_SCOPE` lives here, NOT in the known-false-positive
	// bucket the plan anticipated. The `\bscope\b` value pattern does NOT match
	// `OAUTH_SCOPE` because `_` is a word char, so there is no word boundary
	// before `SCOPE` — the whole token reads as one word `OAUTH_SCOPE`. It only
	// trips the env-var NAME gate (SENSITIVE_ENV_VAR_NAME_SEGMENTS), which is a
	// separate concern from this free-text VALUE scan.
	const NEAR_MISS_BENIGN_FREE_TEXT = [
		// `scope` substring without a word boundary.
		{ field: "summary", text: "Limit work to the periscope view." },
		{ field: "summary", text: "Configure the kaleidoscope mode." },
		// `bun` substring without command-example whitespace+word boundary.
		{ field: "summary", text: "The bunny hops twice." },
		// `account`/`tenant` as bare words, not the hyphen/underscore-joined
		// `account-id` / `tenant_x` forms the pattern requires.
		{ field: "summary", text: "Set the account name label." },
		{ field: "env-var-description", text: "Holds the tenant label only." },
		// `key` substring without the `api`/`client` prefix the credential
		// pattern requires.
		{ field: "flag-description", text: "Show keyboard shortcuts." },
		// `session` alone, not `session-id` / `session-token`.
		{ field: "env-var-description", text: "Set the session length value." },
		// `OAUTH_SCOPE` — underscore-joined, no `\bscope\b` match (see note above).
		{ field: "summary", text: "Provide the OAUTH_SCOPE value." },
	] as const;

	// Bucket 3: ACCEPTED FALSE-POSITIVES — benign content the scanner DOES reject
	// (issue #61: acceptable for free-text values). Pinned here so the behavior
	// breaks loudly if the scanner's precision ever changes.
	//
	// Author workaround when one of these blocks legitimate help text: rephrase
	// the help text to avoid the literal trigger word — e.g. write "your tenant
	// identifier" instead of "TENANT_ID" / "tenant-id", or "limit the search
	// area" instead of "scope". The scanner is deliberately NOT loosened.
	const KNOWN_FALSE_POSITIVE_FREE_TEXT = [
		// `TENANT_ID` — underscore-joined IS matched by `tenant_[A-Za-z0-9]+`.
		{
			field: "summary",
			text: "Set TENANT_ID before running.",
			label: "tenant-or-account",
		},
		// `tenant-id` — hyphen form matched by `tenant[-_ ]?id`.
		{
			field: "summary",
			text: "Pass the tenant-id from config.",
			label: "tenant-or-account",
		},
		// the bare word `scope` — matched by `\bscope\b`.
		{
			field: "summary",
			text: "Limit the scope of the search.",
			label: "scope",
		},
	] as const;

	function summaryDrift(text: string) {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				summary: text,
			},
		});
		return drift.filter((finding) => finding.category.endsWith("-unsafe-text"));
	}

	function fieldDrift(field: string, text: string) {
		const base = { ...contracts.inspect };
		switch (field) {
			case "summary":
				return summaryDrift(text);
			case "usage":
				return findCommandFacadeMetadataDrift({
					inspect: { ...base, usage: [text] },
				}).filter((finding) => finding.category.endsWith("-unsafe-text"));
			case "flag-description":
				return findCommandFacadeMetadataDrift({
					inspect: {
						...base,
						flags: { "--x": { type: "boolean" as const, description: text } },
					},
				}).filter((finding) => finding.category.endsWith("-unsafe-text"));
			case "exit-code":
				return findCommandFacadeMetadataDrift({
					inspect: { ...base, exitCodes: { "0": text } },
				}).filter((finding) => finding.category.endsWith("-unsafe-text"));
			case "env-var-description":
				return findCommandFacadeMetadataDrift({
					inspect: {
						...base,
						envVars: [{ name: "CONFIG_ROOT", description: text }] as const,
					},
				}).filter((finding) => finding.category.endsWith("-unsafe-text"));
			default:
				throw new Error(`unknown field ${field}`);
		}
	}

	for (const { field, text } of CLEANLY_BENIGN_FREE_TEXT) {
		test(`benign free-text: cleanly-benign ${field} ${JSON.stringify(text)} emits no unsafe-text drift`, () => {
			expect(fieldDrift(field, text)).toEqual([]);
		});
	}

	for (const { field, text } of NEAR_MISS_BENIGN_FREE_TEXT) {
		test(`benign free-text: near-miss ${field} ${JSON.stringify(text)} does not over-trigger`, () => {
			expect(fieldDrift(field, text)).toEqual([]);
		});
	}

	for (const { text, label } of KNOWN_FALSE_POSITIVE_FREE_TEXT) {
		test(`benign free-text: accepted false-positive ${JSON.stringify(text)} is pinned (still emits drift)`, () => {
			const unsafe = summaryDrift(text);
			expect(unsafe.map((finding) => finding.category)).toEqual([
				"command-summary-unsafe-text",
			]);
			expect(unsafe[0]?.action).toContain(label);
		});
	}

	// U2 finding — command-example in usage. A usage[] string legitimately shows
	// a command invocation (`bun run foo`), which trips the `command-example`
	// pattern. Pinned as CURRENT behavior. This may warrant a future usage-field
	// label exemption (usage strings exist to show invocations), but that is OUT
	// of U2 scope — do NOT silently exempt it here.
	test("benign free-text: command invocation in usage trips command-usage-unsafe-text (pinned; see U2 finding)", () => {
		const drift = findCommandFacadeMetadataDrift({
			inspect: {
				...contracts.inspect,
				usage: ["Run bun run foo to build."],
			},
		});

		const unsafe = drift.filter((finding) =>
			finding.category.endsWith("-unsafe-text"),
		);
		expect(unsafe.map((finding) => finding.category)).toEqual([
			"command-usage-unsafe-text",
		]);
		expect(unsafe[0]?.action).toContain("command-example");
	});

	// U7: Source candidate traceability (R4, R10, R11). The create-cli brainstorm,
	// emission plan, and design layer fixed the candidate set; this slice does NOT
	// re-open it. This ledger records each source candidate's disposition for THIS
	// slice. The runtime-backed rows name a live owner symbol, so removing or
	// renaming that owner fails this suite loudly. There is no source-side
	// candidate registry, so this ledger does NOT auto-detect a newly added
	// candidate-shaped field — keeping it in sync on new candidates is a reviewer
	// responsibility, not a mechanical tripwire.

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
