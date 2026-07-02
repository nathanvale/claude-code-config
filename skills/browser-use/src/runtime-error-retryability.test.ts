import { describe, expect, test } from "bun:test";
import { createCliRuntimeError } from "@side-quest/cli-command-facade";
import {
	retryabilityForRecoverability,
	structuredRuntimeErrorInput,
} from "./runtime-error-retryability";

describe("runtime error retryability", () => {
	test("pairs retry recoverability with retryable true", () => {
		expect(retryabilityForRecoverability("retry")).toEqual({
			recoverability: "retry",
			retryable: true,
		});
	});

	test("pairs non-retry recoverability with retryable false", () => {
		expect(retryabilityForRecoverability("repair_state")).toEqual({
			recoverability: "repair_state",
			retryable: false,
		});
	});

	test("keeps compatible hint actions in structured runtime errors", () => {
		const error = createCliRuntimeError(
			structuredRuntimeErrorInput({
				run_id: "run-1",
				code: "repair_adapter",
				message: "Adapter config needs repair.",
				exit_code: 20,
				recoverability: "repair_state",
				hint: {
					summary: "Repair adapter config.",
					action: "repair_state",
				},
			}),
		);

		expect(error.retryable).toBe(false);
		expect(error.hint?.action).toBe("repair_state");
	});

	test("drops incompatible hint actions before facade validation", () => {
		const error = createCliRuntimeError(
			structuredRuntimeErrorInput({
				run_id: "run-1",
				code: "runtime_failure",
				message: "Unexpected runtime failure.",
				exit_code: 1,
				recoverability: "none",
				hint: {
					summary: "Stop and inspect diagnostics.",
					action: "repair_state",
					docs_url: "https://example.com/docs",
				},
			}),
		);

		expect(error.retryable).toBe(false);
		expect(error.hint).toEqual({
			summary: "Stop and inspect diagnostics.",
			docs_url: "https://example.com/docs",
		});
	});
});
