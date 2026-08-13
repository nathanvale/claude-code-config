# Temporary HTML Report

Create the report in the operating-system temporary directory. Use one self-contained HTML file with inline CSS and no remote scripts, fonts, images, or telemetry.

Show:

- Suite map by behaviour and proof layer.
- Production-consumer workflow map: consumer, starting condition, public actions, observable outcome, and failure meaning.
- Blind spots and remaining unproved boundaries.
- Three to five candidate cards.
- One clearly marked recommendation.
- Cost, risk, owner, and next slice for each candidate.
- Separate human and programmatic CLI contracts when both public surfaces apply: distinct output, exit-status, receipt, and failure semantics.

When slowness, CI duration, isolation, concurrency, parallelism, projects, or shards motivate the review, add an execution topology backed by retained measurements:

- Map discovery, transform, setup, import, test, teardown, and report stages.
- Show slowest-file or slowest-group evidence before recommending parallelism or sharding.
- Show measured duration for each stage or suite group.
- Name lifecycle ownership and isolation boundaries.
- Show concurrency and shared-resource evidence.
- Show open handles and resource contention.
- Show retries, skips, flakes, and retained diagnostics.
- Separate cold-start from steady-state cost.
- Account for projects and shards.
- Flag missing or duplicate shard receipts.
- Name receipt merge ownership.
- Distinguish proof value from elapsed cost for each stage or suite group.
- Name each optimization candidate.
- Link its evidence to the source-linked reference or retained receipt that produced it.
- State expected runtime impact and confidence risk.
- Give its rollback signal and remaining blind spots.

Open the report locally. Report its absolute path in the active conversation.

Create no repository or vault file. Delete the temporary report when the session cleanup owner requests it.
