---
name: test
description: Run tests, then spawn parallel agents to fix failures
---

Run all tests for this project, collect failures, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Tests

Run the full test suite:
```bash
npx vitest run 2>&1
```

For specific test files:
```bash
npx vitest run tests/unit/specific-file.test.ts
```

For watch mode during development:
```bash
npx vitest --watch
```

For coverage report:
```bash
npx vitest run --coverage
```

## Step 2: If Failures

Analyze the test output. Group failures by root cause (e.g., same module, same mock issue, same breaking change).

For each distinct root cause, use the subagent tool to spawn a sub-agent with a prompt like:
"Fix the failing tests in [file]. The error is [error]. Read the test file and the source file it tests, then fix the underlying source code issue (not the test) unless the test itself is wrong. Run `npx vitest run [file]` to verify the fix."

Spawn multiple sub-agents in parallel when failures are independent.

## Step 3: Re-run

After all sub-agents complete, re-run the full suite:
```bash
npx vitest run 2>&1
```

If there are still failures, repeat Step 2. Continue until all tests pass or failures are identified as known issues.
