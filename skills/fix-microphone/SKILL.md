---
name: fix-microphone
description: "Troubleshoot a Mac microphone that is selected but captures no sound, or activates with a multi-second delay. Covers Elgato Wave:3 with or without Wave Link. Use when the mic picks up nothing, input level bars do not move, an app cannot hear you, the Wave mic stops working, or mic activation is janky/delayed."
role: tool-workflow
---

# Fix Microphone

Quick read-only triage for a Mac mic that is selected but silent. Fix the cheapest cause first; stop as soon as level bars move.

## Trigger

- Mic picks up no sound when speaking into it.
- Input level bars do not move in System Settings or an app.
- Elgato Wave:3 selected but silent, with or without Wave Link running.
- Mic activation is delayed/janky — menubar mic icon flashes for seconds before the app gets audio.
- Voice app reports "no microphone available" then finds it seconds later.

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
2. **Physical mute on the mic.** Wave:3 has a capacitive mute on top; tap it. Red LED = muted, white = live. Easy to bump.
3. **Wrong device selected.** System Settings → Sound → Input → pick **Elgato Wave:3** (the raw USB mic), not a **Wave Link Mix** virtual.
4. **Stale Wave Link driver** intercepting the mic when the app is closed (`WaveLink3VirtualAudio.driver` loaded but no Wave Link process). Restart Core Audio: `sudo killall coreaudiod`; audio blips ~2s, nothing else affected. Ask before running.

## Elevation Scope

`sudo killall coreaudiod` needs admin rights because Core Audio runs as root and owns macOS audio routing. Scope: restarts audio routing, causes about 2s silence, and does not modify user data. Ask before running.

## Wave Link vs raw Wave:3

- **Raw Wave:3** (`Transport: USB`) is the real mic. Simplest target; bypasses Wave Link entirely.
- **Wave Link** creates virtual devices (`Personal Mix`, `Chat Mix`, `Stream Mix`). If an app is set to a Mix that the Wave:3 is not routed into, you get silence. If the app must use a Mix, open Wave Link and confirm the Wave:3 channel is unmuted and metering.
- The Wave Link **virtual driver can stay loaded after the app quits** and capture the mic → silence. Step 4 above clears it.

## Verify

- System Settings → Sound → Input → Elgato Wave:3 → speak → **level bars move** = mic works.
- If bars move but an app still can't hear you, the fix is in that app's mic device selection, not the system.

## Gotchas

<!-- Append a new bullet each time a real, non-obvious failure recurs. Keep one fix per line. -->

