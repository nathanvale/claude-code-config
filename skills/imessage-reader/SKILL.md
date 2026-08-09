---
name: imessage-reader
description: "Read, search, watch, or explicitly send Apple Messages on macOS through imsg when the user names iMessage, SMS, Messages.app, or Mac message history."
role: tool-workflow
---

# Apple Messages

Use `imsg` as the runtime for Apple Messages. It reads the local Messages
database, emits stable JSON, and uses Messages.app's public AppleScript surface
for ordinary sends. Do not build or maintain another Messages database parser
inside this skill.

## Dependency

- `imsg`: hard dependency. Install owner: the dotfiles Brewfile. Runtime owner:
  <https://github.com/openclaw/imsg>.
- Missing state: blocked. Next repair: propose adding
  `steipete/tap/imsg` to the dotfiles Brewfile, then install it with
  `brew bundle` after approval.
- macOS 14 or later with Messages.app signed in.
- Full Disk Access for the parent process that reads messages.
- Automation permission for the parent process that sends through Messages.app.

## Workflow

1. Run `imsg --version` and `imsg status --json` before the first operation.
   Treat status as capability information, not proof that private message reads
   work.
2. Use `imsg completions llm` or `imsg <command> --help` for the installed
   command contract. Do not copy stale flags from this skill.
3. Classify the request as read, watch, or send. Resolve the narrowest chat,
   participants, dates, limit, attachment scope, and direction before reading.
4. Use JSON output. Keep primary data on stdout and interpret repair guidance
   from stderr or the structured RPC error.
5. Present only the requested message facts. Do not persist, index, summarize,
   or promote raw messages unless the user separately approves the destination
   and retention boundary.
6. For a send, show the exact recipient or stable chat, exact text, attachment,
   and service. Obtain fresh confirmation immediately before running `imsg
   send`.
7. After a send, report the returned acknowledgment honestly. A `sent` result
   proves Messages accepted the request, not that the recipient read or received
   it. If the result is unknown, inspect the same target. If that inspection is
   inconclusive, report the result as unknown and stop. Never retry
   automatically. Any later `imsg send` requires fresh confirmation.

## Privacy And Safety

- Message content, participants, attachments, and contact identities are
  private data. Read only the scope needed for the user's request.
- Never run a broad chat listing, archive seed, full-history export, continuous
  watch, or contact-resolution sweep merely to prove setup.
- `imsg status --json` can report basic capability without proving Full Disk
  Access. A bounded user-requested read is the real read-permission proof.
- Do not enable or recommend the injected IMCore bridge. This skill excludes
  features that require disabling System Integrity Protection, library
  validation changes, private frameworks, or process injection.
- Do not use message mutation, read receipts, typing indicators, edit, unsend,
  delete, group management, polls, stickers, or other advanced bridge commands.
- Never send to a guessed contact name or stale numeric chat index. Resolve an
  exact handle or current stable chat target first.
- Default direct sends to `--service imessage`. Do not permit automatic SMS
  fallback unless the user explicitly asks for it after seeing that consequence.
- Sending, reacting, or attaching files is an externally visible side effect
  and always requires fresh confirmation. This MVP does not automate replies.

## Verification

- Static: YAML-parse this file, run the skill description audit, and run owner
  path checks.
- Runtime discovery: `imsg --version`, `imsg status --json`, and
  `imsg completions llm`.
- Read smoke tests require separate approval because even one chat row exposes
  private metadata.
- Send smoke tests require a named recipient, exact content, and separate
  foreground approval. Never send a synthetic test message by default.

## Legacy Boundary

The previous Bun reader under `skills/imessage-reader/scripts/` is preserved
for comparison during this prototype but is not the runtime owner of the new
workflow. Do not invoke it unless the user explicitly asks to compare legacy
behavior. Remove or archive it only after the `imsg` path is accepted and
installed.
