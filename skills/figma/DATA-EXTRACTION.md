# Figma Data Extraction

jq patterns for extracting design tokens from Figma API responses.

## Setup

```bash
# Fetch node properties
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=$NODE_ID" > props.json
```

## Text Styles

Extract all text elements with typography info:

```bash
jq '[.. | objects | select(.type == "TEXT") | {
  name,
  text: .characters,
  font: .style.fontFamily,
  size: .style.fontSize,
  weight: .style.fontWeight,
  lineHeight: .style.lineHeightPx,
  letterSpacing: .style.letterSpacing,
  textAlign: .style.textAlignHorizontal
}]' props.json > text-styles.json
```

### Output Example

```json
[
  {
    "name": "Page Title",
    "text": "Create bulk print order",
    "font": "Futura Std",
    "size": 24,
    "weight": 700,
    "lineHeight": 32,
    "letterSpacing": 0,
    "textAlign": "LEFT"
  }
]
```

### Convert to CSS

```bash
jq '.[] | ".\(.name | gsub(" "; "-") | ascii_downcase) { font: \(.weight) \(.size)px \"\(.font)\"; line-height: \(.lineHeight)px; }"' text-styles.json
```

## Colors

### Extract Fill Colors

```bash
jq '[.. | objects | select(.fills) | select(.fills | length > 0) | {
  name,
  type,
  color: .fills[0].color,
  opacity: .fills[0].opacity
}] | unique_by(.name)' props.json > colors.json
```

### Convert to CSS RGB

```bash
jq '.[] | {
  name,
  css: "rgb(\((.color.r * 255) | round), \((.color.g * 255) | round), \((.color.b * 255) | round))"
}' colors.json
```

### Convert to Hex

```bash
jq -r '.[] | "\(.name) \(.color.r) \(.color.g) \(.color.b)"' colors.json | \
while read name r g b; do
  printf "%s: #%02x%02x%02x\n" "$name" \
    $(echo "$r * 255" | bc | cut -d. -f1) \
    $(echo "$g * 255" | bc | cut -d. -f1) \
    $(echo "$b * 255" | bc | cut -d. -f1)
done
```

### Convert with Alpha

```bash
jq '.[] | {
  name,
  rgba: "rgba(\((.color.r * 255) | round), \((.color.g * 255) | round), \((.color.b * 255) | round), \(.color.a // 1))"
}' colors.json
```

## Dimensions

### Extract Bounding Boxes

```bash
jq '[.. | objects | select(.absoluteBoundingBox) | {
  name,
  type,
  width: .absoluteBoundingBox.width,
  height: .absoluteBoundingBox.height,
  x: .absoluteBoundingBox.x,
  y: .absoluteBoundingBox.y
}]' props.json > dimensions.json
```

### Extract Padding/Spacing

```bash
jq '[.. | objects | select(.paddingLeft or .paddingTop) | {
  name,
  padding: {
    top: .paddingTop,
    right: .paddingRight,
    bottom: .paddingBottom,
    left: .paddingLeft
  },
  gap: .itemSpacing
}]' props.json > spacing.json
```

## Layout Properties

### Auto Layout Frames

```bash
jq '[.. | objects | select(.layoutMode) | {
  name,
  direction: .layoutMode,
  gap: .itemSpacing,
  padding: {
    top: .paddingTop,
    right: .paddingRight,
    bottom: .paddingBottom,
    left: .paddingLeft
  },
  alignment: {
    primary: .primaryAxisAlignItems,
    counter: .counterAxisAlignItems
  }
}]' props.json > layouts.json
```

### Convert to CSS Flexbox

```bash
jq '.[] | {
  name,
  css: "display: flex; flex-direction: \(if .direction == "VERTICAL" then "column" else "row" end); gap: \(.gap)px; padding: \(.padding.top)px \(.padding.right)px \(.padding.bottom)px \(.padding.left)px;"
}' layouts.json
```

## Effects

### Extract Shadows

```bash
jq '[.. | objects | select(.effects) | .effects[] | select(.type == "DROP_SHADOW") | {
  color: .color,
  offset: { x: .offset.x, y: .offset.y },
  radius: .radius,
  spread: .spread
}]' props.json > shadows.json
```

### Convert to CSS Box Shadow

```bash
jq '.[] | "box-shadow: \(.offset.x)px \(.offset.y)px \(.radius)px \(.spread // 0)px rgba(\((.color.r * 255) | round), \((.color.g * 255) | round), \((.color.b * 255) | round), \(.color.a));"' shadows.json
```

## Border Radius

```bash
jq '[.. | objects | select(.cornerRadius or .rectangleCornerRadii) | {
  name,
  radius: (.cornerRadius // .rectangleCornerRadii[0]),
  radii: .rectangleCornerRadii
}]' props.json > borders.json
```

## Component Instances

### Find Component Usage

```bash
jq '[.. | objects | select(.type == "INSTANCE") | {
  name,
  componentId: .componentId,
  overrides: .overriddenProperties
}]' props.json > instances.json
```

## Variables (Design Tokens)

Variables require a separate API call and are available to Enterprise org members.

### Fetch Variables

```bash
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/variables/local" > variables.json
```

### Extract Color Variables

```bash
jq '[.meta.variables | to_entries[] | select(.value.resolvedType == "COLOR") | {
  id: .key,
  name: .value.name,
  collection: .value.variableCollectionId,
  values: [.value.valuesByMode | to_entries[] | {
    mode: .key,
    color: .value
  }]
}]' variables.json > color-variables.json
```

