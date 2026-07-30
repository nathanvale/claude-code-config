import { describe, expect, test } from "bun:test";
import type { BrowserUseEnvironmentTokenCustodyState } from "./browser-use-environment-token";
import {
	assertEnvironmentTokenLifecycleExit,
	terminateEnvironmentTokenLifecycleProcess,
} from "./browser-use-runtime";

const READY: BrowserUseEnvironmentTokenCustodyState = {
	state: "ready",
	next_action: "validate-service-account",
};
const BLOCKED: BrowserUseEnvironmentTokenCustodyState = {
	state: "blocked",
	cause: "token-unsafe",
	next_action: "repair-token-custody",
};

describe("native environment-token lifecycle boundary", () => {
	test("accepts only exit 0 for nonblocked and exit 20 for blocked", () => {
		const cases = [
			{ exitCode: 0, signalCode: null, state: READY, accepted: true },
			{ exitCode: 20, signalCode: null, state: BLOCKED, accepted: true },
			{ exitCode: 0, signalCode: null, state: BLOCKED, accepted: false },
			{ exitCode: 20, signalCode: null, state: READY, accepted: false },
			{ exitCode: 1, signalCode: null, state: BLOCKED, accepted: false },
			{ exitCode: 2, signalCode: null, state: READY, accepted: false },
			{ exitCode: 70, signalCode: null, state: BLOCKED, accepted: false },
			{
				exitCode: 143,
				signalCode: "SIGTERM" as const,
				state: BLOCKED,
				accepted: false,
			},
			{
				exitCode: 137,
				signalCode: "SIGKILL" as const,
				state: READY,
				accepted: false,
			},
		];

		for (const item of cases) {
			const invoke = () =>
				assertEnvironmentTokenLifecycleExit(
					item.exitCode,
					item.signalCode,
					item.state,
				);
			if (item.accepted) {
				expect(invoke).not.toThrow();
			} else {
				expect(invoke).toThrow();
			}
		}
	});

	test("timeout sends SIGTERM and allows cleanup-aware exit", async () => {
		const child = fakeLifecycleProcess("SIGTERM");

		await terminateEnvironmentTokenLifecycleProcess(child, 5);

		expect(child.signals).toEqual(["SIGTERM"]);
	});

	test("timeout escalates to SIGKILL only after the bounded grace", async () => {
		const child = fakeLifecycleProcess("SIGKILL");

		await terminateEnvironmentTokenLifecycleProcess(child, 5);

		expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
	});
});

function fakeLifecycleProcess(exitOn: "SIGTERM" | "SIGKILL"): {
	exited: Promise<number>;
	kill(signal: "SIGTERM" | "SIGKILL"): void;
	signals: ("SIGTERM" | "SIGKILL")[];
} {
	let resolveExit: (exitCode: number) => void = () => {};
	const exited = new Promise<number>((resolve) => {
		resolveExit = resolve;
	});
	const signals: ("SIGTERM" | "SIGKILL")[] = [];
	return {
		exited,
		signals,
		kill(signal) {
			signals.push(signal);
			if (signal === exitOn) {
				queueMicrotask(() => resolveExit(signal === "SIGTERM" ? 143 : 137));
			}
		},
	};
}
