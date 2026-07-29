# Hardware

- **Monitor** — Dell UltraSharp U4025QW (40" curved 5K2K Thunderbolt hub)

## Machines

| Machine | Chip | RAM | Role | SSH |
|---------|------|-----|------|-----|
| Mac 1 (MacBook Pro 14", Space Black) | M4 Pro (12C CPU, 16C GPU) | 24 GB | Personal laptop | local |
| Mac 2 (Mac Mini) | M4 Pro (14C CPU, 20C GPU) | 64 GB | Home server | `ssh -i ~/.ssh/id_rsa_github server@192.168.1.100` |
| Mac 3 (MacBook Pro 16", Bunnings-issued) | M3 Pro (12C, 6P+6E) | 36 GB | Work laptop | `ssh -i ~/.ssh/id_rsa_github s1010081@192.168.1.18` |

## SSH Usage

Flaky/dropped SSH, timeouts, connecting for cmux, or first-time mini key setup: use the `mac-mini-ssh` skill (`skills/mac-mini-ssh/SKILL.md`) — it owns the diagnose→fix→configure runbook (macOS sleep/pmset, keepalives, dedicated key, durable tmux/cmux).

SSH with key auth works directly from Claude Code — no interactive login needed. Run commands via:

```bash
ssh -i ~/.ssh/id_rsa_github <user>@<ip> "<command>"
```

Example: `ssh -i ~/.ssh/id_rsa_github s1010081@192.168.1.18 "hostname && whoami"`

Multi-command sessions work fine by chaining with `&&` or `;`.

## Tmux Sessions

Remote tmux sessions with claude, yazi, and SSH shell (all panes run on the remote machine):

```bash
tx mac-mini mac-mini        # Mac Mini home server (claude + codex + yazi + ssh)
tx mac-bunnings mac-bunnings # Bunnings work laptop (claude + yazi + ssh)
```

Note: Remote panes use `zsh -l -c` to load the full login shell PATH.

## Check Specs

Run locally or over SSH to get current specs instead of trusting cached values:

```bash
hostname && sysctl -n machdep.cpu.brand_string && sysctl -n hw.memsize | awk '{print $0/1073741824 " GB"}' && sw_vers
```
