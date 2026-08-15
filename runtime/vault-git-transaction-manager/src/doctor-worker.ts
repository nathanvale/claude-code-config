#!/usr/bin/env bun

import { pathToFileURL } from "node:url";

import { createVaultGitDoctorTaskStore } from "./doctor-task-store.ts";

const taskId = required("VAULT_GIT_DOCTOR_TASK_ID");
const launchGeneration = required(
	"VAULT_GIT_DOCTOR_TASK_LAUNCH_GENERATION",
);
const stateRoot = required("VAULT_GIT_STATE_ROOT");
const repositoryId = required("VAULT_GIT_DOCTOR_TASK_REPOSITORY_ID");
const delegateEntrypoint = required(
	"VAULT_GIT_DOCTOR_TASK_DELEGATE_ENTRYPOINT",
);
const taskStore = createVaultGitDoctorTaskStore({ stateRoot, repositoryId });
const registrationDeadline = performance.now() + 900;
let loaded = await taskStore.loadByTaskId(taskId);
while (
	loaded.status === "loaded" &&
	loaded.state.state === "launching" &&
	loaded.state.launchGeneration === launchGeneration &&
	loaded.state.workerPid === null &&
	performance.now() < registrationDeadline
) {
	await Bun.sleep(10);
	loaded = await taskStore.loadByTaskId(taskId);
}
if (
	loaded.status !== "loaded" ||
	loaded.state.state !== "launching" ||
	loaded.state.launchGeneration !== launchGeneration ||
	loaded.state.workerPid !== process.pid ||
	loaded.state.workerProcessIdentity === null
) {
	throw new Error("Background Doctor bootstrap acknowledgement refused");
}
const acknowledgedAt = new Date().toISOString();
const acknowledged = await taskStore.transition(
	taskId,
	loaded.state.revision,
	{
		state: "in_progress",
		phase: "running",
		updatedAt: acknowledgedAt,
		heartbeatAt: acknowledgedAt,
		checkpoint: "checking_remote",
		launchGeneration,
		launchExpiresAt: null,
		workerPid: process.pid,
		workerProcessIdentity: loaded.state.workerProcessIdentity,
		launchAttempt: loaded.state.launchAttempt,
		terminalResult: null,
	},
	launchGeneration,
);
if (acknowledged.status !== "transitioned") {
	throw new Error("Background Doctor bootstrap acknowledgement lost");
}
process.env.VAULT_GIT_DOCTOR_TASK_ACKNOWLEDGED = "1";
const delegated = (await import(pathToFileURL(delegateEntrypoint).href)) as {
	readonly main?: (
		args: readonly string[],
	) => Promise<number>;
};
if (delegated.main) {
	process.exitCode = await delegated.main(Bun.argv.slice(2));
}

function required(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error("missing Background Doctor worker input");
	return value;
}
