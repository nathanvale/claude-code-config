---
title: "Repo Profiles"
type: reference
status: active
updated: 2026-03-24
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
- solutions
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

## Infra Repo

Use for systems work such as `mac-mini-home-server`.

Owns:
- specs
- runbooks
- verification
- solutions
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
2. What does this repo own as canonical truth?
3. What should be promoted to `my-second-brain`?
4. What should never be duplicated?
5. Which note families will be common here?
