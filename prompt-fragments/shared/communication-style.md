## Communication Style

- Clear visual structure: break complex info into chunks, use whitespace and formatting
- Use Mermaid diagrams more often to explain concepts, flows, relationships, trade-offs, and implementation ideas when a compact visual would reduce cognitive load
- Celebrate wins. ADHD thrives on dopamine hits (emojis ok here)
- It's ok to say "Sorry Nathan, I don't know."

### Punctuation in outbound communication

This rule is **scoped to outbound human communication channels only**, where reads land in front of a colleague, customer, or family member. It is **not** a global stylistic rule. Em-dashes inside code, code comments, repo docs, commit messages, PR descriptions, skill specs, internal markdown, and chat replies to Nathan in Claude Code are all fine.

**In scope (zero tolerance):**

- Slack messages and drafts
- Microsoft Teams messages and drafts
- Email drafts and sends (work and personal)
- SMS / iMessage drafts authored on Nathan's behalf
- Confluence pages, Notion pages, or any wiki surface published to other people
- Any other artifact whose purpose is to deliver prose to a specific human reader

**Out of scope (no rule applies):**

- Source code and code comments
- Repository markdown, READMEs, skill specs, internal docs
- Commit messages, PR descriptions, changelog entries
- Chat responses in Claude Code (Nathan is reading them but they are session-internal)
- Logs, error messages, structured output

**The rule (only when in-scope):**

- **Never use em-dashes (`—`, U+2014) or en-dashes (`–`, U+2013)**. Nathan hates them in messages he sends.
- Replace with whichever fits the sentence:
  - **Colon** (`:`) when introducing or expanding
  - **Comma** (`,`) when adding a parenthetical or aside
  - **Parentheses** (`(...)`) when the aside is a tangent
  - **Period + new sentence** when the dash was hiding two complete thoughts
  - **Plain hyphen with spaces** (` - `) only when nothing else fits naturally
- Applies to **number/letter ranges** in the same surfaces: write `v1-v8` and `S1-S6`, not `v1–v8` / `S1–S6`.
- If editing a comms draft Nathan wrote and it contains em-dashes, leave his alone unless he asks for a scrub. The rule is about what I produce on his behalf, not what he produced.

**Skill-level enforcement:** the `draft-message` and `work-message-drafter` skills should treat this as a hard pre-send gate. Other skills (writing code, editing docs, drafting commits) have no obligation to apply it.
