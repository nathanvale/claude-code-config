import { join } from "node:path";

import type { SetupFinding } from "./model.ts";

export interface ChildResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export type InstructionRunner = (script: string) => Promise<ChildResult>;

export const INSTRUCTION_CHECK_TIMEOUT_MS = 10_000;

export interface InstructionChild {
	readonly exited: Promise<number>;
	readonly stdout: ReadableStream<Uint8Array>;
	readonly stderr: ReadableStream<Uint8Array>;
	kill(signal?: NodeJS.Signals | number): void;
}

export interface InstructionDeadline {
	readonly expired: Promise<void>;
	cancel(): void;
}

export interface InstructionCheckRuntime {
	readonly spawn?: (script: string) => InstructionChild;
	readonly deadline?: (timeoutMs: number) => InstructionDeadline;
	readonly timeoutMs?: number;
}

export interface InstructionHealthResult extends ChildResult {
	readonly healthy: boolean;
	readonly finding?: SetupFinding;
}

export async function checkInstructionHealth(
	repoRoot: string,
	runner: InstructionRunner = runInstructionCheck,
): Promise<InstructionHealthResult> {
	const script = join(repoRoot, "scripts/agent-instructions.sh");
	try {
		const child = await runner(script);
		if (child.exitCode === 0) return { healthy: true, ...child };
		return { healthy: false, ...child, finding: unhealthy(script) };
	} catch (error) {
		return { healthy: false, exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error), finding: unhealthy(script) };
	}
}

export async function runInstructionCheck(
	script: string,
	runtime: InstructionCheckRuntime = {},
): Promise<ChildResult> {
	const child = runtime.spawn?.(script) ?? Bun.spawn(["bash", script, "check"], { stdout: "pipe", stderr: "pipe" });
	const deadline = (runtime.deadline ?? scheduleDeadline)(runtime.timeoutMs ?? INSTRUCTION_CHECK_TIMEOUT_MS);
	const stdout = new Response(child.stdout).text();
	const stderr = new Response(child.stderr).text();
	const outcome = await Promise.race([
		child.exited.then((exitCode) => ({ kind: "exit" as const, exitCode })),
		deadline.expired.then(() => ({ kind: "timeout" as const })),
	]);
	deadline.cancel();
	if (outcome.kind === "timeout") {
		child.kill("SIGKILL");
		await child.exited;
		const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr]);
		return {
			exitCode: 1,
			stdout: capturedStdout,
			stderr: `${capturedStderr}${capturedStderr.endsWith("\n") || capturedStderr.length === 0 ? "" : "\n"}Agent instruction health check timed out.\n`,
		};
	}
	const [capturedStdout, capturedStderr] = await Promise.all([stdout, stderr]);
	return { exitCode: outcome.exitCode, stdout: capturedStdout, stderr: capturedStderr };
}

function scheduleDeadline(timeoutMs: number): InstructionDeadline {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
	return { expired, cancel: () => clearTimeout(timer) };
}

function unhealthy(path: string): SetupFinding {
	return { id: "instruction_unhealthy", owner: "scripts/agent-instructions.sh", path, summary: "Agent instruction health check failed.", repair: "repair_instructions" };
}
