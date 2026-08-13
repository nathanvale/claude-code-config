# Runner Execution

Read this profile only when runner execution semantics can change the confidence claim. Skip it for a simple isolated unit test whose discovery, mode, lifecycle, and result accounting are already fixed by an owning repository command.

- Record execution mode and termination: one-shot run, watch loop, persistent service, or outer command deadline.
- Record runtime and version, cwd, config, loaders, preloads, transform path, module mode, and source-map path. Compare the test transform and loader path with the production build or runtime path before claiming parity.
- Treat file isolation, file concurrency, within-file isolation, and within-file test concurrency as separate axes. Name exclusive ports, temporary roots, databases, and shared globals, environment, timers, servers, module caches, and mock state.
- Verify the selector, expected file count, and expected test count. Treat zero tests, skipped work, todo work, missing shards, and duplicate shards as explicit outcomes.
- Record the randomized-order seed and replay it before widening. Order changes diagnose shared state; repetition alone does not create confidence.
- Separate timeout, cancellation, and cleanup: per-test timeout, outer deadline, graceful cancellation, forced termination, and resource release are different claims. Runner-managed child termination is hygiene, not proof of application-owned cleanup. Prove cleanup through an independent observable.
- Await promises and subtests. Use assertion plans only when callback count or data cardinality is part of the proof; avoid universal assertion-count rules.
- Name the real boundary hidden by each test double, the practicality gained, confidence lost, restoration owner, and public canary that restores confidence.
- Use compact human output for the focused loop. For qualification, retain a protocol-complete machine receipt plus reporter output and exit status as complementary evidence; never parse application stdout as runner protocol. Treat human reporter text as presentation unless the repository owns it as a public contract.
- Record project identity and shard identity. Merge receipts mechanically, then reject missing, duplicate, or incompatible project and shard results.
- Keep type checking, test execution, coverage, affected-only selection, stress, and performance as separate claims. Coverage proves reachability; affected-only selection accelerates feedback but does not replace the broad final gate.
- Preserve or raise repository-owned coverage floors and explain exclusions. Execution GREEN does not prove type correctness.
- Measure before changing workers, isolation, parallelism, projects, or shards. Attribute time to discovery, transform, setup, import, test, teardown, and reporting.
