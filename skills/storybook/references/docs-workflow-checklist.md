# Docs Workflow Checklist

Use this at the end of any Storybook component documentation workflow.

This checklist owns completion proof for docs-page work. `docs-pattern.md` owns
the docs composition rules. `story-authoring-loop.md` owns edit-loop mechanics.

## Rule

- Do not send the final response for docs work until every applicable item is
  checked or marked `N/A` with a short reason.
- Include the completed checklist in the final response or handoff.
- If one item cannot be checked, report degraded or blocked state before final.
- Treat this as completion proof, not planning prose.

## Checklist

Copy this shape into the handoff and fill it after verification:

```markdown
Docs workflow checklist:
- [ ] Readiness: `storybook-doctor check` returned `ready` or named degraded path.
- [ ] Instructions: `get-storybook-story-instructions` was called before edits.
- [ ] Component truth: props, exports, existing stories, and existing play functions were read.
- [ ] Product domain: component and story descriptions name the product/domain context, consumer task, or Figma node reference when available.
- [ ] Figma provenance: component docs include a Figma design link or node id when one exists; focused stories include relevant Figma node refs when they are already part of the local evidence.
- [ ] Story set: `Default`, `Matrix`, `UX tips`, and focused stories each have an explicit keep/add/skip decision.
- [ ] Default: first story export is `Default`, controls-ready, visible in Docs, and powers the Primary canvas.
- [ ] Controls: controls expose only consumer-facing serializable props; internal, JSX-only, and event props are hidden.
- [ ] Matrix: placed after `Default` when present; explanation lives in `parameters.docs.description.story`; canvas renders matrix content only.
- [ ] UX tips: placed after `Matrix` when present; decision source is named; description includes one authoritative source link; canvas renders component examples only.
- [ ] Focused stories: kept only for direct link, code example, test target, decision rule, or edge guard.
- [ ] Optional docs inclusion: every kept docs-facing optional story (`Matrix`, `UX tips`, and focused states) appears in the Docs page stories block, or is intentionally excluded with `!autodocs` and a reason.
- [ ] Public imports: matrix/helper-only stories use a split file or local helpers so generated public imports stay focused on runtime components.
- [ ] Manifest hygiene: audit-only matrices use `!manifest`; docs-only or visual-only tags are intentional and named.
- [ ] Sidebar order: Storybook index or screenshot confirms `Docs`, `Default`, `Matrix`, `UX tips`, then focused stories.
- [ ] Docs page: actual Docs route was opened or screenshotted after load; `Default` is the top sample and is not duplicated in the stories list.
- [ ] Preview links: `preview-stories` returned URLs for changed public stories.
- [ ] Story tests: `run-story-tests` passed for changed stories with `a11y: true`.
- [ ] Interaction proof: at least one story proves the main keyboard or pointer path when the component is interactive.
- [ ] Package checks: focused type/lint/format checks passed, or skipped with reason.
- [ ] Registry/manifests: agent registry or manifest check ran when manifest-facing stories changed, or skipped with reason.
- [ ] Quality audit: Fallow or equivalent changed-code audit ran after meaningful implementation, or skipped with reason.
- [ ] Residual findings: inherited or unrelated findings are named separately from current-task findings.
- [ ] Final handoff: changed files, story order, previews, checks, screenshot path, and skipped checks are reported.
```

## Rewrite Pattern

When a docs workflow feels complete, run this loop before final:

1. Re-read the requested outcome and latest user correction.
2. Compare the story set against `docs-pattern.md#required-story-set`.
3. Check descriptions for product-domain context and available Figma node refs.
4. Make explicit decisions for `Matrix` and `UX tips`; do not rely on absence.
5. Prove kept docs-facing optional stories appear on the actual Docs page, or
   name the exclusion reason.
6. Prove order with Storybook index or a sidebar screenshot.
7. Prove behavior with focused story tests and `a11y: true`.
8. Inspect Fallow output enough to separate current-task findings from existing
   dirty-tree findings.
9. Fill the checklist in the final answer.

## Gotcha

- A docs workflow can look done after `Default` and `Matrix` pass. Stop and make
  the `UX tips` decision explicit before final, especially for components where
  usage policy, accessibility behavior, destructive action, loading, hierarchy,
  validation, or dismissal behavior affects consumer choices.
- A sidebar story can pass preview and tests without appearing in the Docs page.
  Open the Docs route and verify every kept docs-facing optional story appears
  under the Stories block, or mark the exclusion intentional.
