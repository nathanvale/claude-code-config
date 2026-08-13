# Browser and UI

- A remote function or adapter unit test does not prove a real browser or host integration.
- Observe the user-visible surface: rendered state, accessible label, navigation, persisted setting, or public browser response.
- Bound the Storybook dev server, browser, and helper subprocesses with repository-owned timeouts and resource limits; prove cleanup and useful failure evidence.
- Separate deterministic local fixtures from live authentication, identity, network, and consequential side effects.
- Use a fresh or isolated profile when activation, first-run state, or extension discovery is the claim.
- Keep screenshots secondary to semantic assertions unless pixels are the contract.
- Prefer semantic queries by role and accessible name, then label or text.
- Use realistic complete interactions instead of low-level event dispatch when the browser contract is the claim.
- Record the browser provider and version.
- Record isolation and framework integration.
- Keep preview, provider-backed browser, extension host, and hosted delivery as distinct seams.
