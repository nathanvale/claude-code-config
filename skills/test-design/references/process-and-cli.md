# Process and CLI

- Exercise the public executable when claiming CLI behaviour; engine calls alone do not prove parsing, rendering, streams, signals, or exit status.
- Prove discovery metadata, help, parser acceptance, and runtime semantics separately when their owners can drift.
- Keep machine-readable stdout pure; send diagnostics to stderr and assert both streams.
- Give timeout, protocol, authentication, and remote failures distinct public meanings.
- Test process-tree cleanup, inherited descriptors, signals, parent death, and hostile grandchildren when lifecycle ownership matters.
- Use a sensitivity proof for cleanup: hold a descriptor open or retain a child, observe RED, restore cleanup, observe GREEN.
- Scrub credentials and ambient authority from fixtures, diagnostics, snapshots, and child processes.
