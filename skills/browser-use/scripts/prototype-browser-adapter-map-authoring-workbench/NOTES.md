# Browser Adapter Map Authoring Workbench Notes

Source: prototype request on 2026-06-03.

## Question

- Generate a draft Browser Adapter Map from an adapter proof spec.
- Show missing authoring inputs before a map is written.
- Keep recovery vocabulary shared.
- Keep operator commands adapter-local.

## Early Answer

- Authoring needs an adapter proof spec, not a blank markdown file.
- The workbench can derive Recovery Map keys and section headings.
- The workbench can flag missing exact commands.
- The workbench can catch invented diagnostics before they enter prose.
- The workbench should output a draft skeleton plus a punch list.

## Shared Machinery Candidate

- Diagnostic catalogue: code -> target -> section.
- Local recovery catalogue: local failure key -> target.
- Required section list.
- Map skeleton renderer.
- Authoring review: missing commands, invented diagnostics, unknown fields, duplicate boilerplate.

## Adapter-Specific Inputs

- Dependency command.
- Config repair command.
- Inspect command.
- Verify command.
- Binding proof probe.
- Weak signal probe.
- Risk probes.
- Emitted diagnostics.

## Prototype Learning

- `agent-browser` map authoring blocks on exact session/CDP pin commands.
- Invented vocabulary is best caught at spec entry, before map validation.
- A generated skeleton reduces map prose drift.
- Warnings need a dedicated section even when no blocking recovery action exists.
- The generated map should keep shared wording terse and push exact commands into adapter sections.

## Production Shape Candidate

- Add a map authoring helper only after `agent-browser` proof semantics settle.
- Keep helper output as a draft, not a contract.
- Reuse Browser Adapter Map checker for final validation.
- Store adapter proof spec data near Browser Adapter Proof runtime.
- Keep map source under `skills/browser-use/references/browser-adapter-<adapter>.md`.

## Open Questions

- Should authoring be a mode of `browser-adapter-map.sh`, or a separate prototype-only script until second map lands?
- Should generated skeleton include every shared local recovery key by default?
- Should missing exact commands block draft output or appear as TODO markers?
- Should risk probes map to `Warnings`, `Inspect`, or a future warm-proof return action?
