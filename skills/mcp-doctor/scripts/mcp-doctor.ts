#!/usr/bin/env bun

// MCP health doctor: run `mcporter list`, classify every server, name the fix.
// Turns silent MCP failure (empty key -> server looks configured but dead)
// into a loud one-line diagnosis with a repair hint.

import { spawnSync } from "node:child_process";

type Health = "healthy" | "offline" | "auth-required" | "token-missing" | "http-error" | "error";

type Server = {
	name: string;
	health: Health;
	detail: string;
	source: string;
	fix: string | null;
};

type Report = {
	status: "ok" | "broken";
	healthy: number;
	broken: number;
	servers: Server[];
};

const FIX_HINTS: Record<Health, (name: string) => string | null> = {
	healthy: () => null,
	offline: (name) =>
		`Server unreachable. If it needs an API key, wire it via op run (see SKILL.md). Check the op session before the config: 'op read <ref>'. Last resort: confirm '${name}' command/url still valid.`,
	"auth-required": (name) => `Run 'mcporter auth ${name}' to complete OAuth.`,
	"token-missing": (name) =>
		`A required var is unset. Stdio server: convert '${name}' to the op run pattern (see SKILL.md). HTTP server with a header var: op run cannot wrap it (no process to launch) — export the var from the shell that starts the MCP host, or use a stdio bridge.`,
	"http-error": (name) => `Endpoint returned a non-200 status. Verify the '${name}' URL and any auth header.`,
	error: () => "See the raw mcporter detail; the server failed to initialize.",
};

function classify(detail: string): Health {
	const d = detail.toLowerCase();
	if (/\d+\s+tools?/.test(detail)) return "healthy";
	if (d.includes("must be set") || d.includes("environment variable")) return "token-missing";
	if (d.includes("auth required")) return "auth-required";
	if (d.includes("http") && /\b40[0-9]\b|\b50[0-9]\b/.test(detail)) return "http-error";
	if (d.includes("offline") || d.includes("unable to reach")) return "offline";
	return "error";
}

// mcporter list line shape:
//   - <name> (<detail>, <ms>) [source: <path>]
//   - <name> — <description> (<detail>, <ms>) [source: <path>]
function parseLine(line: string): Server | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("- ")) return null;

	const body = trimmed.slice(2);
	const name = body.split(/\s|\(|—/, 1)[0]?.trim() ?? "";
	if (!name) return null;

	const detailMatch = body.match(/\(([^()]*?,\s*[\d.]+s)\)/);
	const detail = detailMatch?.[1]?.replace(/,\s*[\d.]+s$/, "").trim() ?? body;

	const sourceMatch = body.match(/\[source:\s*([^\]]+)\]/);
	const source = sourceMatch?.[1]?.trim() ?? "unknown";

	const health = classify(detail);
	return { name, health, detail, source, fix: FIX_HINTS[health](name) };
}

function runMcporterList(): string {
	const result = spawnSync("mcporter", ["list"], {
		encoding: "utf8",
		env: { ...process.env, MCPORTER_NO_KEEPALIVE: "*" },
		timeout: 120_000,
	});

	if (result.error) {
		throw new Error(`mcporter not runnable: ${result.error.message}`);
	}

	// mcporter writes the server lines to stdout; some progress to stderr.
	return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function buildReport(raw: string): Report {
	const servers: Server[] = [];
	for (const line of raw.split("\n")) {
		const server = parseLine(line);
		if (server) servers.push(server);
	}

	const broken = servers.filter((s) => s.health !== "healthy");
	return {
		status: broken.length === 0 ? "ok" : "broken",
		healthy: servers.length - broken.length,
		broken: broken.length,
		servers,
	};
}

function renderText(report: Report): string {
	const lines: string[] = [];
	const broken = report.servers.filter((s) => s.health !== "healthy");
	const healthy = report.servers.filter((s) => s.health === "healthy");

	if (broken.length === 0) {
		lines.push(`OK: all ${report.healthy} MCP servers healthy.`);
		return lines.join("\n");
	}

	lines.push(`BROKEN: ${report.broken} of ${report.servers.length} MCP servers need attention.`);
	lines.push("");
	for (const s of broken) {
		lines.push(`✗ ${s.name} [${s.health}] — ${s.detail}`);
		if (s.fix) lines.push(`  fix: ${s.fix}`);
		lines.push(`  source: ${s.source}`);
	}
	lines.push("");
	lines.push(`✓ ${healthy.length} healthy: ${healthy.map((s) => s.name).join(", ")}`);
	return lines.join("\n");
}

function main(): void {
	const json = process.argv.includes("--json");

	let raw: string;
	try {
		raw = runMcporterList();
	} catch (error) {
		const message = (error as Error).message;
		if (json) {
			console.log(JSON.stringify({ status: "error", message }, null, 2));
		} else {
			console.error(`mcp-doctor: ${message}`);
			console.error("Restore mcporter through this machine's configured package owner or check it is on PATH.");
		}
		process.exitCode = 2;
		return;
	}

	const report = buildReport(raw);

	if (json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(renderText(report));
	}

	// Exit non-zero when any server is broken so callers can gate on it.
	process.exitCode = report.status === "ok" ? 0 : 1;
}

main();
