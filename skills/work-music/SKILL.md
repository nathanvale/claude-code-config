---
name: work-music
description: "Use when the user wants music to lock in, enter a work mode, start a focus/admin/writing/debugging/reset/shutdown playlist, or turn Apple Music into a daily work ritual."
role: tool-workflow
---

# Work Music

Use Apple Music as a low-friction work-mode switch.

## Owner

- Use Apple Music on Nathan's Mac.
- Prefer existing playlists: `Pure Focus`, `Coffee Shop`, `Classical AM`, `Jazz Chill`, `Calm`, `Pure Meditation`, `Get Up!`.
- Use `osascript` when Music scripting is enough.
- Use Computer Use only when UI inspection or direct app interaction is needed.

## Workflow

1. Infer work mode from the prompt.
2. If the user asks to play, start, resume, or lock in now, start the matching playlist.
3. If the prompt only invokes the skill or asks what to do, offer 3-5 work-mode choices before playing anything.
4. If the user says "surprise me" or "choose for me", choose the most useful mode and say why.
5. Set volume between `45` and `60` unless the user asks for a level.
6. Verify playback after starting music.
7. Reply with playlist, current track, and one next action after starting music.
8. Keep it terse.

## Modes

- `Deep Work Start`: play `Pure Focus`; use for "lock in", coding, first block, serious work.
- `Task Triage`: play `Coffee Shop`; use for inbox, notes, calendar, Slack, issues.
- `Coding Flow`: play `Pure Focus`; use for implementation, refactoring, routine debugging.
- `Hard Debugging`: play `Calm` at low volume or suggest silence; use for reproduction, logs, hypotheses.
- `Writing`: play `Classical AM`; use for docs, specs, PR descriptions, strategy notes.
- `Admin Sprint`: play `Get Up!`; use for expenses, cleanup, chores, low-stakes follow-ups.
- `Meeting Reset`: play `Calm`; use for five minutes before or after calls.
- `Energy Rescue`: play `Get Up!`; use for afternoon dips.
- `Shutdown`: play `Pure Meditation` or `Calm`; use for the last 15 minutes.

## Human Offer

When not playing immediately, offer choices like:

- `Lock in`: `Pure Focus`; one deep work block.
- `Clear the deck`: `Coffee Shop`; admin, inbox, triage.
- `Write`: `Classical AM`; docs, specs, prose.
- `Reset`: `Calm`; five-minute transition.
- `Close down`: `Pure Meditation`; shutdown ritual.

Ask the user to pick one or say `choose for me`.

## Commands

List playlists:

```sh
osascript -e 'tell application "Music" to get name of playlists'
```

Start a playlist:

```sh
osascript -e 'tell application "Music"' \
  -e 'activate' \
  -e 'play playlist "Pure Focus"' \
  -e 'set sound volume to 55' \
  -e 'end tell'
```

Verify playback:

```sh
osascript -e 'tell application "Music" to get player state & "|" & name of current track & "|" & artist of current track & "|" & name of current playlist'
```

## Response Shape

- If playing: say playlist, track, and one next action.
- If offering: give 3-5 choices with playlist and use.
- Keep it human-readable, not command-like.

Example:

```text
Playing `Pure Focus`.
Current track: `Avril 14th` by `Aphex Twin`.
Next action: write the first concrete task for this block.
```
