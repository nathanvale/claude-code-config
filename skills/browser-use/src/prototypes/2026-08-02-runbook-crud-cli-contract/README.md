# Runbook CRUD CLI contract prototype

Throwaway logic prototype. Question: does the proposed flag-driven CRUD surface
produce a coherent, discoverable authoring workflow before production parser or
filesystem code exists?

Run:

```sh
bun run prototype:runbook-crud-contract
```

Use `v` to switch between the plan contract and the resolved candidate. Every
action prints the command, outcome, and complete in-memory catalog state.

No files are read, written, or deleted by the prototype.
