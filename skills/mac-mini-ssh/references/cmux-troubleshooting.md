# cmux Remote tmux Troubleshooting

Use when cmux cannot discover, attach, or retain the Mini's remote tmux
session.

## Version Gate

Capture versions before research:

```bash
sw_vers
cmux --version
ssh mac-mini 'sw_vers; /usr/bin/ssh -V; command -v tmux; tmux -V'
```

Use the matching macOS version in Apple documentation. Query Context7 library
`/websites/cmux` with the observed cmux, macOS, OpenSSH, and tmux versions.

Official source: [cmux Remote tmux](https://cmux.com/docs/remote-tmux).

The official requirements are:

- Reachable SSH destination or `~/.ssh/config` alias.
- tmux 3.2 or newer on the remote host.
- Remote tmux beta feature enabled in cmux.
- Standard SSH credentials or an explicit `--identity`.

## Failure Ladder

### 1. Plain SSH

```bash
ssh -o ControlMaster=no -o ControlPath=none \
  -o BatchMode=yes -o IdentitiesOnly=yes mac-mini 'printf "SSH_OK\n"'
```

If this fails, return to the main SSH ladder. cmux relies on standard SSH and
cannot repair authentication or firewall failures.

### 2. Remote tmux discovery

```bash
ssh mac-mini 'tmux_path=$(command -v tmux) &&
  test -f "$tmux_path" && test -x "$tmux_path" &&
  printf "TMUX=%s\n" "$tmux_path" && tmux -V &&
  tmux list-sessions'
```

If `command -v tmux` resolves a directory such as `~/bin/tmux`, repair the
fresh noninteractive shell PATH so it resolves `/opt/homebrew/bin/tmux`.
The current cmux command surface has no documented remote-binary override.
On the managed Mini, `.zshenv` is owned by the dotfiles repo.

### 3. Beta feature

Open cmux Settings and enable **Beta Features → Remote tmux**. Socket commands
for remote tmux are gated by this setting.

### 4. Attach

```bash
cmux ssh-tmux mac-mini \
  --identity ~/.ssh/id_ed25519_mac_mini
```

`Permission denied` means the alias, user, or identity is wrong. Reprove plain
SSH with the same identity.

### 5. Session persistence

```bash
ssh mac-mini 'tmux has-session -t mac-mini 2>/dev/null ||
  tmux new-session -d -s mac-mini'
ssh mac-mini 'tmux list-sessions -F "session=#{session_name} attached=#{session_attached}"'
```

Disconnect one client and reattach. The remote tmux server should persist.

### 6. Connection reuse

```bash
ssh mac-mini true
ssh -O check mac-mini
ssh -vv mac-mini true 2>&1 |
  grep -E 'auto-mux: Trying existing master|mux_client_request_session'
```

cmux Remote tmux uses SSH ControlMaster. A stale or missing control socket can
be recreated by a normal `ControlMaster auto` connection. Do not delete every
SSH socket; target only the canonical `mac-mini` ControlPath after confirming
it is stale.

## Known Live Proof

On 2026-07-29, cmux 0.64.20, macOS 26.6, and tmux 3.6a passed this ladder.
cmux displayed the remote `mac-mini` session as a workspace, and the remote
session reported an attached client.
