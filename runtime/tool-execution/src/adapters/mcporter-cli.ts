import type { TransportCommandVector } from "@side-quest/mcporter-transport";
import type { PreparedAdapterInvocation } from "../model.ts";
import type { ProviderResultClassification } from "../result-classifier.ts";

const MCP_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export type McporterCliRequest = {
	server: string;
	tool: string;
	arguments: Record<string, unknown>;
};

export type PrepareMcporterCliResult =
	| { ok: true; invocation: PreparedAdapterInvocation }
	| { ok: false; failure: ProviderResultClassification };

export async function prepareMcporterCliInvocation(
	request: McporterCliRequest,
	resolveCommand: () => Promise<TransportCommandVector>,
): Promise<PrepareMcporterCliResult> {
	if (!MCP_IDENTIFIER.test(request.server) || !MCP_IDENTIFIER.test(request.tool)) {
		return {
			ok: false,
			failure: {
				class: "transport_or_client_policy_failure",
				code: "mcporter_selector_invalid",
				message: "MCPorter server and tool names must be identifiers.",
			},
		};
	}
	if (request.server !== "firecrawl" || request.tool !== "firecrawl_search") {
		return {
			ok: false,
			failure: {
				class: "transport_or_client_policy_failure",
				code: "mcporter_tool_denied",
				message: "MCPorter permits firecrawl.firecrawl_search only.",
			},
		};
	}
	const [command, ...baseArgs] = await resolveCommand();
	return {
		ok: true,
		invocation: {
			command,
			args: [
				...baseArgs,
				"call",
				`${request.server}.${request.tool}`,
				"--args",
				JSON.stringify(request.arguments),
				"--output",
				"json",
				"--no-oauth",
			],
		},
	};
}
