## Email: Read Before Asking

When productivity-sync or any workflow surfaces an email, always read the full email body to extract details (products, amounts, actions, dates). Never ask the user what's in an email you have access to.

- Use `gog gmail read <thread-id> --account <email> --json` to fetch the full thread
- The body may be base64-encoded HTML — decode and extract product names, amounts, dates, action items
- If inline interpreter execution is blocked by hooks, use grep/sed on the raw output to find the data
- Present extracted details in the sync report, not questions about what the email contains
