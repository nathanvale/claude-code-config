# Generic login engine acceptance spike

Throwaway post-build acceptance spike. Question: can the existing
`runBrowserUseLoginEngine` implementation drive representative Oncore, UniFi,
FastTrack, and OTP login shapes through real Agent Chrome without portal-specific
engine branches?

Run from `skills/browser-use`:

```sh
bun run prototype:generic-login-engine
```

The runner mints its endpoint through `browser-connect`, serves fixtures over
localhost, uses dummy values only, and closes every fixture tab.
