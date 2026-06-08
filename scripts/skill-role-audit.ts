#!/usr/bin/env bun

// Compatibility wrapper. Canonical owner: skills/create-skill/scripts/skill-role-audit.ts.

const command = [
	"bun",
	"run",
	"skills/create-skill/scripts/skill-role-audit.ts",
	...Bun.argv.slice(2),
];

const child = Bun.spawnSync(command, {
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

process.exitCode = child.exitCode;
