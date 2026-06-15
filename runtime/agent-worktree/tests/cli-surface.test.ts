import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { renderCommandUsage } from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import type { AgentWorktreeCliRuntime } from "../src/cli.ts";
import { agentWorktreeContracts } from "../src/command-contract.ts";
import { createFileStore } from "../src/store.ts";
import {
	mainRepoGitOutputs,
	repoRuntime,
	runJsonCli,
	type TestJsonEnvelope,
} from "./support.ts";

describe("agent-worktree CLI surface", () => {
	test("every advertised flag appears in rendered help", () => {
		for (const command of Object.keys(agentWorktreeContracts) as Array<
			keyof typeof agentWorktreeContracts
		>) {
			const help = renderCommandUsage(agentWorktreeContracts[command]);
			assertCommandHelpFlagSurface({
				command,
				contract: agentWorktreeContracts[command],
				help,
			});
		}
	});

	test("delete advertises the explicit branch deletion gate", () => {
		const help = renderCommandUsage(agentWorktreeContracts.delete);

		expect(help).toContain("--delete-branch");
		expect(Object.keys(agentWorktreeContracts.delete.flags)).toContain(
			"--delete-branch",
		);
	});

	test("create advertises the explicit base selector", () => {
		const help = renderCommandUsage(agentWorktreeContracts.create);

		expect(help).toContain("--base");
		expect(Object.keys(agentWorktreeContracts.create.flags)).toContain("--base");
	});

	test("context-heavy reads advertise projection flags", () => {
		for (const command of ["doctor", "list", "status", "clean", "handoff"] as const) {
			const flags = Object.keys(agentWorktreeContracts[command].flags);
			expect(flags).toContain("--limit");
			expect(flags).toContain("--fields");
			expect(flags).toContain("--select");
		}
	});

	test("projection flags shape read command output", async () => {
		const outputs = {
			...mainRepoGitOutputs("/repo"),
			["git status --porcelain"]: "",
			["git rev-parse --is-shallow-repository"]: "false\n",
			["git merge-base --is-ancestor main main"]: "",
			["git rev-list --left-right --count main...main"]: "0 0\n",
		};
		const { exitCode, envelope } = await runJsonCli(
			[
				"doctor",
				"--fields",
				"actions",
				"--select",
				"mutation_readiness",
				"--repo",
				"/repo",
				"--json",
			],
			{ runtime: repoRuntime("/repo", outputs) },
		);

		expect(exitCode).toBe(0);
		expect(envelope.data).toMatchObject({
			contract_id: "agent-worktree.lifecycle",
			mutation_readiness: "ready",
			blockers: [],
			next_actions: [],
		});
		expect(envelope.data?.checks).toBeUndefined();
		expect(envelope.data?.summary).toBeUndefined();
	});

	test("unknown projection fields fail instead of acting inertly", async () => {
		const envelope = await expectUsageError([
			"doctor",
			"--fields",
			"unknown",
			"--json",
		]);

		expect(envelope.error?.message).toContain("Unsupported --fields value");
	});

	test("unknown projection selectors fail instead of acting inertly", async () => {
		const { exitCode, envelope } = await runJsonCli(
			["doctor", "--select", "missing", "--repo", "/repo", "--json"],
			{
				runtime: repoRuntime("/repo", {
					...mainRepoGitOutputs("/repo"),
					["git status --porcelain"]: "",
					["git rev-parse --is-shallow-repository"]: "false\n",
					["git merge-base --is-ancestor main main"]: "",
					["git rev-list --left-right --count main...main"]: "0 0\n",
				}),
			},
		);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.message).toContain("--select field 'missing'");
	});

	test("foreign flags fail with exit code 2 and JSON stdout", async () => {
		await expectUsageError([
			"list",
			"--force",
			"--json",
		]);
	});

	test("delete-only branch deletion flag is rejected by other commands", async () => {
		await expectUsageError([
			"list",
			"--delete-branch",
			"--json",
		]);
	});

	test("removed no-input flag is rejected instead of advertised inertly", async () => {
		await expectUsageError([
			"delete",
			"feat/x",
			"--no-input",
			"--json",
		]);
	});

	test("delete normal execution requires force before runtime mutation", async () => {
		const { exitCode, envelope } = await runJsonCli([
			"delete",
			"feat/x",
			"--json",
		]);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.message).toContain("--force");
	});

	test("delete target misses exit non-zero with lifecycle recovery data", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-worktree-cli-delete-missing-"));
		const envelope = await expectRuntimeError(
			["delete", "feat/missing", "--force", "--repo", root, "--json"],
			repoRuntime(root, mainRepoGitOutputs(root)),
		);

		expect(envelope.data).toMatchObject({
			action: "delete",
			changed_state: "none",
			preview: true,
			next_safe_action: "list",
			reason: "target_not_found",
		});
	});

	test("recover rejects force because it is preview-only in v1", async () => {
		const { exitCode, envelope } = await runJsonCli([
			"recover",
			"failure:run/delete_branch",
			"--force",
			"--json",
		]);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("usage_error");
	});

	test("recover resolves refs from the durable store before returning ok", async () => {
		const root = await mkdtemp(join(tmpdir(), "agent-worktree-cli-recover-"));
		const store = createFileStore(join(root, ".agent-worktree"));
		await store.writeFailure({
			ref: { kind: "failure", id: "run-1/delete_branch" },
			runId: "run-1",
			stepId: "delete_branch",
			changedState: "partial",
			retrySafety: "inspect_first",
			whatHappened: "Branch deletion failed.",
			whatChanged: ["Worktree removed."],
			nextSafeActions: ["inspect"],
		});

		const { exitCode, envelope } = await runJsonCli(
			["recover", "failure:run-1/delete_branch", "--dry-run", "--json"],
			{
				runtime: repoRuntime(root, mainRepoGitOutputs(root)),
			},
		);

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data?.changed_state).toBe("partial");
		expect(envelope.data?.failure_ref).toEqual({
			kind: "failure",
			id: "run-1/delete_branch",
		});
	});

	test("inspect valid refs outside a repo report store unavailability", async () => {
		const envelope = await expectRuntimeError(
			["inspect", "run:abc", "--json"],
			{
				cwd: () => "/not-a-repo",
				now: () => 1,
				run: async () => ({
					ok: false,
					stdout: "",
					stderr: "not a git repository",
					code: 128,
				}),
			},
		);

		expect(envelope.error?.recoverability).toBe("repair_state");
	});
});

async function expectUsageError(
	argv: readonly string[],
): Promise<TestJsonEnvelope> {
	const { exitCode, envelope } = await runJsonCli(argv);

	expect(exitCode).toBe(2);
	expect(envelope.status).toBe("error");
	expect(envelope.error?.code).toBe("usage_error");
	return envelope;
}

async function expectRuntimeError(
	argv: readonly string[],
	runtime: Partial<AgentWorktreeCliRuntime>,
): Promise<TestJsonEnvelope> {
	const { exitCode, envelope } = await runJsonCli(argv, { runtime });

	expect(exitCode).toBe(1);
	expect(envelope.status).toBe("error");
	expect(envelope.error?.code).toBe("runtime_error");
	return envelope;
}
