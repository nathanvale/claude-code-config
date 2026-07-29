# Mac Mini VS Code Remote SSH

Use after the main skill proves the saved `mac-mini` alias and remote folder.

Current project folder:

```text
/Users/server/code/mac-mini-home-server
```

Recheck the path on every run. Treat a missing folder as blocked.

## Detect the VS Code Context

From the MacBook:

```bash
code --version
if code --list-extensions |
  grep -qx 'ms-vscode-remote.remote-ssh'; then
  printf "REMOTE_SSH_INSTALLED\n"
else
  printf "REMOTE_SSH_MISSING\n"
fi
```

`ms-vscode-remote.remote-ssh` is a new dependency. If missing, stop and ask
before installing it. Do not edit SSH or firewall configuration as a
substitute.

Use these context signals:

| Context | Explorer owns | New integrated terminal runs on |
|---|---|---|
| Local VS Code | MacBook checkout | MacBook |
| `SSH: mac-mini` Remote SSH window | Mac Mini checkout | Mac Mini |
| cmux/tmux | No VS Code Explorer | Mac Mini |

Do not treat a remote terminal inside a local VS Code window as a remote
Explorer. The terminal can be on the Mini while the editor still writes local
files.

## Open the Remote Folder

After the Remote SSH extension is present, run from a MacBook shell:

```bash
code --remote ssh-remote+mac-mini \
  /Users/server/code/mac-mini-home-server
```

UI fallback:

1. Run **Remote-SSH: Connect to Host...**.
2. Select `mac-mini`.
3. Open `/Users/server/code/mac-mini-home-server`.

The extension reuses the existing OpenSSH alias, including `User`,
`IdentityFile`, `IdentitiesOnly`, and ControlMaster settings. Do not add a
second host alias.

Verify the new window before editing:

```bash
hostname
pwd
printf "%s\n" "$SSH_CONNECTION"
git status --short
```

Expected folder: `/Users/server/code/mac-mini-home-server`.

Official owners:

- [VS Code Remote SSH](https://code.visualstudio.com/docs/remote/ssh)
- [VS Code Remote SSH troubleshooting](https://code.visualstudio.com/docs/remote/troubleshooting)

## Attach the Shared tmux

Remote SSH does not automatically attach the cmux session.

From a Remote SSH integrated terminal, already running on the Mini:

```bash
tmux attach-session -t mac-mini-home-server
```

From a local VS Code integrated terminal:

```bash
ssh -t mac-mini 'tmux attach-session -t mac-mini-home-server'
```

Do not nest `ssh mac-mini` inside a Remote SSH terminal. Detach with
`Ctrl-b d`; never kill the shared session to leave VS Code.

Multiple tmux clients see the same panes and accept input. Use a separate tmux
window or session when commands should not affect the cmux operator.

Inspect shared clients without changing them:

```bash
ssh mac-mini \
  'tmux list-clients -t mac-mini-home-server \
   -F "client=#{client_name} terminal=#{client_termname}"'
```

## Concurrent Edits

The MacBook checkout and Mac Mini checkout are separate working trees. A local
VS Code window and a Remote SSH window can show similar paths while editing
different files.

Before editing:

1. Confirm the VS Code status bar and absolute `pwd`.
2. Run `git status --short` in the selected checkout.
3. Name which checkout owns the current change.
4. Check whether an agent or tmux client is already editing the same files.

Preserve unrelated dirty files. Avoid whole-repo formatting, generated-file
rewrites, or broad save actions while agents are active. After editing, inspect
the scoped diff from the same checkout.

## Verification

- Status bar reports `SSH: mac-mini`.
- Explorer root is `/Users/server/code/mac-mini-home-server`.
- A new integrated terminal reports the Mac Mini hostname and remote folder.
- `ssh -G mac-mini` still resolves the dedicated identity.
- `tmux list-clients` shows every intentional shared client.
- No SSH, pf, WireGuard, or Remote Login setting changed.
