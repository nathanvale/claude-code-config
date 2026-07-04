import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { createDefaultProofDeps } from "../src/proof.ts";
import {
	DEFAULT_FETCH_ABORT_MS,
	createDefaultRuntime,
	findListenerWithSystemTools,
	type KillableChild,
	parseProcessCommand,
	REAL_GOOGLE_CHROME_BINARY,
	terminateChild,
	WarmChromeRuntimeError,
} from "../src/runtime.ts";
import { WARM_CHROME_ATTACH_TIMEOUT_MS } from "../src/proof.ts";

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
		await symlink(`${hostname()}-4321`, join(localDir, "SingletonLock"));
		const localLock = await runtime.readSingletonLock(localDir);
		expect(localLock?.local).toBe(true);
		expect(localLock?.pid).toBe(4321);

		const foreignDir = await mkdtemp(join(tmpdir(), "warm-chrome-lockforeign-"));
		await symlink("some-other-host-77", join(foreignDir, "SingletonLock"));
		const foreignLock = await runtime.readSingletonLock(foreignDir);
		expect(foreignLock?.local).toBe(false);
		expect(foreignLock?.hostname).toBe("some-other-host");
		expect(foreignLock?.pid).toBe(77);
	});
});

describe("default DevToolsActivePort reader", () => {
	test("missing DevToolsActivePort is absent, not a fault", async () => {
		const dir = await mkdtemp(join(tmpdir(), "warm-chrome-profile-"));
		const deps = createDefaultProofDeps();

		await expect(deps.readDevToolsActivePort(dir)).resolves.toBeNull();
	});

	test("non-regular DevToolsActivePort fails closed", async () => {
		const dir = await mkdtemp(join(tmpdir(), "warm-chrome-profile-"));
		await mkdir(join(dir, "DevToolsActivePort"));
		const deps = createDefaultProofDeps();

		await expect(deps.readDevToolsActivePort(dir)).rejects.toThrow(
			"DevToolsActivePort is not a regular file.",
		);
	});
});
