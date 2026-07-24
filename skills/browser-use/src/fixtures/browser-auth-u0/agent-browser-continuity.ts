import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

type HandoffEnvelope = {
	data?: {
		outcome?: string;
		attachment?: { adapter_id?: string };
		endpoint?: { http?: string };
	};
};

type CdpTarget = {
	id: string;
	url: string;
	webSocketDebuggerUrl: string;
};

const handoffPath = process.argv[2];
if (!handoffPath) {
	console.error("usage: agent-browser-continuity.ts <verified-handoff.json>");
	process.exit(64);
}

const handoff = JSON.parse(await readFile(handoffPath, "utf8")) as HandoffEnvelope;
const endpoint = handoff.data?.endpoint?.http;
if (
	handoff.data?.outcome !== "verified" ||
	handoff.data?.attachment?.adapter_id !== "agent-browser" ||
	!endpoint
) {
	console.error("verified Agent Browser handoff required");
	process.exit(20);
}

const fixtureServer = Bun.serve({
	port: 0,
	fetch(): Response {
		return new Response(
			`<!doctype html>
			<html>
				<body>
					<form id="login">
						<label>Password <input id="password" type="password"></label>
						<button id="submit" type="button">Sign in</button>
					</form>
					<p id="status">ready</p>
				</body>
			</html>`,
			{ headers: { "content-type": "text/html" } },
		);
	},
});

const fixtureUrl = `http://127.0.0.1:${fixtureServer.port}/auth-u0`;
const expectedOrigin = new URL(fixtureUrl).origin;
const cdpPort = new URL(endpoint).port;
const session = `auth-u0-${randomUUID()}`;
const sentinel = `U0S-${randomUUID()}`;
const agentEnvironment = {
	HOME: process.env.HOME,
	PATH: process.env.PATH,
	TMPDIR: process.env.TMPDIR,
	XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
	XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
	XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
	XDG_STATE_HOME: process.env.XDG_STATE_HOME,
};

async function runAgent(args: string[], timeoutMs?: number): Promise<{
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}> {
	const child = Bun.spawn(
		["agent-browser", "--cdp", cdpPort, "--session", session, ...args],
		{
			env: agentEnvironment,
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	let timedOut = false;
	const timeout =
		timeoutMs === undefined
			? undefined
			: setTimeout(() => {
					timedOut = true;
					child.kill();
				}, timeoutMs);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { exitCode, stdout, stderr, timedOut };
	} finally {
		if (timeout !== undefined) {
			clearTimeout(timeout);
		}
	}
}

function extractSignInRef(snapshot: string): string | undefined {
	return snapshot.match(
		/\bbutton\s+"Sign in"[^\r\n]*\[ref=([A-Za-z0-9_-]+)\]/,
	)?.[1];
}

async function readTargets(): Promise<CdpTarget[]> {
	const response = await fetch(`${endpoint}/json/list`);
	if (!response.ok) {
		throw new Error(`target discovery failed with ${response.status}`);
	}
	return (await response.json()) as CdpTarget[];
}

async function evaluate(
	webSocketUrl: string,
	expression: string,
): Promise<Record<string, unknown>> {
	const socket = new WebSocket(webSocketUrl);
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("CDP socket failed")), {
			once: true,
		});
	});
	const response = new Promise<Record<string, unknown>>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("CDP response timeout")), 5_000);
		socket.addEventListener("message", (event) => {
			const value = JSON.parse(String(event.data)) as Record<string, unknown>;
			if (value.id === 1) {
				clearTimeout(timeout);
				resolve(value);
			}
		});
	});
	socket.send(
		JSON.stringify({
			id: 1,
			method: "Runtime.evaluate",
			params: {
				expression,
				returnByValue: true,
			},
		}),
	);
	const value = await response;
	socket.close();
	return value;
}

