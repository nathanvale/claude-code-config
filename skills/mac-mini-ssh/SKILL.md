---
name: mac-mini-ssh
description: "Diagnose, harden, or fix SSH to the headless Mac Mini server, then set up or troubleshoot durable cmux/tmux sessions. Use for timeouts, dropped connections, trusted-network firewall changes, key-only access, or daily-driver cmux repair."
role: tool-workflow
---

# Mac Mini SSH

Diagnose Mac Mini SSH by proving the network path before naming a cause.
Then repair access and attach to a durable remote tmux session.

Mini facts: `server@192.168.1.100`, alias `mac-mini`, dedicated key
`~/.ssh/id_ed25519_mac_mini`.

No arguments: classify the route, then run the read-only ladder.

## Version-Aware Research

Before researching macOS, SSH, pf, WireGuard, or cmux behavior, capture the
live versions:

```bash
ssh mac-mini 'sw_vers; /usr/bin/ssh -V; tmux -V'
cmux --version
```

Select Apple documentation for that macOS major version. Query Context7
against official cmux or OpenSSH sources with the observed versions in the
question. Do not apply guidance for an assumed macOS release.

## Classify the Route

WireGuard being connected does not prove traffic uses it. At home, the direct
LAN route wins even while the tunnel is connected.

If the request names WireGuard, off-site access, a hotspot, or tunnel state,
hand off to `unifi-wireguard`. Resume this SSH workflow only after it returns
`Tunnel`, `Underlay`, `Route`, and `Mode`.

For a direct-LAN-only check:

```bash
/sbin/route -n get 192.168.1.100 | grep -E 'destination|gateway|interface'
```

- LAN proof: route uses `en0`; SSH source is `192.168.1.x`.
- UniFi WireGuard proof: tunnel is connected, route uses its `utun` interface,
  and SSH source is `192.168.2.x`.

Keep the target `192.168.1.100` in both modes. The UDR7 routes the WireGuard
subnet to the home LAN.

## Read-Only Ladder

Run one bounded pass. Preserve refusal, timeout, handshake, and authentication
failures as different results.

```bash
ping -c 3 -t 5 192.168.1.100
nc -z -G 5 192.168.1.100 22
ssh -o ControlMaster=no -o ControlPath=none \
  -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10 mac-mini \
  'printf "SSH_OK\n"; printf "%s\n" "$SSH_CONNECTION"'
```

Route failures:

- `Connection refused`: port 22 has no listener or a filter actively rejects
  it. Check Remote Login first.
- Timeout: route, firewall, sleep, or host availability remains possible.
  Do not call sleep or `pf` proven.
- `Permission denied`: the network and listener work; repair authentication.
- Success followed by idle drops: inspect keepalives and power state.

Stop repeated probes after two identical failures. If a legacy dynamic SSH
ban table is loaded, stop and restore the static trusted-network policy before
continuing automation.

## Repair the Proven Branch

### Remote Login Off

At the Mini:

```bash
sudo systemsetup -getremotelogin
sudo lsof -nP -iTCP:22 -sTCP:LISTEN
```

If Remote Login is off, enable it in **System Settings → General → Sharing →
Remote Login**. Select **Only these users** and include `server` or the
Administrators group. `systemsetup -setremotelogin on` requires Full Disk
Access and can fail even under `sudo`.

### Firewall

Read `references/trusted-network-hardening.md` before changing pf, sshd, trusted
subnets, or dynamic-ban state. Keep the current session open and stage an
automatic rollback before loading rules.

```bash
sudo pfctl -s Anchors
sudo pfctl -a com.nathanvale.ssh -sr
sudo pfctl -a com.nathanvale.ssh -t ssh_trusted -T show
sudo pfctl -a ssh-brute-force -t bruteforce -T show 2>&1
```

The trusted table must contain only `192.168.1.0/24` and `192.168.2.0/24`.
`Table does not exist` is the expected result for the retired `bruteforce`
table. Never disable all of pf or flush unrelated state.

