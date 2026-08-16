# op CLI examples (from op help)

## Sign in

- `op signin`
- `op signin --account <shorthand|signin-address|account-id|user-id>`

## Read

- `op read op://app-prod/db/password`
- `op read "op://app-prod/db/one-time password?attribute=otp"`
- `op read "op://app-prod/ssh key/private key?ssh-format=openssh"`
- `op read --out-file ./key.pem op://app-prod/server/ssh/key.pem`

## Run

- `export DB_PASSWORD="op://app-prod/db/password"`
- `op run --no-masking -- printenv DB_PASSWORD`
- `op run --env-file="./.env" -- printenv DB_PASSWORD`

## Inject

- `echo "db_password: {{ op://app-prod/db/password }}" | op inject`
- `op inject -i config.yml.tpl -o config.yml`

## Whoami / accounts

- `op whoami`
- `op account list`

## Multi-account

- Pass `--account` explicitly on every command that stores or reads secrets; do not rely on ambient account selection.
- `op account list` is metadata-only; use it to confirm account names when routing is unclear.

## Item create/edit without printing secrets

Never pass a secret as an `op` assignment argument (`field[password]=$TOKEN`) — argv is visible to other processes. Feed a JSON template through stdin instead; the secret travels env → JSON → pipe, never argv. In JSON templates the category is the enum form (`API_CREDENTIAL`), not the human name.

```bash
ITEM_TITLE="Service API Tokens"
FIELD_NAME="api_token"
EXPECTED_PREFIX=""
TOKEN="$(pbpaste)"
if [ -n "$EXPECTED_PREFIX" ]; then
  case "$TOKEN" in "$EXPECTED_PREFIX"*) ;; *) echo "clipboard value does not match expected prefix" >&2; exit 2;; esac
fi
TOKEN="$TOKEN" ITEM_TITLE="$ITEM_TITLE" FIELD_NAME="$FIELD_NAME" node -e '
process.stdout.write(JSON.stringify({
  title: process.env.ITEM_TITLE,
  category: "API_CREDENTIAL",
  fields: [{ label: process.env.FIELD_NAME, type: "CONCEALED", value: process.env.TOKEN }],
}));' | op item create --account "<account>" - >/dev/null
op item get "$ITEM_TITLE" --account "<account>" --fields "label=$FIELD_NAME" >/dev/null
```

Edit an existing item the same way: pipe the updated item JSON into `op item edit` rather than assigning the new value in argv.

```bash
ITEM_TITLE="Service API Tokens"
FIELD_NAME="app_token"
EXPECTED_PREFIX=""
TOKEN="$(pbpaste)"
if [ -n "$EXPECTED_PREFIX" ]; then
  case "$TOKEN" in "$EXPECTED_PREFIX"*) ;; *) echo "clipboard value does not match expected prefix" >&2; exit 2;; esac
fi
op item get "$ITEM_TITLE" --account "<account>" --format json |
  TOKEN="$TOKEN" FIELD_NAME="$FIELD_NAME" node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  const item=JSON.parse(s);
  const matches=(item.fields||[]).filter(x=>x.label===process.env.FIELD_NAME);
  if (matches.length===0) {
    (item.fields??=[]).push({ label: process.env.FIELD_NAME, type: "CONCEALED", value: process.env.TOKEN });
  } else if (matches.length===1 && matches[0].type==="CONCEALED") {
    matches[0].value=process.env.TOKEN;
  } else {
    console.error("refusing: label must match exactly one CONCEALED field, found " + matches.length + " match(es)");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(item));
});' | op item edit "$ITEM_TITLE" --account "<account>" >/dev/null
op item get "$ITEM_TITLE" --account "<account>" --fields "label=$FIELD_NAME" >/dev/null
```

## Shape-only field read (service account)

One non-interactive command; the token reaches `op` only for this command, injected by a managed wrapper — never exported in the ambient shell. Prints length, prefix class, and newline count, never the value.

```bash
#!/usr/bin/env bash
set -euo pipefail
set +x
ITEM_TITLE="<known item>"
FIELD_LABEL="<field label>"
VAULT="<token-scoped vault>"
TOKEN_WRAPPER="$HOME/code/dotfiles/bin/with-one-password-token"
value="$(
  "$TOKEN_WRAPPER" op item get "$ITEM_TITLE" --vault "$VAULT" --format json |
    FIELD_LABEL="$FIELD_LABEL" node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{const item=JSON.parse(s); const f=(item.fields||[]).find(x=>x.label===process.env.FIELD_LABEL); if(!f?.value) process.exit(2); process.stdout.write(f.value);})'
)"
echo "field_len:${#value}"
case "$value" in sk-*) echo "field_prefix:sk" ;; *) echo "field_prefix:other" ;; esac
echo "field_has_newline:$(printf %s "$value" | wc -l | tr -d ' ')"
```

Keep JSON extraction scoped to the known item and vault. Do not enumerate vaults or items to discover candidates.

## Process environment injection

Use the wrapper's owned injection path when a declared capability needs one secret environment variable.

```bash
"$HOME/code/dotfiles/bin/with-one-password-token" inject <ENV_KEY> '<op://vault/item/field>' -- <command> [args...]
```

Do not substitute `op run`; the wrapper rejects it because the launched workload could inherit `OP_SERVICE_ACCOUNT_TOKEN`.

## Vault-scoped metadata search (explicit ask only)

Only when the user explicitly asks to search, gives a screenshot/listing, or an exact title guess failed and they ask for fuzzy lookup. Metadata only: candidate titles, ids, categories, vault name — never fields or values.

```bash
#!/usr/bin/env bash
set -euo pipefail
set +x
VAULT="<token-scoped vault>"
QUERY="<query>"
"$HOME/code/dotfiles/bin/with-one-password-token" op item list --vault "$VAULT" --format json |
  QUERY="$QUERY" VAULT="$VAULT" node -e '
let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{
  const q=process.env.QUERY.toLowerCase();
  const vault=process.env.VAULT;
  const items=JSON.parse(s).filter(x => [
    x.title, x.id, x.category, ...(x.tags || [])
  ].filter(Boolean).join("\n").toLowerCase().includes(q));
  for (const item of items.slice(0, 10)) {
    console.log(`title:${item.title} id:${item.id} category:${item.category || ""} vault:${vault}`);
  }
  console.log(`matches:${items.length}`);
})'
```

After choosing a candidate, switch back to exact item/field JSON extraction and shape-only validation. Do not broaden from the token-scoped vault to other vaults without explicit user approval.