- Input volume silently sitting at ~24/100 reads as a dead mic; raising it to ~75 fixes it. (2026-06-12, observed failure)
- Wave Link's virtual audio driver (`WaveLink3VirtualAudio.driver`) stays loaded after the app quits and can intercept the Wave:3; check for the driver even when no Wave Link process is running. (2026-06-12, observed failure)
- Bluetooth mics (AirPods, AirPods Max) add 1–3s SCO negotiation delay on every activation + degraded audio quality. Pin superwhisper to a wired mic: `defaults write com.superduper.superwhisper selectedDeviceID "AppleUSBAudioEngine:Elgato Systems:Elgato Wave:3:A017A522103RY2:2,1"` + `useDefaultAudioDevice = 0`. Unplugging the Wave:3 can silently reset `selectedDeviceID` to `BuiltInMicrophoneDevice` — re-pin after replug. (2026-06-15, observed)
- macOS powers down mic hardware when no app holds the input stream open (Apple Silicon M1–M4). Next activation takes 2–5s — superwhisper shows "no microphone available" then finds it. Fix: install [`macos-mic-keepwarm`](https://github.com/drewburchfield/macos-mic-keepwarm) — lightweight Swift binary holds AVCaptureSession open, mic stays instant. Runs as LaunchAgent, survives reboots. Trade-off: permanent orange mic dot in menubar. Uninstall: `curl -fsSL https://raw.githubusercontent.com/drewburchfield/macos-mic-keepwarm/master/uninstall.sh | bash`. (2026-06-15, observed failure + community-verified fix)
- Wave:3 goes completely silent (not delayed) when Zoom + superwhisper contend for the mic and Core Audio loses the USB handshake. `mic-warm` running doesn't prevent it. Input volume drifts to ~56 and DriverPowerState drops to 0. Fix: `sudo killall coreaudiod` to force re-enumeration, then `osascript -e 'set volume input volume 75'`. Recurred on same setup that worked the day before — no config or cable change. (2026-06-25, third recurrence of coreaudiod restart pattern)
- Dell U4025QW USB hub is the root cause of Wave:3 mic failures — not coreaudiod. When the Dell KVM/USB hub path fully stalls, `sudo killall coreaudiod` does NOT fix it. Only a physical USB replug recovers the mic. Moving Wave:3 to a direct Mac USB port eliminates the problem entirely. Monitor firmware M3T105 (latest) does not fully fix this. (2026-06-25, confirmed by direct-to-Mac test)
- Silence-based watchdog monitoring (polling audio levels to detect dead mic) has catastrophic false-positive rates — silence is the dominant state of a developer's workday. If automated monitoring is needed, check USB device presence (`system_profiler SPUSBDataType` or `kAudioDevicePropertyDeviceIsAlive`), not audio levels. (2026-06-25, adversarial review finding)
- Hammerspoon cannot intercept keys emitted by Karabiner's virtual keyboard — F18 arrives as keycode 0 (indistinguishable from 'a'). Don't attempt Hammerspoon-in-the-middle-of-PTT-chain with Karabiner. (2026-06-25, prototyping dead end)
- Stream Deck button at `scripts/fix-mic.sh` runs passwordless `sudo killall coreaudiod` + volume reset. Human-triggered = zero false positives, faster than any automated detection. (2026-06-25, added as backup)

## Troubleshooting Tree

When the mic is delayed/janky (not silent), work through these branches in order. Stop as soon as the symptom resolves.

### Branch 1: Audio device contention
```bash
# Who has audio handles open?
lsof 2>/dev/null | grep -i "coreaudio\|AudioHAL" | awk '{print $1, $2}' | sort -u
# Competing voice apps (superwhisper, dictation, Siri, Zoom, Teams, Discord, OBS)
ps aux | grep -i -E "superwhisper|discord|zoom|teams|obs|krisp|whisper" | grep -v grep
```
Kill or quit competing apps one at a time and retest.

### Branch 2: corespeechd / Siri / Dictation holding passive mic session
```bash
# corespeechd runs the "Hey Siri" hotword detector — holds mic open passively
ps aux | grep corespeechd | grep -v grep
# Check Siri/Dictation state
defaults read com.apple.assistant.support "Assistant Enabled" 2>/dev/null
defaults read com.apple.assistant.support "Dictation Enabled" 2>/dev/null
```
Disable Siri voice trigger in System Settings → Apple Intelligence & Siri → Listen for. Then `killall corespeechd` (macOS respawns it without passive mic hold).

### Branch 3: macOS mic hardware sleep (Apple Silicon)
macOS powers down mic hardware after ~30–60s of idle. Next activation takes 2–5s. This is the most common cause of push-to-talk delay on M1–M4 Macs.
```bash
# Check driver power state (0 = suspended/idle)
ioreg -p IOUSB -l 2>/dev/null | grep -A20 "Wave:3" | grep -i "power"
# DriverPowerState 0 = device asleep, needs wake before audio flows
```
Fix: install `macos-mic-keepwarm` to hold the mic awake permanently:
```bash
curl -fsSL https://raw.githubusercontent.com/drewburchfield/macos-mic-keepwarm/master/install.sh | bash
# To stop: launchctl unload ~/Library/LaunchAgents/com.user.keep-mic-warm.plist
# To restart: launchctl load ~/Library/LaunchAgents/com.user.keep-mic-warm.plist
# To uninstall: curl -fsSL https://raw.githubusercontent.com/drewburchfield/macos-mic-keepwarm/master/uninstall.sh | bash
```
Trade-off: permanent orange mic dot in menubar. Binary at `~/.local/bin/mic-warm`.

### Branch 4: Quick USB mic reset (without physical unplug)
```bash
sudo killall coreaudiod
```
Restarts Core Audio, re-enumerates all devices. ~2s audio blip. Equivalent to unplugging and replugging the mic. Use as a one-shot fix; if the delay recurs, use Branch 3 instead.

Passwordless sudoers entry is installed at `/etc/sudoers.d/coreaudiod-reset` — Claude Code can run this directly without prompting. To reinstall if missing:
```bash
sudo sh -c 'echo "nathanvale ALL=(ALL) NOPASSWD: /usr/bin/killall coreaudiod" > /etc/sudoers.d/coreaudiod-reset && chmod 440 /etc/sudoers.d/coreaudiod-reset'
```

### Branch 5: App sound effects compounding with hardware sleep
If the mic is already in hardware sleep (Branch 3) AND the voice app plays an activation chime through the same USB device, the delay worsens. Disabling sound effects may mask the symptom but doesn't fix root cause.
```bash
defaults read com.superduper.superwhisper enableSoundEffects
# Disable as a test: defaults write com.superduper.superwhisper enableSoundEffects -bool false
# Re-enable after fixing Branch 3: defaults write com.superduper.superwhisper enableSoundEffects -bool true
```

### Branch 5: macOS TCC mic permission cycling
```bash
# Check mic permissions — auth_value 2 = allowed
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  "SELECT client, auth_value FROM access WHERE service='kTCCServiceMicrophone';" 2>/dev/null
```
If the app's auth_value is not 2, re-grant in System Settings → Privacy & Security → Microphone.

### Branch 6: Bluetooth audio device stealing default
```bash
# A BT device reconnecting can briefly claim default input
system_profiler SPBluetoothDataType 2>/dev/null | grep -B2 -A5 -i "audio\|headphone\|airpod"
# Check superwhisper's device selection history
defaults read com.superduper.superwhisper selectedDeviceID
defaults read com.superduper.superwhisper useDefaultAudioDevice
```
Pin superwhisper to the Wave:3 explicitly (`useDefaultAudioDevice = 0`, `selectedDeviceID` set to the Wave:3 USB engine string) so BT reconnection doesn't steal focus.

## Current PTT Setup (2026-06-25)

- **PTT key**: Right Control (all external keyboards have it; MacBook does not — fine, no mic at MacBook)
- **Superwhisper PTT**: Right Control (`carbonKeyCode: 62, carbonModifiers: 4096`)
- **Paste behaviour**: "Paste result text" ON — text pastes at cursor on PTT release
- **Auto-send**: "Hold shift to auto-send after paste" ON — hold Shift at release to also press Enter
- **Keyboards**: Lofree Flow 84, Keychron K2 HE, MacBook built-in (see `context/products/`)
- **Mic connection**: Direct to Mac USB port (preferred for reliability). Dell U4025QW monitor hub is a convenience fallback but causes intermittent mic death.
- **Backup fix**: `scripts/fix-mic.sh` (Stream Deck button) or 🎙 menubar if Hammerspoon is running

### What didn't work (2026-06-25)

- **Karabiner Right Control → Shift+F18 for auto-send**: Karabiner holds Shift alongside F18, but superwhisper needs physical Shift held at the moment of PTT release. Simultaneous synthetic Shift release doesn't trigger auto-send.
- **Hammerspoon mic guard in PTT chain**: Karabiner's virtual keyboard emits F18 as keycode 0 — Hammerspoon can't distinguish it from 'a'. Dead end.
- **Watchdog LaunchAgent polling audio levels**: Adversarial review killed it — silence is normal, false positives dominate. Monitor USB device presence instead if automated detection is ever needed.

## Future Exploration

Ideation doc for superwhisper voice-to-text optimization:
`experience-sdk/docs/ideation/2026-06-15-superwhisper-voice-optimization-ideation.md`

Top opportunities (ranked by ROI):
1. **Vocabulary corpus from codebase** — populate Parakeet V3's 1,000-term keyword recognition from git history, CONCEPTS.md, Jira keys
2. **A/B model shootout** — build a ground-truth utterance corpus, score canary vs parakeet vs cloud on WER/latency/jargon
3. **Dual-hotkey mode router** — right-Control for canary (fast commands), right-Option for parakeet+vocabulary (long dictation)
4. **Post-transcription signal chain** — composable sed-map → casing normaliser → context-aware formatter
5. **Shadow model jury on Mac Mini** — race mlx-whisper against superwhisper, log disagreements as training data
6. **Ambient ring buffer** — CoreAudio tap with 30s pre-roll so you never lose the start of a sentence
7. **Sourdough fine-tune loop** — monthly LoRA fine-tune on Mac Mini from daily correction pairs
