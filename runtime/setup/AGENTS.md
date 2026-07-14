# Setup Runtime

- Keep one flat `setup` CLI package.
- Keep `src/command-contract.ts` as command metadata, flag, action, result-contract, and parser grammar owner.
- Keep `src/model.ts` as stable Setup vocabulary and shared result-shape owner.
- Keep inspection, planning, and apply policy in engine modules added by later units.
- Keep source and ownership discovery in inspection modules added by later units.
- Keep `src/cli.ts` as argv, IO, rendering, diagnostics, and dispatch owner.
- Keep tests as command-surface, Branch Station, and process-evidence owners.
- Derive help and command discovery from the facade contract.
- Add terminal outcomes to `src/branch-station-catalog.ts` before runtime branches emit them.
- Preserve foreign or unproven filesystem state.
- Keep write routes previewable and revalidate ownership before mutation.
