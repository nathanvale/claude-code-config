import Database from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { createDefaultProofDeps } from "../src/proof.ts";
import {
	DEFAULT_FETCH_ABORT_MS,
	chromeLaunchArgs,
	consumeProfileCreationApproval,
	createDefaultRuntime,
	createOneUseProfileCreationApprovalOwner,
	findListenerWithSystemTools,
	isDefaultChromeProfilePath,
	isRealGoogleChromeBinary,
	type KillableChild,
	parseProcessCommand,
	REAL_GOOGLE_CHROME_BINARY,
	terminateChild,
	WarmChromeRuntimeError,
} from "../src/runtime.ts";
import { WARM_CHROME_ATTACH_TIMEOUT_MS } from "../src/proof.ts";

async function withTemporaryProfile(
	run: (profileDir: string) => Promise<void>,
): Promise<void> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "warm-chrome-posture-")),
	);
	const profileDir = join(root, "Default");
	await mkdir(profileDir, { mode: 0o700 });
	try {
		await run(profileDir);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeCredentialPreferences(
	profileDir: string,
	overrides: Record<string, unknown> = {},
): Promise<void> {
	await writeFile(
		join(profileDir, "Preferences"),
		JSON.stringify({
			credentials_enable_service: false,
			credentials_enable_autosignin: false,
			profile: { password_manager_enabled: false },
			sync: { requested: false, has_setup_completed: false },
			...overrides,
		}),
		"utf8",
	);
}

function writeSlowLoginDatabase(path: string): void {
	const db = new Database(path);
	db.run(
		"CREATE VIEW logins AS WITH RECURSIVE cnt(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM cnt WHERE x < 5000000) SELECT x FROM cnt WHERE x = 5000000",
	);
	db.close();
}

describe("credential-clean profile runtime (U6 R8)", () => {
	test("production approval owner binds exact facts and permits one concurrent consumer", async () => {
		const expected = {
			command: "launch",
			port: "9243",
			profileDir: "/Users/warm/.agent-warm-profile-u6",
		} as const;
		const owner = createOneUseProfileCreationApprovalOwner(expected);

		const wrongProfile = await owner({
			...expected,
			profileDir: "/Users/warm/other-profile",
		});
		expect(
			consumeProfileCreationApproval(wrongProfile, {
				...expected,
				profileDir: "/Users/warm/other-profile",
			}),
		).toBe(false);

		const [first, second] = await Promise.all([owner(expected), owner(expected)]);
		expect(
			[
				consumeProfileCreationApproval(first, expected),
				consumeProfileCreationApproval(second, expected),
			].filter(Boolean),
		).toHaveLength(1);
		expect(
			consumeProfileCreationApproval(first, expected) ||
				consumeProfileCreationApproval(second, expected),
		).toBe(false);
	});

	test("public runtime never treats a caller-created terminal as human approval", async () => {
		const runtime = createDefaultRuntime();

		await expect(
			runtime.requestCredentialCleanProfileCreationApproval({
				command: "launch",
				port: "9243",
				profileDir: "/Users/warm/.agent-warm-profile-u6",
			}),
		).resolves.toBe("unavailable");
	});

	test("dedicated launch argv disables sync mechanically", () => {
		const argv = chromeLaunchArgs({
			chromeBin: REAL_GOOGLE_CHROME_BINARY,
			port: "9242",
			profileDir: "/Users/warm/.agent-warm-profile",
			startupUrl: "https://example.com/",
			disableSync: true,
			disableExtensions: true,
		});
		expect(argv).toContain("--disable-sync");
		expect(argv).toContain("--disable-extensions");
		expect(argv).toContain("--profile-directory=Default");
	});

	test("safe disk and process evidence remains configuration-only", async () => {
		await withTemporaryProfile(async (profileDir) => {
			await writeCredentialPreferences(profileDir);
			const runtime = createDefaultRuntime();

			await expect(
				runtime.inspectCredentialPosture({
					activeProfileDir: profileDir,
					syncDisabledByLaunch: true,
					extensionsDisabledByLaunch: true,
				}),
			).resolves.toEqual({
				disk: {
					saveSetting: "disabled",
					autoSignInSetting: "disabled",
					syncSetting: "disabled",
					storedLogin: "absent",
				},
				process: {
					disableSyncSwitch: "present",
					disableExtensionsSwitch: "present",
				},
				effective: {
					observation: "not-observed",
				},
			});
		});
	});

	test("missing or altered controls and sync evidence fail closed", async () => {
		await withTemporaryProfile(async (profileDir) => {
			const runtime = createDefaultRuntime();
			await writeCredentialPreferences(profileDir, {
				credentials_enable_service: true,
				credentials_enable_autosignin: true,
				sync: { requested: true, has_setup_completed: true },
			});
			const altered = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});
			expect(altered.disk.saveSetting).toBe("enabled");
			expect(altered.disk.autoSignInSetting).toBe("enabled");
			expect(altered.disk.syncSetting).toBe("enabled");

			await rm(join(profileDir, "Preferences"));
			const missing = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});
			expect(missing.disk.saveSetting).toBe("unproven");
			expect(missing.disk.autoSignInSetting).toBe("unproven");
			expect(missing.disk.syncSetting).toBe("unproven");
			expect(missing.effective).toEqual({ observation: "not-observed" });
		});
	});

	test("Login Data inspection reads existence only and detects a stored row", async () => {
		await withTemporaryProfile(async (profileDir) => {
			await writeCredentialPreferences(profileDir);
			const db = new Database(join(profileDir, "Login Data"));
			db.run("CREATE TABLE logins (id INTEGER PRIMARY KEY)");
			db.run("INSERT INTO logins (id) VALUES (1)");
			db.close();
			const runtime = createDefaultRuntime();

			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});

			expect(posture.disk.storedLogin).toBe("present");
			expect(posture.disk.autoSignInSetting).toBe("disabled");
		});
	});

	test("account-only Login Data detects a stored row", async () => {
		await withTemporaryProfile(async (profileDir) => {
			await writeCredentialPreferences(profileDir);
			const db = new Database(join(profileDir, "Login Data For Account"));
			db.run("CREATE TABLE logins (id INTEGER PRIMARY KEY)");
			db.run("INSERT INTO logins (id) VALUES (1)");
			db.close();
			const runtime = createDefaultRuntime();

			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});

			expect(posture.disk.storedLogin).toBe("present");
			expect(posture.disk.autoSignInSetting).toBe("disabled");
		});
	});

	test("an indeterminate existing account store fails closed", async () => {
		await withTemporaryProfile(async (profileDir) => {
			await writeCredentialPreferences(profileDir);
			const db = new Database(join(profileDir, "Login Data"));
			db.run("CREATE TABLE logins (id INTEGER PRIMARY KEY)");
			db.close();
			await writeFile(
				join(profileDir, "Login Data For Account"),
				"not a sqlite database",
				"utf8",
			);
			const runtime = createDefaultRuntime();

			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});

			expect(posture.disk.storedLogin).toBe("unproven");
			expect(posture.disk.autoSignInSetting).toBe("disabled");
		});
	});

	test("profile posture never follows Preferences or Login Data symlinks", async () => {
		await withTemporaryProfile(async (profileDir) => {
			const rawPreferences = join(profileDir, "raw-preferences");
			await writeFile(
				rawPreferences,
				JSON.stringify({
					credentials_enable_service: false,
					credentials_enable_autosignin: false,
				}),
				"utf8",
			);
			await symlink(rawPreferences, join(profileDir, "Preferences"));
			const rawLoginData = join(profileDir, "raw-login-data");
			const db = new Database(rawLoginData);
			db.run("CREATE TABLE logins (id INTEGER PRIMARY KEY)");
			db.close();
			await symlink(rawLoginData, join(profileDir, "Login Data"));
			const runtime = createDefaultRuntime();

			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});

			expect(posture.disk.saveSetting).toBe("unproven");
			expect(posture.disk.storedLogin).toBe("unproven");
			expect(posture.disk.autoSignInSetting).toBe("unproven");
		});
	});

	test("Login Data path replacement during inspection fails closed", async () => {
		await withTemporaryProfile(async (profileDir) => {
			await writeCredentialPreferences(profileDir);
			const loginDataPath = join(profileDir, "Login Data");
			const replacementPath = join(profileDir, "Login Data.replacement");
			writeSlowLoginDatabase(loginDataPath);
			const replacement = new Database(replacementPath);
			replacement.run("CREATE TABLE logins (id INTEGER PRIMARY KEY)");
			replacement.close();
			const swap = Bun.spawn(
				[
					process.execPath,
					"-e",
					'import { renameSync } from "node:fs"; await Bun.sleep(75); renameSync(process.argv[1], process.argv[1] + ".queried"); renameSync(process.argv[2], process.argv[1]);',
					loginDataPath,
					replacementPath,
				],
				{ stderr: "pipe", stdout: "ignore" },
			);
			const runtime = createDefaultRuntime();

			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});

			expect(await swap.exited).toBe(0);
			expect(posture.disk.storedLogin).toBe("unproven");
			expect(posture.disk.autoSignInSetting).toBe("disabled");
		});
	});

	test("Login Data disappearance during inspection fails closed", async () => {
		await withTemporaryProfile(async (profileDir) => {
			await writeCredentialPreferences(profileDir);
			const loginDataPath = join(profileDir, "Login Data");
			writeSlowLoginDatabase(loginDataPath);
			const removal = Bun.spawn(
				[
					process.execPath,
					"-e",
					'import { unlinkSync } from "node:fs"; await Bun.sleep(75); unlinkSync(process.argv[1]);',
					loginDataPath,
				],
				{ stderr: "pipe", stdout: "ignore" },
			);
			const runtime = createDefaultRuntime();

			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});

			expect(await removal.exited).toBe(0);
			expect(posture.disk.storedLogin).toBe("unproven");
			expect(posture.disk.autoSignInSetting).toBe("disabled");
		});
	});

	test("Login Data swap-away and restore during inspection still fails closed", async () => {
		await withTemporaryProfile(async (profileDir) => {
			await writeCredentialPreferences(profileDir);
			const loginDataPath = join(profileDir, "Login Data");
			const replacementPath = join(profileDir, "Login Data.replacement");
			writeSlowLoginDatabase(loginDataPath);
			const replacement = new Database(replacementPath);
			replacement.run("CREATE TABLE logins (id INTEGER PRIMARY KEY)");
			replacement.close();
			const swap = Bun.spawn(
				[
					process.execPath,
					"-e",
					'import { renameSync } from "node:fs"; await Bun.sleep(75); const parked = process.argv[1] + ".parked"; renameSync(process.argv[1], parked); renameSync(process.argv[2], process.argv[1]); await Bun.sleep(150); renameSync(process.argv[1], process.argv[2]); renameSync(parked, process.argv[1]);',
					loginDataPath,
					replacementPath,
				],
				{ stderr: "pipe", stdout: "ignore" },
			);
			const runtime = createDefaultRuntime();

			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir: profileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});
			await swap.exited;

			expect(posture.disk.storedLogin).toBe("unproven");
			expect(posture.disk.autoSignInSetting).toBe("disabled");
		});
	});

	test("fresh-profile initializer creates bounded controls once and never overwrites", async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "warm-chrome-init-")),
		);
		try {
			const profileDir = join(root, "fresh");
			const runtime = createDefaultRuntime();
			await runtime.initializeCredentialCleanProfile(profileDir);
			const activeProfileDir = join(profileDir, "Default");
			const posture = await runtime.inspectCredentialPosture({
				activeProfileDir,
				syncDisabledByLaunch: true,
				extensionsDisabledByLaunch: true,
			});
			expect(posture).toEqual({
				disk: {
					saveSetting: "disabled",
					autoSignInSetting: "disabled",
					syncSetting: "disabled",
					storedLogin: "absent",
				},
				process: {
					disableSyncSwitch: "present",
					disableExtensionsSwitch: "present",
				},
				effective: {
					observation: "not-observed",
				},
			});
			const before = await readFile(
				join(activeProfileDir, "Preferences"),
				"utf8",
			);
			await expect(
				runtime.initializeCredentialCleanProfile(profileDir),
			).rejects.toThrow();
			expect(
				await readFile(join(activeProfileDir, "Preferences"), "utf8"),
			).toBe(before);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	test("fresh-profile initializer refuses the everyday Chrome profile directly", async () => {
		const home = "/Users/warm";
		const runtime = createDefaultRuntime({ env: { HOME: home } });
		await expect(
			runtime.initializeCredentialCleanProfile(
				`${home}/Library/Application Support/Google/Chrome`,
			),
		).rejects.toThrow("refusing to initialize");
	});
});

