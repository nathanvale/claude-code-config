#!/usr/bin/env bun

import {
	createVaultGitCliComposition,
	main,
} from "../src/cli.ts";
import { persistedActivationAuthorityForTest } from "./activation-fixture.ts";

const required = (name: string): string => {
	const value = process.env[name];
	if (!value) throw new Error(`missing ${name}`);
	return value;
};

const baseInput = {
	repositoryPath: required("VAULT_GIT_REPOSITORY_PATH"),
	checkRepositoryPath: required("VAULT_GIT_CHECK_REPOSITORY_PATH"),
	stateRoot: required("VAULT_GIT_STATE_ROOT"),
	actor: required("VAULT_GIT_ACTOR"),
	host: required("VAULT_GIT_HOST"),
	remote: process.env.VAULT_GIT_REMOTE ?? "origin",
	privateEntrypointPath: import.meta.path,
} as const;
const storeComposition = await createVaultGitCliComposition(baseInput);
const composition = await createVaultGitCliComposition({
	...baseInput,
	activationAuthority: persistedActivationAuthorityForTest(
		storeComposition.store,
	),
});

process.exitCode = await main(Bun.argv.slice(2), { composition });
