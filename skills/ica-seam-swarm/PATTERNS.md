# ICA Prompt Patterns

Use these neutral prompt patterns as ICA mechanics, not as a separate checklist.
Apply the row when its "Use when" condition matches; skip it when it would add
noise.

| Pattern | ICA mechanic | Use when |
| --- | --- | --- |
| Context Brief | Context Packet | Before dispatch, prompt-pack generation, or resume. |
| Evidence Trail | Files / symbols, assumptions, confidence, and deletion-test consequence | Every worker and synthesis pass. |
| Direct Critique | Confidence gate, dropped findings, and "not worth changing" notes | Synthesis and adversary review. |
| Specific Reviewer Role | Shard Personas | Every dispatched shard. |
| Adversary Pass | Adversary Filter | Before finalizing, or when pressure-testing an existing report. |
| Scope Lock | In-scope / out-of-scope constraints | Before dispatch, especially for large repos or cross-folder seams. |
| Output Contract | Required sections and optional add-ons | Every mode. |
| Assumption Audit | Assumptions To Verify | Complex or high-blast-radius findings. |
| Compression Loop | Compression handoff | Long swarms, multi-batch swarms, and resume points. |
| Pre-Mortem | Seam Failure Pre-Mortem | High-blast-radius seams or future drift-risk requests. |

Never ask agents to reveal hidden chain-of-thought. The Evidence Trail is the
allowed substitute: concise rationale, inspected evidence, assumptions,
confidence, and deletion-test consequence.
