#!/usr/bin/env bun

import { rm, writeFile } from "node:fs/promises";

import { applySetupDomains, checkSetupDomains, unlinkSetupDomains } from "../src/setup-domains.ts";
import { main, type SetupCliRuntime } from "../src/cli.ts";
import { inspectSetup } from "../src/inspection.ts";

const sourceRepoRoot = required("SETUP_FIXTURE_SOURCE");
const homeDir = required("SETUP_FIXTURE_HOME");
const stateRoot = required("SETUP_FIXTURE_STATE");
const hookRoot = required("SETUP_FIXTURE_HOOKS");
const fault = process.env.SETUP_FIXTURE_FAULT ?? "none";
let unlinkCount = 0;

const runtime: Partial<SetupCliRuntime> = {
	sourceRepoRoot,
	homeDir,
	inspect: async (input) => {
		if (fault === "runtime") throw new Error("fixture inspection failure");
		return inspectSetup(input);
	},
	checkDomains: async (input, base) => checkSetupDomains(input, base, {
		stateRoot,
		hookPath: async () => {
			if (fault === "hook") throw new Error("fixture hook failure");
			return hookRoot;
		},
	}),
	apply: async (input) => {
		if (fault === "runtime") throw new Error("fixture apply failure");
		return applySetupDomains(input, {
			stateRoot,
			hookPath: async () => {
				if (fault === "hook") throw new Error("fixture hook failure");
				return hookRoot;
			},
			beforeSymlink: async (_source, destination) => {
				if (fault === "apply_failure") throw new Error("fixture syscall failure");
				if (fault === "concurrent") await writeFile(destination, "foreign\n");
			},
		});
	},
	unlink: async (input, check) => {
		if (fault === "runtime") throw new Error("fixture unlink failure");
		return unlinkSetupDomains(input, {
			check,
			stateRoot,
			beforeRemove: async (path) => {
				unlinkCount += 1;
				if (fault === "unlink_failure" && unlinkCount === 2) {
					throw new Error("fixture remove failure");
				}
				if (fault === "unlink_concurrent") {
					await rm(path);
					await writeFile(path, "foreign\n");
				}
			},
		});
	},
	commands: () => {
		if (fault === "commands_runtime") throw new Error("fixture discovery failure");
		throw new Error("commands adapter should only run for the injected failure");
	},
};

if (fault !== "commands_runtime") delete runtime.commands;
process.exitCode = await main(process.argv.slice(2), { runtime });

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
}