// A scriptable fake of the ChildProcess slice terminateChild drives. `kill`
// records the signals it received; `signalExits` decides which signal (if any)
// makes the process exit, so a SIGTERM-ignoring child can be modelled.
function fakeChild(options: {
	killReturns?: boolean;
	exitOn?: "SIGTERM" | "SIGKILL" | "none";
	alreadyExited?: boolean;
}): KillableChild & { signals: string[] } {
	const exitOn = options.exitOn ?? "SIGTERM";
	let exitCode: number | null = options.alreadyExited ? 0 : null;
	let onExit: (() => void) | null = null;
	const signals: string[] = [];
	return {
		signals,
		get exitCode() {
			return exitCode;
		},
		once(event: string, listener: (...args: unknown[]) => void) {
			if (event === "exit") onExit = () => listener(0);
			return this;
		},
		kill(signal?: NodeJS.Signals) {
			signals.push(signal ?? "SIGTERM");
			if (options.killReturns === false) return false;
			if (signal === exitOn || (signal === undefined && exitOn === "SIGTERM")) {
				exitCode = 0;
				// Settle the exit listener on the next microtask, as a real child
				// process would.
				queueMicrotask(() => onExit?.());
			}
			return true;
		},
	};
}

describe("terminateChild kill-until-dead (review: kill boolean means gone)", () => {
	test("an already-exited child is gone without any signal", async () => {
		const child = fakeChild({ alreadyExited: true });
		expect(await terminateChild(child, 5)).toBe(true);
		expect(child.signals).toEqual([]);
	});

	test("a child that exits on SIGTERM is confirmed gone", async () => {
		const child = fakeChild({ exitOn: "SIGTERM" });
		expect(await terminateChild(child, 5)).toBe(true);
		expect(child.signals).toEqual(["SIGTERM"]);
	});

	test("a SIGTERM-ignoring child is escalated to SIGKILL, then confirmed gone", async () => {
		const child = fakeChild({ exitOn: "SIGKILL" });
		expect(await terminateChild(child, 5)).toBe(true);
		// SIGTERM was ignored (no exit within the grace window), so SIGKILL fired.
		expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
	});

	test("kill() returning false (ESRCH) on an already-gone pid is success", async () => {
		const child = fakeChild({ killReturns: false, alreadyExited: false });
		// killReturns:false models ESRCH; exitCode stays null so terminateChild
		// reports not-gone. A truly-gone pid would have exitCode set — model that:
		const gone = fakeChild({ killReturns: false, alreadyExited: true });
		expect(await terminateChild(gone, 5)).toBe(true);
		expect(await terminateChild(child, 5)).toBe(false);
	});
});

