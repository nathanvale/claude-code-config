#!/usr/bin/env bun

// Compatibility wrapper. Canonical owner: skills/create-skill/scripts/skill-description-audit.ts.

import { fileURLToPath } from "node:url";

const canonicalAuditPath = fileURLToPath(
	new URL("../skills/create-skill/scripts/skill-description-audit.ts", import.meta.url),
);
const command = [
	"bun",
	"run",
	canonicalAuditPath,
	...Bun.argv.slice(2),
];

const child = Bun.spawnSync(command, {
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});

process.exitCode = child.exitCode;
