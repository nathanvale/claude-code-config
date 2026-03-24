## Governance

### Memory OS

- Shared user-scope memory contract lives at `~/.config/memory/AGENTS.md`
- Canonical docs live under `~/.config/memory/docs/`
- Canonical source lives in this repo at `~/code/claude-code-config/memory/`
- `~/.config/memory` is the stable runtime path and should resolve to this repo via `./install.sh`
- `CLAUDE.md` is hot memory only — broadly relevant, high-frequency cues, not durable storage
- `memory/` is for compact durable recall; `docs/` is for full authored documents
- Repos own operational truth; `my-second-brain` owns synthesis and promoted durable knowledge
- Preserve provenance for imported external material when it helps future retrieval or auditing
- Prefer QMD for broad federated recall and NotebookLM for curated synthesis packs

### Git Safety

- Never force push, hard reset, clean -f, or checkout/restore `.`
- Never use `git add .` or `git add -A`; stage specific files
- Never skip hooks except for explicit WIP checkpoint workflows
- Use conventional commits: `type(scope): subject`
- Check branch policy before committing; do not commit directly to protected branches

Protected branches include `main`, `master`, and any repo-configured protected branches.

- If on a feature branch, commit freely once Nathan has approved
- If on a protected branch and the harness supports branching, create a feature branch first
- If on a protected branch and branching is not supported, stop and ask the user

For detailed git procedures, read:

- `docs/git/conventions.md`
- `docs/git/workflows.md`
- `docs/git/worktree.md`
