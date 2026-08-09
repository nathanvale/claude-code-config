---
name: apple-reminders
description: "Read, search, create, edit, complete, move, or delete items in Apple Reminders through remindctl when the user explicitly names Apple Reminders."
---

# Apple Reminders

Use `remindctl`, which writes through Apple's public EventKit API and therefore
uses the same reminders and iCloud sync as Reminders.app. Never write directly
to the Reminders SQLite store.

## Dependency

- `remindctl`: hard dependency. Missing state: blocked. Next repair: add
  `steipete/tap/remindctl` to the dotfiles Brewfile and install it with
  `brew bundle`, then rerun `remindctl doctor --for-agent --json`.
- macOS 14 or later and Reminders permission for the process running the CLI.
- Upstream contract checked 2026-08-09:
  `https://github.com/openclaw/remindctl`.

## Workflow

1. Run `remindctl doctor --for-agent --json` before the first operation in a
   session or after a permission failure.
2. If authorization is `not-determined`, explain that macOS will ask for
   Reminders access, then run `remindctl authorize` only with the user's
   approval. If denied, direct the user to **System Settings > Privacy &
   Security > Reminders**.
3. Read current state with JSON before changing it. Use stable reminder or list
   IDs when available; do not rely on a numeric display index from an old read.
4. For a requested mutation, resolve the exact title, list, due value, and
   target ID. Preserve date-only input as an all-day date; never invent a time.
5. Preview completion or deletion with `--dry-run`. State the exact effect and
   obtain confirmation before destructive deletion or deleting a list.
6. Execute with `--json --no-input`, then read the affected item again and
   report the verified result. Never retry a mutation when the result is
   unknown until current state has been inspected.

## Read Operations

```bash
remindctl status --json
remindctl list --json
remindctl open --json
remindctl today --json
remindctl overdue --json
remindctl search "query" --json
remindctl info <stable-id> --json
```

Use `open --json` for all incomplete reminders, including items without due
dates. Add `--list-id <stable-list-id>` when a list name is ambiguous.

## Mutations

```bash
remindctl add "Title" --list-id <list-id> --due <date> --json --no-input
remindctl edit <stable-id> --title "Title" --json --no-input
remindctl edit <stable-id> --list-id <list-id> --json --no-input
remindctl complete <stable-id> --dry-run --json
remindctl complete <stable-id> --json --no-input
remindctl delete <stable-id> --dry-run --json
remindctl delete <stable-id> --force --json --no-input
```

Create or rename a list only when explicitly requested. Do not assume the
default list has a particular name. Reject conflicting changes such as setting
and clearing the same field in one operation.

## Boundaries

- This skill does not own recurring Codex automations or chat follow-ups.
- EventKit does not expose native Reminders sections, tags and smart lists,
  attachments, or Apple's private **Urgent** toggle. Say so plainly instead of
  approximating those features.
- Do not expose raw reminder databases, private filesystem paths, or unrelated
  reminders in the response.
- Running over SSH requires permission on the Mac that executes `remindctl`.