describe("attach budget ordering (review: attach_timeout must be reachable)", () => {
	test("the default fetch abort sits above the proof attach budget", () => {
		// If the fetch abort were <= the attach budget, a hang would reject as a
		// fetch error and classify as no_listener (spawn-licensing) instead of
		// the proof's attach_timeout verdict.
		expect(DEFAULT_FETCH_ABORT_MS).toBeGreaterThan(WARM_CHROME_ATTACH_TIMEOUT_MS);
	});
});

describe("real Google Chrome binary identity", () => {
	// The macOS hardened runtime maps Chrome's executable as a code-sign clone
	// under a private per-launch dir; lsof -d txt returns THAT path, not
	// /Applications. The identity predicate must recognize the real app-bundle
	// tail through the clone while still rejecting spoof shapes (issue #252).
	const CLONE_BINARY =
		"/private/var/folders/_b/0fxx_szx34qchf5vq6j5xd1h0000gn/X/com.google.Chrome.code_sign_clone/code_sign_clone.H5bJ4j/Google Chrome.app.bundle/Contents/MacOS/Google Chrome";

	test("accepts the canonical /Applications binary", () => {
		expect(isRealGoogleChromeBinary(REAL_GOOGLE_CHROME_BINARY)).toBe(true);
	});

	test("accepts the macOS code-sign clone binary path", () => {
		expect(isRealGoogleChromeBinary(CLONE_BINARY)).toBe(true);
	});

	test("rejects the Google Chrome Helper superstring", () => {
		expect(
			isRealGoogleChromeBinary(
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper",
			),
		).toBe(false);
	});

	test("rejects Chromium", () => {
		expect(
			isRealGoogleChromeBinary(
				"/Applications/Chromium.app/Contents/MacOS/Chromium",
			),
		).toBe(false);
	});

	test("rejects Chrome for Testing", () => {
		expect(
			isRealGoogleChromeBinary(
				"/Users/example/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
			),
		).toBe(false);
	});

	test("rejects an arbitrary spoof path", () => {
		expect(isRealGoogleChromeBinary("/private/tmp/fake-chrome")).toBe(false);
	});

	test("rejects the empty string", () => {
		expect(isRealGoogleChromeBinary("")).toBe(false);
	});
});

