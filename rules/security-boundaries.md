---
alwaysApply: true
---

## Security Boundaries

- Never read or write `~/.ssh`, `~/.aws`, `.env`, credential files, or wallet data
- Never hardcode secrets, tokens, or API keys in source files
- Never commit files that likely contain secrets — warn if the user asks
- Never pipe secrets into shell commands or log them to console

Bad: `const API_KEY = "sk-live-abc123"` in source code
Good: `const API_KEY = process.env.API_KEY` with `.env` in `.gitignore`
