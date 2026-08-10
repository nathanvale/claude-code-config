export type ProviderObservation =
	| {
			kind: "transport_failure";
			code: string;
			message: string;
	  }
	| { kind: "response"; value: unknown };

export type ProviderResultClassification =
	| {
			class: "transport_or_client_policy_failure";
			code: string;
			message: string;
	  }
	| {
			class: "jsonrpc_protocol_or_server_error";
			error: unknown;
	  }
	| {
			class: "tool_error";
			result: Record<string, unknown>;
	  }
	| {
			class: "successful_tool_result";
			result: Record<string, unknown>;
	  };

export function classifyProviderResult(
	observation: ProviderObservation,
): ProviderResultClassification {
	if (observation.kind === "transport_failure") {
		return {
			class: "transport_or_client_policy_failure",
			code: observation.code,
			message: observation.message,
		};
	}
	if (
		observation.kind === "response" &&
		isRecord(observation.value) &&
		"error" in observation.value
	) {
		return {
			class: "jsonrpc_protocol_or_server_error",
			error: observation.value.error,
		};
	}
	if (
		observation.kind === "response" &&
		isRecord(observation.value) &&
		"result" in observation.value &&
		isRecord(observation.value.result)
	) {
		if (observation.value.result.isError === true) {
			return {
				class: "tool_error",
				result: observation.value.result,
			};
		}
		return {
			class: "successful_tool_result",
			result: observation.value.result,
		};
	}
	return {
		class: "transport_or_client_policy_failure",
		code: "malformed_provider_response",
		message: "Provider response did not match the expected protocol shape.",
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
