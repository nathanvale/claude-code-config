import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { renderCommandUsage } from "@side-quest/cli-command-facade";
import { assertCommandHelpFlagSurface } from "@side-quest/cli-command-facade/testing";

import { agentWorktreeContracts } from "../src/command-contract.ts";
import { main } from "../src/cli.ts";
import { createFileStore } from "../src/store.ts";

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

	test("foreign flags fail with exit code 2 and JSON stdout", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["list", "--force", "--json"], { stdout });
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
	});

	test("delete-only branch deletion flag is rejected by other commands", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["list", "--delete-branch", "--json"], {
			stdout,
		});
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
	});

	test("removed no-input flag is rejected instead of advertised inertly", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["delete", "feat/x", "--no-input", "--json"], {
			stdout,
		});
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
	});

	test("delete normal execution requires force before runtime mutation", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["delete", "feat/x", "--json"], { stdout });
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error.message).toContain("--force");
	});

	test("delete target misses exit non-zero with lifecycle recovery data", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-cli-delete-missing-"));
		const stdout = createMemoryWriter();
		const exitCode = await main(
			["delete", "feat/missing", "--force", "--repo", root, "--json"],
			{
				stdout,
				runtime: {
					cwd: () => root,
					now: () => 1,
					run: fakeGitRunner({
						["git rev-parse --show-toplevel"]: `${root}\n`,
						["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main
`,
						["git branch --show-current"]: "main\n",
						["git symbolic-ref --short refs/remotes/origin/HEAD"]:
							"origin/main\n",
					}),
				},
			},
		);
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(1);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("runtime_error");
		expect(envelope.data).toMatchObject({
			action: "delete",
			changed_state: "none",
			preview: true,
			next_safe_action: "list",
			reason: "target_not_found",
		});
	});

	test("recover rejects force because it is preview-only in v1", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(
			["recover", "failure:run/delete_branch", "--force", "--json"],
			{ stdout },
		);
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
	});

	test("recover resolves refs from the durable store before returning ok", async () => {
		const root = await mkdtemp(join(tmpdir(), "awt-cli-recover-"));
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

		const stdout = createMemoryWriter();
		const exitCode = await main(
			["recover", "failure:run-1/delete_branch", "--dry-run", "--json"],
			{
				stdout,
				runtime: {
					cwd: () => root,
					now: () => 1,
					run: fakeGitRunner({
						["git rev-parse --show-toplevel"]: `${root}\n`,
						["git worktree list --porcelain"]: `worktree ${root}
HEAD abc
branch refs/heads/main
`,
						["git branch --show-current"]: "main\n",
						["git symbolic-ref --short refs/remotes/origin/HEAD"]:
							"origin/main\n",
					}),
				},
			},
		);
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.changed_state).toBe("partial");
		expect(envelope.data.failure_ref).toEqual({
			kind: "failure",
			id: "run-1/delete_branch",
		});
	});

	test("inspect valid refs outside a repo report store unavailability", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["inspect", "run:abc", "--json"], {
			stdout,
			runtime: {
				cwd: () => "/not-a-repo",
				now: () => 1,
				run: async () => ({
					ok: false,
					stdout: "",
					stderr: "not a git repository",
					code: 128,
				}),
			},
		});
		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(1);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("runtime_error");
		expect(envelope.error.recoverability).toBe("repair_state");
	});
});

function createMemoryWriter(): { output: string; write(chunk: string): void } {
	return {
		output: "",
		write(chunk: string) {
			this.output += chunk;
		},
	};
}

function fakeGitRunner(outputs: Record<string, string>) {
	return async (args: readonly string[]) => {
		const stdout = outputs[args.join(" ")];
		return stdout === undefined
			? { ok: false, stdout: "", stderr: "missing fake output", code: 1 }
			: { ok: true, stdout, stderr: "", code: 0 };
	};
}