### Extract Spacing Variables

```bash
jq '[.meta.variables | to_entries[] | select(.value.resolvedType == "FLOAT") | {
  id: .key,
  name: .value.name,
  collection: .value.variableCollectionId,
  values: [.value.valuesByMode | to_entries[] | {
    mode: .key,
    value: .value
  }]
}]' variables.json > spacing-variables.json
```

### Extract Code Syntax (Platform Mappings)

```bash
jq '[.meta.variables | to_entries[] | select(.value.codeSyntax) | {
  name: .value.name,
  type: .value.resolvedType,
  web: .value.codeSyntax.WEB,
  android: .value.codeSyntax.ANDROID,
  ios: .value.codeSyntax.iOS
}]' variables.json > code-syntax.json
```

### Get Variable Collections with Modes

```bash
jq '[.meta.variableCollections | to_entries[] | {
  id: .key,
  name: .value.name,
  modes: .value.modes,
  defaultMode: .value.defaultModeId
}]' variables.json > collections.json
```

### Convert Variables to CSS Custom Properties

```bash
jq -r '.meta.variables | to_entries[] |
  select(.value.resolvedType == "COLOR") |
  .value as $var |
  .value.valuesByMode | to_entries[] |
  "--\($var.name | gsub(" "; "-") | ascii_downcase): rgba(\((.value.r * 255) | round), \((.value.g * 255) | round), \((.value.b * 255) | round), \(.value.a // 1));"
' variables.json
```

### Convert Variables to Tailwind Config

```bash
jq '{
  colors: [.meta.variables | to_entries[] | select(.value.resolvedType == "COLOR")] |
    map({
      (.value.name | gsub(" "; "-") | ascii_downcase):
      (.value.valuesByMode | to_entries[0].value |
        "rgb(\((.r * 255) | round) \((.g * 255) | round) \((.b * 255) | round))")
    }) | add,
  spacing: [.meta.variables | to_entries[] | select(.value.resolvedType == "FLOAT")] |
    map({
      (.value.name | gsub(" "; "-") | ascii_downcase):
      "\(.value.valuesByMode | to_entries[0].value)px"
    }) | add
}' variables.json > tailwind-tokens.json
```

## Full Design Token Export

Combined extraction for design system documentation:

```bash
#!/bin/bash
# extract-tokens.sh

FILE_KEY=$1
NODE_ID=$2
OUTPUT_DIR=${3:-.}

mkdir -p "$OUTPUT_DIR"

# Fetch node properties
ENCODED_ID=$(echo "$NODE_ID" | sed 's/:/%3A/g')
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/nodes?ids=$ENCODED_ID" > "$OUTPUT_DIR/raw.json"

# Fetch variables (if Enterprise)
curl -sH "X-Figma-Token: $(printenv FIGMA_TOKEN)" \
  "https://api.figma.com/v1/files/$FILE_KEY/variables/local" > "$OUTPUT_DIR/variables.json" 2>/dev/null

# Extract all token types from node
jq '[.. | objects | select(.type == "TEXT") | {
  name, text: .characters, font: .style.fontFamily,
  size: .style.fontSize, weight: .style.fontWeight
}]' "$OUTPUT_DIR/raw.json" > "$OUTPUT_DIR/typography.json"

jq '[.. | objects | select(.fills) | select(.fills | length > 0) | {
  name, type, color: .fills[0].color
}] | unique_by(.name)' "$OUTPUT_DIR/raw.json" > "$OUTPUT_DIR/colors.json"

jq '[.. | objects | select(.absoluteBoundingBox) | {
  name, type, width: .absoluteBoundingBox.width, height: .absoluteBoundingBox.height
}]' "$OUTPUT_DIR/raw.json" > "$OUTPUT_DIR/dimensions.json"

jq '[.. | objects | select(.layoutMode) | {
  name, direction: .layoutMode, gap: .itemSpacing,
  padding: { top: .paddingTop, right: .paddingRight, bottom: .paddingBottom, left: .paddingLeft }
}]' "$OUTPUT_DIR/raw.json" > "$OUTPUT_DIR/layouts.json"

# Extract variables if available
if [ -s "$OUTPUT_DIR/variables.json" ]; then
  jq '[.meta.variables | to_entries[] | {
    name: .value.name,
    type: .value.resolvedType,
    values: .value.valuesByMode,
    codeSyntax: .value.codeSyntax
  }]' "$OUTPUT_DIR/variables.json" > "$OUTPUT_DIR/design-tokens.json" 2>/dev/null
fi

echo "Tokens extracted to $OUTPUT_DIR"
ls -la "$OUTPUT_DIR"/*.json
```

## Structure Analysis

### Get Frame Hierarchy

```bash
jq '.. | objects | select(.type == "FRAME" or .type == "COMPONENT") | {
  id, name, type,
  children: [.children[]? | { id, name, type }]
}' props.json
```

### Count Elements by Type

```bash
jq '[.. | objects | .type] | group_by(.) | map({type: .[0], count: length}) | sort_by(-.count)' props.json
```

### Find Bound Variables

Find which properties are bound to variables:

```bash
jq '[.. | objects | select(.boundVariables) | {
  name,
  type,
  bindings: .boundVariables
}]' props.json > bound-variables.json
```
