import { describe, expect, test } from "bun:test";
import {
	findCommandDiscoveryTreeDrift,
	findCommandFacadeMetadataDrift,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import {
	parseSetupInvocation,
	projectSetupCommandDiscoveryTree,
	setupContractEntries,
	setupContracts,
} from "../src/command-contract.ts";
import { SETUP_COMMANDS } from "../src/model.ts";

describe("setup command contract", () => {
	test("declares the complete facade-owned public surface", () => {
		expect(Object.keys(setupContracts)).toEqual([...SETUP_COMMANDS]);
		expect(setupContractEntries.map(([command]) => command)).toEqual([
			...SETUP_COMMANDS,
		]);
		expect(findCommandFacadeMetadataDrift(setupContracts, {
			path: "runtime/setup/src/command-contract.ts",
			writeImplyingMutations: new Set(["write"]),
		})).toEqual([]);
		expect(findCommandDiscoveryTreeDrift(projectSetupCommandDiscoveryTree())).toEqual([]);
	});

	test("renders every advertised flag from the contract", () => {
		for (const command of SETUP_COMMANDS) {
			assertCommandHelpFlagSurface({
				command,
				contract: setupContracts[command],
				help: renderCommandUsage(setupContracts[command]),
			});
		}
	});

	test("keeps command-foreign flags out of help and parser acceptance", () => {
		expect(renderCommandUsage(setupContracts.status)).not.toContain("--check");
		expect(renderCommandUsage(setupContracts.commands)).not.toContain("--scope");
		expect(() => parseSetupInvocation(["status", "--check"])).toThrow(
			"Unsupported flag for status: --check",
		);
		expect(() => parseSetupInvocation(["commands", "--verbose"])).toThrow(
			"Unsupported flag for commands: --verbose",
		);
	});

	test("routes no arguments to read-only user status", () => {
		expect(parseSetupInvocation([])).toEqual({
			command: "status",
			scope: "user",
			positionals: [],
			json: false,
			verbose: false,
			noColor: false,
			check: false,
			alias: "no_args",
		});
	});

	test("accepts every advertised flag with explicit project scope", () => {
		expect(parseSetupInvocation([
			"sync",
			"--check",
			"--scope",
			"project",
			"--repo",
			"/tmp/project",
			"--json",
			"--verbose",
			"--no-color",
		])).toMatchObject({
			command: "sync",
			scope: "project",
			repo: "/tmp/project",
			json: true,
			verbose: true,
			noColor: true,
			check: true,
		});
	});

	test("rejects invalid scope and repo combinations", () => {
		expect(() => parseSetupInvocation(["status", "--scope", "other"])).toThrow(
			"--scope must be one of: user, project",
		);
		expect(() => parseSetupInvocation(["status", "--scope", "project"])).toThrow(
			"--scope project requires --repo",
		);
		expect(() => parseSetupInvocation(["status", "--repo", "/tmp/project"])).toThrow(
			"--repo requires --scope project",
		);
	});

	test("limits catalog to one optional skill and commands to JSON only", () => {
		expect(parseSetupInvocation(["catalog", "fallow"])).toMatchObject({
			command: "catalog",
			positionals: ["fallow"],
		});
		expect(() => parseSetupInvocation(["catalog", "one", "two"])).toThrow(
			"catalog accepts at most one skill id",
		);
		expect(() => parseSetupInvocation(["commands"])).toThrow(
			"commands requires --json",
		);
		expect(parseSetupInvocation(["commands", "--json"])).toMatchObject({
			command: "commands",
			json: true,
		});
	});
});
