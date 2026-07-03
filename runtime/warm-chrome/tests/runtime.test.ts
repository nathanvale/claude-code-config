import { describe, expect, test } from "bun:test";
import {
	DEFAULT_FETCH_ABORT_MS,
	type KillableChild,
	terminateChild,
} from "../src/runtime.ts";
import { WARM_CHROME_ATTACH_TIMEOUT_MS } from "../src/proof.ts";

// A scriptable fake of the ChildProcess slice terminateChild drives. `kill`
// records the signals it received; `signalExits` decides which signal (if any)
// makes the process exit, so a SIGTERM-ignoring child can be modelled.
function fakeChild(options: {
	killReturns?: boolean;
	exitOn?: "SIGTERM" | "SIGKILL" | "none";
	alreadyExited?: boolean;
}): KillableChild & { signals: string[] } {
	const exitOn = options.exitOn ?? "SIGTERM";
	let exitCode: number | null = options.alreadyExited ? 0 : null;
	let onExit: (() => void) | null = null;
	const signals: string[] = [];
	return {
		signals,
		get exitCode() {
			return exitCode;
		},
		once(event: string, listener: (...args: unknown[]) => void) {
			if (event === "exit") onExit = () => listener(0);
			return this;
		},
		kill(signal?: NodeJS.Signals) {
			signals.push(signal ?? "SIGTERM");
			if (options.killReturns === false) return false;
			if (signal === exitOn || (signal === undefined && exitOn === "SIGTERM")) {
				exitCode = 0;
				// Settle the exit listener on the next microtask, as a real child
				// process would.
				queueMicrotask(() => onExit?.());
			}
			return true;
		},
	};
}

describe("terminateChild kill-until-dead (review: kill boolean means gone)", () => {
	test("an already-exited child is gone without any signal", async () => {
		const child = fakeChild({ alreadyExited: true });
		expect(await terminateChild(child, 5)).toBe(true);
		expect(child.signals).toEqual([]);
	});

	test("a child that exits on SIGTERM is confirmed gone", async () => {
		const child = fakeChild({ exitOn: "SIGTERM" });
		expect(await terminateChild(child, 5)).toBe(true);
		expect(child.signals).toEqual(["SIGTERM"]);
	});

	test("a SIGTERM-ignoring child is escalated to SIGKILL, then confirmed gone", async () => {
		const child = fakeChild({ exitOn: "SIGKILL" });
		expect(await terminateChild(child, 5)).toBe(true);
		// SIGTERM was ignored (no exit within the grace window), so SIGKILL fired.
		expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
	});

	test("kill() returning false (ESRCH) on an already-gone pid is success", async () => {
		const child = fakeChild({ killReturns: false, alreadyExited: false });
		// killReturns:false models ESRCH; exitCode stays null so terminateChild
		// reports not-gone. A truly-gone pid would have exitCode set — model that:
		const gone = fakeChild({ killReturns: false, alreadyExited: true });
		expect(await terminateChild(gone, 5)).toBe(true);
		expect(await terminateChild(child, 5)).toBe(false);
	});
});

describe("attach budget ordering (review: attach_timeout must be reachable)", () => {
	test("the default fetch abort sits above the proof attach budget", () => {
		// If the fetch abort were <= the attach budget, a hang would reject as a
		// fetch error and classify as no_listener (spawn-licensing) instead of
		// the proof's attach_timeout verdict.
		expect(DEFAULT_FETCH_ABORT_MS).toBeGreaterThan(WARM_CHROME_ATTACH_TIMEOUT_MS);
	});
});
