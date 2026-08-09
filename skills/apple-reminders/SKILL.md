---
name: apple-reminders
description: "Read, search, create, edit, complete, move, or delete items in Apple Reminders through remindctl when the user explicitly names Apple Reminders."
---

# Apple Reminders

Use `remindctl`, which reads and writes through Apple's public EventKit API.
Never read or write the Reminders SQLite store directly.

If the user names Apple Reminders without an operation, ask whether they want
to inspect reminders or change them.

## Dependency

- `remindctl`: hard dependency. Missing state: blocked. Next repair: add
  `steipete/tap/remindctl` to the dotfiles Brewfile and install it with
  `brew bundle`, then rerun `remindctl doctor --for-agent --json`.
- macOS 14 or later and Reminders permission for the process running the CLI.
- Command contract: `remindctl <command> --help` and
  `https://github.com/openclaw/remindctl`.

## Workflow

1. Run `remindctl doctor --for-agent --json` before the first operation in a
   session or after a permission failure.
2. If authorization is `not-determined`, explain that macOS will ask for
   Reminders access, then run `remindctl authorize` only with the user's
   approval. If denied, direct the user to **System Settings > Privacy &
   Security > Reminders**.
3. Use `remindctl <command> --help` for current flags. Run commands with JSON
   output and non-interactive mode when available.
4. Read only the scope the user requested. Never run a broad `all`, `open`, or
   `export` read merely to resolve a narrow list or reminder operation.
5. Before changing existing state, read the exact target and use a stable
   reminder or list ID. Never reuse a numeric index from an old read.
6. Resolve the exact title, list, due value, and target ID. Preserve date-only
   input as an all-day date; never invent a time or default list name.
7. Preview completion or deletion with `--dry-run`. State the exact effect and
   obtain confirmation before deleting a reminder or list.
8. Execute the requested change, then read the affected item again and report
   the verified result. On an unknown result, inspect current state before any
   retry.

## Boundaries

- This skill does not own recurring Codex automations or chat follow-ups.
- Create or rename a list only when explicitly requested.
- EventKit does not expose native Reminders sections, tags and smart lists,
  attachments, or Apple's private **Urgent** toggle. Say so plainly instead of
  approximating those features.
- Do not expose raw reminder databases, private filesystem paths, or unrelated
  reminders in the response.
- Running over SSH requires permission on the Mac that executes `remindctl`.
