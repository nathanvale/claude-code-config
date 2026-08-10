import type { TransportCommandVector } from "@side-quest/mcporter-transport";
import type { PreparedAdapterInvocation } from "../model.ts";
import type { ProviderResultClassification } from "../result-classifier.ts";

export type FirecrawlCliRequest = {
	operation: string;
	query: string;
	options?: Record<string, unknown>;
};

export type PrepareFirecrawlCliResult =
	| { ok: true; invocation: PreparedAdapterInvocation }
	| { ok: false; failure: ProviderResultClassification };

export async function prepareFirecrawlCliInvocation(
	request: FirecrawlCliRequest,
	resolveCommand: () => Promise<TransportCommandVector>,
): Promise<PrepareFirecrawlCliResult> {
	if (request.operation !== "search") {
		return {
			ok: false,
			failure: {
				class: "transport_or_client_policy_failure",
				code: "firecrawl_operation_denied",
				message: "Firecrawl CLI permits search only.",
			},
		};
	}
	if (request.options && Object.keys(request.options).length > 0) {
		return {
			ok: false,
			failure: {
				class: "transport_or_client_policy_failure",
				code: "firecrawl_options_unsupported",
				message: "Firecrawl CLI options are not admitted by this adapter.",
			},
		};
	}
	const [command, ...baseArgs] = await resolveCommand();
	return {
		ok: true,
		invocation: {
			command,
			args: [...baseArgs, "search", request.query, "--json"],
		},
	};
}
