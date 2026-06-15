# ADHD-Friendly DX

Use when a skill has choices, handoffs, recovery paths, live-session steps,
status output, or next actions that could overload the user or next agent.

Source pattern:

- `skills/lll-account-switch/SKILL.md`
- `experience-sdk/.agents/skills/extension-qa-session/SKILL.md`
- `experience-sdk/.agents/skills/design-parity-session/SKILL.md`

## Goal

- Reduce choice load.
- Keep visible momentum.
- Make the recommended safe path obvious.
- Keep the user in control without asking them to manage the workflow.

## Pattern

Use this block shape in the target skill, adapted to the workflow:

```markdown
## Next Safe Actions

DX lens: present choices as a short numbered list so the user can reply by
number. Bold the recommended default. Never present more than 4 options. When
status makes the next step obvious, state what you are doing and proceed unless
the user redirects.

1. No required input yet -> **recommended action** - why this keeps momentum.
2. Known alternate -> action - when to choose it.
3. Handoff path -> action - target owner or tool.
4. Stay / stop / report -> action - safe resting state.
```

## Rules

- Use numbered choices at decision points.
- Bold exactly one recommended default.
- Keep menus to 4 options or fewer.
- Merge, omit, or defer low-value branches.
- Put the safest momentum-preserving option first.
- State the action and proceed when the next step is obvious.
- Use a menu only when user choice changes owner, risk, target, or next action.
- Show the command under the option when the workflow is command-backed.
- Label blocked or degraded paths with the next repair.
- Name the owner path for each handoff.

## Avoid

- Do not ask the user to choose when the owner path already decides.
- Do not list every possible branch.
- Do not bury the recommended path in prose.
- Do not use a menu to hide a safety gate.
- Do not copy deterministic flags, schemas, or state machines into the skill.

## Examples

Status-driven command skill:

```markdown
## Next Safe Actions

DX lens: present choices as a short numbered list so the user can reply by
number. Bold the recommended default. Never present more than 4 options.

1. Health issue present -> **repair first health issue**; show the repair hint,
   but do not run human-auth or destructive commands.
2. Inspect state -> `tool status --json`.
3. Change one target -> `tool use <target> --scope <scope>`.
4. Change repo override -> `tool use <target> --repo <path>`.
```

Live-session skill:

```markdown
## Next Safe Actions

1. No target given -> **list targets** and present numbered choices.
2. Target but no role -> show role menu.
3. Session live -> present handoff menu:
   1. **Design parity** - side-by-side visual comparison
   2. Locator debugging - DOM inspection
   3. Stay live - no further handoff
```

Multi-stage conversational workflow (e.g. classic-cinema Browse Mode):

When the workflow has multiple decision points, name them in the flow steps and
define a matching subheaded menu for each stage. The agent presents only the
menu for the current stage.

```markdown
## Browse Mode

1. Fetch listing via API (instant)
2. Show the listing table, then present **Next Safe Actions (post-listing)**
3. User picks a movie → show sessions, then present **Next Safe Actions (post-sessions)**
4. User picks a session → converge with Express at Q2 (Tickets)

## Next Safe Actions

DX lens: present choices as a short numbered list so the user can reply by
number. Bold the recommended default. Never present more than 4 options.

### Post-listing (after showing tonight's movies)

1. **Pick a movie** (reply by number or name) — see sessions + availability.
2. Movie details — trailer, synopsis, or reviews for a specific title.
3. Quick book — `/skill-name <item> <time> [options]`.
4. Nothing tonight — done.

### Post-sessions (after showing sessions with availability)

1. **Pick a session** (reply by number or time) — proceed to next step.
2. Back to listing — see all items again.
3. Item details — more info before deciding.

### Post-completion (after final action)

1. **Done** — action logged.
2. Start again — back to listing.
```

**Key points:**
- Bold text in flow steps (e.g. `**Next Safe Actions (post-listing)**`) links
  the step to its menu — the agent knows which block to render.
- Each subheaded menu is self-contained; the agent never shows two at once.
- The pattern scales: add a `### Post-<stage>` block per decision point.

## Verification

- Check the target skill has at most one DX menu per decision point.
- Check each menu has 4 top-level options or fewer.
- Check one recommended option is bolded when user choice is requested.
- Check exact commands still point to CLI help, tests, generated docs, or code.
