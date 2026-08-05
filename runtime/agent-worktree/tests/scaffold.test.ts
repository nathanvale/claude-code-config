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
import {
	AGENT_WORKTREE_BACKUP_REF_POLICY,
	AGENT_WORKTREE_BACKUP_REF_TEMPLATE,
	AGENT_WORKTREE_COMMANDS,
	AGENT_WORKTREE_DIAGNOSTIC_OUTPUT_POLICY,
	AGENT_WORKTREE_DOCTOR_JSON_FIELDS,
	AGENT_WORKTREE_DOCTOR_EXIT_POLICY,
	AGENT_WORKTREE_EVENT_TRAIL_FORMAT,
	AGENT_WORKTREE_FAILURE_RECORD_FIELDS,
	AGENT_WORKTREE_FAILURE_REF_TEMPLATE,
	AGENT_WORKTREE_JSON_OUTPUT_POLICY,
	AGENT_WORKTREE_LOOKUP_INPUTS,
	AGENT_WORKTREE_REF_KINDS,
	AGENT_WORKTREE_RETENTION_WARN_AFTER_DAYS,
	AGENT_WORKTREE_SAME_INPUT_RETRY,
	AGENT_WORKTREE_SCAFFOLD_SEAMS,
	AGENT_WORKTREE_STORE_DIRS,
} from "../src/model.ts";
import { fakeGitRunner, runJsonCli, runTextCli } from "./support.ts";

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
		expect(AGENT_WORKTREE_DOCTOR_JSON_FIELDS).toEqual([
			"summary",
			"checks",
			"mutation_readiness",
			"blockers",
			"next_actions",
		]);
		expect(agentWorktreeContracts.doctor.mutation).toBe("check");
	});

	test("captures v1 recovery and output contract defaults", () => {
		expect(AGENT_WORKTREE_SAME_INPUT_RETRY).toEqual([
			"safe",
			"unsafe",
			"unknown",
		]);
		expect(AGENT_WORKTREE_FAILURE_RECORD_FIELDS).toEqual([
			"what_happened",
			"changed_state",
			"changed",
			"same_input_retry",
			"next_actions",
			"diagnostics",
		]);
		expect(AGENT_WORKTREE_LOOKUP_INPUTS).toEqual(["id", "branch", "path"]);
		expect(AGENT_WORKTREE_JSON_OUTPUT_POLICY).toBe("object_envelopes_only");
		expect(AGENT_WORKTREE_DIAGNOSTIC_OUTPUT_POLICY).toBe(
			"stderr_or_durable_refs",
		);
	});

	test("emits command discovery through the public CLI", async () => {
		const { exitCode, envelope } = await runJsonCli(["commands", "--json"], {
			runtime: { now: () => Date.now() },
		});

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data?.contract_id).toBe("agent-worktree.commands");
		expect(
			Object.keys(envelope.data?.commands as Record<string, unknown>).sort(),
		).toEqual(
			[...AGENT_WORKTREE_COMMANDS].sort(),
		);
	});

	test("renders top-level help and version through the public CLI", async () => {
		const help = await runTextCli([]);
		const version = await runTextCli(["--version"]);

		expect(help.exitCode).toBe(0);
		expect(help.output).toContain("Usage: agent-worktree doctor --json");
		expect(version.exitCode).toBe(0);
		expect(version.output).toBe("agent-worktree 0.1.0\n");
	});

	test("returns usage failure for unknown public commands", async () => {
		const { exitCode, envelope } = await runJsonCli(["missing", "--json"], {
			runtime: { now: () => Date.now() },
		});

		expect(exitCode).toBe(2);
		expect(envelope.status).toBe("error");
		expect(envelope.error?.code).toBe("usage_error");
		expect(envelope.error?.recoverability).toBe("change_input");
		expect(envelope.data?.changed_state).toBe("none");
	});

	test("doctor emits a readable map through the public CLI", async () => {
		const { exitCode, envelope } = await runJsonCli(["doctor", "--json"], {
			runtime: {
				now: () => Date.now(),
				cwd: () => "/repo",
				run: fakeGitRunner({
					["git rev-parse --show-toplevel"]: "/repo\n",
					["git rev-parse --git-dir"]: ".git\n",
					["git rev-parse --git-common-dir"]: "/repo/.git\n",
					["git rev-parse --show-superproject-working-tree"]: "\n",
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

		expect(exitCode).toBe(0);
		expect(envelope.status).toBe("ok");
		expect(envelope.data?.summary).toMatchObject({
			status: "ok",
			repo_root: "/repo",
			isolation: "main",
		});
		expect(envelope.data?.mutation_readiness).toBe("ready");
		expect(envelope.data?.blockers).toEqual([]);
		expect(envelope.data?.next_actions).toEqual([]);
		expect(Array.isArray(envelope.data?.checks)).toBe(true);
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
