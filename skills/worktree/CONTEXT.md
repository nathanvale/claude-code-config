# WorkTree

This context defines durable language for the WorkTree workflow and its `worktree` command shorthand boundary with shared git/worktree runtime ownership.

## Language

**Workflow Entry Point**:
A skill-level entrypoint that routes human or agent work into owned command surfaces and owner docs. It is not a package-owned public CLI interface.
_Avoid_: front door, CLI Front Door, command owner

**Generated Workspace**:
A VS Code workspace artifact rendered from repo and worktree state. It is output, not a source of truth.
_Avoid_: workspace source, hand-edited workspace, project file

**Workspace Registry**:
The durable source for per-repo workspace preferences such as branch focus and display grouping. It owns preferences, not git truth.
_Avoid_: workspace file, generated workspace, worktree registry

**Main Owner Root**:
The primary checkout that owns repo-scoped worktree state and survives linked worktree deletion.
_Avoid_: active worktree, current checkout, tracked repo docs

**Mutation Readiness**:
The aggregate repo posture for whether worktree mutation may proceed, is blocked, or needs more evidence.
_Avoid_: can mutate, permission, approval

**State Refresh**:
A reconciliation pass that updates durable worktree recovery state from current repo evidence.
_Avoid_: sync, config sync, workspace render

**Clean Preview**:
A read-only cleanup classification that names candidates, blockers, and next safe action without deleting anything.
_Avoid_: destructive clean, prune, cleanup execution

**Typed Ref**:
A portable recovery pointer that names its record kind before its identifier so another agent can inspect it without transcript context.
_Avoid_: raw id, log pointer, transcript link

**Backup Ref**:
A local recovery pointer created before branch deletion so deleted branch work can be found again if cleanup fails or was wrong.
_Avoid_: safety branch, copied branch, undo log

**Run Record**:
Durable context for one lifecycle command attempt, including enough state for another agent to inspect what happened.
_Avoid_: log line, transcript, command output

**Event Trail**:
Ordered evidence from a lifecycle command attempt, used to reconstruct progress after success, failure, or handoff.
_Avoid_: terminal scrollback, chat history, debug spam

**Handoff Snapshot**:
A read-only context view for the next agent, assembled from current repo evidence and durable recovery state.
_Avoid_: handoff record, saved handoff, transcript summary

**Shared Runtime Package**:
The repo-local owner for git/worktree truth, hygiene, safety, and recovery language consumed by `worktree` and future workflow entry points.
_Avoid_: external SideQuest dependency, skill-owned git logic, CLI wrapper

**Agent-Recoverable Repo Product**:
A repo operation product where agents can inspect the actual repo state, prior actions, failure state, and next safe action after a partial or failed mutation.
_Avoid_: worktree CRUD helper, transcript-dependent recovery, thin SideQuest wrapper

**Merge Intelligence**:
Evidence about whether and how a branch's work landed, used to explain cleanup, delete, status, and recovery decisions.
_Avoid_: branch guessing, stale merged flag, cleanup heuristic
