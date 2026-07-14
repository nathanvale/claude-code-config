#!/usr/bin/env bun

// U1 scaffold: stub entrypoint so the package exists and passes every
// workspace gate. U6 replaces this with the facade-backed dispatcher
// (prove, inject, exec) built on @side-quest/cli-command-facade.

export async function main(_argv: readonly string[]): Promise<number> {
	return 0;
}

if (import.meta.main) {
	const exitCode = await main(Bun.argv.slice(2));
	process.exit(exitCode);
}
