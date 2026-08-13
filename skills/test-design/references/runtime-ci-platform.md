# Runtime, CI, and Platform Differences

- Reproduce the owning runtime, operating system assumptions, frozen install, and CI environment for compatibility claims.
- Name Bun, Node, shell, filesystem, signal, path, and permission differences that affect the seam.
- Verify selectors actually run the intended test; record zero-test, skipped, todo, and disabled states explicitly.
- Use retries to diagnose nondeterminism, never to turn intermittent failure into confidence.
- For green-local and red-CI mismatch, reproduce the exact tested ref before changing the test.
- Keep platform absence as an unproved boundary, not a pass.
- Use the runner-execution profile when loaders, transforms, type checking, coverage, affected selection, or isolation changes the confidence claim.
