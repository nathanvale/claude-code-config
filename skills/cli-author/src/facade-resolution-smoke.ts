#!/usr/bin/env bun

import { COMMAND_FACADE_BASELINE_EXIT_CODES } from "@side-quest/cli-command-facade";

if (!COMMAND_FACADE_BASELINE_EXIT_CODES.includes("0")) {
	throw new Error("Facade baseline exit codes failed to resolve.");
}
