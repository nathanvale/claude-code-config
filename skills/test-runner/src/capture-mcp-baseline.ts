#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BENCHMARK_FIXTURES, type BenchmarkFixture } from "./test-runner.benchmark";

type JsonRpcMessage = {
	jsonrpc: "2.0";
	id?: number;
	method?: string;
	params?: unknown;
	result?: {
		content?: Array<{ type: string; text: string }>;
		structuredContent?: {
			failed?: number;
		};
		isError?: boolean;
	};
	error?: unknown;
};

const SKILL_ROOT = join(import.meta.dir, "..");
const OUTPUT_PATH = join(
	SKILL_ROOT,
	"var",
	"benchmark-input",
	"mcp-baseline.json",
);
const MCP_COMMAND = ["bunx", "--bun", "@side-quest/bun-runner"] as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function main(): Promise<void> {
	const cwd = import.meta.dir;
	const proc = Bun.spawn([...MCP_COMMAND], {
		cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const pending = new Map<number, (message: JsonRpcMessage) => void>();
	const stdoutDone = pumpJsonLines(proc.stdout, pending);
	let nextId = 1;

	const call = (method: string, params: unknown): Promise<JsonRpcMessage> => {
		const id = nextId;
		nextId += 1;
		const message: JsonRpcMessage = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};
		proc.stdin.write(encoder.encode(`${JSON.stringify(message)}\n`));
		return new Promise((resolve) => pending.set(id, resolve));
	};

	await call("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "test-runner-mcp-baseline", version: "0.1.0" },
	});
	proc.stdin.write(
		encoder.encode(
			`${JSON.stringify({
				jsonrpc: "2.0",
				method: "notifications/initialized",
				params: {},
			})}\n`,
		),
	);

	const rows = [];
	for (const fixture of BENCHMARK_FIXTURES) {
		if (fixture.bunArgs.length > 0) {
			rows.push(createUnsupportedArgsRow(fixture));
			continue;
		}
		const response = await call("tools/call", {
			name: "bun_testFile",
			arguments: {
				file: fixture.file,
				response_format: "json",
			},
		});
		const stdoutSample =
			response.result?.content?.find((entry) => entry.type === "text")?.text ?? "";
		const failed = response.result?.structuredContent?.failed ?? 0;
		rows.push({
			fixture: fixture.label,
			variant: "mcp-runner",
			exit_code: failed > 0 || response.result?.isError ? 1 : 0,
			wall_time_ms: null,
			stdout_sample: stdoutSample,
			stderr_sample: "",
			notes: [
				"captured through @side-quest/bun-runner MCP stdio server",
				"tool=bun_testFile",
				"response_format=json",
			],
		});
	}

	const artifact = {
		provenance: {
			source: "@side-quest/bun-runner MCP stdio server",
			command: MCP_COMMAND.join(" "),
			cwd,
			captured_at: new Date().toISOString(),
			limitation:
				"bun_testFile cannot pass arbitrary Bun args; fixtures with bunArgs are marked unsupported.",
		},
		rows,
	};
	await mkdir(join(OUTPUT_PATH, ".."), { recursive: true });
	await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
	proc.kill("SIGTERM");
	await stdoutDone.catch(() => undefined);
	await proc.exited.catch(() => undefined);
}

function createUnsupportedArgsRow(fixture: BenchmarkFixture): Record<string, unknown> {
	return {
		fixture: fixture.label,
		variant: "mcp-runner",
		exit_code: null,
		wall_time_ms: null,
		stdout_sample: "",
		stderr_sample: "",
		skip_reason: `MCP bun_testFile cannot pass fixture Bun args: ${fixture.bunArgs.join(" ")}`,
		notes: [
			"MCP row exists but is not comparable for this fixture.",
			"Use this as a named incumbent surface blocker, not a token baseline.",
		],
	};
}

async function pumpJsonLines(
	stream: ReadableStream<Uint8Array>,
	pending: Map<number, (message: JsonRpcMessage) => void>,
): Promise<void> {
	const reader = stream.getReader();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			const message = JSON.parse(line) as JsonRpcMessage;
			if (typeof message.id !== "number") continue;
			pending.get(message.id)?.(message);
			pending.delete(message.id);
		}
	}
}

if (import.meta.main) {
	await main();
}
