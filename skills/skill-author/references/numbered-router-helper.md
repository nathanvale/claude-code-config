# Numbered Router Helper

Use when a skill has choices, handoffs, recovery paths, live-session steps,
status output, or next actions where user choice changes owner, risk, target,
or next action.

## Goal

- Offer the menu for the current decision station only.
- Make one recommended default visible.
- Include likely branch jumps when they matter now.
- Keep a free-form outcome escape hatch outside the menu.
- Keep runtime contracts in their owner paths.

## Owner Boundary

- This reference owns numbered menu mechanics for skill prose.
- Branch Maps are non-contract orientation for non-facade conversational skills.
- Branch Maps help the agent find the current station; they do not prove
  coverage.
- Facade-backed Branch Station model and Station Map projection live in
  `runtime/cli-command-facade/src/station-map.ts`.
- Cross-package Station Map reports live in
  `skills/cli-execution-auditor/src/station-map.ts`.
- Facade-backed CLI guidance lives in
  `skills/cli-author/references/cli-command-facade.md`.
- Generated Station Maps are runtime evidence when a package-owned Branch
  Station Catalog exists.

## Menu Mechanics

- Use the heading `## Next Safe Actions`.
- Show the menu only for the current decision station.
- Use numbered options.
- Bold exactly one recommended default when asking for a choice.
- Put the safest momentum-preserving option first.
- Keep top-level menus short; merge, omit, or defer low-value branches.
- Put likely cross-branch jumps directly in the numbered menu.
- State the action and proceed when one safe next action exists.
- Name owner paths for handoffs.
- Mark examples illustrative.
- Put this exact line after the menu:

```text
Reply with a number, or say what outcome you want.
```

## Avoid

- Do not ask the user to choose when the owner path already decides.
- Do not list every possible branch.
- Do not use a second route picker for likely branch jumps.
- Do not add `Chat about this` or similar as a menu option.
- Do not hide the recommended path in prose.
- Do not use a menu to hide a safety gate.
- Do not copy deterministic flags, schemas, state machines, Branch Station
  fields, Station Map fields, or runtime semantics into skill prose.

## Branch Maps

Use a prose Branch Map only when a non-facade conversational skill needs
orientation across multiple decision stations.

```markdown
## Branch Map

- Listing station -> show available items, then present `Next Safe Actions`.
- Sessions station -> show times, then present `Next Safe Actions`.
- Completion station -> summarize the completed action or restart path.
```

Rules:

- Keep the map orienting, not exhaustive.
- Keep each station name tied to a current-state menu.
- Show only the menu for the current station.
- Use generated Station Maps instead when a facade-backed Branch Station Catalog
  exists.

## Examples

Current-station menu:

```markdown
## Next Safe Actions

1. **Pick a movie** - show sessions and availability.
2. Movie details - inspect one title before deciding.
3. Quick book - jump to Express booking with title and time.
4. Done - stop without booking.

Reply with a number, or say what outcome you want.
```

Recovery menu:

```markdown
## Next Safe Actions

1. **Repair first issue** - follow the runtime hint for the current target.
2. Inspect station evidence - read the generated Station Map report.
3. Change target - choose another package or front door.
4. Stop here - report the blocked state and next repair.

Reply with a number, or say what outcome you want.
```

Multi-stage conversational workflow:

```markdown
## Browse Mode

1. Fetch listing.
2. Show the listing table, then present `Next Safe Actions` for Listing station.
3. User picks an item, then show sessions and present `Next Safe Actions` for
   Sessions station.
4. User picks a session, then converge with Express at Tickets station.

## Branch Map

- Listing station -> choose item, inspect details, jump to Express, or stop.
- Sessions station -> choose session, go back to listing, inspect details, or
  stop.
- Tickets station -> choose ticket count, jump to payment, or stop.

## Next Safe Actions

1. **Pick a session** - proceed to Tickets station.
2. Back to listing - return to Listing station.
3. Item details - inspect before deciding.
4. Quick book - jump to Express with the selected item and time.

Reply with a number, or say what outcome you want.
```

Facade-backed station evidence:

```markdown
## Next Safe Actions

1. **Repair missing station evidence** - follow the auditor finding for the
   current facade-backed CLI.
2. Inspect generated Station Map - read the runtime/auditor report.
3. Jump to catalog authoring - update the package-owned Branch Station Catalog.
4. Stop here - report skipped stations and owner paths.

Reply with a number, or say what outcome you want.
```

This example is illustrative. Exact Branch Station and Station Map behavior
belongs to the owner paths named above.

## Verification

- Check `Next Safe Actions` describes the current station only.
- Check one recommended option is bolded when user choice is requested.
- Check likely branch jumps appear as numbered options.
- Check the canonical escape hatch appears after the menu.
- Check prose Branch Maps are orientation only.
- Check facade-backed Station Map guidance points at runtime and auditor owner
  paths instead of copying fields or semantics.
