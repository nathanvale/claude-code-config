import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_ADAPTER_PROOF_ADAPTERS,
	BROWSER_ADAPTER_PROOF_BINDING_STATUSES,
	BROWSER_ADAPTER_PROOF_CONFIG_SOURCE_LABELS,
	BROWSER_ADAPTER_PROOF_DIAGNOSTIC_CODES,
	BROWSER_ADAPTER_PROOF_SCHEMA_VERSION,
	browserAdapterProofContracts,
	warmChromeFailureActions,
} from "./command-contract";
import {
	createDefaultAdapterProofRuntime,
	runForTest,
	runCommand,
	validateErrorEnvelopeForTest,
	type AdapterCommandInput,
	type AdapterCommandResult,
	type AdapterProofRuntime,
} from "./preflight-browser-adapter";

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

function actionIds(envelope: {
	runtime_actions?: readonly { id: string }[];
}): string[] {
	return envelope.runtime_actions?.map((action) => action.id) ?? [];
}

function expectContinuation(
	envelope: {
		runtime_actions?: readonly { id: string }[];
		continuation?: {
			next_action_id?: string;
			constraints?: readonly {
				id: string;
				forbidden_action_ids?: readonly string[];
			}[];
		};
	},
	nextActionId: string,
): void {
	expect(envelope.continuation?.next_action_id).toBe(nextActionId);
	expect(actionIds(envelope)).toContain(nextActionId);
}

function expectNoAdapterFallback(envelope: {
	continuation?: {
		constraints?: readonly {
			id: string;
			forbidden_action_ids?: readonly string[];
		}[];
	};
}): void {
	const constraint = envelope.continuation?.constraints?.find(
		(entry) => entry.id === "no_adapter_fallback",
	);
	expect(constraint?.forbidden_action_ids).toEqual([
		"adapter_fallback",
		"cold_browser_fallback",
	]);
}

describe("Browser Adapter Proof command contract", () => {
	test("declares create-cli facade contract for check and status", () => {
		expect(browserAdapterProofContracts.check.sideEffects).toEqual([
			"check",
			"network",
		]);
		expect(browserAdapterProofContracts.status.alias).toEqual({
			command: "check",
			defaultArgs: ["--plain"],
		});
		expect(browserAdapterProofContracts.check.flags["--adapter"]).toMatchObject({
			type: "enum",
			values: ["chrome-devtools"],
			required: true,
		});
		expect(browserAdapterProofContracts.check.resultContract?.id).toBe(
			"browser-use.browser-adapter-proof",
		);
		expect(browserAdapterProofContracts.check.resultContract?.schema_version).toBe(
			BROWSER_ADAPTER_PROOF_SCHEMA_VERSION,
		);
		const mcporterCommandEnvVar =
			browserAdapterProofContracts.check.envVars.find(
				(envVar) => envVar.name === "BROWSER_USE_MCPORTER_COMMAND_JSON",
			);
		expect(mcporterCommandEnvVar?.description).toContain("JSON array");
		expect(mcporterCommandEnvVar?.description).toContain(
			"package runners are never tried automatically",
		);
		expect(
			browserAdapterProofContracts.check.actionAffordances?.success.map(
				(action) => action.id,
			),
		).toEqual(["use_verified_browser_adapter"]);
		expect(
			browserAdapterProofContracts.check.actionAffordances?.failure.map(
				(action) => action.id,
			),
		).toEqual(
			expect.arrayContaining(warmChromeFailureActions.map((action) => action.id)),
		);
		expect(
			browserAdapterProofContracts.check.actionAffordances?.failure.map(
				(action) => action.id,
			),
		).toContain("configure_adapter_dependency");
		expect(
			browserAdapterProofContracts.check.actionAffordances?.failure.find(
				(action) => action.id === "configure_adapter_dependency",
			)?.sideEffects,
		).toEqual(["write"]);
	});

	test("owns stable Browser Adapter Proof vocabulary", () => {
		expect(BROWSER_ADAPTER_PROOF_ADAPTERS).toEqual(["chrome-devtools"]);
		expect(BROWSER_ADAPTER_PROOF_CONFIG_SOURCE_LABELS).toEqual([
			"mcporter",
			"repo_mcp",
			"native_mcp_claude_code",
			"native_mcp_claude_desktop",
			"native_mcp_codex",
			"native_mcp_unknown",
		]);
		expect(BROWSER_ADAPTER_PROOF_BINDING_STATUSES).toEqual([
			"matches_verified_endpoint",
			"mismatch",
			"stale",
			"missing",
			"unknown",
		]);
		expect(BROWSER_ADAPTER_PROOF_DIAGNOSTIC_CODES).toEqual(
			expect.arrayContaining([
				"adapter_binding_mismatch",
				"adapter_binding_ambiguous",
				"adapter_config_stale",
				"adapter_command_override_invalid",
				"adapter_signal_weak",
			]),
		);
	});

	test("validates against facade package without declaring reserved diagnostics", () => {
		const parsed = parseCommandFacadeContract(browserAdapterProofContracts, {
			path: "skills/browser-use/scripts/command-contract.ts",
			writeImplyingMutations: new Set(["write", "browser"]),
		});

		expect(parsed.ok).toBe(true);
		for (const contract of Object.values(browserAdapterProofContracts)) {
			for (const flag of CLI_DIAGNOSTIC_FLAGS) {
				expect(contract.flags).not.toHaveProperty(flag);
			}
		}
	});

	test("keeps proof commands read-only", () => {
		for (const contract of Object.values(browserAdapterProofContracts)) {
			expect(contract.mutation).toBe("check");
			expect(contract.sideEffects).not.toContain("write");
			expect(contract.sideEffects).not.toContain("browser");
		}
	});
});