describe("listener identity probe", () => {
	test("true executable path from lsof txt beats spoofable argv0 from ps", async () => {
		const listener = await findListenerWithSystemTools("9222", async (command, args) => {
			if (command === "lsof" && args.some((arg) => arg.includes("-iTCP@127.0.0.1:9222"))) {
				return "123\n";
			}
			if (command === "lsof" && args.includes("-d") && args.includes("txt")) {
				return "p123\nn/private/tmp/fake-chrome\n";
			}
			if (command === "ps") {
				return `${REAL_GOOGLE_CHROME_BINARY} --remote-debugging-port=9222 --user-data-dir=/tmp/profile\n`;
			}
			throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
		});

		expect(listener?.pid).toBe(123);
		const parsed = parseProcessCommand(listener?.command ?? "");
		expect(parsed.executable).toBe("/private/tmp/fake-chrome");
		expect(parsed.args).toContain("--remote-debugging-port=9222");
	});

	test("multiple loopback listener pids fail closed", async () => {
		const promise = findListenerWithSystemTools("9222", async (command, args) => {
			if (command === "lsof" && args.some((arg) => arg.includes("-iTCP@127.0.0.1:9222"))) {
				return "123\n456\n";
			}
			throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
		});

		await expect(promise).rejects.toBeInstanceOf(WarmChromeRuntimeError);
		await expect(promise).rejects.toHaveProperty("code", "listener_uninspectable");
	});
});

