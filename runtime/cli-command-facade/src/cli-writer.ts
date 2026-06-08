export type CliWriter = {
	write(chunk: string): unknown;
};

export function writeJson(stdout: CliWriter, value: unknown): void {
	stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export const CLI_WRITER_CONTRACT_EXIT_CODE = 70;

export type CliWriterContractEvent =
	| "cli-writer-no-context"
	| "cli-writer-run-id-conflict"
	| "cli-writer-duration-ms-conflict"
	| "cli-writer-error-envelope-zero-exit";

export class CliWriterContractError extends Error {
	constructor(
		readonly event: CliWriterContractEvent,
		message: string,
		readonly properties: Record<string, unknown> = {},
	) {
		super(message);
		this.name = "CliWriterContractError";
	}

	readonly exitCode = CLI_WRITER_CONTRACT_EXIT_CODE;
}

export type CliJsonEnvelopeRuntime = {
	runId: string;
	durationMs: number;
};

export function writeJsonEnvelope(
	stdout: CliWriter,
	value: unknown,
	runtime: CliJsonEnvelopeRuntime,
): void {
	if (!isJsonObject(value)) {
		writeJson(stdout, value);
		return;
	}

	if (value.duration_ms !== undefined) {
		throw new CliWriterContractError(
			"cli-writer-duration-ms-conflict",
			"Facade JSON envelopes own top-level duration_ms.",
			{ result_duration_ms: value.duration_ms },
		);
	}

	const existingRunId = value.run_id;
	if (existingRunId !== undefined && existingRunId !== runtime.runId) {
		throw new CliWriterContractError(
			"cli-writer-run-id-conflict",
			"Facade JSON envelopes own top-level run_id.",
			{ result_run_id: existingRunId, cli_run_id: runtime.runId },
		);
	}

	writeJson(stdout, {
		...value,
		run_id: runtime.runId,
		duration_ms: runtime.durationMs,
	});
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
