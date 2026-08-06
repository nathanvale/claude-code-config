// bad-raw-runner: injects heal bug a — a check that spawns a RAW `bun test`
// instead of routing through the sanctioned test-runner.sh / MCP runners. The
// no-raw-runner clause MUST flag this source line.

export async function runTests(): Promise<number> {
	// Defect: raw runner invocation (code-quality rule forbids this).
	const proc = Bun.spawn(["bun", "test", "src/foo.test.ts"], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return await proc.exited;
}
