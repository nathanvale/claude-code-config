# Trusted-Network SSH Hardening

Use only for Mac Mini SSH authentication or firewall changes.

## Version Gate

Capture live state before research or mutation:

```bash
ssh mac-mini 'sw_vers; /usr/bin/ssh -V; sudo /usr/sbin/sshd -T \
  -C user=server,host=mac-mini-server,addr=192.168.1.104 |
  grep -E "^(authenticationmethods|passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication|allowusers)"'
```

The last live proof was macOS 26.6 build `25G72` on 2026-07-29. Recheck it;
never treat that version as permanent.

Research order:

1. Select the matching macOS version in Apple Support.
2. Use the Apple-shipped `man 5 pf.conf` and `man 8 pfctl` on the Mini for its
   actual parser and enable-reference behavior.
3. Query Context7 `/openssh/openssh-portable` for the observed OpenSSH version.

Sources:

- [Apple: Remote Login on macOS Tahoe 26](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/26/mac/26)
- [Apple: Firewall on macOS Tahoe 26](https://support.apple.com/guide/mac-help/block-connections-to-your-mac-with-a-firewall-mh34041/26/mac/26)
- [OpenSSH sshd_config](https://github.com/openssh/openssh-portable/blob/master/sshd_config.5)

## Owned Policy

- Allowed SSH sources: `192.168.1.0/24` and `192.168.2.0/24`.
- Every other IPv4 or IPv6 SSH source: drop.
- Authentication: `publickey` only for `server`; no password,
  keyboard-interactive, or root login.
- Dynamic ban, overload, fail2ban, and SSHGuard tables: absent.
- Client reuse: `ControlMaster auto`, owned by `~/.ssh/config`.

Source owners:

- Anchor: `mac-mini-home-server/config/security/com.nathanvale.ssh.pf`
- Loader: `mac-mini-home-server/bin/server/ensure-ssh-firewall.sh`
- LaunchDaemon: `mac-mini-home-server/templates/com.nathanvale.ssh-firewall.plist`
- Decision: `mac-mini-home-server/docs/decisions/ADR-009-trusted-network-key-only-ssh.md`

## Safe Change Sequence

1. Prove the current SSH source is inside one trusted subnet.
2. Keep that session open.
3. Back up `/etc/pf.conf`, the active anchor, and sshd drop-ins.
4. Parse the anchor and candidate main ruleset with `pfctl -nf`.
5. Start a timed automatic rollback.
6. Load the rules.
7. Prove a fresh, connection-sharing-disabled key login.
8. Prove both trusted source addresses.
9. Prove password and keyboard-interactive login fail.
10. Confirm the drop-rule counter or an independent untrusted-source probe.
11. Confirm launchd reload exits zero.
12. Cancel rollback only after every required proof passes.

Never flush all pf state, run `pfctl -d`, or close the working session during
this sequence. A matching rule marked `quick` is final; the owned anchor is
also `quick` so later system-added rules cannot reopen port 22.

## Verification

```bash
sudo pfctl -sr
sudo pfctl -a com.nathanvale.ssh -vvsr
sudo pfctl -a com.nathanvale.ssh -t ssh_trusted -T show
sudo pfctl -a ssh-brute-force -t bruteforce -T show
sudo sshd -t
sudo sshd -T -C user=server,host=mac-mini-server,addr=192.168.1.104 |
  grep -E '^(authenticationmethods|passwordauthentication|kbdinteractiveauthentication|permitrootlogin|pubkeyauthentication|allowusers)'
ssh -O check mac-mini
```

Expected legacy-table result: `Table does not exist`.

## Console Recovery

If a future rule blocks both trusted paths, use the Mini console:

1. Confirm Remote Login remains on in **System Settings → General → Sharing**.
2. List `/var/backups/com.nathanvale.ssh-hardening.*`; select the intended
   backup explicitly.
3. Restore that backup's `pf.conf` to `/etc/pf.conf`.
4. Run `sudo pfctl -nf /etc/pf.conf`, then `sudo pfctl -f /etc/pf.conf`.
5. Prove a fresh SSH session before changing another setting.
