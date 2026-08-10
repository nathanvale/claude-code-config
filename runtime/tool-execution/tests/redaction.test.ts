import { expect, test } from "bun:test";
import {
	RUNTIME_CONTRACT_REDACTION_FIXTURES,
	assertNoRuntimeContractFixtureLeaks,
} from "@side-quest/cli-command-facade/testing";
import { redactValue, summarizeClassification } from "../src/redaction.ts";

test("redacts secret-bearing fields and stores only a result fingerprint", () => {
	const result = {
		isError: false,
		content: [{ type: "text", text: "retry with shell fallback" }],
		api_key: "secret-value",
		authorization: "Bearer secret-token",
	};

	expect(redactValue(result)).toEqual({
		isError: false,
		content: [{ type: "text", text: "retry with shell fallback" }],
		api_key: "[REDACTED]",
		authorization: "[REDACTED]",
	});
	expect(
		summarizeClassification({ class: "successful_tool_result", result }),
	).toEqual({
		class: "successful_tool_result",
		result_fingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
	});
});

test("redacts the facade baseline fixtures from provider-visible output", () => {
	const redacted = redactValue(
		Object.fromEntries(
			RUNTIME_CONTRACT_REDACTION_FIXTURES.map((fixture) => [
				fixture.label,
				fixture.value,
			]),
		),
	);
	assertNoRuntimeContractFixtureLeaks(redacted);
});

test("redacts credential values even when providers use neutral field names", () => {
	const redacted = redactValue({
		data: "sessionid=fixture-cookie",
		url: "https://example.test/callback?token=fixture-token#fragment",
		note: "api_key=fixture-key",
	});

	expect(redacted).toEqual({
		data: "[REDACTED]",
		url: "[REDACTED]",
		note: "[REDACTED]",
	});
	expect(JSON.stringify(redacted)).not.toContain("fixture-");
});

test("JSON-RPC error summaries accept integer codes only", () => {
	expect(
		summarizeClassification({
			class: "jsonrpc_protocol_or_server_error",
			error: { code: -32_000, message: "bounded failure" },
		}),
	).toMatchObject({ code: "-32000" });
	expect(
		summarizeClassification({
			class: "jsonrpc_protocol_or_server_error",
			error: { code: "token=fixture-secret", message: "hostile" },
		}),
	).not.toHaveProperty("code");
});
