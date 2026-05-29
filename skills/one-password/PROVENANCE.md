# Provenance: one-password

Source: [steipete/agent-scripts](https://github.com/steipete/agent-scripts) — `skills/one-password/`
License: MIT © 2026 Peter Steinberger (see `LICENSE.upstream`)
Pulled: 2026-05-29 (sparse checkout of `main`)

## Status: VERBATIM COPY — adaptation pending

`SKILL.md`, `references/get-started.md`, `references/cli-examples.md` are unmodified upstream
copies. They carry steipete's personal specifics that must be adapted before use here:

- Default service-account vault is `Molty` (steipete's), token from his `~/.profile` as
  `OP_SERVICE_ACCOUNT_TOKEN`; fallback alias `MOLTY_OP_SERVICE_ACCOUNT_TOKEN`. Nathan's vaults
  differ (e.g. "API Credentials" is the default vault in the side-quest browser-automation config).
- Default account `my.1password.com` and "Peter's default" framing are steipete's.
- `clawdbot`/Codex metadata and `$npm` skill cross-reference are steipete's ecosystem.

The generic mechanics ARE the value and transfer directly: tmux-only `op`, service-account-first,
targeted reads, shape-only validation (length/prefix/newline, never the value), `op run` / `op
inject` over writing secrets to disk, no broad vault enumeration. Adapt the account/vault names and
the clawdbot metadata to Nathan's setup; keep the discipline.

## Why it's here

The clean, lean "fetch-and-inject credentials, secrets never leak" pattern that backs the
separate-auth-step idea in the record-replay thesis
(`side-quest-engineering/docs/brainstorms/2026-05-29-001-two-skill-browser-automation-thesis.md`).
Pairs with `browser-use` for authenticated browser flows.

## What this repo will change (track edits here as they land)

- [ ] Replace `Molty` vault / steipete token vars with Nathan's vault + token convention.
- [ ] Replace `clawdbot` metadata block with this repo's skill-frontmatter convention.
- [ ] Reconcile default account with Nathan's 1Password account.
