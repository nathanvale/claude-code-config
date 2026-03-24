# Figma Comparison Report Template

Use this template when outputting the comparison report.

## Template

```markdown
# Figma Comparison Report

**Figma**: [URL]
**Implementation**: [localhost URL]
**Jira**: [ticket]
**Date**: [timestamp]

## Screenshots

- Figma design: `[path]`
- Implementation: `[path]`

## Design Tokens Extracted

### Typography
| Element | Figma | Expected CSS |
|---------|-------|--------------|

### Colors
| Element | Figma RGBA | CSS |
|---------|------------|-----|

## Differences Checklist

### Must Fix
- [ ] **[Element]**: [Issue] → [Expected]

### Should Fix
- [ ] **[Element]**: [Description]

## Summary
[Brief summary]
```

## Field Descriptions

| Field | Description |
|-------|-------------|
| Figma | The Figma file/frame URL |
| Implementation | The localhost URL tested |
| Jira | The Jira ticket (e.g., POS-2903) |
| Date | ISO timestamp of comparison |
| Screenshots | Paths to saved PNG files |
| Typography | Font family, size, weight comparisons |
| Colors | Figma RGBA (0-1) converted to CSS RGB (0-255) |
| Must Fix | Critical mismatches affecting UX |
| Should Fix | Minor differences, nice-to-have |
