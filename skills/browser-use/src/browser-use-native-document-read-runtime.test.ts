import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type {
	BrowserUseNativeDocumentReadPort,
	BrowserUseNativeDocumentReadRequest,
} from "./browser-use-agent-browser";
import { browserUseRunbookRuntimePorts } from "./browser-use";
import {
	buildBrowserUseNativeDocumentReadInvocation,
	browserUseNativeDocumentReadOutputIsSafe,
	createProductionBrowserUseRuntime,
	parseBrowserUseNativeDocumentReadProcessOutput,
} from "./browser-use-runtime";

const SCRIPT =
	"async () => ({ status: 'fields-required', fields: ['password'] })";

function request(
	overrides: Partial<BrowserUseNativeDocumentReadRequest> = {},
): BrowserUseNativeDocumentReadRequest {
	return {
		browser_ws_endpoint:
			"ws://127.0.0.1:9222/devtools/browser/browser-id",
		browser_pid: 4242,
		target_id: "target-1",
		document_id: "loader-1",
		top_level_origin: "https://identity.example.test",
		frame_origin: "https://identity.example.test",
		target_proof_digest: "b".repeat(64),
		script: SCRIPT,
		script_sha256: createHash("sha256").update(SCRIPT).digest("hex"),
		reset_navigation_history: false,
		...overrides,
	};
}

describe("native reviewed document read runtime", () => {
	test("keeps the browser endpoint and reviewed script in bounded stdin only", () => {
		const value = request();
		const invocation = buildBrowserUseNativeDocumentReadInvocation({
			native_bin_root: "/opt/browser-use/bin",
			request: value,
		});

		expect(invocation).toEqual({
			executable_path:
				"/opt/browser-use/bin/browser-use-confidential-delivery",
			argv: ["read-reviewed"],
			env: { PATH: "/usr/bin:/bin", LANG: "C" },
			stdin_text: JSON.stringify({
				schema_version: 1,
				browser_ws_endpoint: value.browser_ws_endpoint,
				browser_pid: value.browser_pid,
				target_id: value.target_id,
				document_id: value.document_id,
				top_level_origin: value.top_level_origin,
				frame_origin: value.frame_origin,
				target_proof_digest: value.target_proof_digest,
				script: value.script,
				script_sha256: value.script_sha256,
				reset_navigation_history: false,
			}),
			timeout_ms: 15_000,
		});
		expect(invocation.argv.join(" ")).not.toContain(
			value.browser_ws_endpoint,
		);
		expect(invocation.argv.join(" ")).not.toContain(value.script);
		expect(Buffer.byteLength(invocation.stdin_text, "utf8")).toBeLessThanOrEqual(
			131_072,
		);
	});

	test("rejects unsafe coordinates, origins, scripts, and script identity", () => {
		const invalid = [
			{ browser_ws_endpoint: "ws://attacker.test/devtools/browser/id" },
			{ browser_pid: 0 },
			{ target_id: "target id" },
			{ document_id: "loader id" },
			{ top_level_origin: "https://identity.example.test/path" },
			{ frame_origin: "javascript:alert(1)" },
			{ target_proof_digest: "not-a-digest" },
			{ reset_navigation_history: "yes" as never },
			{ script: "" },
			{ script_sha256: "a".repeat(64) },
		] as const;

		for (const overrides of invalid) {
			expect(() =>
				buildBrowserUseNativeDocumentReadInvocation({
					native_bin_root: "/opt/browser-use/bin",
					request: request(overrides),
				}),
			).toThrow("native reviewed document read request is inadmissible");
		}
	});

	test("rejects reflected endpoint or script output", () => {
		const value = request();
		expect(
			browserUseNativeDocumentReadOutputIsSafe({
				stdout: JSON.stringify({
					schema_version: 1,
					ok: true,
					proof: {},
					result: {},
				}),
				stderr: "",
				request: value,
			}),
		).toBe(true);
		expect(
			browserUseNativeDocumentReadOutputIsSafe({
				stdout: `unsafe ${value.browser_ws_endpoint}`,
				stderr: "",
				request: value,
			}),
		).toBe(false);
		expect(
			browserUseNativeDocumentReadOutputIsSafe({
				stdout: "",
				stderr: `unsafe ${value.script}`,
				request: value,
			}),
		).toBe(false);
	});

	test("accepts only the bounded exact success process contract", () => {
		const value = request();
		const success = {
			schema_version: 1,
			ok: true,
			proof: { target_id: value.target_id },
			result: { status: "fields-required", fields: ["password"] },
			navigation_history_sealed: false,
		};
		expect(
			parseBrowserUseNativeDocumentReadProcessOutput({
				stdout: JSON.stringify(success),
				stderr: "",
				exit_code: 0,
				signal_code: null,
				request: value,
			}),
		).toEqual(success);
		const invalidProcesses: Array<{
			stdout: string;
			exit_code: number;
			stderr?: string;
			signal_code?: NodeJS.Signals;
		}> = [
			{ stdout: JSON.stringify({ ...success, extra: true }), exit_code: 0 },
			{
				stdout: JSON.stringify({
					...success,
					navigation_history_sealed: true,
				}),
				exit_code: 0,
			},
			{ stdout: JSON.stringify(success), exit_code: 20 },
			{ stdout: JSON.stringify(success), exit_code: 0, signal_code: "SIGTERM" },
			{
				stdout: JSON.stringify(success),
				exit_code: 0,
				stderr: "x".repeat(65_537),
			},
		];
		for (const candidate of invalidProcesses) {
			expect(() =>
				parseBrowserUseNativeDocumentReadProcessOutput({
					stdout: candidate.stdout,
					stderr: candidate.stderr ?? "",
					exit_code: candidate.exit_code,
					signal_code: candidate.signal_code ?? null,
					request: value,
				}),
			).toThrow();
		}
	});

	test("production wiring supplies the native port and preserves an injected port", async () => {
		const production = await createProductionBrowserUseRuntime({ env: {} });
		expect(production.authDocumentRead).toBeDefined();
		expect(
			browserUseRunbookRuntimePorts(production)
				.authDocumentRead,
		).toBe(production.authDocumentRead);

		const injected: BrowserUseNativeDocumentReadPort = {
			readDocument: async () => ({
				schema_version: 1,
				ok: false,
				rejection: { code: "fixture" },
			}),
		};
		const overridden = await createProductionBrowserUseRuntime({
			env: {},
			authDocumentRead: injected,
		});
		expect(overridden.authDocumentRead).toBe(injected);
		expect(
			browserUseRunbookRuntimePorts(overridden)
				.authDocumentRead,
		).toBe(injected);
	});
});
