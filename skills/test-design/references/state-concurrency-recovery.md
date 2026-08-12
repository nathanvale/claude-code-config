# State, Concurrency, and Recovery

- Assert durable state through an independent reader, not only the writer response.
- Name exclusive ownership, idempotency key, generation, or compare-and-swap boundary.
- Inject crashes before and after claim, launch, acknowledgement, checkpoint, and terminal write where duplicate or lost work is possible.
- Prove recovery produces at most one owner and does not silently abandon accepted work.
- Keep heartbeat, lease renewal, liveness, and write authority as separate concepts.
- Use deterministic clocks and barriers first; add bounded real concurrency to catch scheduling assumptions.