describe("CLI front door", () => {
	test("prints help without Warm Chrome or adapter work", async () => {
		let commandCount = 0;
		const result = await runForTest(
			["--help"],
			await testRuntime({
				runCommand: async () => {
					commandCount += 1;
					return okCommand("{}");
				},
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: preflight-browser-adapter");
		expect(commandCount).toBe(0);
	});

	test("prints version without Warm Chrome or adapter work", async () => {
		const result = await runForTest(["--version"], await testRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/^preflight-browser-adapter 0\.1\.0\n$/);
		expect(result.stderr).toBe("");
	});

	test("shell wrapper passes through --version", async () => {
		const proc = Bun.spawn(
			["bash", join(import.meta.dir, "preflight-browser-adapter.sh"), "--version"],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/^preflight-browser-adapter 0\.1\.0\n$/);
		expect(stderr).toBe("");
	});

	test("legacy launch wrapper forwards leading flags as preflight options", async () => {
		const dir = await mkdtemp(join(tmpdir(), "launch-agent-chrome-"));
		cleanupPaths.push(dir);
		const wrapper = join(dir, "launch-agent-chrome.sh");
		const stub = join(dir, "preflight-warm-chrome.sh");
		await writeFile(
			wrapper,
			await readFile(join(import.meta.dir, "launch-agent-chrome.sh"), "utf8"),
		);
		await writeFile(stub, '#!/usr/bin/env bash\nprintf "<%s>\\n" "$@"\n');
		await Promise.all([chmod(wrapper, 0o755), chmod(stub, 0o755)]);

		const proc = Bun.spawn(["bash", wrapper, "--json", "--debug"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toBe("<launch>\n<--plain>\n<--json>\n<--debug>\n");
		expect(stderr).toBe("");
	});

	test("legacy launch wrapper still maps positional port and profile", async () => {
		const dir = await mkdtemp(join(tmpdir(), "launch-agent-chrome-"));
		cleanupPaths.push(dir);
		const wrapper = join(dir, "launch-agent-chrome.sh");
		const stub = join(dir, "preflight-warm-chrome.sh");
		await writeFile(
			wrapper,
			await readFile(join(import.meta.dir, "launch-agent-chrome.sh"), "utf8"),
		);
		await writeFile(stub, '#!/usr/bin/env bash\nprintf "<%s>\\n" "$@"\n');
		await Promise.all([chmod(wrapper, 0o755), chmod(stub, 0o755)]);

		const proc = Bun.spawn(
			["bash", wrapper, "9333", "/tmp/agent-profile", "--json"],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toBe(
			"<launch>\n<--plain>\n<--port>\n<9333>\n<--profile>\n</tmp/agent-profile>\n<--json>\n",
		);
		expect(stderr).toBe("");
	});

	test("missing adapter is input failure before adapter subprocesses", async () => {
		let commandCount = 0;
		const result = await runForTest(
			["check", "--json"],
			await testRuntime({
				runCommand: async () => {
					commandCount += 1;
					return okCommand("{}");
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("missing_adapter");
		expect(envelope.error.failure_domain).toBe("input");
		expectContinuation(envelope, "change_adapter_input");
		expect(commandCount).toBe(0);
	});

	test("unknown adapter is input failure with supported values", async () => {
		const result = await runForTest(
			["check", "--adapter", "playwright", "--json"],
			await testRuntime(),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("unknown_adapter");
		expect(envelope.error.hint.summary).toContain("chrome-devtools");
		expect(envelope.error.hint.summary).not.toContain("playwright-cdp");
		expectContinuation(envelope, "change_adapter_input");
	});
});

describe("default adapter command runtime", () => {
	test("returns timeout result without waiting for child completion", async () => {
		const startedAt = Date.now();
		const result = await runCommand({
			command: process.execPath,
			args: ["-e", "setTimeout(() => {}, 10000);"],
			timeoutMs: 25,
		});

		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(Date.now() - startedAt).toBeLessThan(1000);
	});
});

describe("Warm Chrome composition", () => {
	test("Warm Chrome failure stops before adapter proof and preserves browser-entry handoff", async () => {
		let commandCount = 0;
		const result = await runForTest(
			[
				"check",
				"--adapter",
				"chrome-devtools",
				"--port",
				"9222",
				"--json",
				"--run-id",
				"adapter-run",
			],
			await testRuntime({
				fetchJson: async () => {
					throw new Error("remote debugging off");
				},
				runCommand: async () => {
					commandCount += 1;
					return okCommand("{}");
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.run_id).toBe("adapter-run");
		expect(envelope.error.code).toBe("endpoint_unreachable");
		expect(envelope.error.failure_domain).toBe("browser_entry_handoff");
		expectContinuation(envelope, "enable_remote_debugging");
		expect(commandCount).toBe(0);
	});
});

describe("chrome-devtools proof", () => {
	test("mcporter pinned to Warm Chrome passes and emits adapter continuation", async () => {
		const result = await runForTest(
			[
				"check",
				"--adapter",
				"chrome-devtools",
				"--port",
				"9222",
				"--json",
				"--run-id",
				"proof-ok",
			],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: [
								"chrome-devtools-mcp",
								"--browserUrl",
								"http://127.0.0.1:9222",
							],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(
							JSON.stringify({
								pages: [
									{
										id: "page-1",
										title: "Example",
										url: "https://example.com/?token=secret",
									},
								],
							}),
						),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.action).toBe("adapter_ready");
		expect(envelope.data.contract).toBe("browser-use.browser-adapter-proof");
		expect(envelope.data.adapter).toBe("chrome-devtools");
		expect(envelope.data.warm_chrome_run_id).toBe("proof-ok-warm-chrome");
		expect(envelope.data.page_count).toBe(1);
		expect(envelope.data.pages[0].url).toBe("https://example.com/");
		expect(envelope.data.diagnostics.selected_config_source).toBe("mcporter");
		expect(envelope.data.diagnostics.selected_binding.observed_port).toBe("9222");
		expect(actionIds(envelope)).toEqual(["use_verified_browser_adapter"]);
		expectContinuation(envelope, "use_verified_browser_adapter");
		expect(validateErrorEnvelopeForTest(envelope)).toEqual([
			"envelope.error missing",
		]);
	});

	test("JSON command override prefixes mcporter subcommands", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				env: {
					BROWSER_USE_MCPORTER_COMMAND_JSON: '["bunx","mcporter"]',
				},
				runCommand: commandRouter({
					"bunx mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"bunx mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(JSON.stringify({ pages: [] })),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expectContinuation(envelope, "use_verified_browser_adapter");
	});

	test("JSON command override supports runner flags", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				env: {
					BROWSER_USE_MCPORTER_COMMAND_JSON: '["npx","-y","mcporter"]',
				},
				runCommand: commandRouter({
					"npx -y mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"npx -y mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(JSON.stringify({ pages: [] })),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expectContinuation(envelope, "use_verified_browser_adapter");
	});

	for (const [label, override] of [
		["invalid JSON", "{"],
		["shell string", "npx -y mcporter"],
		["empty array", "[]"],
		["non-string entry", '["npx",7,"mcporter"]'],
		["blank string entry", '["npx"," ","mcporter"]'],
	]) {
		test(`invalid command override rejects ${label}`, async () => {
			let commandCount = 0;
			const result = await runForTest(
				["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
				await testRuntime({
					env: { BROWSER_USE_MCPORTER_COMMAND_JSON: override },
					runCommand: async () => {
						commandCount += 1;
						return okCommand("{}");
					},
				}),
			);
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode).toBe(20);
			expect(commandCount).toBe(0);
			expect(envelope.error.code).toBe("adapter_command_override_invalid");
			expect(envelope.error.recoverability).toBe("repair_state");
			expect(envelope.error.retryable).toBe(false);
			expect(envelope.error.hint.action).toBe("repair_state");
			expect(envelope.error.hint.summary).toContain(
				"BROWSER_USE_MCPORTER_COMMAND_JSON",
			);
			expect(envelope.error.hint.summary).toContain(
				'["bunx","mcporter"]',
			);
			expect(envelope.error.hint.summary).toContain(
				"does not auto-try package runners",
			);
			expectContinuation(envelope, "configure_adapter_dependency");
			expectNoAdapterFallback(envelope);
		});
	}

	test("plain status projects check result and names same continuation action", async () => {
		const result = await runForTest(
			["status", "--adapter", "chrome-devtools", "--port", "9222", "--run-id", "plain"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(JSON.stringify([])),
				}),
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("adapter_ready");
		expect(result.stdout).toContain("action=use_verified_browser_adapter");
		expect(result.stdout).toContain("warm_chrome_run_id=plain-warm-chrome");
	});

	test("parses MCP content text page list output", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(
							JSON.stringify({
								content: [
									{
										type: "text",
										text: "## Pages\n1: https://example.com/ [selected]",
									},
								],
							}),
						),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.page_count).toBe(1);
		expect(envelope.data.pages[0]).toEqual({
			id: "1",
			url: "https://example.com/",
		});
		expect(envelope.data.diagnostics.warnings).toEqual([]);
	});

	test("mcporter pinned to localhost Warm Chrome passes", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://localhost:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(JSON.stringify({ pages: [] })),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.diagnostics.selected_binding).toMatchObject({
			status: "matches_verified_endpoint",
			endpoint_host: "localhost",
			observed_port: "9222",
		});
	});

	for (const endpoint of ["http://192.168.0.2:9222", "http://0.0.0.0:9222"]) {
		test(`mcporter pinned to non-loopback endpoint ${endpoint} fails`, async () => {
			const result = await runForTest(
				["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
				await testRuntime({
					runCommand: commandRouter({
						"mcporter config get chrome-devtools --json": okCommand(
							JSON.stringify({
								args: ["chrome-devtools-mcp", `--browserUrl=${endpoint}`],
							}),
						),
					}),
				}),
			);
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode).toBe(20);
			expect(envelope.error.code).toBe("adapter_binding_mismatch");
			expect(envelope.error.failure_domain).toBe("browser_adapter_proof");
			expectContinuation(envelope, "update_adapter_config");
			expectNoAdapterFallback(envelope);
			expect(validateErrorEnvelopeForTest(envelope)).toEqual([]);
		});
	}

	test("mcporter pinned to stale port fails with update_adapter_config", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: [
								"chrome-devtools-mcp",
								"--browserUrl",
								"http://127.0.0.1:9223",
							],
						}),
					),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_config_stale");
		expect(envelope.error.failure_domain).toBe("browser_adapter_proof");
		expect(envelope.error.message).toContain("9223");
		expect(result.stderr).toContain("\"observed_port\":\"9223\"");
		expect(result.stderr).toContain("\"source_label\":\"mcporter\"");
		expectContinuation(envelope, "update_adapter_config");
		expectNoAdapterFallback(envelope);
		expect(validateErrorEnvelopeForTest(envelope)).toEqual([]);
	});

	test("healthy mcporter plus stale native MCP emits warning only", async () => {
		const home = await makeDir();
		const cwd = await makeDir();
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					"chrome-devtools": {
						args: [
							"chrome-devtools-mcp",
							"--browserUrl",
							"http://127.0.0.1:9223",
						],
					},
				},
			}),
		);
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				home,
				cwd,
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(JSON.stringify({ pages: [] })),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);
		const warnings = envelope.data.diagnostics.warnings;

		expect(result.exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(warnings).toContainEqual(
			expect.objectContaining({
				code: "adapter_config_stale",
				severity: "warning",
				source_label: "repo_mcp",
				observed_port: "9223",
			}),
		);
		expect(actionIds(envelope)).toEqual(["use_verified_browser_adapter"]);
	});

	test("healthy mcporter ignores stale URL in unrelated native MCP server", async () => {
		const cwd = await makeDir();
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					"not-chrome-devtools": {
						args: [
							"some-other-mcp",
							"--browserUrl",
							"http://127.0.0.1:9223",
						],
					},
				},
			}),
		);
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				cwd,
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(JSON.stringify({ pages: [] })),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.diagnostics.warnings).not.toContainEqual(
			expect.objectContaining({
				code: "adapter_config_stale",
				source_label: "repo_mcp",
				observed_port: "9223",
			}),
		);
	});

	test("missing mcporter ignores stale URL in unrelated native MCP server", async () => {
		const cwd = await makeDir();
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					"not-chrome-devtools": {
						args: [
							"some-other-mcp",
							"--browserUrl",
							"http://127.0.0.1:9223",
						],
					},
				},
			}),
		);
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				cwd,
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": {
						exitCode: 1,
						stdout: "",
						stderr: "no config",
					},
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_config_missing");
		expect(envelope.error.message).not.toContain("9223");
		expectContinuation(envelope, "update_adapter_config");
		expectNoAdapterFallback(envelope);
	});

	test("native TOML parser ignores stale URL outside chrome-devtools section", async () => {
		const cwd = await makeDir();
		await mkdir(join(cwd, ".codex"), { recursive: true });
		await writeFile(
			join(cwd, ".codex", "config.toml"),
			[
				"[mcp_servers.not-chrome-devtools]",
				'args = ["some-other-mcp", "--browserUrl", "http://127.0.0.1:9223"]',
				"",
				"[mcp_servers.chrome-devtools]",
				'args = ["chrome-devtools-mcp", "--browserUrl", "http://127.0.0.1:9222"]',
			].join("\n"),
		);
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				cwd,
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json":
						okCommand(JSON.stringify({ pages: [] })),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.diagnostics.config_sources).toContainEqual(
			expect.objectContaining({
				source_label: "native_mcp_codex",
				scope: "project",
				binding: expect.objectContaining({
					status: "matches_verified_endpoint",
					observed_port: "9222",
				}),
			}),
		);
		expect(envelope.data.diagnostics.warnings).not.toContainEqual(
			expect.objectContaining({
				code: "adapter_config_stale",
				source_label: "native_mcp_codex",
				observed_port: "9223",
			}),
		);
	});

	for (const endpoint of [
		"https://127.0.0.1:9222",
		"http://192.168.0.2:9222",
	]) {
		test(`missing mcporter reports TOML chrome-devtools unsafe endpoint ${endpoint} as mismatch`, async () => {
			const cwd = await makeDir();
			await mkdir(join(cwd, ".codex"), { recursive: true });
			await writeFile(
				join(cwd, ".codex", "config.toml"),
				[
					"[mcp_servers.chrome-devtools]",
					`args = ["chrome-devtools-mcp", "--browserUrl", "${endpoint}"]`,
				].join("\n"),
			);
			const result = await runForTest(
				["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
				await testRuntime({
					cwd,
					runCommand: commandRouter({
						"mcporter config get chrome-devtools --json": {
							exitCode: 1,
							stdout: "",
							stderr: "no config",
						},
					}),
				}),
			);
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode).toBe(20);
			expect(envelope.error.code).toBe("adapter_binding_mismatch");
			expect(envelope.error.failure_domain).toBe("browser_adapter_proof");
			expectContinuation(envelope, "update_adapter_config");
			expectNoAdapterFallback(envelope);
		});
	}

	test("selected dependency failure outranks stale native MCP config", async () => {
		const cwd = await makeDir();
		await writeFile(
			join(cwd, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					"chrome-devtools": {
						args: [
							"chrome-devtools-mcp",
							"--browserUrl",
							"http://127.0.0.1:9223",
						],
					},
				},
			}),
		);
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				cwd,
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": {
						exitCode: 127,
						stdout: "",
						stderr: "mcporter: command not found",
					},
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_dependency_missing");
		expect(envelope.error.recoverability).toBe("repair_state");
		expect(envelope.error.retryable).toBe(false);
		expect(envelope.error.hint.action).toBe("repair_state");
		expect(envelope.error.hint.summary).toContain("Expose mcporter on PATH");
		expect(envelope.error.hint.summary).toContain(
			"BROWSER_USE_MCPORTER_COMMAND_JSON",
		);
		expect(envelope.error.hint.summary).toContain(
			"does not auto-try package runners",
		);
		expect(result.stderr).toContain("\"source_label\":\"mcporter\"");
		expect(result.stderr).not.toContain("\"observed_port\":\"9223\"");
		expectContinuation(envelope, "configure_adapter_dependency");
		expectNoAdapterFallback(envelope);
	});

	test("plain command-resolution failure names configure_adapter_dependency", async () => {
		const result = await runForTest(
			["status", "--adapter", "chrome-devtools", "--port", "9222", "--run-id", "plain-missing"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": {
						exitCode: 127,
						stdout: "",
						stderr: "mcporter: command not found",
					},
				}),
			}),
		);

		expect(result.exitCode).toBe(20);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("browser_adapter_proof adapter_dependency_missing");
		expect(result.stderr).toContain("action=configure_adapter_dependency");
		expect(result.stderr).toContain("(run_id=plain-missing)");
	});

	test("missing configured runner is dependency missing, not config missing", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				env: {
					BROWSER_USE_MCPORTER_COMMAND_JSON: '["bunx","mcporter"]',
				},
				runCommand: commandRouter({
					"bunx mcporter config get chrome-devtools --json": {
						exitCode: 127,
						stdout: "",
						stderr: "bunx: command not found",
					},
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_dependency_missing");
		expect(envelope.error.failure_domain).toBe("browser_adapter_proof");
		expect(envelope.error.recoverability).toBe("repair_state");
		expect(envelope.error.retryable).toBe(false);
		expect(envelope.error.hint.action).toBe("repair_state");
		expect(envelope.error.hint.summary).toContain(
			"the configured runner is missing",
		);
		expect(envelope.error.hint.summary).toContain(
			'["npx","-y","mcporter"]',
		);
		expectContinuation(envelope, "configure_adapter_dependency");
		expectNoAdapterFallback(envelope);
	});

	test("missing Chrome DevTools MCP during page proof is dependency missing", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json": {
						exitCode: 127,
						stdout: "",
						stderr: "chrome-devtools-mcp: command not found",
					},
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_dependency_missing");
		expect(envelope.error.message).toContain("Chrome DevTools MCP");
		expectContinuation(envelope, "configure_adapter_dependency");
		expectNoAdapterFallback(envelope);
	});

	test("mcporter config unparsable output is distinct from missing config", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						"not-json",
					),
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_output_unparsable");
		expect(envelope.error.failure_domain).toBe("browser_adapter_proof");
		expectContinuation(envelope, "inspect_adapter_config");
		expectNoAdapterFallback(envelope);
	});

	test("list_pages non-zero exit is distinct from timeout", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json": {
						exitCode: 1,
						stdout: "",
						stderr: "connection failed",
					},
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_command_failed");
		expect(envelope.error.failure_domain).toBe("browser_adapter_proof");
		expectContinuation(envelope, "inspect_adapter_config");
		expectNoAdapterFallback(envelope);
	});

	test("adapter timeout is blocking adapter proof failure", async () => {
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--port", "9222", "--json"],
			await testRuntime({
				runCommand: commandRouter({
					"mcporter config get chrome-devtools --json": okCommand(
						JSON.stringify({
							args: ["chrome-devtools-mcp", "--browserUrl=http://127.0.0.1:9222"],
						}),
					),
					"mcporter call chrome-devtools.list_pages --args {} --output json": {
						exitCode: 1,
						stdout: "",
						stderr: "",
						timedOut: true,
					},
				}),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("adapter_proof_timeout");
		expect(envelope.error.failure_domain).toBe("browser_adapter_proof");
		expectContinuation(envelope, "inspect_adapter_config");
		expectNoAdapterFallback(envelope);
	});
});

