import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WORKSPACE_ROOT = resolve(import.meta.dir, "../../..");
const PACKAGE_ROOT = join(
	WORKSPACE_ROOT,
	"runtime",
	"browser-use-environment-auth",
);
const SUPERVISOR = join(
	PACKAGE_ROOT,
	".build",
	"debug",
	"browser-use-op-supervisor",
);
// The supervisor and delivery child are a macOS-only Swift package (Darwin
// imports); on any other platform the binary cannot exist, so this real
// process-boundary proof runs only on darwin. On darwin an absent binary
// still hard-fails: build the package rather than skipping the proof.
const DARWIN = process.platform === "darwin";
const SENTINEL = "DELIVERY_SENTINEL_U1_9173";
const TARGET_URL = "https://portal.test/login";
const TARGET_ORIGIN = "https://portal.test";
const REAL_TARGET_ID = "cdp-target-42";
const ADAPTER_TAB_ID = "t1";

type CDPState = {
	value: string;
	selected: boolean;
	methods: string[];
	attachedTargetIDs: string[];
	mouseEvents: string[];
	binaryFrames: number;
	failInsert: boolean;
};

const cdpState: CDPState = {
	value: "pre-seeded-value",
	selected: false,
	methods: [],
	attachedTargetIDs: [],
	mouseEvents: [],
	binaryFrames: 0,
	failInsert: false,
};

function startCDPServer(): ReturnType<typeof Bun.serve> | undefined {
	try {
		return Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request, server) {
				if (server.upgrade(request, { data: {} })) return;
				return new Response("upgrade required", { status: 426 });
			},
			websocket: {
				message(socket, rawMessage) {
					if (typeof rawMessage !== "string") {
						cdpState.binaryFrames += 1;
						socket.close(1003, "cdp-text-frames-required");
						return;
					}
					const message = JSON.parse(rawMessage) as {
						id: number;
						method: string;
						params?: Record<string, unknown>;
					};
					cdpState.methods.push(message.method);
					let result: Record<string, unknown> = {};
					switch (message.method) {
						case "Target.getTargets":
							result = {
								targetInfos: [
									{
										targetId: REAL_TARGET_ID,
										type: "page",
										url: TARGET_URL,
									},
								],
							};
							break;
						case "Target.attachToTarget":
							cdpState.attachedTargetIDs.push(
								String(message.params?.targetId),
							);
							result = { sessionId: "delivery-session" };
							break;
						case "Accessibility.getFullAXTree":
							result = {
								nodes: [
									{
										role: { value: "textbox" },
										name: { value: "Password" },
										backendDOMNodeId: 101,
									},
									{
										role: { value: "button" },
										name: { value: "Log In" },
										backendDOMNodeId: 202,
									},
								],
							};
							break;
						case "DOM.resolveNode":
							result = { object: { objectId: "field-object" } };
							break;
						case "Runtime.callFunctionOn":
							cdpState.selected = true;
							result = { result: { value: null } };
							break;
						case "Input.insertText":
							if (cdpState.failInsert) {
								socket.close(1011, "fixture-mid-action-failure");
								return;
							}
							cdpState.value = cdpState.selected
								? String(message.params?.text)
								: `${cdpState.value}${String(message.params?.text)}`;
							cdpState.selected = false;
							break;
						case "DOM.getBoxModel":
							result = {
								model: {
									content: [10, 10, 30, 10, 30, 30, 10, 30],
								},
							};
							break;
						case "Input.dispatchMouseEvent":
							cdpState.mouseEvents.push(String(message.params?.type));
							break;
					}
					socket.send(JSON.stringify({ id: message.id, result }));
				},
			},
		});
	} catch {
		return undefined;
	}
}

const cdpServer = startCDPServer();

const temporaryRoots: string[] = [];

beforeAll(() => {
	if (DARWIN && !existsSync(SUPERVISOR)) {
		throw new Error(
			`real supervisor binary missing; build the Swift package first: ${SUPERVISOR}`,
		);
	}
});

