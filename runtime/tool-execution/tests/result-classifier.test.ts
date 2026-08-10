import { describe, expect, test } from "bun:test";
import { classifyProviderResult } from "../src/result-classifier.ts";

describe("classifyProviderResult", () => {
	test("accepts an empty successful tool result", () => {
		expect(
			classifyProviderResult({
				kind: "response",
				value: { jsonrpc: "2.0", id: 1, result: { content: [] } },
			}),
		).toEqual({
			class: "successful_tool_result",
			result: { content: [] },
		});
	});

	test("keeps JSON-RPC server errors out of the tool-error class", () => {
		expect(
			classifyProviderResult({
				kind: "response",
				value: {
					jsonrpc: "2.0",
					id: 1,
					error: { code: -32_001, message: "Method missing" },
				},
			}),
		).toEqual({
			class: "jsonrpc_protocol_or_server_error",
			error: { code: -32_001, message: "Method missing" },
		});
	});

	test("classifies a successful protocol response with isError as a tool error", () => {
		expect(
			classifyProviderResult({
				kind: "response",
				value: {
					jsonrpc: "2.0",
					id: 1,
					result: { isError: true, content: [{ type: "text", text: "Denied" }] },
				},
			}),
		).toEqual({
			class: "tool_error",
			result: {
				isError: true,
				content: [{ type: "text", text: "Denied" }],
			},
		});
	});

	test("classifies a client policy refusal as a transport or client-policy failure", () => {
		expect(
			classifyProviderResult({
				kind: "transport_failure",
				code: "route_denied",
				message: "Route is not allowed.",
			}),
		).toEqual({
			class: "transport_or_client_policy_failure",
			code: "route_denied",
			message: "Route is not allowed.",
		});
	});

	test("classifies malformed provider data as a client-policy failure, not a tool error", () => {
		expect(
			classifyProviderResult({ kind: "response", value: { unexpected: true } }),
		).toEqual({
			class: "transport_or_client_policy_failure",
			code: "malformed_provider_response",
			message: "Provider response did not match the expected protocol shape.",
		});
	});
});
