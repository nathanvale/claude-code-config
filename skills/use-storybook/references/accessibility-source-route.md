# Accessibility Source Route

Use this when Storybook MCP, axe, review, or component work raises an
accessibility question.

Checked: 2026-06-16.

## Default Rule

Treat accessibility skill marketplaces and community repos as checklist inputs,
not authority.

For factual claims, cite the highest source that applies:

1. Normative specs: WCAG, WAI-ARIA, HTML.
2. Informative W3C guidance: Understanding WCAG, WAI-ARIA APG.
3. Vendor or library docs: MDN, Radix, shadcn/ui, Tailwind CSS.
4. Tool rules: axe-core, Storybook a11y output.
5. Practical guidance: WebAIM, A11y Project, Inclusive Components.
6. Community skills and marketplaces: examples and checklist inspiration only.

If a source cannot be found, say the recommendation is based on practical
testing experience.

## Component Routes

- Dialog or modal: start with
  `https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/`.
- Alert dialog: start with
  `https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/`.
- Select, autocomplete, or combobox: start with
  `https://www.w3.org/WAI/ARIA/apg/patterns/combobox/`.
- Select-only combobox: start with
  `https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/`.
- Keyboard behavior: start with
  `https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/`.
- Accessible names and descriptions: start with
  `https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/`.
- Focus appearance: start with
  `https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html`.
- Target size: start with
  `https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html`.
- Contrast: start with
  `https://www.w3.org/TR/WCAG22/#contrast-minimum`.
- Data tables: start with `https://webaim.org/techniques/tables/data`.
- Forms and labels: start with `https://webaim.org/techniques/forms/`.
- Images and icons: start with `https://www.w3.org/WAI/tutorials/images/`.

## React, shadcn, Radix, Tailwind

- Use shadcn/ui docs for component composition examples.
- Use Radix docs when behavior comes from a primitive.
- Use Tailwind docs for implementation utilities such as `sr-only`,
  `focus-visible`, `motion-reduce`, and `forced-color-adjust`.
- Treat shadcn, Radix, and Tailwind docs as implementation sources, not WCAG
  authority.

## Storybook Checklist

Before calling a component story done, check:

- Name, role, and value are exposed.
- Keyboard path works without pointer input.
- Focus is visible, restored, and not trapped unexpectedly.
- Semantic HTML is used before ARIA.
- ARIA states match visible state.
- Error, empty, loading, and status states are announced when needed.
- Reduced motion is respected for non-essential animation.
- Contrast and target size issues are flagged for visual/design approval.
- Storybook `run-story-tests` passes with `a11y: true`, or remaining issues are
  documented with source route and next action.

## Source Notes

- Community-Access/accessibility-agents influenced this route through its source
  hierarchy, citation policy, domain routing, and research-source registry:
  `https://github.com/Community-Access/accessibility-agents`.
- Accessibility Design on MCP Market influenced the component checklist framing:
  `https://mcpmarket.com/tools/skills/accessibility-design`.
- These community sources are research evidence only. Do not copy their rules
  as contracts unless the target repo accepts and owns them.
