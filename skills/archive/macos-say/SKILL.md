---
name: macos-say
description: "Use native macOS text-to-speech from shell. Triggers on 'say this', 'speak aloud', 'text to speech', or 'save speech audio'."
---

# macOS Say

## Route

- Use `/usr/bin/say` for native macOS text-to-speech.
- Use PATH `say` only when the user asks for Nathan's wrapper.
- Prefer `-o` for tests; avoid surprise aloud speech.
- Owner: `/usr/bin/say`; docs: `man say`; wrapper: `/Users/nathanvale/code/dotfiles/bin/say`.

## Commands

```bash
/usr/bin/say "Hello."
/usr/bin/say -v Samantha -r 160 "Hello slowly."
/usr/bin/say -o /tmp/speech.aiff "Save this."
```

## Guardrails

- Quote text.
- Ask before speaking sensitive text aloud.
- For verification, save to temp audio and inspect exit code/file.
- Check voices with `/usr/bin/say -v '?'` when exact voice matters.
- Do not trust bad voice/rate values to fail; macOS may exit `0`.
- Treat invalid flags, files, or paths as command errors; report stderr.
