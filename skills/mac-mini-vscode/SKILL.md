---
name: mac-mini-vscode
description: "Open the Mac Mini project in VS Code Remote SSH, distinguish local and remote windows, reuse the saved SSH alias, or attach VS Code to the shared tmux session."
role: tool-workflow
---

# Mac Mini VS Code

Open the Mac Mini project from the MacBook without creating a second SSH
configuration or replacing the durable cmux/tmux terminal workflow.

No arguments: run the read-only preflight, classify the current VS Code
context, then return one next safe action.

## Safety Gate

Connectivity, the `mac-mini` alias, the dedicated identity, Remote Login,
WireGuard, and pf belong to `mac-mini-ssh`. Never change them here.

Before opening a remote window, prove the saved alias and project folder:

```bash
ssh -G mac-mini |
  grep -E '^(hostname|user|identityfile|identitiesonly|controlmaster) '
ssh -o ControlMaster=no -o ControlPath=none \
  -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=10 mac-mini \
  'test -d /Users/server/code/mac-mini-home-server &&
   printf "REMOTE_FOLDER_OK\n"'
```

If either check fails, stop and hand off to `mac-mini-ssh`. Do not repair
network or authentication state from this skill.

## Add A Laptop

The Mini-side local-forwarding allowance is configured once. For each laptop:

1. Install the official VS Code Remote SSH extension.
2. Create and approve that laptop's own SSH key. Never copy another laptop's
   private key.
3. Save the existing `mac-mini` SSH alias shape with that laptop's identity.
4. Prove a fresh key-only connection before opening the remote folder.

`mac-mini-ssh` owns key approval, server connectivity, and firewall policy.
No per-laptop firewall rule is needed when the laptop connects from the
trusted LAN `192.168.1.0/24` or WireGuard `192.168.2.0/24`.

## Classify the Context

- Local VS Code: Explorer edits MacBook files; a local terminal needs
  `ssh -t mac-mini ...` to reach remote tmux.
- Remote SSH window: status bar names `SSH: mac-mini`; Explorer and new
  integrated terminals operate on the Mac Mini.
- cmux shell: already remote, but cannot open a MacBook VS Code window by
  running `code .`.

Read `references/remote-workflow.md` for extension detection, safe folder
opening, tmux attachment, verification, and concurrent-edit rules.

## Output

Return:

- Context: local VS Code, Remote SSH, or cmux/tmux.
- Host: effective `mac-mini` SSH target.
- Folder: local or remote absolute working directory.
- Terminal: local shell, remote shell, or shared tmux.
- Concurrent editors: detected clients or dirty worktree state.
- Next safe action: one command or handoff.

## Dependency

Dependency: `skills/mac-mini-ssh/SKILL.md`
Type: optional handoff for connectivity, authentication, route, or firewall diagnosis
Missing state: degraded; Remote SSH opening may continue only while the saved alias passes the fresh-session preflight
Next repair: restore `mac-mini-ssh`; never improvise SSH or network changes here