### Sleep

Treat sleep as an evidence-gated branch:

```bash
pmset -g custom
pmset -g assertions
log show --predicate 'eventMessage CONTAINS "Thermal pressure requested Sleep"' \
  --last 3d 2>/dev/null
```

No matching sleep or thermal evidence means do not apply a sleep fix. Snapshot
the current AC profile and obtain approval before any `sudo pmset` change.
Operational truth and rollback belong in the `mac-mini-home-server` repo.

## Keepalives (idle drops)

Use the client alias:

```
Host mac-mini
    HostName 192.168.1.100
    User server
    IdentityFile ~/.ssh/id_ed25519_mac_mini
    IdentitiesOnly yes
    ControlMaster auto
    ControlPersist 10m
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

Change server keepalives only after client keepalives fail to solve a reproduced
idle drop.

## Dedicated Key

Never overwrite an existing key. Never print private-key material.

```bash
test ! -e ~/.ssh/id_ed25519_mac_mini &&
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_mac_mini \
    -C "mac-mini-$(whoami)"

ssh-copy-id -f -i ~/.ssh/id_ed25519_mac_mini.pub \
  -o IdentityFile=~/.ssh/id_rsa_github -o IdentitiesOnly=yes \
  server@192.168.1.100

ssh -i ~/.ssh/id_ed25519_mac_mini -o IdentitiesOnly=yes \
  server@192.168.1.100 'printf "KEY_OK\n"'
```

Without `-f`, `ssh-copy-id` can mistake authentication by the bootstrap key
for proof that the new public key is already installed. Prove a fresh session
with `IdentitiesOnly=yes`, back up `authorized_keys`, remove only the old
public-key fingerprint, then prove the old key is rejected.

## Durable cmux/tmux

tmux runs on the Mini. cmux is the local viewer.

```bash
ssh mac-mini 'tmux_path=$(command -v tmux) &&
  test -f "$tmux_path" && test -x "$tmux_path" &&
  printf "TMUX=%s\n" "$tmux_path" && tmux -V'
ssh mac-mini '/opt/homebrew/bin/tmux has-session -t mac-mini 2>/dev/null ||
  /opt/homebrew/bin/tmux new-session -d -s mac-mini'
cmux ssh-tmux mac-mini --identity ~/.ssh/id_ed25519_mac_mini
```

Run the preflight through a fresh noninteractive SSH shell. If cmux reports
that `~/bin/tmux` is a directory, repair PATH so `command -v tmux` resolves
`/opt/homebrew/bin/tmux`; do not delete the `~/bin` directory. On the managed
Mini, `.zshenv` is owned by the dotfiles repo.

Do not use the local `tx mac-mini` template as proof of a remote tmux server;
that template opens local panes that SSH to the Mini.

## Troubleshoot cmux

Read `references/cmux-troubleshooting.md`. Follow its version gate, then prove
plain SSH, remote tmux discovery, beta-feature state, and ControlMaster in that
order. Do not diagnose cmux before `ssh mac-mini` succeeds.

## Verification

- Record route interface and SSH source for each claimed mode.
- Prove a fresh dedicated-key session with connection sharing disabled.
- Prove the former GitHub key is rejected after migration.
- Force one client disconnect; reattach the existing remote tmux session.
- Record live state in the `mac-mini-home-server` repo.

## Recheck After macOS Updates

Confirm `sw_vers`, Remote Login, route classification, power state, and one
fresh key-only SSH session. Research version-specific fixes only after live
evidence selects that branch.

## Dependency

Dependency: `skills/unifi-wireguard/SKILL.md`
Type: optional handoff for tunnel state, route repair, and hotspot proof
Missing state: degraded; direct-LAN diagnosis remains available
Next repair: restore `unifi-wireguard`; never toggle an unowned VPN profile
