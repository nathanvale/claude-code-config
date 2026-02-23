# Search Tools (Kit Plugin)

## Tool Selection

| Tool | Use For |
|------|---------|
| `kit_grep` | Text patterns, regex, literal matches, TODOs |
| `kit_semantic` | Natural language ("find auth logic") |
| `kit_symbols` | Function/class/variable definitions |
| `kit_usages` | Where is symbol X used? |
| `kit_ast_search` | Structural patterns (async functions, classes) |
| `kit_file_tree` | Repository structure overview |
| `kit_file_content` | Multi-file content retrieval |

## AST Search Modes

**Simple** → `"async function"`, `"class"`, `"arrow function"`

**Pattern** → `{"type": "function_declaration", "async": true}`

Supports → TypeScript, JavaScript, Python

## Quick Reference

| Need | Tool |
|------|------|
| TODO comments, imports, strings | `kit_grep` |
| All async functions, classes | `kit_ast_search` |
| "Find validation logic" | `kit_semantic` |
| Function definitions | `kit_symbols` |
| Where is X called? | `kit_usages` |
