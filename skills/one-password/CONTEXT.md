# One Password

Scoped vocabulary for safe 1Password / op secret access: service-account paths, secret reference mappings, and the compatibility-surface escape hatch. Glossary only.

## Language

**one-password**:
The canonical adapted skill for safe 1Password CLI (`op`) workflows. It owns the generic `op` safety contract, while exact vault, item, field, and service-account details belong in service-specific owning skills.
_Avoid_: 1password, onepassword, secrets

**Reference-only env file**:
An env-shaped file whose values are 1Password secret references such as `op://...`, not plaintext secret values. It is a safe mapping artifact that may be reviewed or regenerated when every secret-bearing value remains a reference.
_Avoid_: pointer env file, map file, `.env` with secrets

**Secret reference mapping**:
A capability-owned declaration that maps a tool-facing environment variable or config key to a 1Password secret reference. The capability that consumes the secret owns the mapping; `one-password` owns only the safety contract.
_Avoid_: central secret manifest, global env bucket, one-password mapping

**Scoped service-account access**:
The preferred non-interactive 1Password access path for agents. A service account token may act as the bootstrap secret only when its vault and item permissions are scoped to the capability's declared secret reference mappings.
_Avoid_: broad service account, ambient 1Password access, desktop-first auth

**Persistent shell session**:
A stable shell context reused for an interactive 1Password task so sign-in, verification, and follow-up commands share session state. Tmux is the usual CLI implementation; Codex desktop may use a persistent Codex PTY or start a dedicated tmux session.
_Avoid_: tmux-only rule, fresh shell per `op` command, scattered sign-in

**Direct service-account read**:
A narrow, non-interactive 1Password read that uses scoped service-account access without relying on desktop sign-in state. It may run outside a persistent shell session when the capability supplies the exact vault, item, field, and expected shape.
_Avoid_: ambient read, probing read, service-account enumeration

**Targeted metadata check**:
A 1Password metadata command against an exact account, vault, item, or field already declared by an owning capability. It may prove existence or shape, but must not discover candidates by listing broad accounts, vaults, or items.
_Avoid_: broad enumeration, vault discovery, item discovery

**Materialized secret adapter**:
A generated compatibility surface that contains plaintext secret values only because a target tool cannot consume `op run` or 1Password references directly. It is never the source of truth and should be scoped to the tool that needs it.
_Avoid_: secret source, canonical env file, synced secrets file

## Example Dialogue

Dev: "Should `one-password` include the exact npm token item name?"
Domain expert: "No. `one-password` defines the safe `op` workflow. The npm-owning skill supplies the exact item and field names."

Dev: "Can an agent regenerate the env file?"
Domain expert: "It can regenerate a reference-only env file. If a tool needs plaintext values, that output is a materialized secret adapter and must stay generated, scoped, and non-canonical."

Dev: "Where should the `OPENAI_API_KEY=op://...` mapping live?"
Domain expert: "With the capability that needs OpenAI. `one-password` defines safe access, not the global list of every secret."

Dev: "Should an agent unlock the desktop app first?"
Domain expert: "No. Prefer scoped service-account access for declared mappings. Desktop app integration is the fallback when scoped access is unavailable or insufficient."

Dev: "Does `one-password` literally require tmux in Codex desktop?"
Domain expert: "No. It requires a persistent shell session for interactive 1Password work. Tmux is the common CLI implementation, but a persistent Codex PTY can satisfy the same session-state boundary."

Dev: "Can a service-account read run outside tmux?"
Domain expert: "Yes, when it is a direct service-account read for a declared vault, item, field, and shape. Interactive fallback still needs a persistent shell session."

Dev: "Can an agent list vaults to find the right one?"
Domain expert: "No. It can run targeted metadata checks for declared names, but broad vault or item discovery is outside the `one-password` safety contract."