afterAll(() => {
	cdpServer?.stop(true);
	for (const root of temporaryRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

function shellLiteral(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function fixtureRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "browser-use-deliver-u1-"));
	temporaryRoots.push(root);
	return root;
}

function executable(path: string, body: string): string {
	writeFileSync(path, body);
	chmodSync(path, 0o700);
	return path;
}

function fakeOp(
	root: string,
	options: { fail?: boolean; logPath: string },
): string {
	return executable(
		join(root, options.fail ? "op-fail" : "op-ok"),
		`#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '2.35.0\\n'
  exit 0
fi
{
  printf 'argv'
  for argument in "$@"; do printf '<%s>' "$argument"; done
  printf '\\nPATH=<%s>\\nLANG=<%s>\\nTOKEN_PRESENT=<%s>\\n' "$PATH" "$LANG" "\${OP_SERVICE_ACCOUNT_TOKEN:+yes}"
} >> ${shellLiteral(options.logPath)}
${options.fail ? "exit 7" : `printf '%s' ${shellLiteral(SENTINEL)}`}
`,
	);
}

function fakeDelivery(
	root: string,
	options: { leak: boolean; logPath: string; spawnPath?: string },
): string {
	return executable(
		join(root, options.leak ? "delivery-leak" : "delivery-clean"),
		`#!/bin/sh
${options.spawnPath ? `printf 'spawned\\n' > ${shellLiteral(options.spawnPath)}` : ""}
{
  printf 'argv'
  for argument in "$@"; do printf '<%s>' "$argument"; done
  printf '\\nPATH=<%s>\\nLANG=<%s>\\n' "$PATH" "$LANG"
} >> ${shellLiteral(options.logPath)}
value=
IFS= read -r value <&3 || true
${options.leak
	? `printf '{"ok":true,"shape":{"kind":"utf8","byte_length":%s},"leak":"%s"}\\n' "\${#value}" "$value"`
	: `printf '{"ok":true,"shape":{"kind":"utf8","byte_length":%s}}\\n' "\${#value}"`}
`,
	);
}

function baseArguments(opPath: string): string[] {
	return [
		"deliver",
		"--test-unadmitted-op",
		"true",
		"--op-path",
		opPath,
		"--vault-id",
		"vault-1",
		"--item-id",
		"item-1",
		"--field",
		"password",
		"--ws-url",
		`ws://127.0.0.1:${cdpServer?.port ?? 9}/devtools/browser/fixture`,
		"--target-url",
		TARGET_URL,
		"--target-origin",
		TARGET_ORIGIN,
		"--field-role",
		"textbox",
		"--field-name",
		"Password",
		"--timeout-ms",
		"5000",
	];
}

async function runSupervisor(
	arguments_: string[],
	tokenPath: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = spawn(SUPERVISOR, [
		...arguments_,
		"--test-token-path",
		tokenPath,
	], {
		env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!(child.stdout && child.stderr)) {
		child.kill("SIGKILL");
		throw new Error("supervisor output pipes unavailable");
	}
	const childStdout = child.stdout;
	const childStderr = child.stderr;
	let stdout = "";
	let stderr = "";
	childStdout.setEncoding("utf8");
	childStderr.setEncoding("utf8");
	childStdout.on("data", (chunk) => {
		stdout += chunk;
	});
	childStderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const exitCode = await new Promise<number>((resolveExit, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("supervisor timeout"));
		}, 10_000);
		child.once("error", reject);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			resolveExit(code ?? -1);
		});
	});
	return { exitCode, stdout, stderr };
}

function tokenFile(root: string): string {
	const path = join(root, "token");
	writeFileSync(path, "fixture-service-account-token", { mode: 0o600 });
	chmodSync(path, 0o600);
	return path;
}

function resetCDP(options: { failInsert?: boolean } = {}): void {
	cdpState.value = "pre-seeded-value";
	cdpState.selected = false;
	cdpState.methods = [];
	cdpState.attachedTargetIDs = [];
	cdpState.mouseEvents = [];
	cdpState.binaryFrames = 0;
	cdpState.failInsert = options.failInsert ?? false;
}

function surfacesContainSentinel(surfaces: readonly string[]): boolean {
	return surfaces.some((surface) => surface.includes(SENTINEL));
}

