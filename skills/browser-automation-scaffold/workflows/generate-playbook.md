# Workflow: Generate Playbook

## Step 1: Gather task details

Ask the user:

- **Task name** -- short, kebab-case (e.g. `fill-week`, `export-report`, `check-status`)
- **What does it do?** -- one sentence description
- **Inputs** -- what parameters does the task need? (fields, values, options)
- **Safety constraints** -- anything that should never happen? (e.g. "never click Delete")

## Step 2: Determine paths

- **Playbook YAML:** `{playbook-dir}/{task-name}.yaml`
- **Script dir:** `{playbook-dir}/scripts/`
- **Fill script:** `{playbook-dir}/scripts/{task-name}.js`
- **Verify script:** `{playbook-dir}/scripts/verify-{task-name}.js`

Create directories if needed.

## Step 3: Generate playbook YAML

```yaml
name: "{task_name}"
version: 1
status: "candidate"
registry:
  path: "{registry-path}"
  schema_version: 2
page:
  fingerprint: "{page-name-from-registry}"
inputs:
  {for each input:}
  {input_name}:
    required: true
    {type, format, allowed values, notes as appropriate}
execution:
  mode: "eval_js"
  script_path: "{fill-script-path}"
verification:
  script_path: "{verify-script-path}"
  requires:
    - "field_values_match"
    - "dirty_state_or_save_ready"
    - "persistence_after_save"
guardrails:
  - "{safety constraints from user}"
  - "If fingerprint mismatches or verification fails, fall back to Discovery or Recovery Mode."
promotion:
  notes: "Promote status from candidate to validated only after a successful run + verification pass confirms persistence."
```

## Step 4: Generate skeleton scripts

**Fill script** (`{task-name}.js`):

```js
(() => {
  /**
   * Candidate bulk action helper for {service name}.
   *
   * Expected globals set by caller:
   * - window.__{DOMAIN_UPPER}_{TASK_UPPER}__.{each input}
   *
   * This script stops at field updates. Save/submit remains a separate step.
   */
  const payload = window.__{DOMAIN_UPPER}_{TASK_UPPER}__;

  if (!payload) {
    return { ok: false, reason: "missing_payload" };
  }

  // TODO: Discovery Mode will fill this in as selectors are validated.
  // For now, return a stub so the playbook contract is valid.

  return {
    ok: false,
    reason: "not_yet_implemented",
    note: "Run in Discovery Mode first to populate selectors and interaction patterns.",
  };
})();
```

**Verify script** (`verify-{task-name}.js`):

```js
(() => {
  /**
   * Verification helper for {task-name} playbook.
   *
   * Expected globals set by caller:
   * - window.__{DOMAIN_UPPER}_{TASK_UPPER}__.{each input}
   */
  const payload = window.__{DOMAIN_UPPER}_{TASK_UPPER}__;

  if (!payload) {
    return { ok: false, reason: "missing_payload" };
  }

  // TODO: Add field-by-field verification after Discovery Mode maps the form.

  return {
    ok: false,
    reason: "not_yet_implemented",
    reminder: "Run in Discovery Mode first, then fill in verification logic.",
  };
})();
```

## Step 5: Show the user

Display all generated files and explain:

- The playbook starts as `candidate` -- Discovery Mode will flesh out the scripts
- After a successful fill + save + persistence check, promote to `validated`
- Once validated, Fast Mode kicks in for subsequent runs
- After 2+ consecutive successes, the agent will recommend promoting to Haiku
