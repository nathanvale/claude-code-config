# Browser and UI

- A remote function or adapter unit test does not prove a real browser or host integration.
- Observe the user-visible surface: rendered state, accessible label, navigation, persisted setting, or public browser response.
- Bound story, browser, and helper subprocesses; prove cleanup and useful failure evidence.
- Separate deterministic local fixtures from live authentication, identity, network, and consequential side effects.
- Use a fresh or isolated profile when activation, first-run state, or extension discovery is the claim.
- Keep screenshots secondary to semantic assertions unless pixels are the contract.
