---
title: "Repo Profiles"
type: reference
status: active
updated: 2026-03-17
summary: "Shared repo-role profiles so new repos can join the Memory OS without inventing a new memory model."
---

# Repo Profiles

## Purpose

Give each repo a role instead of a bespoke memory architecture.

Every repo inherits the core Memory OS contract and then chooses a local profile.

## Work Repo

Use for client or employer work such as `monash-smst`.

Owns:
- meeting notes
- stakeholders and people context
- imported docs and sidecars
- work research
- project tasks
- local delivery context

Promote upward:
- durable domain learnings
- reusable workflows
- personal career insights
- important long-lived people context when appropriate

Keep local:
- routine meeting churn
- team-specific task noise
- bulky imported corpora

## Work Hub

Use when a Work Repo grows large enough to own spoke repos that depend on it for people, tasks, glossary, or domain context. A Work Hub is a Work Repo that also acts as the coordination point for one or more spokes.

The hub-spoke relationship is opt-in. Most work repos are independent and should stay as plain Work Repos.

Owns (in addition to Work Repo scope):
- people routing table used by spokes
- shared glossary entries
- task surface for the project cluster
- reusable patterns and domain context consumed by spokes
- delivery roadmap across the spoke cluster

Promote upward (same as Work Repo):
- durable domain learnings
- reusable workflows
- personal career insights

Keep local:
- routine meeting churn
- team-specific task noise
- bulky imported corpora

Spoke roster:
- declare spokes in `roster.yml` via `parent: <hub-name>` on each spoke entry

## Spoke

Use for a repo that implements part of a larger project owned by a Work Hub. A spoke delegates cross-cutting context (people, tasks, glossary, domain patterns) to its parent hub and keeps only local implementation detail.

Owns:
- implementation details and coding conventions
- local gotchas and solved problems
- build, deploy, and environment setup
- local ADRs and decisions scoped to this codebase
- local glossary entries for code-level terms

Delegates to parent hub:
- people and stakeholder context
- active task surface
- shared glossary (program/org acronyms)
- reusable cross-repo patterns

Promote upward:
- solved problems with cross-repo value promote to the parent hub
- durable patterns promote to the parent hub, then optionally to my-second-brain

Keep local:
- implementation-specific churn
- build artifacts and environment quirks
- narrow coding conventions

## Infra Repo

Use for systems work such as `mac-mini-home-server`.

Owns:
- specs
- runbooks
- verification
- gotchas
- implementation logs
- ADRs

Promote upward:
- durable infrastructure patterns
- personal operating preferences
- reusable troubleshooting playbooks

Keep local:
- phase-specific execution details
- narrow implementation checkpoints

## Personal Product Repo

Use for meaningful founder or product work.

Owns:
- roadmap
- customer research
- specs
- decisions
- implementation history
- product operations

Promote upward:
- founder lessons
- durable product strategy
- personal goals or commitments tied to the product
- cross-product patterns

Keep local:
- feature churn
- local technical implementation detail

## Life Hub Repo

Use for `my-second-brain`.

Owns:
- personal control plane
- deep recall memory
- authored documents
- cross-project synthesis
- promoted durable knowledge
- federated recall entrypoints

Promote upward:
- nothing above this by default

Keep local:
- synthesis outputs
- life planning
- durable context that spans multiple repos or areas

## Reference Corpus

Use for large external documentation sets indexed for recall but not authored by us.

Owns:
- converted vendor docs with provenance
- sync manifests and runtime update state
- converter and sync scripts
- collection-level context for QMD

Promote upward:
- nothing by default

Keep local:
- the mirrored corpus
- runtime sync state
- source-specific filters
- converter implementation details

## New Repo Template

Every new repo should answer:

1. Which profile is this closest to?
2. If Work Hub or Spoke: which repo is the parent or which repos are the spokes?
3. What does this repo own as canonical truth?
3. What should be promoted to `my-second-brain`?
4. What should never be duplicated?
5. Which note families will be common here?
