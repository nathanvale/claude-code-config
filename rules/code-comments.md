---
alwaysApply: true
---

## Code Comments

Before writing any comment, ask: **"if I delete this, what is lost?"**

- Nothing lost → delete it.
- It restates the code, the test name, or the assertion below it → delete it.
- It names something not in the code → keep it.

Only three kinds survive:

- **Traps** — "do not reintroduce X, because Y". Name the consequence.
- **Constraints** — something a future editor would otherwise violate.
- **Non-obvious why** — a decision the code cannot express.

Never in source; these belong in the ticket or PR description:

- Requirement history and spec quotes
- Verification narrative ("verified in Chrome at 6x zoom")
- Change backstory ("two earlier passes got this wrong")
- Revision markers (R7, R8) and dated attributions

Tests are the strictest case: the test name and the assertion already state the behaviour. A comment above them is a third copy.

- Bad: `// Resting: single label in the field` above `expect(label).toHaveAttribute('data-shrink','false')` inside `it('rests with the label inside the box')`.
- Good: no comment — the name and the assertion say it.
- Good: `// Do not reintroduce boxSizing:'border-box' with vertical padding — leaves 0px content box, so text renders high while the wrapper still measures centred.`
