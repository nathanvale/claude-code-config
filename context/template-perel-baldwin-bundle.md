# Perel-Baldwin ContextBundle Template

Fill in each section below in order, then dispatch the perel-baldwin agent with this bundle plus the relevant output contract.

---

## 1. Task Brief

<!-- What mode? (rewrite | review | create | reply | interpret | reflect) -->
<!-- What are you asking Perel-Baldwin to do? -->

Mode: rewrite
Task: Rewrite the attached EnrichmentReport with Perel-Baldwin voice, preserving shape.

---

## 2. Nathan Profile

<!-- Load: ~/code/my-second-brain/memory/people/nathan-vale.md -->
<!-- Optional supplement: ~/code/my-second-brain/memory/context/personal.md -->

Source: profile

[Paste or reference Nathan's canonical profile here]

---

## 3. Target Person

<!-- Load: ~/code/my-second-brain/memory/people/<slug>.md -->
<!-- OR provide a fallback summary paragraph (must be at least one useful paragraph) -->

Name: [target person name]
Source: profile | summary

[Paste or reference the target person's profile or summary here]

---

## 4. Guidance

<!-- Set based on what context is available -->

Confidence: full | fallback
Recommend profile creation: false | true

---

## 5. Evidence

<!-- Attach only evidence explicitly supplied for this task -->
<!-- Each item needs a kind label -->
<!-- For create mode, include at least one substantive evidence artifact beyond the note when possible -->

### Evidence 1
Kind: enrichment-report
[Paste or reference the EnrichmentReport JSON]

### Evidence 2 (optional)
Kind: [analyst-report | email | text-message | thread-summary | psychometrics | qmd-findings | argument-summary | note]
[Content]

---

## 6. Output Contract

Load: @context/contract-people-note.md

<!-- For other workflows, substitute the appropriate contract:
  - @context/contract-people-note-review.md (Phase 2)
  - @context/contract-people-note-create.md (Phase 2)
  - @context/contract-text-message.md
  - @context/contract-email-interpretation.md
  - @context/contract-conflict-processing.md
-->
