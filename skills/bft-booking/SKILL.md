---
name: bft-booking
description: "BFT classes: show session capacity, list bookings, book a class, join a waitlist, or cancel a booking."
disable-model-invocation: true
---

# BFT Booking

Use the Bun command owner for every BFT read or mutation:

```sh
bun run skills/bft-booking/src/cli.ts --help
```

## Route

- Availability or class times: run `sessions`.
- Existing classes: run `bookings`.
- Book or waitlist: preview `book`, show the exact class, then rerun with `--execute` only after Nathan confirms.
- Cancel: preview `cancel`, show the exact booking, then rerun with `--execute` only after Nathan confirms.
- Auth or setup failure: run `doctor`; follow its repair action without printing any 1Password values.

The CLI help owns flags, credential field labels, output contracts, and repair
steps. Use `--json` for agent-readable output.

## Safety

- Never pass passwords, bearer tokens, cookies, or Glofox access tokens as arguments or print them.
- Never retry an uncertain booking mutation. Run `bookings` first and reconcile state.
- Never use `--join-waitlist` unless the preview reports the class full and waitlisting available.

## Owner

- Runtime, API contract, auth mapping, and tests: `skills/bft-booking/src/`.
- Captured protocol notes: `context/systems/bft-glofox.md`.
- Runtime: Bun. Missing Bun, `op`, the managed token wrapper, or required 1Password fields is blocked.

## Next Safe Action

Run `doctor --json`, then `sessions --date tomorrow --json`.
