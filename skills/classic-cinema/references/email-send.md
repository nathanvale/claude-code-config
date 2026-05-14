# Email Send — gog gmail send

## The verified invocation

```bash
gog gmail send \
  --account <email> \
  --to <email> \
  --subject "Booking Confirmation for {MOVIE_TITLE}" \
  --body-html "$(cat /tmp/classic-cinema-ticket-<timestamp>.html)"
```

Verified 2026-04-08 against `gog` build v0.12.0 with an HTML test body containing `&`, `<`, `>`, `"`, `$`, and `$(cat /etc/passwd)`. All characters survived intact. No shell expansion. See pre-flight message ID `19d6c19e4074f7b8` for the successful test.

## Account resolution

Read the `email-account` from `.productivity.yml`:

1. Current working directory's `.productivity.yml` (preferred)
2. Fall back to `~/code/my-second-brain/.productivity.yml` which declares:
   ```yaml
   connectors:
     email: gog
     email-account: hi@nathanvale.com
   ```

Never hard-code the account in the skill. If neither file exists, ask Nathan which account to use via AskUserQuestion.

The `--to` is the same as `--account` for this skill (Nathan sends the reminder to himself).

## Subject line format

**Exactly:** `Booking Confirmation for {MOVIE_TITLE}`

This matches the old plugin's `sendTicketEmail(toEmail, movieTitle, ticketHtml)` wrapper which sets subject as `` `Booking Confirmation for ${movieTitle}` `` (from `the-cinema-bandit/src/gmail/send.ts` line 113). Do not relabel, do not add emojis, do not add venue name. Verbatim.

## Temp file pattern

1. Generate a timestamp: `TS=$(date +%s)`
2. Write filled HTML: `TEMP_FILE=/tmp/classic-cinema-ticket-${TS}.html`
3. Send: `--body-html "$(cat $TEMP_FILE)"`
4. **On success:** delete the temp file
5. **On failure:** do NOT delete the temp file — surface the path to Nathan

## Error handling

If `gog gmail send` returns non-zero:

1. Print the full gog error output to Nathan
2. Show the temp file path: `"The filled HTML is at $TEMP_FILE — you can retry by running: gog gmail send --account ... --to ... --subject '...' --body-html \"$(cat $TEMP_FILE)\""`
3. Do NOT delete the temp file
4. Do NOT append to the booking log (the booking didn't "happen" — nothing was sent)
5. Stop — don't retry automatically, let Nathan decide

## Message ID parsing

The successful send returns TSV output like:

```
message_id	19d6c19e4074f7b8
thread_id	19d6c19e4074f7b8
```

Capture the `message_id` value for the booking log entry. Pattern:

```bash
GMAIL_MSG_ID=$(gog gmail send --account ... --to ... --subject "..." --body-html "$(cat $TEMP_FILE)" 2>&1 | awk '/^message_id/ {print $2}')
```

Or use `--json` if `gog` supports it on send (check `gog gmail send --help` before using).

## Safety notes

- Never pipe secrets or credentials into the command line
- The temp file is HTML only, no payment data (we don't have any)
- The temp file contains Nathan's selected seats, which is minor PII — default `/tmp` ACL is fine
- Don't log the full HTML body to stdout (it's 15kb+ of template junk); log only the message ID on success
