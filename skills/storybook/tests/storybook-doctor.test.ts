import { describe, expect, test } from "bun:test";
import {
	parseCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	type StorybookDoctorCommand,
	storybookDoctorContracts,
} from "../src/command-contract.ts";
import {
	STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID,
	STORYBOOK_DOCTOR_CONTRACT_ID,
	STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
} from "../src/readiness-model.ts";
import { runCheck } from "../src/readiness-engine.ts";
import { runDeep } from "../src/deep-doctor.ts";
import { runForTest } from "../src/storybook-doctor.ts";
import type { StorybookDoctorRuntime } from "../src/storybook-doctor-runtime.ts";

const contractEntries = Object.entries(storybookDoctorContracts) as Array<
	[
		StorybookDoctorCommand,
		(typeof storybookDoctorContracts)[StorybookDoctorCommand],
	]
>;

describe("command contract", () => {
	test("declares valid facade contracts", () => {
		const parsed = parseCommandFacadeContract(storybookDoctorContracts, {
			path: "skills/storybook/src/command-contract.ts",
			writeImplyingMutations: new Set(["write", "destructive"]),
		});
		expect(parsed.ok).toBe(true);
	});

	test("every command declares read/check side effects only", () => {
		for (const [, contract] of contractEntries) {
			const effects = new Set<string>(contract.sideEffects);
			expect(effects.has("write")).toBe(false);
			expect(effects.has("destructive")).toBe(false);
			expect(effects.has("browser")).toBe(false);
			expect(effects.has("auth")).toBe(false);
		}
	});

	test("commands --json emits projected discovery for check, deep, and commands", () => {
		const tree = projectCommandDiscoveryTree(contractEntries, {
			includeFlagDescriptions: true,
		});
		const commandIds = Object.keys(tree.commands);
		expect(commandIds).toContain("check");
		expect(commandIds).toContain("deep");
		expect(commandIds).toContain("commands");
	});

	test("discovery output includes result contract metadata", () => {
		const tree = projectCommandDiscoveryTree(contractEntries, {
			includeFlagDescriptions: true,
		});
		const cmds = tree.commands as Record<string, { result_contract?: { id: string } }>;
		expect(cmds.check?.result_contract?.id).toBe(STORYBOOK_DOCTOR_CONTRACT_ID);
		expect(cmds.deep?.result_contract?.id).toBe(
			STORYBOOK_DOCTOR_DEEP_CONTRACT_ID,
		);
		expect(cmds.commands?.result_contract?.id).toBe(
			STORYBOOK_DOCTOR_COMMANDS_CONTRACT_ID,
		);
	});
});

// --- U3: Readiness engine tests ---

const FAKE_STORYBOOK_CONFIG = `
import type { StorybookConfig } from "@storybook/react-vite";
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-mcp"],
};
export default config;
`;

const FAKE_PACKAGE_JSON = JSON.stringify({
	name: "test-project",
	devDependencies: {
		storybook: "^8.0.0",
		"@storybook/addon-mcp": "^0.1.0",
	},
	scripts: {
		storybook: "storybook dev -p 6006",
	},
});

function fakeRuntime(
	overrides: Partial<StorybookDoctorRuntime> = {},
): StorybookDoctorRuntime {
	const files: Record<string, string> = {
		"/project/package.json": FAKE_PACKAGE_JSON,
		"/project/.storybook/main.ts": FAKE_STORYBOOK_CONFIG,
	};
	return {
		cwd: () => "/project",
		fileExists: (path) => path in files,
		readTextFile: (path) => {
			if (path in files) return files[path];
			throw new Error(`ENOENT: ${path}`);
		},
		fetch: async () => new Response("ok", { status: 200 }),
		lookupPortOwner: () => null,
		commandExists: () => true,
		execCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
		now: () => 1_000_000,
		getEnv: () => undefined,
		...overrides,
	};
}

