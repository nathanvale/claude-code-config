---
alwaysApply: true
---

## Scope Discipline

- Change requested scope only.
- Don't clean adjacent code.
- Don't add type annotations to unchanged files.
- Don't refactor while there.
- Don't add docstrings, comments, or logging to untouched code.
- Bug fixes don't need surrounding cleanup.
- Notice extra issues; mention them, don't fix them.
- Prefer three similar lines over premature abstraction.

- Bad: fix broken import, plus reformat file and add JSDoc to 4 functions.
- Good: fix import; mention adjacent issues in response.
