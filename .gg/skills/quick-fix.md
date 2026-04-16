---
name: quick-fix
description: Fast diagnosis and fix for bugs in the codebase
---

1. Reproduce the issue — get the exact error message or unexpected behavior.
2. Use `grep` to find the error string or relevant function in `src/`.
3. Read the file and understand the surrounding context before editing.
4. Make the smallest possible change that fixes the root cause.
5. Run `npm run typecheck && npm run lint` to verify no regressions.
6. Run `npm run test` if tests exist for the affected module.
7. Summarize what broke, why, and what you changed.
