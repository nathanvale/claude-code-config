# Code Connect Workflow

Bridge Figma component nodes to codebase components so MCP tools return real
component mappings instead of generic markup.

## Prerequisites

- Figma MCP state is `ready`.
- Target project uses React, HTML/Web Components, Angular, Vue, SwiftUI, or
  Jetpack Compose (Code Connect supports these frameworks).
- Figma file uses a component library with named components.

## Setup

1. Install the Code Connect CLI as a dev dependency:
   ```bash
   npm install --save-dev @figma/code-connect
   ```

2. Verify the CLI is available:
   ```bash
   npx figma connect --help
   ```

## Authoring Mappings

Code Connect mappings live as `.figma.tsx` (or framework equivalent) files
alongside the component they map.

Example for a React component:
```tsx
// Button.figma.tsx
import figma from '@figma/code-connect'
import { Button } from './Button'

figma.connect(Button, 'https://www.figma.com/design/FILE_KEY/...?node-id=NODE_ID', {
  props: {
    label: figma.string('Label'),
    variant: figma.enum('Variant', {
      Primary: 'primary',
      Secondary: 'secondary',
    }),
    disabled: figma.boolean('Disabled'),
  },
  example: (props) => <Button variant={props.variant} disabled={props.disabled}>{props.label}</Button>,
})
```

## Publishing

Publish mappings to Figma:
```bash
npx figma connect publish
```

This requires a Figma access token. Set via environment variable:
```bash
export FIGMA_ACCESS_TOKEN=<token>
npx figma connect publish
```

Do not hardcode the token. Use a secret wrapper or environment variable.

## Verification

After publishing, verify mappings are visible to MCP:

1. Call `get_code_connect_map` — should return the published mappings.
2. Call `get_code_connect_suggestions` — should show auto-detected candidates
   for components that don't have mappings yet.

## MCP-Assisted Mapping

The Figma MCP server can help author Code Connect mappings:

- `get_code_connect_suggestions` — auto-detects component mapping candidates.
- `get_context_for_code_connect` — returns metadata for authoring Code Connect
  templates (remote mode only).
- `send_code_connect_mappings` — confirms suggested mappings.
- `add_code_connect_map` — adds a specific node-to-code mapping.

## When To Use

- Setting up a new project's Figma integration.
- Adding a new component to an existing mapped library.
- When `get_code_connect_map` returns empty for components that should be
  mapped.
- When design-to-code workflow produces generic markup instead of project
  components.
