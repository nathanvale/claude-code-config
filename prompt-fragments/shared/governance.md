## Memory OS

- Shared user-scope memory contract: `~/.config/memory/AGENTS.md`.
- Canonical docs: `~/.config/memory/docs/`.
- Canonical source in this repo: `~/code/claude-code-config/memory/`.
- `~/.config/memory` is the stable runtime path; resolves to this repo via `./install.sh`.
- `CLAUDE.md` is hot memory only — broadly relevant, high-frequency cues. Not durable storage.
- `memory/` for compact durable recall; `docs/` for full authored documents.
- Repos own operational truth; `my-second-brain` owns synthesis and promoted durable knowledge.
- Preserve provenance for imported external material when it aids retrieval or auditing.
- Prefer QMD for broad federated recall; NotebookLM for curated synthesis packs.

## Git Safety

- Never force push, hard reset, `clean -f`, or `checkout/restore .`.
- Never use `git add .` or `git add -A`; stage specific files.
- Never skip hooks except for explicit WIP checkpoint workflows.
- Use conventional commits: `type(scope): subject`.
- Check branch policy before committing; never commit directly to protected branches.
- Protected branches: `main`, `master`, any repo-configured protected branches.
- Feature branch: commit freely once Nathan has approved.
- Protected branch with branching support: create a feature branch first.
- Protected branch without branching support: stop and ask.

Git procedure docs:

- `docs/git/conventions.md`
- `docs/git/workflows.md`
- `docs/git/worktree.md`
