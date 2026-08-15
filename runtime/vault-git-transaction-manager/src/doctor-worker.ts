#!/usr/bin/env bun

import { pathToFileURL } from "node:url";

const delegateEntrypoint = required(
	"VAULT_GIT_DOCTOR_TASK_DELEGATE_ENTRYPOINT",
);
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
