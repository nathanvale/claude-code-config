---
alwaysApply: true
---

## Scope Discipline

- Only change what was requested — nothing more
- Don't clean up adjacent code, add type annotations to unchanged files, or refactor "while you're in there"
- Don't add docstrings, comments, or logging to code you didn't change
- A bug fix doesn't need surrounding code improved
- If you notice something worth fixing, mention it — don't fix it
- Three similar lines of code is better than a premature abstraction

Bad: asked to fix a broken import, also reformats the file and adds JSDoc to 4 functions
Good: fix the import, mention the other issues in your response
