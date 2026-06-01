import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { warmChromePreflightContracts } from "./command-contract";
import {
	createDefaultRuntime,
	runForTest,
	validateErrorEnvelopeForTest,
	type PreflightRuntime,
} from "./preflight-warm-chrome";

const cleanupPaths: string[] = [];

afterEach(async () => {
	await Promise.all(
		cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("Warm Chrome command contract", () => {
	test("declares honest side effects for check, repair, and launch", () => {
		expect(warmChromePreflightContracts.check.sideEffects).toEqual([
			"check",
			"network",
		]);
		expect(warmChromePreflightContracts.repair.sideEffects).toContain("write");
		expect(warmChromePreflightContracts.launch.sideEffects).toContain("browser");
		expect(warmChromePreflightContracts.status.alias).toEqual({
			command: "check",
			defaultArgs: ["--plain"],
		});
	});

	test("uses one result contract id and schema for every command", () => {
		const contracts = Object.values(warmChromePreflightContracts);

		expect(
			contracts.every(
				(contract) =>
					contract.resultContract?.id === "browser-use.warm-chrome-preflight" &&
					contract.resultContract.schema_version === "1",
			),
		).toBe(true);
	});

	test("keeps check and status read-only", () => {
		expect(warmChromePreflightContracts.check.sideEffects).not.toContain("write");
		expect(warmChromePreflightContracts.check.sideEffects).not.toContain("browser");
		expect(warmChromePreflightContracts.status.sideEffects).not.toContain("write");
		expect(warmChromePreflightContracts.status.sideEffects).not.toContain("browser");
	});

	test("declares json and plain output for every command", () => {
		for (const contract of Object.values(warmChromePreflightContracts)) {
			expect(contract.outputModes).toContain("json");
			expect(contract.outputModes).toContain("plain");
		}
	});

	test("keeps launch as the only browser-mutating command", () => {
		expect(warmChromePreflightContracts.launch.mutation).toBe("browser");
		expect(warmChromePreflightContracts.launch.sideEffects).toContain("browser");
		expect(warmChromePreflightContracts.repair.mutation).toBe("write");
		expect(warmChromePreflightContracts.check.mutation).toBe("check");
		expect(warmChromePreflightContracts.status.mutation).toBe("check");
	});

	test("declares specific failure recovery affordances", () => {
		const failureIds =
			warmChromePreflightContracts.check.actionAffordances?.failure.map(
				(action) => action.id,
			) ?? [];

		expect(failureIds).toContain("needs_browser_entry");
		expect(failureIds).toContain("launch_warm_chrome");
		expect(failureIds).toContain("repair_profile");
		expect(failureIds).toContain("inspect_listener");
		expect(failureIds).toContain("inspect_diagnostics");
		expect(failureIds).toContain("change_input");
		expect(failureIds).toContain("do_not_fallback");
	});
});

describe("CLI front door", () => {
	test("prints root help without touching browser state", async () => {
		const result = await runForTest(["--help"], testRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: preflight-warm-chrome");
		expect(result.stdout).toContain("repair");
		expect(result.stderr).toBe("");
	});

	test("prints root help with -h without touching browser state", async () => {
		let touchedBrowser = false;
		const result = await runForTest(
			["-h"],
			testRuntime({
				fetchJson: async () => {
					touchedBrowser = true;
					return {};
				},
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: preflight-warm-chrome");
		expect(touchedBrowser).toBe(false);
	});

	test("prints version without touching browser state", async () => {
		const result = await runForTest(["--version"], testRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/^preflight-warm-chrome 0\.2\.0\n$/);
		expect(result.stderr).toBe("");
	});

	test("prints version before browser work even when endpoint would fail", async () => {
		let touchedBrowser = false;
		const result = await runForTest(
			["--version"],
			testRuntime({
				fetchJson: async () => {
					touchedBrowser = true;
					throw new Error("offline");
				},
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/^preflight-warm-chrome 0\.2\.0\n$/);
		expect(touchedBrowser).toBe(false);
	});

	test("shell wrapper passes through --version without browser work", async () => {
		const proc = Bun.spawn(
			["bash", join(import.meta.dir, "preflight-warm-chrome.sh"), "--version"],
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
		expect(stdout).toMatch(/^preflight-warm-chrome 0\.2\.0\n$/);
		expect(stderr).toBe("");
	});

	test("uses BROWSER_USE_RUN_ID when --run-id is absent", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				env: { BROWSER_USE_RUN_ID: "env-run", HOME: "/Users/tester" },
				profile,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.run_id).toBe("env-run");
	});

	test("lets --run-id override BROWSER_USE_RUN_ID", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			[
				"check",
				"--port",
				"9444",
				"--profile",
				profile,
				"--json",
				"--run-id",
				"arg-run",
			],
			testRuntime({
				env: { BROWSER_USE_RUN_ID: "env-run", HOME: "/Users/tester" },
				profile,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.run_id).toBe("arg-run");
	});

	test("prints command help without touching browser state", async () => {
		let touchedBrowser = false;
		const result = await runForTest(
			["help", "launch"],
			testRuntime({
				fetchJson: async () => {
					touchedBrowser = true;
					return {};
				},
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Launch real Google Chrome if needed");
		expect(touchedBrowser).toBe(false);
	});

	test("prints command help via --help after command", async () => {
		const result = await runForTest(["check", "--help"], testRuntime());

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Verify Warm Chrome without changing local state");
		expect(result.stderr).toBe("");
	});
});

describe("check", () => {
	test("returns facade-shaped JSON when the endpoint is missing", async () => {
		const result = await runForTest(
			["check", "--port", "9", "--json", "--run-id", "missing-endpoint"],
			testRuntime({
				fetchJson: async () => {
					throw new Error("offline");
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.status).toBe("error");
		expect(envelope.run_id).toBe("missing-endpoint");
		expect(envelope.error.code).toBe("endpoint_unreachable");
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toEqual([
			"needs_browser_entry",
			"launch_warm_chrome",
			"do_not_fallback",
		]);
		expect(validateErrorEnvelopeForTest(envelope)).toEqual([]);
	});

	test("fails non-loopback endpoints before network access", async () => {
		let fetched = false;
		const result = await runForTest(
			["check", "--endpoint", "http://192.168.1.5:9223", "--json"],
			testRuntime({
				fetchJson: async () => {
					fetched = true;
					return {};
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("non_loopback_endpoint");
		expect(fetched).toBe(false);
	});

	test("emits a browser_ready proof for a healthy real Chrome listener", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.action).toBe("browser_ready");
		expect(envelope.data.profile_permissions).toBe("700");
		expect(envelope.data.repair_actions).toEqual([]);
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toContain(
			"use_verified_endpoint",
		);
	});

	test("plain success writes stable human output", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--plain", "--run-id", "plain-ok"],
			testRuntime({ profile }),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("browser_ready command=check");
		expect(result.stdout).toContain("run_id=plain-ok");
		expect(result.stdout).toContain("duration_ms=");
		expect(result.stderr).toBe("");
	});

	test("json success includes contract and schema", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.contract).toBe("browser-use.warm-chrome-preflight");
		expect(envelope.data.schema_version).toBe("1");
	});

	test("json success returns adapter recovery actions", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toEqual([
			"use_verified_endpoint",
			"rerun_preflight_before_adapter_action",
		]);
	});

	test("fails when the supplied profile does not match the listener", async () => {
		const profile = await makeProfile(0o700);
		const otherProfile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", otherProfile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("profile_mismatch");
	});

	test("treats a missing supplied profile as input to correct", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", join(profile, "missing"), "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);
		const actions = envelope.runtime_actions.map((action: { id: string }) => action.id);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("profile_missing");
		expect(envelope.error.hint.action).toBe("change_input");
		expect(actions).toContain("change_input");
		expect(actions).not.toContain("launch_warm_chrome");
	});

	test("does not chmod or write DevToolsActivePort", async () => {
		const profile = await makeProfile(0o755);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("unsafe_profile_permissions");
		expect(await fileMode(profile)).toBe("755");
		await expect(readFile(join(profile, "DevToolsActivePort"), "utf-8")).rejects.toThrow();
	});

	test("rejects Chrome for Testing", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand:
					"/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --remote-debugging-port=9444 --user-data-dir=/tmp/profile",
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("chrome_for_testing");
	});

	test("rejects the everyday default Chrome profile", async () => {
		const home = await makeDir();
		const defaultRoot = join(home, "Library/Application Support/Google/Chrome");
		const profile = join(defaultRoot, "Profile 1");
		await mkdir(profile, { recursive: true, mode: 0o700 });
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({ home, profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("default_profile");
	});

	test("uses BROWSER_USE_CDP_PORT and BROWSER_USE_PROFILE_DIR defaults", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--json"],
			testRuntime({
				env: {
					BROWSER_USE_CDP_PORT: "9555",
					BROWSER_USE_PROFILE_DIR: profile,
				},
				listenerCommand: chromeCommand({ port: "9555", profile }),
				fetchJson: async (url) => cdpJsonForPort(url, "9555"),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.port).toBe("9555");
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("explicit port overrides BROWSER_USE_CDP_PORT", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				env: { BROWSER_USE_CDP_PORT: "9555" },
				profile,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.port).toBe("9444");
	});

	test("explicit profile overrides BROWSER_USE_PROFILE_DIR", async () => {
		const envProfile = await makeProfile(0o700);
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				env: { BROWSER_USE_PROFILE_DIR: envProfile },
				profile,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("accepts equals-form port and profile flags", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port=9444", `--profile=${profile}`, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("accepts equals-form endpoint flags", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--endpoint=http://127.0.0.1:9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.endpoint).toBe("http://127.0.0.1:9444");
	});

	test("accepts localhost loopback endpoints", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			[
				"check",
				"--endpoint",
				"http://localhost:9444",
				"--profile",
				profile,
				"--json",
			],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.endpoint).toBe("http://localhost:9444");
	});

	test("handles quoted profile paths with spaces in the Chrome command", async () => {
		const parent = await makeDir();
		const profile = join(parent, "profile with spaces");
		await mkdir(profile, { recursive: true, mode: 0o700 });
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				listenerCommand: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9444 --user-data-dir="${profile}" --no-first-run`,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("handles separate --user-data-dir arguments in the Chrome command", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				listenerCommand: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port 9444 --user-data-dir ${profile} --no-first-run`,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("expands tilde in supplied profile paths", async () => {
		const home = await makeDir();
		const profile = join(home, ".agent-warm-profile");
		await mkdir(profile, { recursive: true, mode: 0o700 });
		const result = await runForTest(
			["check", "--port", "9444", "--profile", "~/.agent-warm-profile", "--json"],
			testRuntime({
				home,
				profile,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("accepts a symlinked supplied profile when it resolves to listener profile", async () => {
		const profile = await makeProfile(0o700);
		const link = join(await makeDir(), "profile-link");
		await symlink(profile, link);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", link, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("fails when a port is occupied by a non-Chrome listener", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand: "/usr/bin/python3 -m http.server 9444",
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("rejects non-Chrome listeners that mention Chrome in arguments", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand:
					"/usr/bin/python3 -m fake --path /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9444 --user-data-dir=/Users/tester/.agent-warm-profile",
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("does not reject real Chrome when profile path looks like an automation bundle", async () => {
		const parent = await makeDir();
		const profile = join(parent, "chrome-mac", "Chromium.app", "warm-profile");
		await mkdir(profile, { recursive: true, mode: 0o700 });
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				listenerCommand: chromeCommand({ port: "9444", profile }),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("rejects Chromium listeners", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand:
					"/Applications/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9444 --user-data-dir=/Users/tester/.agent-warm-profile",
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("chrome_for_testing");
	});

	test("rejects chrome-mac automation bundles", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand:
					"/tmp/chrome-mac/Chromium.app/Contents/MacOS/Chromium --remote-debugging-port=9444 --user-data-dir=/Users/tester/.agent-warm-profile",
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("chrome_for_testing");
	});

	test("fails when the listener command uses a different debug port", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				listenerCommand: chromeCommand({ port: "9333", profile }),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("port_mismatch");
	});

	test("fails when CDP answers but no local listener can be inspected", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				findListener: async () => null,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("listener_missing");
	});

	test("fails when CDP version is not an object", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) return [];
					return [];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("invalid_cdp_version");
	});

	test("fails when CDP version misses required fields", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return {
							Browser: "Chrome/136.0.0.0",
							webSocketDebuggerUrl:
								"ws://127.0.0.1:9444/devtools/browser/test-browser",
						};
					}
					return [];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("invalid_cdp_version");
	});

	test("rejects websocket discovery on a non-loopback host", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl:
								"ws://192.168.1.5:9444/devtools/browser/test-browser",
						});
					}
					return [];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("non_loopback_websocket");
	});

	test("rejects websocket discovery on the wrong port", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl:
								"ws://127.0.0.1:9333/devtools/browser/test-browser",
						});
					}
					return [];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("non_loopback_websocket");
	});

	test("accepts websocket discovery on localhost loopback", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl:
								"ws://localhost:9444/devtools/browser/test-browser",
						});
					}
					return [{ id: "page-1" }];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.web_socket_debugger_url).toBe(
			"ws://localhost:9444/devtools/browser/test-browser",
		);
	});

	test("rejects malformed websocket discovery URLs", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl: "not a websocket url",
						});
					}
					return [];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("invalid_cdp_version");
	});

	test("rejects non-websocket discovery protocols", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl:
								"http://127.0.0.1:9444/devtools/browser/test-browser",
						});
					}
					return [];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("non_loopback_websocket");
	});

	test("rejects non-browser websocket discovery paths", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl:
								"ws://127.0.0.1:9444/devtools/page/test-page",
						});
					}
					return [{ id: "page-1" }];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("invalid_cdp_version");
	});

	test("fails when Chrome was launched without a dedicated user data dir", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand:
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9444 --no-first-run",
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("missing_profile");
	});

	test("treats present but empty --user-data-dir values as missing profile", async () => {
		const scenarios = [
			{
				name: "empty equals form",
				listenerCommand:
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9444 --user-data-dir= --no-first-run",
			},
			{
				name: "separate flag without value",
				listenerCommand:
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9444 --user-data-dir --no-first-run",
			},
		];

		for (const scenario of scenarios) {
			const result = await runForTest(
				["check", "--port", "9444", "--json"],
				testRuntime({
					listenerCommand: scenario.listenerCommand,
				}),
			);
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode, scenario.name).toBe(20);
			expect(envelope.error.code, scenario.name).toBe("missing_profile");
		}
	});

	test("handles quoted --user-data-dir paths containing argument-looking text", async () => {
		const parent = await makeDir();
		const profile = join(parent, "profile -- with marker");
		await mkdir(profile, { recursive: true, mode: 0o700 });
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				listenerCommand: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9444 --user-data-dir="${profile}" --no-first-run`,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
	});

	test("rejects the everyday default Chrome profile root", async () => {
		const home = await makeDir();
		const profile = join(home, "Library/Application Support/Google/Chrome");
		await mkdir(profile, { recursive: true, mode: 0o700 });
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				home,
				profile,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("default_profile");
	});

	test("rejects a listener profile symlinked into the everyday default profile", async () => {
		const home = await makeDir();
		const defaultRoot = join(home, "Library/Application Support/Google/Chrome");
		const realProfile = join(defaultRoot, "Profile 1");
		await mkdir(realProfile, { recursive: true, mode: 0o700 });
		const linkRoot = join(await makeDir(), "default-profile-link");
		await symlink(defaultRoot, linkRoot);
		const profile = join(linkRoot, "Profile 1");
		let chmodCount = 0;
		let writeCount = 0;
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				home,
				profile,
				chmod: async () => {
					chmodCount += 1;
				},
				writeTextFile: async () => {
					writeCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("default_profile");
		expect(chmodCount).toBe(0);
		expect(writeCount).toBe(0);
	});

	test("fails when inferred listener profile is missing", async () => {
		const parent = await makeDir();
		const profile = join(parent, "missing-profile");
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand: chromeCommand({ port: "9444", profile }),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("profile_missing");
	});

	test("returns zero target count when target list is not an array", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) return cdpVersion({ port: "9444" });
					if (url.endsWith("/json/list")) return { not: "an array" };
					throw new Error(`unexpected URL: ${url}`);
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.target_count).toBe(0);
	});

	test("returns zero target count when target list fetch fails", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) return cdpVersion({ port: "9444" });
					throw new Error("target list offline");
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.target_count).toBe(0);
	});

	test("returns profile_missing when supplied profile is a file", async () => {
		const profile = await makeFile();
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				listenerCommand: chromeCommand({ port: "9444", profile }),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("profile_missing");
	});

	test("rejects throwaway profile locations", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				isTemporaryPath: () => true,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("throwaway_profile");
	});
});

describe("observability", () => {
	test("keeps JSON success stdout as one envelope and default stderr quiet", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout).status).toBe("ok");
		expect(result.stderr).toBe("");
	});

	test("emits LogTape JSONL diagnostics on debug success", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			[
				"check",
				"--port",
				"9444",
				"--profile",
				profile,
				"--json",
				"--debug",
				"--run-id",
				"debug-success",
			],
			testRuntime({ profile }),
		);
		const diagnostics = parseJsonObjects(result.stderr);
		const events = diagnostics.map((entry) => entry.event);

		expect(result.exitCode).toBe(0);
		expect(events).toContain("command-start");
		expect(events).toContain("preflight-check");
		expect(events).toContain("preflight-ready");
		expect(diagnostics.every((entry) => entry.run_id === "debug-success")).toBe(true);
		expect(diagnostics.find((entry) => entry.event === "preflight-check")).toMatchObject({
			category: ["browser-use.warm-chrome"],
			endpoint_host: "127.0.0.1",
			phase: "verify",
			port: "9444",
			profile: "provided",
		});
		expect(result.stderr).not.toContain(profile);
		expect(result.stderr).not.toContain("devtools/browser");
		expect(result.stderr).not.toContain("Google Chrome.app");
	});

	test("flushes buffered diagnostics on JSON error", async () => {
		const result = await runForTest(
			["check", "--port", "9", "--json", "--run-id", "error-flush"],
			testRuntime({
				fetchJson: async () => {
					throw new Error("offline");
				},
			}),
		);
		const diagnostics = parseJsonObjects(result.stderr);
		const events = diagnostics.map((entry) => entry.event);

		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout).error.code).toBe("endpoint_unreachable");
		expect(events).toContain("command-start");
		expect(events).toContain("preflight-check");
		expect(events).toContain("endpoint_unreachable");
		expect(diagnostics.every((entry) => entry.run_id === "error-flush")).toBe(true);
		expect(result.stderr).not.toContain("/Users/");
		expect(result.stderr).not.toContain("devtools/browser");
	});

	test("default error diagnostics redact listener command and profile path", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json", "--run-id", "redact-error"],
			testRuntime({
				profile,
				listenerCommand: "/usr/bin/python3 -m http.server 9444",
			}),
		);

		expect(result.exitCode).toBe(20);
		expect(result.stderr).not.toContain(profile);
		expect(result.stderr).not.toContain("python3");
		expect(result.stderr).not.toContain("http.server");
	});

	test("suppresses diagnostics in quiet JSON mode while keeping stdout envelope", async () => {
		const result = await runForTest(
			["check", "--port", "9", "--json", "--quiet", "--run-id", "quiet-error"],
			testRuntime({
				fetchJson: async () => {
					throw new Error("offline");
				},
			}),
		);

		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout).run_id).toBe("quiet-error");
		expect(result.stderr).toBe("");
	});

	test("quiet wins over debug on success", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["check", "--port", "9444", "--profile", profile, "--json", "--debug", "--quiet"],
			testRuntime({ profile }),
		);

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout).status).toBe("ok");
		expect(result.stderr).toBe("");
	});

	test("debug repair diagnostics include action names without profile paths", async () => {
		const profile = await makeProfile(0o755);
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json", "--debug"],
			testRuntime({ profile }),
		);
		const diagnostics = parseJsonObjects(result.stderr);

		expect(result.exitCode).toBe(0);
		expect(diagnostics.map((entry) => entry.event)).toContain("repair-actions");
		expect(result.stderr).toContain("profile_permissions");
		expect(result.stderr).not.toContain(profile);
		expect(result.stderr).not.toContain("DevToolsActivePort");
	});

	test("debug launch diagnostics redact chrome binary and profile paths", async () => {
		const profile = await makeProfile(0o700);
		let endpointReady = false;
		const result = await runForTest(
			[
				"launch",
				"--port",
				"9444",
				"--profile",
				profile,
				"--chrome",
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				"--json",
				"--debug",
			],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version") && !endpointReady) {
						throw new Error("offline");
					}
					return cdpJsonForPort(url, "9444");
				},
				spawnChrome: async () => {
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile),
			}),
		);
		const diagnostics = parseJsonObjects(result.stderr);

		expect(result.exitCode).toBe(0);
		expect(diagnostics.map((entry) => entry.event)).toContain("launch-started");
		expect(result.stderr).not.toContain(profile);
		expect(result.stderr).not.toContain("Google Chrome Beta");
	});
});

describe("repair", () => {
	test("repairs owner-only mode and rewrites DevToolsActivePort", async () => {
		const profile = await makeProfile(0o755);
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.repair_actions).toEqual([
			"profile_permissions",
			"devtools_active_port",
		]);
		expect(await fileMode(profile)).toBe("700");
		await expect(readFile(join(profile, "DevToolsActivePort"), "utf-8")).resolves.toBe(
			"9444\n/devtools/browser/test-browser\n",
		);
	});

	test("safe profile repair only rewrites DevToolsActivePort", async () => {
		const profile = await makeProfile(0o700);
		let chmodCount = 0;
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				chmod: async () => {
					chmodCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(chmodCount).toBe(0);
		expect(envelope.data.repair_actions).toEqual(["devtools_active_port"]);
	});

	test("uses BROWSER_USE_PROFILE_DIR for repair when profile flag is absent", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["repair", "--port", "9444", "--json"],
			testRuntime({
				env: { BROWSER_USE_PROFILE_DIR: profile },
				profile,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.profile_dir).toBe(await realpath(profile));
		expect(envelope.data.repair_actions).toEqual(["devtools_active_port"]);
	});

	test("missing repair profile does not chmod or write", async () => {
		const parent = await makeDir();
		const profile = join(parent, "missing-profile");
		let chmodCount = 0;
		let writeCount = 0;
		const result = await runForTest(
			["repair", "--port", "9444", "--json"],
			testRuntime({
				listenerCommand: chromeCommand({ port: "9444", profile }),
				chmod: async () => {
					chmodCount += 1;
				},
				writeTextFile: async () => {
					writeCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("profile_missing");
		expect(chmodCount).toBe(0);
		expect(writeCount).toBe(0);
	});

	test("repair rejects a listener profile symlinked into the everyday default profile without writing", async () => {
		const home = await makeDir();
		const defaultRoot = join(home, "Library/Application Support/Google/Chrome");
		const realProfile = join(defaultRoot, "Profile 1");
		await mkdir(realProfile, { recursive: true, mode: 0o700 });
		const linkRoot = join(await makeDir(), "default-profile-link");
		await symlink(defaultRoot, linkRoot);
		const profile = join(linkRoot, "Profile 1");
		let chmodCount = 0;
		let writeCount = 0;
		const result = await runForTest(
			["repair", "--port", "9444", "--json"],
			testRuntime({
				home,
				profile,
				chmod: async () => {
					chmodCount += 1;
				},
				writeTextFile: async () => {
					writeCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("default_profile");
		expect(chmodCount).toBe(0);
		expect(writeCount).toBe(0);
	});

	test("chmod failure during repair surfaces runtime failure before writing", async () => {
		const profile = await makeProfile(0o755);
		let writeCount = 0;
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				chmod: async () => {
					throw new Error("chmod failed");
				},
				writeTextFile: async () => {
					writeCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(1);
		expect(envelope.error.code).toBe("runtime_failure");
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toEqual([
			"inspect_diagnostics",
		]);
		expect(writeCount).toBe(0);
	});

	test("DevToolsActivePort write failure during repair surfaces runtime failure", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				writeTextFile: async () => {
					throw new Error("write failed");
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(1);
		expect(envelope.error.code).toBe("runtime_failure");
	});

	test("refuses chmod when the current user does not own the profile", async () => {
		const profile = await makeProfile(0o755);
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				currentUser: async () => "999999",
			}),
		);
		const envelope = JSON.parse(result.stdout);
		const actions = envelope.runtime_actions.map((action: { id: string }) => action.id);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("unsafe_profile_permissions");
		expect(envelope.error.hint.action).toBe("change_input");
		expect(actions).toContain("change_input");
		expect(actions).not.toContain("repair_profile");
		expect(await fileMode(profile)).toBe("755");
		await expect(readFile(join(profile, "DevToolsActivePort"), "utf-8")).rejects.toThrow();
	});

	test("refuses DevToolsActivePort rewrite when the current user does not own a safe-mode profile", async () => {
		const profile = await makeProfile(0o700);
		let writeCount = 0;
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				currentUser: async () => "999999",
				writeTextFile: async () => {
					writeCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);
		const actions = envelope.runtime_actions.map((action: { id: string }) => action.id);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("unsafe_profile_permissions");
		expect(envelope.error.hint.action).toBe("change_input");
		expect(actions).toContain("change_input");
		expect(actions).not.toContain("repair_profile");
		expect(writeCount).toBe(0);
		await expect(readFile(join(profile, "DevToolsActivePort"), "utf-8")).rejects.toThrow();
	});

	test("refuses to rewrite DevToolsActivePort for a non-browser websocket path", async () => {
		const profile = await makeProfile(0o700);
		let writes = 0;
		const result = await runForTest(
			["repair", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl:
								"ws://127.0.0.1:9444/devtools/page/test-page",
						});
					}
					return [{ id: "page-1" }];
				},
				writeTextFile: async () => {
					writes += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.error.code).toBe("invalid_cdp_version");
		expect(writes).toBe(0);
	});
});

describe("launch", () => {
	test("starts real Chrome after a machine restart and verifies the new endpoint", async () => {
		const profile = await makeProfile(0o700);
		let endpointReady = false;
		let spawned: { port: string; profileDir: string } | undefined;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version") && !endpointReady) {
						throw new Error("offline after restart");
					}
					return cdpJsonForPort(url, "9444");
				},
				spawnChrome: async (input) => {
					spawned = {
						port: input.port,
						profileDir: input.profileDir,
					};
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(spawned).toEqual({ port: "9444", profileDir: await realpath(profile) });
		expect(envelope.data.launch_performed).toBe(true);
		expect(envelope.data.action).toBe("browser_ready");
	});

	test("creates a missing persistent profile before launching after restart", async () => {
		const parent = await makeDir();
		const profile = join(parent, "new-warm-profile");
		let endpointReady = false;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version") && !endpointReady) {
						throw new Error("offline");
					}
					return cdpJsonForPort(url, "9444");
				},
				spawnChrome: async () => {
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(await fileMode(profile)).toBe("700");
		expect(envelope.data.launch_performed).toBe(true);
	});

	test("uses BROWSER_USE_CDP_PORT when launching without explicit port", async () => {
		const profile = await makeProfile(0o700);
		let endpointReady = false;
		let launchedPort = "";
		const result = await runForTest(
			["launch", "--profile", profile, "--json"],
			testRuntime({
				env: { BROWSER_USE_CDP_PORT: "9555" },
				profile,
				listenerCommand: chromeCommand({ port: "9555", profile }),
				fetchJson: async (url) => {
					if (url.endsWith("/json/version") && !endpointReady) {
						throw new Error("offline");
					}
					return cdpJsonForPort(url, "9555");
				},
				spawnChrome: async (input) => {
					launchedPort = input.port;
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile, "9555"),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(launchedPort).toBe("9555");
		expect(envelope.data.port).toBe("9555");
	});

	test("explicit launch port overrides BROWSER_USE_CDP_PORT", async () => {
		const profile = await makeProfile(0o700);
		let endpointReady = false;
		let launchedPort = "";
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				env: { BROWSER_USE_CDP_PORT: "9555" },
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version") && !endpointReady) {
						throw new Error("offline");
					}
					return cdpJsonForPort(url, "9444");
				},
				spawnChrome: async (input) => {
					launchedPort = input.port;
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(launchedPort).toBe("9444");
		expect(envelope.data.port).toBe("9444");
	});

	test("launch accepts explicit loopback endpoint without separate port", async () => {
		const profile = await makeProfile(0o700);
		let endpointReady = false;
		const result = await runForTest(
			["launch", "--endpoint", "http://127.0.0.1:9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async (url) => {
					if (url.endsWith("/json/version") && !endpointReady) {
						throw new Error("offline");
					}
					return cdpJsonForPort(url, "9444");
				},
				spawnChrome: async () => {
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile),
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.data.endpoint).toBe("http://127.0.0.1:9444");
		expect(envelope.data.launch_performed).toBe(true);
	});

	test("launch rejects non-loopback endpoints before spawning", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--endpoint", "http://192.168.1.5:9444", "--profile", profile, "--json"],
			testRuntime({
				spawnChrome: async () => {
					spawnCount += 1;
				},
				findListener: async () => null,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("non_loopback_endpoint");
	});

	test("launch rejects default profile paths before creating them", async () => {
		const home = await makeDir();
		const profile = join(home, "Library/Application Support/Google/Chrome/Profile 1");
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				home,
				fetchJson: async () => {
					throw new Error("offline");
				},
				findListener: async () => null,
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("default_profile");
		await expect(stat(profile)).rejects.toThrow();
	});

	test("launch fails on file profile before spawning", async () => {
		const profile = await makeFile();
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				fetchJson: async () => {
					throw new Error("offline");
				},
				spawnChrome: async () => {
					spawnCount += 1;
				},
				findListener: async () => null,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(1);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("runtime_failure");
	});

	test("launch rejects Chrome for Testing before spawning", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			[
				"launch",
				"--port",
				"9444",
				"--profile",
				profile,
				"--chrome",
				"/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
				"--json",
			],
			testRuntime({
				profile,
				fetchJson: async () => {
					throw new Error("offline");
				},
				findListener: async () => null,
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("chrome_for_testing");
	});

	test("launch rejects non-stable Google Chrome before spawning", async () => {
		const profile = await makeProfile(0o700);
		const scenarios = [
			"/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
			"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
		];

		for (const chromeBin of scenarios) {
			let spawnCount = 0;
			const result = await runForTest(
				["launch", "--port", "9444", "--profile", profile, "--chrome", chromeBin, "--json"],
				testRuntime({
					profile,
					fetchJson: async () => {
						throw new Error("offline");
					},
					findListener: async () => null,
					spawnChrome: async () => {
						spawnCount += 1;
					},
				}),
			);
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode, chromeBin).toBe(20);
			expect(spawnCount, chromeBin).toBe(0);
			expect(envelope.error.code, chromeBin).toBe("not_real_google_chrome");
		}
	});

	test("launch rejects non-Google binaries before spawning", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--chrome", "/bin/echo", "--json"],
			testRuntime({
				profile,
				fetchJson: async () => {
					throw new Error("offline");
				},
				findListener: async () => null,
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("spawn failure during launch surfaces runtime failure", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async () => {
					throw new Error("offline");
				},
				spawnChrome: async () => {
					throw new Error("spawn failed");
				},
				findListener: async () => null,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(1);
		expect(envelope.error.code).toBe("runtime_failure");
	});

	test("default spawnChrome rejects missing binaries", async () => {
		const runtime = createDefaultRuntime();

		await expect(
			runtime.spawnChrome({
				chromeBin: join(await makeDir(), "missing-chrome"),
				port: "9444",
				profileDir: await makeProfile(0o700),
			}),
		).rejects.toThrow();
	});

	test("uses CHROME_BIN when launching after restart", async () => {
		const profile = await makeProfile(0o700);
		let endpointReady = false;
		let chromeBin = "";
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
				testRuntime({
					profile,
					env: {
						CHROME_BIN:
							"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					},
					fetchJson: async (url) => {
						if (url.endsWith("/json/version") && !endpointReady) {
							throw new Error("offline");
						}
					return cdpJsonForPort(url, "9444");
				},
				spawnChrome: async (input) => {
					chromeBin = input.chromeBin;
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile),
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(chromeBin).toBe(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		);
	});

	test("launch rejects unsafe CHROME_BIN before spawning after restart", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				env: {
					CHROME_BIN:
						"/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
				},
				fetchJson: async () => {
					throw new Error("offline");
				},
				findListener: async () => null,
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("lets --chrome override CHROME_BIN when launching", async () => {
		const profile = await makeProfile(0o700);
		let endpointReady = false;
		let chromeBin = "";
		const result = await runForTest(
			[
				"launch",
				"--port",
				"9444",
					"--profile",
					profile,
					"--chrome",
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					"--json",
				],
				testRuntime({
					profile,
					env: { CHROME_BIN: "/bad/env/chrome" },
				fetchJson: async (url) => {
					if (url.endsWith("/json/version") && !endpointReady) {
						throw new Error("offline");
					}
					return cdpJsonForPort(url, "9444");
				},
				spawnChrome: async (input) => {
					chromeBin = input.chromeBin;
					endpointReady = true;
				},
				findListener: listenerAfterLaunch(() => endpointReady, profile),
			}),
		);

		expect(result.exitCode).toBe(0);
		expect(chromeBin).toBe(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		);
	});

	test("refuses throwaway launch profile before spawning Chrome", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async () => {
					throw new Error("offline");
				},
				isTemporaryPath: () => true,
				spawnChrome: async () => {
					spawnCount += 1;
				},
				findListener: async () => null,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("throwaway_profile");
	});

	test("launch rejects a default-profile target through a symlinked parent before creating it", async () => {
		const home = await makeDir();
		const defaultRoot = join(home, "Library/Application Support/Google/Chrome");
		await mkdir(defaultRoot, { recursive: true, mode: 0o700 });
		const linkRoot = join(await makeDir(), "chrome-profile-link");
		await symlink(defaultRoot, linkRoot);
		const profile = join(linkRoot, "Profile 1");
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				home,
				fetchJson: async () => {
					throw new Error("offline");
				},
				findListener: async () => null,
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("default_profile");
		await expect(stat(profile)).rejects.toThrow();
	});

	test("does not spawn Chrome when the endpoint already validates", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(spawnCount).toBe(0);
		expect(envelope.data.launch_performed).toBe(false);
	});

	test("launch rejects unsafe --chrome even when the endpoint already validates", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			[
				"launch",
				"--port",
				"9444",
				"--profile",
				profile,
				"--chrome",
				"/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
				"--json",
			],
			testRuntime({
				profile,
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("launch rejects unsafe CHROME_BIN even when the endpoint already validates", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				env: {
					CHROME_BIN:
						"/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
				},
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("does not hide a port clash behind launch", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				listenerCommand: "/usr/bin/python3 -m http.server 9444",
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("does not spawn Chrome onto an occupied non-CDP port", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async () => {
					throw new Error("not cdp");
				},
				listenerCommand: "/usr/bin/python3 -m http.server 9444",
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("not_real_google_chrome");
	});

	test("occupied real Chrome without CDP routes to listener inspection", async () => {
		const profile = await makeProfile(0o700);
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async () => {
					throw new Error("not cdp");
				},
				listenerCommand: chromeCommand({ port: "9444", profile }),
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("endpoint_unreachable");
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toEqual([
			"needs_browser_entry",
			"inspect_listener",
			"do_not_fallback",
		]);
	});

	test("surfaces launch timeout when Chrome never exposes CDP", async () => {
		const profile = await makeProfile(0o700);
		let sleeps = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({
				profile,
				fetchJson: async () => {
					throw new Error("offline");
				},
				sleep: async () => {
					sleeps += 1;
				},
				findListener: async () => null,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(sleeps).toBe(30);
		expect(envelope.error.code).toBe("endpoint_unreachable");
	});
});

describe("status", () => {
	test("defaults to plain human health output", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["status", "--port", "9444", "--profile", profile],
			testRuntime({ profile }),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("browser_ready command=status");
		expect(result.stdout).toContain("port=9444");
		expect(result.stderr).toBe("");
	});

	test("can emit JSON when requested", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["status", "--port", "9444", "--profile", profile, "--json"],
			testRuntime({ profile }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.command).toBe("status");
		expect(result.stderr).toBe("");
	});

	test("failure defaults to plain human output", async () => {
		const result = await runForTest(
			["status", "--port", "9", "--run-id", "status-fail"],
			testRuntime({
				fetchJson: async () => {
					throw new Error("offline");
				},
			}),
		);

		expect(result.exitCode).toBe(20);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("needs_browser_entry endpoint_unreachable");
		expect(result.stderr).toContain("run_id=status-fail");
	});

	test("failure can emit a JSON envelope with browser-entry actions", async () => {
		const result = await runForTest(
			["status", "--port", "9", "--json", "--run-id", "status-json-fail"],
			testRuntime({
				fetchJson: async () => {
					throw new Error("offline");
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(20);
		expect(envelope.status).toBe("error");
		expect(envelope.run_id).toBe("status-json-fail");
		expect(envelope.error.code).toBe("endpoint_unreachable");
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toEqual([
			"needs_browser_entry",
			"launch_warm_chrome",
			"do_not_fallback",
		]);
		expect(result.stderr).not.toContain("needs_browser_entry endpoint_unreachable");
		expect(validateErrorEnvelopeForTest(envelope)).toEqual([]);
	});

	test("inspect-first failures align retry signals and lead with inspect action", async () => {
		// listener_missing: CDP answers but no local process owns the port.
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				findListener: async () => null,
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(envelope.error.code).toBe("listener_missing");
		// No contradictory retry signal: retryable is false and recoverability
		// is not "retry" (which would invite blind same-input rerun).
		expect(envelope.error.retryable).toBe(false);
		expect(envelope.error.recoverability).not.toBe("retry");
		// runtime_actions[0] is the browser-entry stop; the primary action that
		// follows is the safe inspect step, not a blind retry.
		expect(envelope.runtime_actions[1].id).toBe("inspect_listener");
	});

	test("invalid CDP websocket aligns retry signals", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({
				fetchJson: async (url) => {
					if (url.endsWith("/json/version")) {
						return cdpVersion({
							port: "9444",
							webSocketDebuggerUrl:
								"ws://127.0.0.1:9444/devtools/page/test-page",
						});
					}
					return [];
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(envelope.error.code).toBe("invalid_cdp_version");
		expect(envelope.error.retryable).toBe(false);
		expect(envelope.error.recoverability).not.toBe("retry");
	});

	test("plain output names the same primary action as the first JSON runtime action", async () => {
		const jsonResult = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({ findListener: async () => null }),
		);
		const plainResult = await runForTest(
			["check", "--port", "9444", "--plain"],
			testRuntime({ findListener: async () => null }),
		);
		const envelope = JSON.parse(jsonResult.stdout);
		const primary = envelope.runtime_actions[1].id;

		expect(plainResult.stderr).toContain(`action=${primary}`);
	});

	test("last output flag wins for status", async () => {
		const profile = await makeProfile(0o700);
		const result = await runForTest(
			["status", "--port", "9444", "--profile", profile, "--json", "--plain"],
			testRuntime({ profile }),
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("browser_ready command=status");
		expect(() => JSON.parse(result.stdout)).toThrow();
	});
});

describe("usage failures", () => {
	test("rejects unknown commands", async () => {
		const result = await runForTest(["doctor", "--json"], testRuntime());
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects unknown options", async () => {
		const result = await runForTest(["check", "--bogus", "--json"], testRuntime());
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects missing --port values", async () => {
		const result = await runForTest(["check", "--port", "--json"], testRuntime());
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects missing --profile values", async () => {
		const result = await runForTest(["check", "--profile", "--json"], testRuntime());
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects missing --endpoint values", async () => {
		const result = await runForTest(["check", "--endpoint", "--json"], testRuntime());
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects empty equals-form option values", async () => {
		const scenarios = [
			["check", "--port=", "--json"],
			["check", "--endpoint=", "--json"],
			["check", "--profile=", "--json"],
			["launch", "--profile", "/tmp/warm-profile", "--chrome=", "--json"],
		];

		for (const argv of scenarios) {
			const result = await runForTest(argv, testRuntime());
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode, argv.join(" ")).toBe(2);
			expect(envelope.error.code, argv.join(" ")).toBe("invalid_usage");
		}
	});

	test("rejects port zero before browser work", async () => {
		const result = await runForTest(["check", "--port", "0", "--json"], testRuntime());
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toEqual([
			"change_input",
		]);
	});

	test("rejects nonnumeric ports before browser work", async () => {
		const result = await runForTest(
			["check", "--port", "not-a-port", "--json"],
			testRuntime(),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects endpoints without an explicit port", async () => {
		const result = await runForTest(
			["check", "--endpoint", "http://127.0.0.1", "--json"],
			testRuntime(),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects non-http endpoints", async () => {
		const result = await runForTest(
			["check", "--endpoint", "https://127.0.0.1:9444", "--json"],
			testRuntime(),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects endpoint and port mismatch", async () => {
		const result = await runForTest(
			[
				"check",
				"--endpoint",
				"http://127.0.0.1:9444",
				"--port",
				"9555",
				"--json",
			],
			testRuntime(),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("usage errors respect last output flag before full parse", async () => {
		const result = await runForTest(
			["check", "--plain", "--json", "--quiet", "--port", "0"],
			testRuntime(),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
		expect(result.stderr).toBe("");
	});

	test("requires a profile before launch can spawn", async () => {
		let spawnCount = 0;
		const result = await runForTest(
			["launch", "--port", "9444", "--json"],
			testRuntime({
				spawnChrome: async () => {
					spawnCount += 1;
				},
			}),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(spawnCount).toBe(0);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("rejects --chrome outside launch", async () => {
		const result = await runForTest(
			["check", "--chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
			testRuntime(),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(envelope.error.code).toBe("invalid_usage");
	});

	test("redacts unsafe usage arguments in JSON errors", async () => {
		const scenarios = [
			["check", "/Users/tester/profile", "--json"],
			["check", "op://Vault/Item/field", "--json"],
			["check", "--password=abc", "--json"],
		];

		for (const argv of scenarios) {
			const result = await runForTest(argv, testRuntime());
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode, argv.join(" ")).toBe(2);
			expect(envelope.error.code, argv.join(" ")).toBe("invalid_usage");
			expect(result.stdout, argv.join(" ")).not.toContain("/Users/tester/profile");
			expect(result.stdout, argv.join(" ")).not.toContain("op://");
			expect(result.stdout, argv.join(" ")).not.toContain("password");
			expect(result.stdout, argv.join(" ")).not.toContain("abc");
		}
	});

	test("redacts unsafe usage arguments in plain errors", async () => {
		const result = await runForTest(
			["check", "/Users/tester/profile", "--plain"],
			testRuntime(),
		);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).not.toContain("/Users/tester/profile");
	});

	test("plain errors write the human line to stderr and no stdout envelope", async () => {
		const result = await runForTest(
			["check", "--port", "9", "--plain", "--run-id", "plain-error"],
			testRuntime({
				fetchJson: async () => {
					throw new Error("offline");
				},
			}),
		);

		expect(result.exitCode).toBe(20);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("needs_browser_entry endpoint_unreachable");
		expect(result.stderr).toContain("run_id=plain-error");
	});

	test("plain errors include the primary recovery action", async () => {
		const scenarios = [
			{
				name: "endpoint unreachable",
				argv: ["check", "--port", "9", "--plain"],
				runtime: testRuntime({
					fetchJson: async () => {
						throw new Error("offline");
					},
				}),
				expectedAction: "launch_warm_chrome",
			},
			{
				name: "listener missing",
				argv: ["check", "--port", "9444", "--plain"],
				runtime: testRuntime({
					findListener: async () => null,
				}),
				expectedAction: "inspect_listener",
			},
			{
				name: "invalid usage",
				argv: ["check", "--port", "0", "--plain"],
				runtime: testRuntime(),
				expectedAction: "change_input",
			},
		];

		for (const scenario of scenarios) {
			const result = await runForTest(scenario.argv, scenario.runtime);

			expect(result.exitCode, scenario.name).not.toBe(0);
			expect(result.stdout, scenario.name).toBe("");
			expect(result.stderr, scenario.name).toContain(
				`action=${scenario.expectedAction}`,
			);
		}
	});

	test("returns runtime failure on unsupported platforms", async () => {
		const result = await runForTest(
			["check", "--port", "9444", "--json"],
			testRuntime({ platform: "linux" }),
		);
		const envelope = JSON.parse(result.stdout);

		expect(result.exitCode).toBe(1);
		expect(envelope.error.code).toBe("unsupported_platform");
		expect(envelope.runtime_actions.map((action: { id: string }) => action.id)).toEqual([
			"inspect_diagnostics",
		]);
	});

	test("browser-entry failures include specific recovery hints", async () => {
		const profile = await makeProfile(0o700);
		const defaultProfile = join(
			profile,
			"Library/Application Support/Google/Chrome/Profile 1",
		);
		await mkdir(defaultProfile, { recursive: true, mode: 0o700 });
		const scenarios = [
			{
				name: "profile mismatch",
				expectedCode: "profile_mismatch",
				expectedAction: "change_input",
				expectedRuntimeAction: "change_input",
				argv: ["check", "--port", "9444", "--profile", await makeProfile(0o700), "--json"],
				runtime: testRuntime({ profile }),
			},
			{
				name: "Chrome for Testing",
				expectedCode: "chrome_for_testing",
				expectedAction: "repair_state",
				expectedRuntimeAction: "launch_warm_chrome",
				argv: ["check", "--port", "9444", "--json"],
				runtime: testRuntime({
					listenerCommand:
						"/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --remote-debugging-port=9444 --user-data-dir=/tmp/profile",
				}),
			},
			{
				name: "default profile",
				expectedCode: "default_profile",
				expectedAction: "change_input",
				expectedRuntimeAction: "change_input",
					argv: ["check", "--port", "9444", "--json"],
					runtime: testRuntime({
						home: profile,
						profile: defaultProfile,
					}),
				},
		];

		for (const scenario of scenarios) {
			const result = await runForTest(scenario.argv, scenario.runtime);
			const envelope = JSON.parse(result.stdout);

			expect(result.exitCode, scenario.name).toBe(20);
			expect(envelope.error.code, scenario.name).toBe(scenario.expectedCode);
			expect(envelope.error.hint.action, scenario.name).toBe(scenario.expectedAction);
			expect(
				envelope.runtime_actions.map((action: { id: string }) => action.id),
				scenario.name,
			).toContain(scenario.expectedRuntimeAction);
		}
	});
});

function testRuntime(
	overrides: {
		home?: string;
		platform?: NodeJS.Platform;
		profile?: string;
		listenerCommand?: string;
		env?: Record<string, string | undefined>;
		fetchJson?: PreflightRuntime["fetchJson"];
		findListener?: PreflightRuntime["findListener"];
		currentUser?: PreflightRuntime["currentUser"];
		chmod?: PreflightRuntime["chmod"];
		sleep?: PreflightRuntime["sleep"];
		spawnChrome?: PreflightRuntime["spawnChrome"];
		writeTextFile?: PreflightRuntime["writeTextFile"];
		isTemporaryPath?: PreflightRuntime["isTemporaryPath"];
	} = {},
): PreflightRuntime {
	const home = overrides.home ?? "/Users/tester";
	const profile = overrides.profile ?? "/Users/tester/.agent-warm-profile";
	return createDefaultRuntime({
		env: { HOME: home, ...overrides.env },
		platform: overrides.platform ?? "darwin",
		now: () => 1000,
		fetchJson:
			overrides.fetchJson ??
			(async (url: string) => cdpJsonForPort(url, "9444")),
		findListener:
			overrides.findListener ??
			(async () => ({
				pid: 12345,
				command:
					overrides.listenerCommand ??
					chromeCommand({ port: "9444", profile }),
			})),
			currentUser: overrides.currentUser ?? (async () => String(userInfo().uid)),
			chmod:
				overrides.chmod ??
				(async (path, mode) => {
					await chmod(path, mode);
				}),
			spawnChrome: overrides.spawnChrome ?? (async () => {}),
		writeTextFile:
			overrides.writeTextFile ??
			(async (path, content) => {
				await writeFile(path, content, "utf-8");
			}),
		isTemporaryPath: overrides.isTemporaryPath ?? (() => false),
		sleep: overrides.sleep ?? (async () => {}),
	});
}

function chromeCommand(input: { port: string; profile: string }): string {
	return `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=${input.port} --user-data-dir=${input.profile} --no-first-run`;
}

function listenerAfterLaunch(
	isReady: () => boolean,
	profile: string,
	port = "9444",
): PreflightRuntime["findListener"] {
	return async () =>
		isReady()
			? {
					pid: 12345,
					command: chromeCommand({ port, profile }),
				}
			: null;
}

function cdpVersion(input: {
	port: string;
	webSocketDebuggerUrl?: string;
}): Record<string, string> {
	return {
		Browser: "Chrome/136.0.0.0",
		"User-Agent": "Mozilla/5.0 Chrome/136.0.0.0",
		webSocketDebuggerUrl:
			input.webSocketDebuggerUrl ??
			`ws://127.0.0.1:${input.port}/devtools/browser/test-browser`,
	};
}

function cdpJsonForPort(url: string, port: string): unknown {
	if (url.endsWith("/json/version")) {
		return cdpVersion({ port });
	}
	if (url.endsWith("/json/list")) {
		return [{ id: "page-1" }];
	}
	throw new Error(`unexpected URL: ${url}`);
}

async function makeDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "warm-chrome."));
	cleanupPaths.push(dir);
	return dir;
}

async function makeProfile(mode: number): Promise<string> {
	const dir = await makeDir();
	await chmod(dir, mode);
	return dir;
}

async function makeFile(): Promise<string> {
	const dir = await makeDir();
	const path = join(dir, "profile-file");
	await writeFile(path, "not a directory", "utf-8");
	return path;
}

async function fileMode(path: string): Promise<string> {
	const info = await stat(path);
	return (info.mode & 0o777).toString(8);
}

function parseJsonObjects(text: string): Array<Record<string, unknown>> {
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}
