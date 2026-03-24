# Workflow: Generate Selector Registry

## Step 1: Determine path

- **Project scope:** `.claude/skills/{domain-key}/selectors.yaml`
- **User scope:** `~/.claude/skills/{domain-key}/selectors.yaml`

Create parent directories if needed.

## Step 2: Generate empty registry

Write a declarative YAML registry with the v2 schema:

```yaml
# {Domain Name} Selector Registry
# Declarative selector data for {domain-key} workflows.

_meta:
  domain: "{full-domain}"
  schema_version: 2
  discovered_at: "{today}"
  last_validated_at: null
  last_validated_by: null
  notes:
    - "Selectors are declarative only. Executable flow lives in playbooks."
    - "Candidate repairs must be promoted only after revalidation."

page_fingerprints:
  # Add fingerprints as Discovery Mode identifies stable page signals.
  # Example:
  # dashboard:
  #   title_contains:
  #     - "Dashboard"
  #   required_text:
  #     - "Welcome"

gotchas:
  # Add gotchas as they are discovered.
  # Example:
  # blur_required:
  #   summary: "Blur event required after input fill."

pages:
  # Add pages as Discovery Mode maps the site.
  # Example:
  # dashboard:
  #   route:
  #     url: "https://example.com/dashboard"
  #   regions:
  #     main_content:
  #       selector: ".main"
  #       fields:
  #         search:
  #           interaction: fill_then_blur
  #           verify:
  #             type: value_equals
  #           locators:
  #             - strategy: id
  #               value: "search-input"

candidates:
  selectors: []
  promotions:
    policy: "Promote only after successful revalidation on a matching fingerprint."
```

## Step 3: Create gotcha file stub

Write to the gotcha path co-located with the skill:

- **Project scope:** `.claude/skills/{domain-key}/gotchas.md`
- **User scope:** `~/.claude/skills/{domain-key}/gotchas.md`

Create parent directories if needed.

```markdown
# {Domain Name} -- Browser Agent Gotchas

_Updated by Discovery Mode. Do not remove entries without verification._

<!-- Add gotchas as Discovery Mode encounters them. Format:

## [gotcha-name]
**Discovered:** YYYY-MM-DD
**Summary:** One sentence.
**Detail:** What happens and how to handle it.
-->
```

## Step 4: Show the user

Display the generated registry and gotcha file, and confirm.
