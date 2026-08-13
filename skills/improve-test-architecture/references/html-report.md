# Temporary HTML Report

Create the report in the operating-system temporary directory. Use one self-contained HTML file with inline CSS and no remote scripts, fonts, images, or telemetry.

Show:

- Suite map by behaviour and proof layer.
- Production-consumer workflow map: consumer, starting condition, public actions, observable outcome, and failure meaning.
- Blind spots and remaining unproved boundaries.
- Three to five candidate cards.
- One clearly marked recommendation.
- Cost, risk, owner, and next slice for each candidate.

When slowness, CI duration, isolation, concurrency, parallelism, projects, or shards motivate the review, add an execution topology backed by retained measurements:

- Map discovery, transform, setup, import, test, teardown, and report stages.
- Show slowest-file or slowest-group evidence before recommending parallelism or sharding.
- Show measured duration, lifecycle owner, isolation, concurrency, shared resources, open handles, resource contention, retries, skips, flakes, and retained diagnostic surface.
- Separate cold-start from steady-state cost. Account for projects, shards, missing or duplicate shard receipts, and merge ownership.
- Distinguish proof value from elapsed cost for each stage or suite group.
- Name each optimization candidate, supporting evidence, expected runtime impact, confidence risk, rollback signal, and remaining blind spots.

Open the report locally. Report its absolute path in the active conversation.

Create no repository or vault file. Delete the temporary report when the session cleanup owner requests it.