describe("default loopback fetch", () => {
	test("ambient proxy env does not intercept numeric-loopback CDP probes", async () => {
		const server = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ ok: true }));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (address === null || typeof address === "string") {
				throw new Error("expected tcp server address");
			}
			const runtime = createDefaultRuntime({
				env: {
					HTTP_PROXY: "http://127.0.0.1:9",
					http_proxy: "http://127.0.0.1:9",
				},
			});

			await expect(
				runtime.fetchJson(`http://127.0.0.1:${address.port}/json/version`),
			).resolves.toEqual({ ok: true });
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});

	test("mid-body connection reset settles the fetch promise instead of hanging", async () => {
		const server = createServer((_request, response) => {
			response.writeHead(200, {
				"content-type": "application/json",
				"content-length": "1024",
			});
			response.write('{"partial":');
			// Destroy the socket mid-body: the error lands on the response
			// stream, which the fetch must observe to settle.
			response.destroy();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (address === null || typeof address === "string") {
				throw new Error("expected tcp server address");
			}
			const runtime = createDefaultRuntime({});
			const outcome = await Promise.race([
				runtime
					.fetchJson(`http://127.0.0.1:${address.port}/json/version`)
					.then(() => "resolved")
					.catch(() => "rejected"),
				new Promise<string>((resolve) =>
					setTimeout(() => resolve("hung"), 2000),
				),
			]);

			expect(outcome).toBe("rejected");
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});

	// Regression (fourth-pass HIGH): a healthy 200 body split across chunks with
	// a macrotask gap must resolve. Under Bun the request "close" fires a full
	// macrotask before the response "end", so a "close" backstop that rejected on
	// any timing race (sync or microtask-deferred) failed every multi-chunk body.
	// The response-lifecycle design leaves settlement to the response's own end.
	test("multi-chunk 200 body with a delayed final chunk resolves", async () => {
		const server = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.write('{"ok"');
			// Macrotask gap before the final chunk: exercises the close-vs-end race.
			setTimeout(() => {
				response.write(":true}");
				response.end();
			}, 40);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (address === null || typeof address === "string") {
				throw new Error("expected tcp server address");
			}
			const runtime = createDefaultRuntime({});
			await expect(
				runtime.fetchJson(`http://127.0.0.1:${address.port}/json/version`),
			).resolves.toEqual({ ok: true });
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});

	// Regression (sixth-pass HIGH): request() throwing synchronously (e.g. a
	// non-http: protocol) rejects the promise via the executor, but a deadline
	// timer armed BEFORE request() was never cleared — and its callback then
	// touched `req` in its temporal dead zone, an uncaught ReferenceError that
	// crashed the whole process 5s after an already-handled rejection. The fix
	// arms the deadline only after request() returns; this test fails pre-fix
	// because the stray timer's ReferenceError escapes as an uncaught error.
	test(
		"synchronous request() throw rejects without arming a stray deadline timer",
		async () => {
			const runtime = createDefaultRuntime({});
			await expect(
				runtime.fetchJson("https://127.0.0.1:1/json/version"),
			).rejects.toThrow(/protocol/i);
			// Outlive the deadline window: pre-fix the leaked timer fires here.
			await new Promise((resolve) =>
				setTimeout(resolve, DEFAULT_FETCH_ABORT_MS + 500),
			);
		},
		DEFAULT_FETCH_ABORT_MS + 5000,
	);

	// Regression (fifth-pass): a response that stalls after headers + partial
	// body (no reset, no FIN, no further bytes) must reject at the wall-clock
	// deadline with TimeoutError. Under Bun, the deadline's req.destroy flushes
	// the buffered partial body as a response "end" with `complete` still
	// false — so without a completeness guard, a truncated-but-parseable body
	// resolves as success (a stalled endpoint masquerading as a healthy
	// /json/version answer) and an unparseable one rejects with a SyntaxError
	// that classifiers cannot tell apart from a real CDP fault.
	test(
		"stalled-after-headers response rejects TimeoutError at the deadline",
		async () => {
			const startStalledServer = (partialBody: string) => {
				const server = createTcpServer((socket) => {
					socket.on("error", () => {});
					socket.write(
						"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n" +
							`content-length: 1000\r\n\r\n${partialBody}`,
					);
					// Hold the socket open forever: no more bytes, no FIN, no RST.
				});
				return new Promise<{ server: typeof server; port: number }>(
					(resolve) => {
						server.listen(0, "127.0.0.1", () => {
							const address = server.address();
							if (address === null || typeof address === "string") {
								throw new Error("expected tcp server address");
							}
							resolve({ server, port: address.port });
						});
					},
				);
			};
			// Parseable partial body is the dangerous variant (would resolve);
			// unparseable pins the error identity. Run both concurrently so the
			// test pays the deadline once.
			const [parseable, unparseable] = await Promise.all([
				startStalledServer('{"ok":true}'),
				startStalledServer('{"partial":'),
			]);
			try {
				const runtime = createDefaultRuntime({});
				const outcomes = await Promise.all(
					[parseable, unparseable].map(({ port }) =>
						runtime
							.fetchJson(`http://127.0.0.1:${port}/json/version`)
							.then(() => "resolved")
							.catch((error: Error) => `rejected:${error.name}`),
					),
				);

				expect(outcomes).toEqual([
					"rejected:TimeoutError",
					"rejected:TimeoutError",
				]);
			} finally {
				for (const { server } of [parseable, unparseable]) {
					await new Promise<void>((resolve, reject) => {
						server.close((error) => (error ? reject(error) : resolve()));
					});
				}
			}
		},
		DEFAULT_FETCH_ABORT_MS + 5000,
	);

	// Regression (re-audit HIGH): under Bun, req.destroy on a connected socket
	// that never produced an HTTP response emits only "close", not "error". A
	// fetch with no "close" backstop never settles, so a socket reset before any
	// response bytes must still reject rather than hang the awaiting caller
	// (repair has no outer timeout race).
	test("socket reset before any response rejects instead of hanging", async () => {
		const server = createTcpServer((socket) => {
			// Accept the connection, read the request, then reset — no HTTP reply.
			socket.on("data", () => socket.destroy());
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (address === null || typeof address === "string") {
				throw new Error("expected tcp server address");
			}
			const runtime = createDefaultRuntime({});
			const outcome = await Promise.race([
				runtime
					.fetchJson(`http://127.0.0.1:${address.port}/json/version`)
					.then(() => "resolved")
					.catch(() => "rejected"),
				new Promise<string>((resolve) =>
					setTimeout(() => resolve("hung"), 2000),
				),
			]);

			expect(outcome).toBe("rejected");
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});
});

describe("SingletonLock locality and pid liveness", () => {
	test("isProcessAlive(0) is false (kill(0) signals the caller's own group)", async () => {
		const runtime = createDefaultRuntime({});
		await expect(runtime.isProcessAlive(0)).resolves.toBe(false);
	});

	test("a same-host lock is marked local; a foreign-host lock is not", async () => {
		const runtime = createDefaultRuntime({});

		const localDir = await mkdtemp(join(tmpdir(), "warm-chrome-locklocal-"));
		const foreignDir = await mkdtemp(join(tmpdir(), "warm-chrome-lockforeign-"));
		try {
			await symlink(`${hostname()}-4321`, join(localDir, "SingletonLock"));
			const localLock = await runtime.readSingletonLock(localDir);
			expect(localLock?.local).toBe(true);
			expect(localLock?.pid).toBe(4321);

			await symlink("some-other-host-77", join(foreignDir, "SingletonLock"));
			const foreignLock = await runtime.readSingletonLock(foreignDir);
			expect(foreignLock?.local).toBe(false);
			expect(foreignLock?.hostname).toBe("some-other-host");
			expect(foreignLock?.pid).toBe(77);
		} finally {
			await rm(localDir, { recursive: true, force: true });
			await rm(foreignDir, { recursive: true, force: true });
		}
	});
});

describe("profile directory creation", () => {
	test("refuses symlinked parents before mkdir/chmod can mutate the target", async () => {
		const root = await mkdtemp(join(tmpdir(), "warm-chrome-profile-root-"));
		const target = await mkdtemp(join(tmpdir(), "warm-chrome-profile-target-"));
		try {
			await symlink(target, join(root, "link"));
			const runtime = createDefaultRuntime({});
			await expect(
				runtime.ensureProfileDir(join(root, "link", "nested", "profile")),
			).rejects.toThrow("symbolic-link component");
			await expect(stat(join(target, "nested"))).rejects.toHaveProperty(
				"code",
				"ENOENT",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(target, { recursive: true, force: true });
		}
	});
});

describe("default Chrome profile detection", () => {
	// CodeRabbit review (PR #226): a trailing slash on HOME must not build a
	// double-slash root that fails the guard open on a real default-profile path.
	test("a trailing slash on HOME still matches the default profile", () => {
		const path = "/Users/example/Library/Application Support/Google/Chrome";
		expect(isDefaultChromeProfilePath(path, { HOME: "/Users/example/" })).toBe(
			true,
		);
		expect(isDefaultChromeProfilePath(`${path}/Default`, { HOME: "/Users/example///" })).toBe(true);
		// A dedicated warm profile is still not the default profile.
		expect(
			isDefaultChromeProfilePath("/Users/example/.agent-warm-profile", {
				HOME: "/Users/example/",
			}),
		).toBe(false);
	});
});

describe("default DevToolsActivePort reader", () => {
	test("missing DevToolsActivePort is absent, not a fault", async () => {
		const dir = await mkdtemp(join(tmpdir(), "warm-chrome-profile-"));
		const deps = createDefaultProofDeps();

		try {
			await expect(deps.readDevToolsActivePort(dir)).resolves.toBeNull();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("non-regular DevToolsActivePort fails closed", async () => {
		const dir = await mkdtemp(join(tmpdir(), "warm-chrome-profile-"));
		const deps = createDefaultProofDeps();

		try {
			await mkdir(join(dir, "DevToolsActivePort"));
			await expect(deps.readDevToolsActivePort(dir)).rejects.toThrow(
				"DevToolsActivePort is not a regular file.",
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