try {
	const open = await runAgent(["open", fixtureUrl]);
	if (open.exitCode !== 0) {
		throw new Error("Agent Browser could not open the controlled fixture");
	}
	const beforeUrl = await runAgent(["get", "url"]);
	const beforeSnapshot = await runAgent(["snapshot"]);
	const staleRef = extractSignInRef(beforeSnapshot.stdout);
	if (beforeSnapshot.exitCode !== 0 || beforeSnapshot.timedOut || !staleRef) {
		throw new Error("Agent Browser snapshot did not expose the sign-in ref");
	}
	const beforeTargets = await readTargets();
	const target = beforeTargets.find((candidate) => candidate.url === fixtureUrl);
	if (!target) {
		throw new Error("controlled target missing after Agent Browser navigation");
	}

	const delivery = await evaluate(
		target.webSocketDebuggerUrl,
		`(() => {
			if (location.origin !== ${JSON.stringify(expectedOrigin)}) {
				return { origin_ok: false, field_length: 0 };
			}
			const input = document.querySelector("#password");
			const status = document.querySelector("#status");
			const button = document.querySelector("#submit");
			if (!(input instanceof HTMLInputElement) || !status || !button) {
				return { origin_ok: true, field_length: 0 };
			}
			input.value = ${JSON.stringify(sentinel)};
			button.replaceWith(button.cloneNode(true));
			status.textContent = "delivered";
			return { origin_ok: true, field_length: input.value.length };
		})()`,
	);

	const staleRefProbe = await runAgent(["click", `@${staleRef}`], 5_000);
	const staleRefProbeOutput = [
		staleRefProbe.stdout,
		staleRefProbe.stderr,
	].join("\n");
	if (staleRefProbe.timedOut) {
		throw new Error("Agent Browser stale-ref probe timed out");
	}
	const staleRefRejected = /\bUnknown ref\b/i.test(staleRefProbeOutput);
	if (staleRefProbe.exitCode !== 0 && !staleRefRejected) {
		throw new Error("Agent Browser stale-ref probe failed without a verdict");
	}
	const staleRefReused = !staleRefRejected && staleRefProbe.exitCode === 0;

	const afterUrl = await runAgent(["get", "url"]);
	const afterSnapshot = await runAgent(["snapshot"]);
	const afterTargets = await readTargets();
	const afterTarget = afterTargets.find((candidate) => candidate.url === fixtureUrl);
	const cleanup = await evaluate(
		target.webSocketDebuggerUrl,
		`(() => {
			const input = document.querySelector("#password");
			if (!(input instanceof HTMLInputElement)) return { field_length: -1 };
			input.value = "";
			return { field_length: input.value.length };
		})()`,
	);
	const allAdapterOutput = [
		open.stdout,
		open.stderr,
		beforeUrl.stdout,
		beforeUrl.stderr,
		beforeSnapshot.stdout,
		beforeSnapshot.stderr,
		staleRefProbe.stdout,
		staleRefProbe.stderr,
		afterUrl.stdout,
		afterUrl.stderr,
		afterSnapshot.stdout,
		afterSnapshot.stderr,
	].join("\n");
	const deliveryResult = (
		(delivery.result as Record<string, unknown> | undefined)?.result as
			| Record<string, unknown>
			| undefined
	)?.value as Record<string, unknown> | undefined;
	const cleanupResult = (
		(cleanup.result as Record<string, unknown> | undefined)?.result as
			| Record<string, unknown>
			| undefined
	)?.value as Record<string, unknown> | undefined;

	process.stdout.write(
		`${JSON.stringify({
			adapter_version: "0.31.2",
			handoff_verified: true,
			same_target: afterTarget?.id === target.id,
			origin_reproved: deliveryResult?.origin_ok === true,
			field_delivery_observed:
				typeof deliveryResult?.field_length === "number" &&
				deliveryResult.field_length > 0,
			field_cleanup: cleanupResult?.field_length === 0,
			pause_resume_continuity:
				beforeUrl.exitCode === 0 &&
				afterUrl.exitCode === 0 &&
				beforeUrl.stdout.trim() === afterUrl.stdout.trim(),
			fresh_snapshot:
				beforeSnapshot.exitCode === 0 &&
				afterSnapshot.exitCode === 0 &&
				afterSnapshot.stdout.includes("delivered"),
			stale_ref_reused: staleRefReused,
			adapter_sentinel_clean: !allAdapterOutput.includes(sentinel),
		})}\n`,
	);
} finally {
	fixtureServer.stop(true);
}
