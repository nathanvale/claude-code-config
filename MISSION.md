# Mission: Browser connection architecture

## Why
Understand how independent automation tools can safely reuse a real, authenticated Chrome session without confusing browser, protocol, profile, and adapter responsibilities.

## Success looks like
- Explain Chrome, CDP, Warm Chrome, and browser adapters as separate layers.
- Choose classic CDP or Chrome UI auto-connect for a concrete workflow.
- Identify which tools can share one Chrome session and which require another browser.

## Constraints
- Keep the mental model visual and low-load.
- Preserve authenticated state without silent cold-browser fallback.
- Treat the everyday Chrome profile as sensitive.

## Out of scope
- Implementing the Warm Chrome fix during this lesson.
- Designing Firefox automation beyond its boundary as a separate browser.
