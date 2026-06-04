# Fallow CI

CI adoption is reference-only in v1.

## Sequence

- Clean meaningful full-repo findings first.
- Add PR-only audit after the baseline is understood.
- Keep workflow generation outside the runner and this reference.
- Use official Fallow CI docs and action inputs as owner sources.
- Check official docs before copying workflow syntax.

## Runner Boundary

- Do not add a `ci init` command.
- Do not create GitHub Actions files.
- Do not own CI thresholds, baselines, SARIF upload policy, or PR comment policy.
- Use the runner locally to collect evidence before changing CI.

## Owner Sources

- Official docs index: `https://docs.fallow.tools/llms.txt`.
- Official CI docs: `https://docs.fallow.tools/integrations/ci`.
- GitHub Action: `https://github.com/marketplace/actions/fallow-codebase-intelligence`.
- Local research: `docs/research/2026-06-04-fallow-agent-lens.md`.
- Local decision: `docs/decisions/2026-06-04-fallow-agent-native-decision-log.md`.