async function testRuntime(
	overrides: Partial<AdapterProofRuntime> & {
		profile?: string;
		home?: string;
		listenerCommand?: string;
	} = {},
): Promise<AdapterProofRuntime> {
	const home = overrides.home ?? (await makeDir());
	const profile = overrides.profile ?? (await makeProfile(0o700));
	const env = { HOME: home, BROWSER_USE_PROFILE_DIR: profile, ...overrides.env };
	const listenerCommand =
		overrides.listenerCommand ?? chromeCommand({ port: "9222", profile });
	return createDefaultAdapterProofRuntime({
		env,
		platform: "darwin",
		now: (() => {
			let now = 1_000;
			return () => {
				now += 17;
				return now;
			};
		})(),
		fetchJson:
			overrides.fetchJson ??
			(async (url) => {
				if (url.endsWith("/json/version")) return cdpVersion({ port: "9222" });
				if (url.endsWith("/json/list")) return [{ id: "page-1" }];
				throw new Error(`unexpected URL: ${url}`);
			}),
		findListener:
			overrides.findListener ??
			(async () => ({ pid: 12345, command: listenerCommand })),
		currentUser: overrides.currentUser ?? (async () => String(userInfo().uid)),
		statProfile:
			overrides.statProfile ??
			(async (path) => {
				const realPath = await realpath(path);
				const info = await stat(realPath);
				if (!info.isDirectory()) throw new Error("not a directory");
				return {
					realPath,
					mode: (info.mode & 0o777).toString(8),
					owner: String(info.uid),
				};
			}),
		ensureProfileDir:
			overrides.ensureProfileDir ??
			(async (path) => {
				await mkdir(path, { recursive: true, mode: 0o700 });
				const real = await realpath(path);
				await chmod(real, 0o700);
				return real;
			}),
		chmod:
			overrides.chmod ??
			(async (path, mode) => {
				await chmod(path, mode);
			}),
		writeTextFile:
			overrides.writeTextFile ??
			(async (path, content) => {
				await writeFile(path, content, "utf-8");
			}),
		spawnChrome: overrides.spawnChrome ?? (async () => {}),
		sleep: overrides.sleep ?? (async () => {}),
		isTemporaryPath: overrides.isTemporaryPath ?? (() => false),
		cwd: overrides.cwd ?? (await makeDir()),
		readTextFile:
			overrides.readTextFile ??
			(async (path) => {
				return readFile(path, "utf-8");
			}),
		runCommand:
			overrides.runCommand ??
			commandRouter({
				"mcporter config get chrome-devtools --json": okCommand(
					JSON.stringify({
						args: [
							"chrome-devtools-mcp",
							"--browserUrl",
							"http://127.0.0.1:9222",
						],
					}),
				),
				"mcporter call chrome-devtools.list_pages --args {} --output json":
					okCommand(JSON.stringify({ pages: [] })),
			}),
		});
	}

function commandRouter(
	responses: Record<string, AdapterCommandResult>,
): (input: AdapterCommandInput) => Promise<AdapterCommandResult> {
	return async (input) => {
		const key = [input.command, ...input.args].join(" ");
		const response = responses[key];
		if (!response) {
			throw new Error(`unexpected command: ${key}`);
		}
		return response;
	};
}

function okCommand(stdout: string): AdapterCommandResult {
	return { exitCode: 0, stdout, stderr: "" };
}

async function makeDir(): Promise<string> {
	const path = await mkdtemp(join(tmpdir(), "browser-adapter-proof-"));
	cleanupPaths.push(path);
	return path;
}

async function makeProfile(mode: number): Promise<string> {
	const path = await makeDir();
	await chmod(path, mode);
	return path;
}

function cdpVersion(input: { port: string }): Record<string, string> {
	return {
		Browser: "Chrome/136.0.0.0",
		"User-Agent": "Mozilla/5.0 Chrome/136.0.0.0",
		webSocketDebuggerUrl: `ws://127.0.0.1:${input.port}/devtools/browser/test-browser`,
	};
}

function chromeCommand(input: { port: string; profile: string }): string {
	return `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=${input.port} --user-data-dir=${input.profile} --no-first-run`;
}
