# Browser Adapter Failure Explanation Notes

Source: prototype request on 2026-06-03.

## Question

- Compare explanation surfaces for the same proof outcome.
- Keep next action obvious.
- Avoid vocabulary drift between JSON, plain CLI, map prose, Router handoff, and operator choice.
- Reduce cognitive load for agents and humans.

## Early Answer

- Each surface should name the same diagnostic code and continuation action.
- Plain CLI should include failure domain, code, action, and one compact reason.
- Router handoff should avoid adapter repair detail.
- Browser Adapter Map should carry local commands and repair context.
- Operator choice should appear only when proof cannot safely pick a repair.

## Shared Explanation Candidate

- `code`: stable diagnostic code.
- `failure_domain`: `browser_adapter_proof` or `browser_entry_handoff`.
- `continuation_action`: canonical next action.
- `constraint`: `no_adapter_fallback` when blocking.
- `reason`: one sentence.
- `map_section`: where to look for local commands.
- `router_summary`: reroute status without command details.

## Prototype Learning

- The same code/action pair is the strongest anti-drift anchor.
- Weak-signal success needs warning language that does not sound like failure.
- Auto-launch risk needs stop language, not repair-by-default language.
- Ambiguous binding needs “stop before action” wording.
- Missing dependency should name dependency setup without auto-installing.

## Production Shape Candidate

- Derive plain CLI and Router summaries from one explanation model.
- Keep map prose terse and section-targeted.
- Keep exact commands in Browser Adapter Map sections.
- Add explanation checks to unit tests for action/code consistency.

## Open Questions

- Should explanation text live in command contract data or proof runtime data?
- Should Router evidence include warning summaries?
- Should operator choices be generated from map sections or proof errors?
- How terse can plain output be before it stops helping recovery?
