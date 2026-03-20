---
title: "iMessage Privacy and Retention"
type: spec
status: planned
updated: 2026-03-20
summary: "Defines privacy guardrails, cloud enrichment opt-in, redaction categories, retention expectations, and security rules for the personal iMessage corpus"
related:
  - /Users/nathanvale/.claude/plans/serene-wishing-sun.md
  - docs/specs/imessage-corpus-repo.md
  - docs/specs/imessage-attachment-model.md
  - docs/specs/imessage-productivity-integration.md
---

# iMessage Privacy and Retention

## Purpose

Define the safety rules for storing and enriching personal message history inside the Memory OS. This spec exists so agents have explicit guardrails before they autonomously sync, search, enrich, or promote personal communications.

## Privacy Defaults

- default to local-first processing whenever possible
- do not send message bodies or attachment binaries to external AI providers by default
- treat the corpus as privacy-sensitive even when the user has requested convenience automation
- require explicit opt-in before any cloud-based enrichment runs

## External AI Opt-In Rules

Cloud enrichment is allowed only when all of these are true:
- the user has explicitly requested the enrichment run
- the target scope is bounded by source IDs, a tight time window, or specific attachments
- the request is allowed by the redaction policy below

Cloud enrichment is not the default path for:
- routine sync
- broad historical backfills
- family or child-related communications unless the user clearly asks for it

## Redaction Categories

Before any external AI call, support redaction hooks for:
- phone numbers
- home addresses
- email addresses
- financial details
- health details
- school or child-related details
- passwords, codes, and account identifiers

If redaction is unavailable or low-confidence, the agent should not proceed with cloud enrichment automatically.

## Retention Rules

The raw corpus may be retained long-term, but the rules should be explicit:
- Markdown message notes may be kept indefinitely unless the user chooses otherwise
- attachment binaries may move to a colder archive tier later without deleting the parent note
- retention policies for notes and binaries may differ
- derived AI enrichment can be regenerated and should never be treated as more important than the raw note plus provenance

## Backup and Storage Rules

- the corpus repo must remain private
- local disk encryption is assumed for machines storing the repo
- backup targets should preserve equivalent privacy guarantees
- attachment binaries should not be synced to third-party cloud storage by default without explicit user intent

## Promotion Rules

Promote durable meaning, not raw message dumps:
- person notes
- durable summaries
- project context
- extracted tasks and commitments

Never bulk-copy raw message bodies into `my-second-brain-v2`.

## Enforcement Expectations

Agents should:
- check this spec before cloud enrichment
- prefer local parsing and deterministic extraction first
- ask before acting when scope, ownership, or privacy sensitivity is ambiguous
- record whether an enrichment was local-only or cloud-assisted in any run report

## Verification

1. Base sync can run without any cloud AI dependency
2. Cloud enrichment paths require explicit user opt-in
3. Sensitive categories can be redacted before external calls, or the call is blocked
4. The corpus repo is documented as private and privacy-sensitive
5. Promotion flows move meaning into owning repos without copying raw message bodies
