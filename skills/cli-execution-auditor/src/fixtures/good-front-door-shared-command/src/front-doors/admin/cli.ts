#!/usr/bin/env bun

const args = Bun.argv.slice(2);
const json = args.includes("--json");
const command = args.find((arg) => !arg.startsWith("-"));

if (command !== "check") {
	if (json) {
		process.stdout.write(
			`${JSON.stringify({
				status: "error",
				run_id: "admin",
				error: { code: "usage_error" },
			})}\n`,
		);
	} else {
		process.stderr.write("usage error\n");
	}
	process.exit(2);
}

if (json) {
	process.stdout.write(
		`${JSON.stringify({ status: "ok", run_id: "admin", data: { action: "clean" } })}\n`,
	);
} else {
	process.stdout.write("admin clean\n");
}
