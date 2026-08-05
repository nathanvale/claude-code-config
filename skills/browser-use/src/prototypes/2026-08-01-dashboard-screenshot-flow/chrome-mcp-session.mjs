// PROTOTYPE: keep one native chrome-devtools-mcp session across its own tools.
import { spawn } from "node:child_process";

const [executable, endpoint, url, marker, out, requestedOrigin] = process.argv.slice(2);
if (!executable || !endpoint || !url || !marker || !out || !requestedOrigin) {
	console.error(
		"usage: bun chrome-mcp-session.mjs <executable> <endpoint> <url> <marker> <out> <requested-origin>",
	);
	process.exit(2);
}

const child = spawn(executable, ["--browser-url", endpoint], {
	stdio: ["pipe", "pipe", "pipe"],
});
child.on("error", (error) => {
	console.error(`failed to spawn ${executable}: ${error.message}`);
	process.exit(1);
});
const pending = new Map();
let nextId = 0;
let stdoutBuffer = "";

child.stdout.setEncoding("utf8");
child.stdout.on("data", chunk => {
	stdoutBuffer += chunk;
	while (stdoutBuffer.includes("\n")) {
		const newline = stdoutBuffer.indexOf("\n");
		const line = stdoutBuffer.slice(0, newline).trim();
		stdoutBuffer = stdoutBuffer.slice(newline + 1);
		if (!line) continue;
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			continue;
		}
		if (message.id === undefined || !pending.has(message.id)) continue;
		const { resolve, reject, timeout } = pending.get(message.id);
		pending.delete(message.id);
		clearTimeout(timeout);
		if (message.error) reject(new Error(JSON.stringify(message.error)));
		else resolve(message.result);
	}
});

function request(method, params) {
	const id = ++nextId;
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`timeout ${method}`));
		}, 30_000);
		pending.set(id, { resolve, reject, timeout });
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	});
}

function notify(method, params = {}) {
	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function textOf(result) {
	return result.content?.find(item => item.type === "text")?.text ?? "";
}

try {
	await request("initialize", {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "dashboard-shot-prototype", version: "0" },
	});
	notify("notifications/initialized");

	await request("tools/call", {
		name: "new_page",
		arguments: { url },
	});
	const urlResult = await request("tools/call", {
		name: "evaluate_script",
		arguments: { function: "() => location.href" },
	});
	const observedUrl = JSON.parse(textOf(urlResult).match(/```json\n(.*)\n```/)?.[1] ?? "null");

	// Off-origin refusal must precede marker evaluation and screenshot capture;
	// an off-origin page carrying the marker must never produce an artifact.
	let observedOrigin = null;
	try {
		observedOrigin = new URL(observedUrl).origin;
	} catch {}
	let markerPresent = false;
	if (observedOrigin === requestedOrigin) {
		const markerFunction = `async () => { for (let attempt = 0; attempt < 50; attempt++) { if (document.querySelector(${JSON.stringify(marker)})) return true; await new Promise(resolve => setTimeout(resolve, 100)); } return false; }`;
		const markerResult = await request("tools/call", {
			name: "evaluate_script",
			arguments: { function: markerFunction },
		});
		markerPresent = (textOf(markerResult).match(/```json\n(.*)\n```/)?.[1] ?? "false") === "true";

		if (markerPresent) {
			await request("tools/call", {
				name: "take_screenshot",
				arguments: { filePath: out, format: "png", fullPage: true },
			});
		}
	}

	process.stdout.write(`${JSON.stringify({ observed_url: observedUrl, marker_present: markerPresent })}\n`);
} finally {
	child.kill("SIGTERM");
}
