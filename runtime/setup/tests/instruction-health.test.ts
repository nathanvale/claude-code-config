import { describe, expect, test } from "bun:test";

import {
	checkInstructionHealth,
	runInstructionCheck,
	type InstructionChild,
} from "../src/instruction-health.ts";

describe("instruction health", () => {
	test("captures successful child output", async () => {
		const result = await checkInstructionHealth("/repo", async () => ({ exitCode: 0, stdout: "child out\n", stderr: "child err\n" }));
		expect(result).toMatchObject({ healthy: true, stdout: "child out\n", stderr: "child err\n" });
	});

	test("maps child failure to package-owned finding", async () => {
		const result = await checkInstructionHealth("/repo", async () => ({ exitCode: 1, stdout: "bad\n", stderr: "why\n" }));
		expect(result.finding).toMatchObject({ id: "instruction_unhealthy", repair: "repair_instructions" });
	});

	test("kills and awaits a hanging default check after its deadline", async () => {
		let resolveExit!: (exitCode: number) => void;
		let killedWith: NodeJS.Signals | number | undefined;
		let exited = false;
		const child: InstructionChild = {
			exited: new Promise<number>((resolve) => {
				resolveExit = (exitCode) => { exited = true; resolve(exitCode); };
			}),
			stdout: stream("partial output\n"),
			stderr: stream(""),
			kill: (signal) => { killedWith = signal; resolveExit(137); },
		};
		const runner = (script: string) => runInstructionCheck(script, {
			spawn: () => child,
			deadline: () => ({ expired: Promise.resolve(), cancel: () => undefined }),
		});

		const result = await checkInstructionHealth("/repo", runner);

		expect(killedWith).toBe("SIGKILL");
		expect(exited).toBe(true);
		expect(result).toMatchObject({
			healthy: false,
			exitCode: 1,
			stdout: "partial output\n",
			stderr: "Agent instruction health check timed out.\n",
			finding: { id: "instruction_unhealthy", repair: "repair_instructions" },
		});
	});
});

function stream(content: string): ReadableStream<Uint8Array> {
	return new Response(content).body as ReadableStream<Uint8Array>;
}
