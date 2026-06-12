---
name: fix-microphone
description: "Troubleshoot a Mac microphone that is selected but captures no sound, including Elgato Wave:3 with or without Wave Link. Use when the mic picks up nothing, input level bars do not move, an app cannot hear you, or the Wave mic stops working."
---

# Fix Microphone

Quick read-only triage for a Mac mic that is selected but silent. Fix the cheapest cause first; stop as soon as level bars move.

## Trigger

- Mic picks up no sound when speaking into it.
- Input level bars do not move in System Settings or an app.
- Elgato Wave:3 selected but silent, with or without Wave Link running.

## First Safe Action

Run the diagnostic block. It only reads state, except step 3 (raises input volume), which is reversible.

```bash
# 1. Is the device connected and which is default input?
system_profiler SPAudioDataType 2>/dev/null | grep -B1 "Default Input Device: Yes"
system_profiler SPAudioDataType 2>/dev/null | grep -i -A6 "Elgato Wave:3"

# 2. Current input volume (low = near-silent) and mute state
osascript -e 'get volume settings'

# 3. FIX: raise input volume if low (this is the #1 cause)
osascript -e 'set volume input volume 75'

# 4. Is Wave Link app running, or just its leftover virtual driver?
ps aux | grep -i "wave link" | grep -v grep
ps aux | grep -i "WaveLink3VirtualAudio" | grep -v grep
```

## Fix Order (cheapest first)

1. **Input volume too low.** `osascript -e 'set volume input volume 75'`. Anything under ~30 reads as silence.
2. **Physical mute on the mic.** Wave:3 has a capacitive mute on top — tap it. Red LED = muted, white = live. Easy to bump.
3. **Wrong device selected.** System Settings → Sound → Input → pick **Elgato Wave:3** (the raw USB mic), not a **Wave Link Mix** virtual.
4. **Stale Wave Link driver** intercepting the mic when the app is closed (`WaveLink3VirtualAudio.driver` loaded but no Wave Link process). Restart Core Audio: `sudo killall coreaudiod` — audio blips ~2s, nothing else affected. Ask before running.

## Wave Link vs raw Wave:3

- **Raw Wave:3** (`Transport: USB`) is the real mic. Simplest target — bypasses Wave Link entirely.
- **Wave Link** creates virtual devices (`Personal Mix`, `Chat Mix`, `Stream Mix`). If an app is set to a Mix that the Wave:3 is not routed into, you get silence. If the app must use a Mix, open Wave Link and confirm the Wave:3 channel is unmuted and metering.
- The Wave Link **virtual driver can stay loaded after the app quits** and capture the mic → silence. Step 4 above clears it.

## Verify

- System Settings → Sound → Input → Elgato Wave:3 → speak → **level bars move** = mic works.
- If bars move but an app still can't hear you, the fix is in that app's mic device selection, not the system.

## Gotchas

<!-- Append a new bullet each time a real, non-obvious failure recurs. Keep one fix per line. -->

- Input volume silently sitting at ~24/100 reads as a dead mic; raising it to ~75 fixes it. (2026-06-12, observed failure)
- Wave Link's virtual audio driver (`WaveLink3VirtualAudio.driver`) stays loaded after the app quits and can intercept the Wave:3; check for the driver even when no Wave Link process is running. (2026-06-12, observed failure)
