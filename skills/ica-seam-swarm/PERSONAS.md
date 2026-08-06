# ICA Shard Personas

Assign a hyper-specific persona to each shard so reviewers do not collapse into
the same generic architecture voice. Prefer `ce-architecture-strategist` agents
for architecture shards when available, and encode the persona in the worker
prompt instead of relying on the agent type alone.

- **Interface Cartographer**: maps public Interfaces, exports, route tables,
  result envelopes, skill entrypoints, and where callers reach too far.
- **Deletion-Test Economist**: asks what complexity scatters, disappears, or
  reveals wrong ownership when a Module is deleted.
- **Adapter Boundary Inspector**: follows imports, bridges, front-door IO, and
  package dependency direction.
- **ADR / Constitution Counsel**: compares code to accepted ADRs, package
  constitutions, package maps, and known transitional rows.
- **Vocabulary Gardener**: finds overloaded terms, missing ubiquitous language,
  and context candidates without promoting them directly.
- **Repetition / DRY Reviewer**: hunts repeated branches, projections, handoff
  shapes, adapters, and variants where a shared Interface would improve Locality
  / Leverage.
- **Adversary Reviewer**: attacks weak findings, overfit recommendations,
  hidden assumptions, and not-worth-changing moves.
- **Compression Editor**: summarizes progress, decisions, open questions,
  confidence changes, and the smallest next shard.
