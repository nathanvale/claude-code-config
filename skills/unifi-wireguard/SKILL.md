---
name: unifi-wireguard
description: "Check, enable, disable, or diagnose the UniFi WireGuard macOS client; prove tunnel routing before testing Mac Mini SSH or private LAN services."
---

# UniFi WireGuard

Manage the macOS WireGuard client for a UniFi-hosted home-LAN tunnel. Prove
the route, not just the connection badge.

No arguments: report status and the route to `192.168.1.100` without changing
state.

## First Safe Action

```bash
scutil --nc list
scutil --nwi
/sbin/route -n get 192.168.1.100 |
  grep -E 'destination|gateway|interface'
route_src=$(ifconfig "$(/sbin/route -n get 192.168.1.100 |
  awk '/interface:/{print $2}')" 2>/dev/null |
  awk '/inet /{print $2; exit}')
printf 'source=%s\n' "$route_src"
```

Select the one enabled service whose provider is `com.wireguard.macos`.

- No matching service: blocked. Install or import the WireGuard profile.
- Multiple matching services: ask which profile owns the target LAN.
- Do not hardcode the service UUID; discover it on each machine.

Classify the result:

- `en0` with a `192.168.1.x` source: direct home LAN.
- `utun*` with a `192.168.2.x` source: UniFi WireGuard.
- `Connected` plus an `en0` target route while at home: expected LAN bypass.
- `Connected` plus an `en0` target route while off-site: tunnel routing failed.

## Ensure On

Use when the user asks to connect, repair, or ensure WireGuard is on:

```bash
wireguard_service_id='<discovered-service-id>'
scutil --nc start "$wireguard_service_id"
scutil --nc status "$wireguard_service_id"
/sbin/route -n get 192.168.1.100 |
  grep -E 'destination|gateway|interface'
route_src=$(ifconfig "$(/sbin/route -n get 192.168.1.100 |
  awk '/interface:/{print $2}')" 2>/dev/null |
  awk '/inet /{print $2; exit}')
printf 'source=%s\n' "$route_src"
```

Poll status for at most 10 seconds. `Connected` is necessary but not
sufficient; the off-site target route must use `utun*`.

## Turn Off

Turn WireGuard off only when the user explicitly requests it. First check that
the current control session does not depend on the tunnel.

```bash
wireguard_service_id='<discovered-service-id>'
scutil --nc stop "$wireguard_service_id"
scutil --nc status "$wireguard_service_id"
```

If the current SSH or remote-control route uses `utun*`, stop. Disconnecting
would strand the session.

## Prove Both Paths

Use two independent situations:

1. Home LAN: WireGuard off, route `en0`, target reachable.
2. Phone hotspot: WireGuard off, target unreachable; WireGuard on, route
   `utun*`, target reachable.

Keep the Mini target at `192.168.1.100` in both modes. The UDR7 routes the
WireGuard client subnet to the home LAN.

For an SSH-path probe:

```bash
nc -z -G 5 192.168.1.100 22
```

When toggling for a test, record the initial state and restore it before
handoff. If the user asks to ensure WireGuard is on, leave it on.

## Diagnose

- Service disconnected: start it, poll, then recheck the route.
- Service connected but off-site route uses `en0`: inspect the imported
  profile's allowed networks; do not claim VPN success.
- Route uses `utun*` but `192.168.1.1:443` is unreachable: tunnel or UDR7
  routing failure.
- UDR7 is reachable but the target is not: target host or host-firewall
  failure.
- Target port 22 opens but SSH fails: hand off to `mac-mini-ssh`.

Never display or copy a WireGuard private key. Do not change the UDR7 profile,
peer, firewall, or network configuration without explicit approval.

## Handoff

Return:

```text
Tunnel: <Connected | Disconnected>
Underlay: <home LAN | hotspot | other>
Route: <en0 | utunN | missing>
Target: <address:port>
Reachability: <open | refused | timeout>
Mode: <LAN | UniFi WireGuard | unproven>
Next: <one safe action>
```

Dependency: `skills/mac-mini-ssh/SKILL.md`
Type: optional handoff
Missing state: degraded; stop after reporting the proven network layer
Next repair: restore that skill, then resume SSH authentication diagnosis
