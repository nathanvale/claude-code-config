import { describe, expect, test } from "bun:test";

import {
	findCommandDiscoveryTreeDrift,
	projectCommandDiscoveryTree,
	renderCommandUsage,
} from "@side-quest/cli-command-facade";
import {
	agentWorktreeContractEntries,
	agentWorktreeContracts,
} from "../src/command-contract.ts";
import { main } from "../src/cli.ts";
import {
	AGENT_WORKTREE_BACKUP_REF_POLICY,
	AGENT_WORKTREE_BACKUP_REF_TEMPLATE,
	AGENT_WORKTREE_COMMANDS,
	AGENT_WORKTREE_CONTRACT_ID,
	AGENT_WORKTREE_DOCTOR_EXIT_POLICY,
	AGENT_WORKTREE_EVENT_TRAIL_FORMAT,
	AGENT_WORKTREE_FAILURE_REF_TEMPLATE,
	AGENT_WORKTREE_REF_KINDS,
	AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS,
	AGENT_WORKTREE_SCAFFOLD_SEAMS,
	AGENT_WORKTREE_STORE_DIRS,
} from "../src/model.ts";

describe("agent-worktree scaffold", () => {
	test("projects the v1 command catalog without discovery drift", () => {
		const tree = projectCommandDiscoveryTree(agentWorktreeContractEntries);

		expect(Object.keys(tree.commands).sort()).toEqual(
			[...AGENT_WORKTREE_COMMANDS].sort(),
		);
		expect(tree.commands.doctor?.capability_roles).toContain("diagnostic");
		expect(findCommandDiscoveryTreeDrift(tree)).toEqual([]);
	});

	test("renders doctor help from the facade contract", () => {
		const help = renderCommandUsage(agentWorktreeContracts.doctor);

		expect(help).toContain("Usage: agent-worktree doctor --json");
		expect(help).toContain("--repo Repo root to inspect.");
		expect(help).toContain("--json Emit a JSON envelope.");
	});

	test("renders inspect positional ref and explicit ref forms", () => {
		const help = renderCommandUsage(agentWorktreeContracts.inspect);

		expect(help).toContain("Usage: agent-worktree inspect <ref> --json");
		expect(help).toContain("agent-worktree inspect --ref <ref> --json");
		expect(help).toContain("--ref Typed ref to inspect;");
	});

	test("renders recover explicit ref and positional ref forms", () => {
		const help = renderCommandUsage(agentWorktreeContracts.recover);

		expect(help).toContain("Usage: agent-worktree recover --ref <ref> --dry-run --json");
		expect(help).toContain("agent-worktree recover <ref> --dry-run --json");
		expect(help).toContain("--ref Typed ref to inspect;");
	});

	test("keeps handoff read-only, not a durable ref namespace", () => {
		expect(AGENT_WORKTREE_REF_KINDS).toEqual(["worktree", "run", "failure"]);
		expect(agentWorktreeContracts.handoff.mutation).toBe("check");
	});

	test("requires backup refs before branch deletion", () => {
		expect(AGENT_WORKTREE_BACKUP_REF_POLICY).toBe(
			"always_before_branch_delete",
		);
		expect(AGENT_WORKTREE_BACKUP_REF_TEMPLATE).toBe(
			"refs/agent-worktree/backups/<branch>/<run-id>",
		);
		expect(agentWorktreeContracts.delete.mutation).toBe("destructive");
	});

	test("captures v1 store and retention defaults", () => {
		expect(AGENT_WORKTREE_STORE_DIRS).toEqual([
			"runs",
			"failures",
			"worktrees",
		]);
		expect(AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS).toBe(30);
		expect(AGENT_WORKTREE_EVENT_TRAIL_FORMAT).toBe("jsonl_per_run");
		expect(AGENT_WORKTREE_FAILURE_REF_TEMPLATE).toBe(
			"failure:<run-id>/<step-id>",
		);
	});

	test("keeps doctor blockers in readable map data", () => {
		expect(AGENT_WORKTREE_DOCTOR_EXIT_POLICY).toBe(
			"exit_zero_with_readable_map",
		);
		expect(agentWorktreeContracts.doctor.mutation).toBe("check");
	});

	test("emits command discovery through the public CLI", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["commands", "--json"], {
			stdout,
			runtime: { now: () => Date.now() },
		});

		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.contract_id).toBe(AGENT_WORKTREE_CONTRACT_ID);
		expect(Object.keys(envelope.data.commands).sort()).toEqual(
			[...AGENT_WORKTREE_COMMANDS].sort(),
		);
	});

	test("renders top-level help and version through the public CLI", async () => {
		const helpStdout = createMemoryWriter();
		const helpExitCode = await main([], { stdout: helpStdout });
		const versionStdout = createMemoryWriter();
		const versionExitCode = await main(["--version"], { stdout: versionStdout });

		expect(helpExitCode).toBe(0);
		expect(helpStdout.output).toContain("Usage: agent-worktree doctor --json");
		expect(versionExitCode).toBe(0);
		expect(versionStdout.output).toBe("agent-worktree 0.1.0\n");
	});

	test("returns usage failure for unknown public commands", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["missing", "--json"], {
			stdout,
			runtime: { now: () => Date.now() },
		});

		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error.code).toBe("usage_error");
		expect(envelope.error.recoverability).toBe("change_input");
		expect(envelope.data.changed_state).toBe("none");
	});

	test("doctor emits a readable map through the public CLI", async () => {
		const stdout = createMemoryWriter();
		const exitCode = await main(["doctor", "--json"], {
			stdout,
			runtime: {
				now: () => Date.now(),
				cwd: () => "/repo",
				run: fakeGitRunner({
					["git rev-parse --show-toplevel"]: "/repo\n",
					["git worktree list --porcelain"]:
						"worktree /repo\nHEAD abc\nbranch refs/heads/main\n",
					["git branch --show-current"]: "main\n",
					["git symbolic-ref --short refs/remotes/origin/HEAD"]:
						"origin/main\n",
					["git status --porcelain"]: "",
					["git rev-parse --is-shallow-repository"]: "false\n",
					["git merge-base --is-ancestor main main"]: "",
					["git rev-list --left-right --count main...main"]: "0 0\n",
				}),
			},
		});

		const envelope = JSON.parse(stdout.output);

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data.status).toBe("ok");
		expect(envelope.data.mutationReadiness).toBe("ready");
	});

	test("scaffold inventory covers each planned owner seam", () => {
		const ownerPaths = AGENT_WORKTREE_SCAFFOLD_SEAMS.map(
			(seam) => seam.ownerPath,
		);

		expect(ownerPaths).toContain("runtime/agent-worktree/src/doctor.ts");
		expect(ownerPaths).toContain("runtime/agent-worktree/src/discovery.ts");
		expect(ownerPaths).toContain("runtime/agent-worktree/src/worktrees.ts");
		expect(ownerPaths).toContain(
			"runtime/agent-worktree/src/merge-intelligence.ts",
		);
		expect(ownerPaths).toContain("runtime/agent-worktree/src/store.ts");
		expect(ownerPaths).toContain("runtime/agent-worktree/src/inspect.ts");
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
		const key = args.join(" ");
		const stdout = outputs[key];
		return stdout === undefined
			? { ok: false, stdout: "", stderr: "missing fake output", code: 1 }
			: { ok: true, stdout, stderr: "", code: 0 };
	};
}
