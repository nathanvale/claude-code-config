#!/usr/bin/env bun

import { existsSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { createVaultGitCliComposition, main } from "../../src/cli.ts";
import { createNodeVaultGitRuntime } from "../../src/clock.ts";

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`missing ${name}`);
	return value;
};

const gate = process.env.VAULT_GIT_TEST_START_GATE;
if (gate) {
	await writeFile(`${gate}.ready`, "ready\n");
	while (!existsSync(gate)) await Bun.sleep(10);
}

const leaseDurationMs = Number(
	process.env.VAULT_GIT_TEST_LEASE_DURATION_MS ?? 15 * 60_000,
);
const baseRuntime = createNodeVaultGitRuntime({
	actor: required("VAULT_GIT_ACTOR"),
	host: required("VAULT_GIT_HOST"),
});
const interruptPoint = process.env.VAULT_GIT_TEST_INTERRUPT_POINT;
const interruptGate = process.env.VAULT_GIT_TEST_INTERRUPT_GATE;
const runtime =
	interruptPoint && interruptGate
		? {
				...baseRuntime,
				interrupt(point: string): void {
					if (point !== interruptPoint) return;
					writeFileSync(`${interruptGate}.ready`, `${point}\n`);
					while (!existsSync(interruptGate)) {
						Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
					}
				},
			}
		: baseRuntime;
const composition = await createVaultGitCliComposition({
	repositoryPath: required("VAULT_GIT_REPOSITORY_PATH"),
	checkRepositoryPath: required("VAULT_GIT_CHECK_REPOSITORY_PATH"),
	stateRoot: required("VAULT_GIT_STATE_ROOT"),
	repositoryIdentity: required("VAULT_GIT_REPOSITORY_IDENTITY"),
	actor: required("VAULT_GIT_ACTOR"),
	host: required("VAULT_GIT_HOST"),
	remote: process.env.VAULT_GIT_REMOTE ?? "origin",
	leaseDurationMs,
	runtime,
});

process.exitCode = await main(Bun.argv.slice(2), { composition });
