---
name: peekaboo
description: "macOS screenshots, UI inspect, clicks, typing, app/window automation."
role: tool-workflow
---

# Peekaboo

Use for macOS screen capture, UI inspection, and GUI automation.

## Binary

- Prefer `~/bin/peekaboo` when present; it is Peter's local release copy.
- Else use `peekaboo`.
- Check first: `~/bin/peekaboo --version || peekaboo --version`.

## Safety

- Check permissions before capture/automation: `peekaboo permissions status --json`.
- Screenshot needs Screen Recording; clicks/typing/window control need Accessibility.
- On remote Macs, Screenshot may be blocked by missing Screen Recording while
  clicks/typing still work through Accessibility; continue with clicks or DOM
  automation when the target is otherwise knowable.
- Prefer `--json` for machine parsing and `--no-remote` when testing local TCC.
- Do not click/type/destructively automate unless user asked or target is a controlled test.

## Command reference (owner)

The binary owns the command contract. Resolve `PB`, then discover commands and flags from the binary itself — do not rely on a copied list:

```bash
PB="${PEEKABOO_BIN:-$HOME/bin/peekaboo}"
[ -x "$PB" ] || PB="$(command -v peekaboo)"
```

- `"$PB" tools --json` — command and tool discovery.
- `"$PB" learn` — full agent guide.
- `"$PB" <command> --help` — per-command flags.
- Docs: `~/Projects/Peekaboo/docs/commands/`.

## Workflow

1. Resolve `PB` as above and confirm version when install state matters.
2. Run `permissions status --json`; if missing TCC, report exact missing grant.
3. For screenshots, use `image`; include `--path`, `--json`, and usually `--no-remote`.
4. For element targeting, run `see --json --annotate`, then click by element id/snapshot.
5. For long-running/change-aware screen capture, use `capture live`; for video frame sampling, use `capture video`.
6. Use `tools --json` for command/tool discovery and `learn` when the full agent guide is useful.
7. Verify output files with `sips -g pixelWidth -g pixelHeight <path>` or view the image.
