# Teams Local Reader — Operations

Prerequisites, store layout, failure modes, and troubleshooting. Read when
setup fails, a command errors, or output looks wrong.

## Prerequisites

- **macOS only.** The reader resolves the Teams container at
  `~/Library/Containers/com.microsoft.teams2`. Windows and Linux stores are out
  of scope by design.
- **New Teams (v2), signed in at least once.** The classic Teams client used a
  different store and is not supported.
- **Python 3.13**, pinned in `scripts/bootstrap.sh`. Override with
  `TEAMS_READER_PYTHON=/path/to/python3.x` if you keep it elsewhere.
- **Full Disk Access** may be required for the calling process (Terminal, the
  editor, Claude Code) to read the container. System Settings → Privacy &
  Security → Full Disk Access.
- **First run only:** network, `git`, and a C build toolchain (Xcode command
  line tools). The bootstrap clones from GitHub and builds wheels. This is the
  only network the skill uses, and it never goes to Microsoft.

## Bootstrap

```bash
skills/teams/scripts/bootstrap.sh          # idempotent; no-op when complete
skills/teams/scripts/bootstrap.sh --force  # rebuild from scratch
```

The script probes the full load-bearing import chain
(`scripts/check_deps.py`), so a partially-installed venv reprovisions rather
than passing the fast path.

### Dependencies, and why they are pinned this way

- `ccl_chromium_reader` decodes the IndexedDB envelope and the Blink/V8
  structured-clone payloads. It is installed **from GitHub at a pinned commit**.
  The repo publishes no tags, so `@v0.3.17` cannot resolve.
- The PyPI package named `chromium-reader` is a **different, broken** project
  (it hardcodes a `0xC9` global-section byte that is `0x32` in real Teams
  stores). Never install it. `check_deps.py` guards against it.
- `ccl_simplesnappy` is deliberately **not** listed in `requirements.txt`.
  Pinning it explicitly produces a pip `ResolutionImpossible`, because our
  direct reference and the parent's bare-URL reference are treated as
  conflicting even when they resolve to the same commit. Its SHA is recorded in
  a comment and the import assertion covers it.
- `zstd==1.5.7.3` is **yanked** upstream ("buggy - not thread safe"). pip warns
  and installs it. The reader is single-threaded, so the defect does not apply.
  The warning is expected, not a failure.

## How the store is read

1. `find_leveldb()` globs the container for
   `https_teams.microsoft.com_0.indexeddb.leveldb` and picks the largest match.
2. `snapshot()` does a read-only `cp -R` of that directory plus its sibling
   `.blob` into a `0o700` temp dir, so the live store is never touched and
   reads are safe while Teams is running.
3. The snapshot is removed on the way out — on success, on exception, and on
   interrupt. Cleanup lives in the library, not in callers, because the
   snapshot is a full plaintext copy of your chat history. A failed unlink is
   reported loudly rather than swallowed.

Databases used, all under origin `https_teams.microsoft.com_0`:

| Database | Object store | Carries |
|----------|--------------|---------|
| `Teams:replychain-manager` | `replychains` | messages, and reactions at `properties.emotions` |
| `Teams:conversation-manager` | `conversations` | names, types, last activity, per-chat `isRead` |
| `Teams:messaging-slice-manager` | `mentions-metadata-items` | pointers to messages @mentioning you |
| `Teams:activity-manager` | `feed-items` | activity feed with `isRead` |
| `Teams:profiles` | `profiles` | MRI → display name, email, title |

## Identity resolution

`self_identity()` takes the modal `creator` MRI across messages flagged
`isSentByCurrentUser`, then requires **all** of:

- at least 5 self-sent messages,
- at least a 60% share of self-sent creators,
- a resolvable profile display name,
- a match against the user GUID embedded in the IndexedDB database names
  (`Teams:<manager>:react-web-client:<clientId>:<userGuid>:<locale>`).

Below the margin it returns `confidence: "low"` and **refuses to gate on the
guess** — it surfaces the candidate for you to confirm instead. A GUID mismatch
hard-stops, because a cross-account pick is always wrong. This matters for
low-volume accounts, shared or delegated mailboxes, and guest/B2B stores.

Set `self.mri` in `teams-reader.yaml` to skip detection entirely.

## Failure categories

Every failure carries a stable `category`, plus `hint`, `retry_safe`,
`changed`, and where to find diagnostics. Every command is read-only, so
retrying the same input is always safe.

| Category | Usual cause | Fix |
|----------|-------------|-----|
| `dependency_missing` | venv absent or incomplete | run `bootstrap.sh` |
| `store_not_found` | new Teams not installed or never signed in | open Teams, sign in, let it sync |
| `config_invalid` | malformed YAML or wrong value type | the message names the file and the key |
| `not_found` | channel name matched nothing | run `channels`, or use a shorter fragment |

Exit codes: `0` success (including empty results), `1` runtime failure,
`2` invalid usage.

## Troubleshooting

**A recent message is missing.** Freshness lag: Teams has not flushed its
memtable to the `.ldb` files yet. Keep Teams running; re-run in a few minutes.

**A watch entry warns NO MATCH.** The warning lists the nearest cached names.
Matching is case-insensitive substring, so use a distinctive fragment. Run
`channels` for the full list.

**A watch entry matched many channels.** It warns, lists them, and uses all of
them rather than silently picking one. Narrow the fragment if that is wrong.

**Messages attributed to the wrong person.** Two colleagues share a display
name. Run `disambiguate "<name>"` to get the distinct MRIs and message counts,
then attribute by `creator_mri`.

**`whoami` reports low confidence.** Expected on a low-volume, shared, or guest
account. Set `self.mri` in `teams-reader.yaml`; `disambiguate` will find yours.

**A snapshot was left behind.** The library logs an error naming the path if
cleanup ever fails. Temp dirs are `teams-reader-*` under `$TMPDIR`; they hold a
plaintext copy of your chat, so delete them.

**Teams updated and the reader broke.** Microsoft can change the IndexedDB
schema. The reader already dedupes record versions and swallows undecodable
records, but a schema change may need a newer `ccl_chromium_reader` commit in
`requirements.txt`.

## Privacy posture

- Reads only your own already-synced local cache.
- Never writes to the Teams store, and never persists results — output goes to
  stdout for you or the calling agent to use.
- The only file it creates is the temp snapshot, which it always removes.
- JSON output includes MRIs (account identifiers), because disambiguating
  identity is a core capability. Keep that in mind before pasting output
  somewhere public.