describe.skipIf(!DARWIN)("environment OP supervisor deliver process boundary", () => {
	test("real child uses CDP text frames, re-proves by URL, replaces the field, activates with trusted events, and exits after one write", async () => {
		if (!cdpServer) throw new Error("loopback fixture unavailable");
		resetCDP();
		const root = fixtureRoot();
		const opLog = join(root, "op.log");
		const opPath = fakeOp(root, { logPath: opLog });
		const args = [
			...baseArguments(opPath),
			"--activate-role",
			"button",
			"--activate-name",
			"Log In",
		];

		const result = await runSupervisor(args, tokenFile(root));

		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			ok: true,
			shape: { kind: "utf8", byte_length: SENTINEL.length },
		});
		expect(cdpState.value).toBe(SENTINEL);
		expect(cdpState.binaryFrames).toBe(0);
		expect(cdpState.methods.filter((method) => method === "Target.getTargets")).toHaveLength(2);
		expect(cdpState.methods.filter((method) => method === "Input.insertText")).toHaveLength(1);
		expect(cdpState.attachedTargetIDs).toEqual([REAL_TARGET_ID]);
		expect(cdpState.attachedTargetIDs).not.toContain(ADAPTER_TAB_ID);
		expect(cdpState.mouseEvents).toEqual([
			"mouseMoved",
			"mousePressed",
			"mouseReleased",
		]);
		expect(
			surfacesContainSentinel([
				JSON.stringify(args),
				JSON.stringify({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }),
				result.stdout,
				result.stderr,
				readFileSync(opLog, "utf8"),
			]),
		).toBe(false);
	});

	test("OP failure is typed and never starts the delivery child", async () => {
		resetCDP();
		const root = fixtureRoot();
		const opPath = fakeOp(root, {
			fail: true,
			logPath: join(root, "op.log"),
		});
		const spawnPath = join(root, "delivery-spawned");
		const deliveryPath = fakeDelivery(root, {
			leak: false,
			logPath: join(root, "delivery.log"),
			spawnPath,
		});
		const result = await runSupervisor(
			[
				...baseArguments(opPath),
				"--test-delivery-path",
				deliveryPath,
			],
			tokenFile(root),
		);

		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout).rejection.code).toBe("process-failed");
		expect(existsSync(spawnPath)).toBe(false);
		expect(cdpState.methods).toHaveLength(0);
	});

	test("mid-action transport loss returns a nonzero honest outcome and never retries", async () => {
		if (!cdpServer) throw new Error("loopback fixture unavailable");
		resetCDP({ failInsert: true });
		const root = fixtureRoot();
		const opPath = fakeOp(root, { logPath: join(root, "op.log") });

		const result = await runSupervisor(
			baseArguments(opPath),
			tokenFile(root),
		);

		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout)).toEqual({
			ok: false,
			reason: "write-failed",
			field_cleared: false,
		});
		expect(cdpState.methods.filter((method) => method === "Input.insertText")).toHaveLength(1);
	});

	test("malformed target or websocket parameters refuse before either child forks", async () => {
		resetCDP();
		const root = fixtureRoot();
		const opLog = join(root, "op.log");
		const deliverySpawn = join(root, "delivery-spawned");
		const opPath = fakeOp(root, { logPath: opLog });
		const deliveryPath = fakeDelivery(root, {
			leak: false,
			logPath: join(root, "delivery.log"),
			spawnPath: deliverySpawn,
		});
		const args = [
			...baseArguments(opPath),
			"--test-delivery-path",
			deliveryPath,
		];
		args[args.indexOf("--ws-url") + 1] = "https://not-a-websocket.test";

		const result = await runSupervisor(args, tokenFile(root));

		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout).rejection.code).toBe("invalid-arguments");
		expect(existsSync(opLog)).toBe(false);
		expect(existsSync(deliverySpawn)).toBe(false);
	});

	test("argv, environment, and output sweep is falsifiable with a deliberately leaking child", async () => {
		resetCDP();
		const root = fixtureRoot();
		const opLog = join(root, "op.log");
		const cleanLog = join(root, "delivery-clean.log");
		const leakingLog = join(root, "delivery-leak.log");
		const opPath = fakeOp(root, { logPath: opLog });
		const tokenPath = tokenFile(root);
		const cleanDelivery = fakeDelivery(root, {
			leak: false,
			logPath: cleanLog,
		});
		const cleanArgs = [
			...baseArguments(opPath),
			"--test-delivery-path",
			cleanDelivery,
		];
		const clean = await runSupervisor(cleanArgs, tokenPath);
		const cleanSurfaces = [
			JSON.stringify(cleanArgs),
			JSON.stringify({ PATH: "/usr/bin:/bin", LANG: "C.UTF-8" }),
			clean.stdout,
			clean.stderr,
			readFileSync(opLog, "utf8"),
			readFileSync(cleanLog, "utf8"),
		];
		expect(clean.exitCode).toBe(0);
		expect(surfacesContainSentinel(cleanSurfaces)).toBe(false);

		const leakingDelivery = fakeDelivery(root, {
			leak: true,
			logPath: leakingLog,
		});
		const leakingArgs = [
			...baseArguments(opPath),
			"--test-delivery-path",
			leakingDelivery,
		];
		const leaking = await runSupervisor(leakingArgs, tokenPath);
		const leakingSurfaces = [
			JSON.stringify(leakingArgs),
			leaking.stdout,
			leaking.stderr,
			readFileSync(leakingLog, "utf8"),
		];
		expect(leaking.exitCode).toBe(0);
		expect(surfacesContainSentinel(leakingSurfaces)).toBe(true);
	});
});
