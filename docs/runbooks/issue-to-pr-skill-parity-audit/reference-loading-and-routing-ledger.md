# Reference loading and routing - findings ledger

Format and protocol: see [README.md](README.md#ledger-format).

| id | signature | status | risk | summary | resolution |
| --- | --- | --- | --- | --- | --- |
| 001 | stage-3-contract-review-cycle-cap-missing | fixed | high | Runbook lists `contract-review-cycle-cap` (Stage 3 five-cycle Contract Review cap, `blocked_reason: contract-review-cycle-cap`) among the 11 stop-and-ask conditions this seam owns, but the skill omitted it: the Stage 3 shell stop conditions named "open Stage 3 P0/P1" only, and the `<fail_stops>` "Escape hatch or iteration cap" row is bound to Stage 4 batch-loop iteration-cap semantics (accepted-risk/replacement resume), which do not cover a Stage 3 cap that resumes via plan/contract revision. | commit 9ab3d7c |