function fakeRuntimeWithMcp(
	overrides: Partial<StorybookDoctorRuntime> = {},
): StorybookDoctorRuntime {
	return fakeRuntime({
		fetch: async (url) => {
			if (typeof url === "string" && url.endsWith("/mcp")) {
				return new Response(
					JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "tool1" }, { name: "tool2" }] } }),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response("ok", { status: 200 });
		},
		...overrides,
	});
}

describe("readiness engine", () => {
	test("valid target with running MCP produces ready", async () => {
		const result = await runCheck(fakeRuntimeWithMcp(), {
			url: "http://localhost:6006",
		});
		expect(result.status).toBe("ready");
		expect(result.findings.some((f) => f.id === "mcp_tools_ready")).toBe(true);
	});

	test("missing package.json produces blocked", async () => {
		const result = await runCheck(
			fakeRuntime({
				fileExists: () => false,
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(result.findings.some((f) => f.id === "no_package_json")).toBe(true);
		expect(result.next_safe_action.id).toBe("create_package_json");
	});

	test("missing Storybook config produces blocked", async () => {
		const files: Record<string, string> = {
			"/project/package.json": FAKE_PACKAGE_JSON,
		};
		const result = await runCheck(
			fakeRuntime({
				fileExists: (path) => path in files,
				readTextFile: (path) => {
					if (path in files) return files[path];
					throw new Error(`ENOENT: ${path}`);
				},
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(
			result.findings.some((f) => f.id === "no_storybook_config"),
		).toBe(true);
	});

	test("missing Storybook dependency produces blocked", async () => {
		const pkgJson = JSON.stringify({
			name: "test-project",
			devDependencies: { "@storybook/addon-mcp": "^0.1.0" },
			scripts: { storybook: "storybook dev" },
		});
		const files: Record<string, string> = {
			"/project/package.json": pkgJson,
			"/project/.storybook/main.ts": FAKE_STORYBOOK_CONFIG,
		};
		const result = await runCheck(
			fakeRuntime({
				fileExists: (path) => path in files,
				readTextFile: (path) => {
					if (path in files) return files[path];
					throw new Error(`ENOENT: ${path}`);
				},
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(
			result.findings.some((f) => f.id === "no_storybook_dependency"),
		).toBe(true);
	});

	test("missing MCP addon dependency produces blocked", async () => {
		const pkgJson = JSON.stringify({
			name: "test-project",
			devDependencies: { storybook: "^8.0.0" },
			scripts: { storybook: "storybook dev" },
		});
		const files: Record<string, string> = {
			"/project/package.json": pkgJson,
			"/project/.storybook/main.ts": FAKE_STORYBOOK_CONFIG,
		};
		const result = await runCheck(
			fakeRuntime({
				fileExists: (path) => path in files,
				readTextFile: (path) => {
					if (path in files) return files[path];
					throw new Error(`ENOENT: ${path}`);
				},
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(
			result.findings.some((f) => f.id === "no_mcp_addon_dependency"),
		).toBe(true);
	});

	test("no running Storybook produces blocked without starting server", async () => {
		const result = await runCheck(
			fakeRuntimeWithMcp({
				fetch: async () => {
					throw new Error("ECONNREFUSED");
				},
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(result.findings.some((f) => f.id === "no_live_session")).toBe(true);
		expect(result.next_safe_action.id).toBe("start_storybook");
	});

	test("non-loopback URL produces blocked with no network probe", async () => {
		let fetched = false;
		const result = await runCheck(
			fakeRuntime({
				fetch: async () => {
					fetched = true;
					return new Response("ok", { status: 200 });
				},
			}),
			{ url: "http://remote-host:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(
			result.findings.some((f) => f.id === "non_loopback_url"),
		).toBe(true);
		expect(fetched).toBe(false);
	});

	test("manager healthy with /mcp missing produces blocked", async () => {
		const result = await runCheck(
			fakeRuntime({
				fetch: async (url) => {
					if (typeof url === "string" && url.endsWith("/mcp")) {
						return new Response("Not Found", { status: 404 });
					}
					return new Response("ok", { status: 200 });
				},
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(
			result.findings.some((f) => f.id === "manager_ok_mcp_missing"),
		).toBe(true);
	});

	test("raw /mcp ready but mcporter missing produces degraded", async () => {
		const result = await runCheck(
			fakeRuntimeWithMcp({
				commandExists: (name) => name !== "mcporter",
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("degraded");
		expect(
			result.findings.some(
				(f) => f.id === "mcporter_missing_raw_mcp_ready",
			),
		).toBe(true);
	});

	test("missing tmux produces degraded with install hint", async () => {
		const result = await runCheck(
			fakeRuntimeWithMcp({
				commandExists: (name) => name !== "tmux",
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("degraded");
		const tmuxFinding = result.findings.find(
			(f) => f.id === "tmux_missing_hint",
		);
		expect(tmuxFinding).toBeDefined();
		expect(tmuxFinding!.severity).toBe("degraded");
	});

	test("stale port owner is reported with PID and command", async () => {
		const result = await runCheck(
			fakeRuntime({
				fetch: async () => {
					throw new Error("ECONNREFUSED");
				},
				lookupPortOwner: () => ({ pid: 12345, command: "node" }),
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.session?.port_owner_pid).toBe(12345);
		expect(result.session?.port_owner_command).toBe("node");
	});

	test("missing storybook script produces degraded hint", async () => {
		const pkgJson = JSON.stringify({
			name: "test-project",
			devDependencies: {
				storybook: "^8.0.0",
				"@storybook/addon-mcp": "^0.1.0",
			},
		});
		const files: Record<string, string> = {
			"/project/package.json": pkgJson,
			"/project/.storybook/main.ts": FAKE_STORYBOOK_CONFIG,
		};
		const result = await runCheck(
			fakeRuntimeWithMcp({
				fileExists: (path) => path in files,
				readTextFile: (path) => {
					if (path in files) return files[path];
					throw new Error(`ENOENT: ${path}`);
				},
			}),
			{ url: "http://localhost:6006" },
		);
		expect(
			result.findings.some((f) => f.id === "no_storybook_script"),
		).toBe(true);
		const scriptFinding = result.findings.find(
			(f) => f.id === "no_storybook_script",
		);
		expect(scriptFinding!.severity).toBe("degraded");
	});
});

// --- U4: Deep doctor tests ---

function fakeRuntimeWithLocalBinary(
	overrides: Partial<StorybookDoctorRuntime> = {},
): StorybookDoctorRuntime {
	const baseFiles: Record<string, string> = {
		"/project/package.json": FAKE_PACKAGE_JSON,
		"/project/.storybook/main.ts": FAKE_STORYBOOK_CONFIG,
		"/project/node_modules/.bin/storybook": "",
	};
	return fakeRuntimeWithMcp({
		fileExists: (path) => path in baseFiles,
		readTextFile: (path) => {
			if (path in baseFiles) return baseFiles[path];
			throw new Error(`ENOENT: ${path}`);
		},
		...overrides,
	});
}

describe("deep doctor", () => {
	test("deep reuses all check findings before evaluating local doctor", async () => {
		const result = await runDeep(fakeRuntimeWithLocalBinary(), {
			url: "http://localhost:6006",
		});
		expect(result.findings.some((f) => f.id === "mcp_tools_ready")).toBe(true);
		expect(result.deep.local_binary_found).toBe(true);
	});

	test("local storybook doctor exit 0 preserves status and adds deep evidence", async () => {
		const result = await runDeep(
			fakeRuntimeWithLocalBinary({
				execCommand: async () => ({
					exitCode: 0,
					stdout: "No issues found.\n",
					stderr: "",
				}),
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.deep.doctor_exit_code).toBe(0);
		expect(
			result.findings.some((f) => f.id === "deep_local_doctor_ok"),
		).toBe(true);
	});

	test("missing local storybook binary produces degraded", async () => {
		const result = await runDeep(fakeRuntimeWithMcp(), {
			url: "http://localhost:6006",
		});
		expect(result.deep.local_binary_found).toBe(false);
		expect(
			result.findings.some(
				(f) => f.id === "local_storybook_binary_missing",
			),
		).toBe(true);
	});

	test("nonzero storybook doctor exit becomes structured finding", async () => {
		const result = await runDeep(
			fakeRuntimeWithLocalBinary({
				execCommand: async () => ({
					exitCode: 1,
					stdout: "Duplicate packages found.\nVersion mismatch detected.\n",
					stderr: "",
				}),
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.deep.doctor_exit_code).toBe(1);
		expect(
			result.findings.some((f) => f.id === "storybook_doctor_nonzero"),
		).toBe(true);
	});

	test("large debug output is truncated with visible fact", async () => {
		const bigOutput = "x".repeat(20_000);
		const result = await runDeep(
			fakeRuntimeWithLocalBinary({
				execCommand: async () => ({
					exitCode: 0,
					stdout: bigOutput,
					stderr: "",
				}),
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.deep.truncated).toBe(true);
		expect(
			result.findings.some((f) => f.id === "debug_output_truncated"),
		).toBe(true);
	});

	test("token-like output is redacted before JSON emission", async () => {
		const result = await runDeep(
			fakeRuntimeWithLocalBinary({
				execCommand: async () => ({
					exitCode: 0,
					stdout: "Using token sk-abc123456789012345678901234567890\n",
					stderr: "",
				}),
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.deep.redacted_count).toBeGreaterThan(0);
		for (const line of result.deep.doctor_summary) {
			expect(line).not.toContain("sk-abc");
		}
	});

	test("existing check blockers remain blocked after deep", async () => {
		const result = await runDeep(
			fakeRuntime({
				fileExists: () => false,
			}),
			{ url: "http://localhost:6006" },
		);
		expect(result.status).toBe("blocked");
		expect(result.findings.some((f) => f.id === "no_package_json")).toBe(true);
	});
});

// --- U5: CLI front door tests ---

describe("CLI front door", () => {
	test("--help renders without target repo reads", async () => {
		const result = await runForTest(["--help"], fakeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("storybook-doctor");
	});

	test("help check renders check command help", async () => {
		const result = await runForTest(["help", "check"], fakeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("check");
	});

	test("--version writes only version text to stdout", async () => {
		const result = await runForTest(["--version"], fakeRuntime());
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/^storybook-doctor \d+\.\d+\.\d+\n$/);
		expect(result.stderr).toBe("");
	});

	test("unknown command exits 2", async () => {
		const result = await runForTest(["bogus", "--json"], fakeRuntime());
		expect(result.exitCode).toBe(2);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.status).toBe("error");
	});

	test("commands --json performs no runtime probes", async () => {
		let probed = false;
		const result = await runForTest(
			["commands", "--json"],
			fakeRuntime({
				fetch: async () => {
					probed = true;
					return new Response("ok", { status: 200 });
				},
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(probed).toBe(false);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.status).toBe("ok");
	});

	test("check --json returns readiness envelope", async () => {
		const result = await runForTest(
			["check", "--json", "--url", "http://localhost:6006"],
			fakeRuntimeWithMcp(),
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.status).toBeDefined();
	});

	test("deep --json returns extended envelope", async () => {
		const result = await runForTest(
			["deep", "--json", "--url", "http://localhost:6006"],
			fakeRuntimeWithMcp(),
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.deep).toBeDefined();
	});

	test("completed blocked readiness exits 0", async () => {
		const result = await runForTest(
			["check", "--json"],
			fakeRuntime({
				fileExists: () => false,
			}),
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.data.status).toBe("blocked");
	});

	test("check rejects unknown flags with exit 2", async () => {
		const result = await runForTest(
			["check", "--json", "--bogus"],
			fakeRuntime(),
		);
		expect(result.exitCode).toBe(2);
	});

	test("diagnostics go to stderr, primary data to stdout", async () => {
		const result = await runForTest(
			["check", "--json"],
			fakeRuntimeWithMcp(),
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout);
		expect(envelope.status).toBe("ok");
	});
});
