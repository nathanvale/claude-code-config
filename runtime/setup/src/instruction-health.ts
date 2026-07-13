import { join } from "node:path";

import type { SetupFinding } from "./model.ts";

export interface ChildResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export type InstructionRunner = (script: string) => Promise<ChildResult>;

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

async function runInstructionCheck(script: string): Promise<ChildResult> {
	const child = Bun.spawn(["bash", script, "check"], { stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

function unhealthy(path: string): SetupFinding {
	return { id: "instruction_unhealthy", owner: "scripts/agent-instructions.sh", path, summary: "Agent instruction health check failed.", repair: "repair_instructions" };
}
