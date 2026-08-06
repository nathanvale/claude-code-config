# Out-of-Scope Knowledge Base

The `.out-of-scope/` directory stores durable records of rejected enhancement
requests. It preserves reasoning and helps identify repeated proposals.

## Shape

Use one kebab-case file per concept:

```text
.out-of-scope/
├── dark-mode.md
├── plugin-system.md
└── graphql-api.md
```

Each file contains:

- concept heading
- durable rejection reasoning
- technical or strategic constraints
- prior issue links

Group related requests in one concept file. Do not create one file per issue.

## During Triage

Read `.out-of-scope/*.md` during context gathering.

- Match by concept, not exact keywords.
- Surface a possible match to the maintainer.
- Ask whether the prior decision still applies.
- Continue normal triage when the maintainer reconsiders or rejects the match.

## Writing

Write only after the maintainer rejects an enhancement as `wontfix`.

1. Find a matching concept file.
2. Append the current issue link to an existing concept file.
3. Otherwise create a concept file with reasoning and the current issue link.
4. Link the record from the issue comment.
5. Apply the mapped `wontfix` role and close the issue after confirmation.

Do not create out-of-scope records for bugs or temporary deferrals.

## Removing

Delete or update a concept file when the maintainer reverses the decision.
Historical issues remain closed unless separately reconsidered.
