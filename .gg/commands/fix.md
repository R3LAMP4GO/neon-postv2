---
name: fix
description: Run typechecking and linting, then spawn parallel agents to fix all issues
---

Run all linting and typechecking tools, collect errors, group them by domain, and use the subagent tool to spawn parallel sub-agents to fix them.

## Step 1: Run Checks

Run these commands and capture ALL output (don't stop on failure):

```bash
npm run typecheck 2>&1 || true
npm run lint 2>&1 || true
npm run format:check 2>&1 || true
```

## Step 2: Collect and Group Errors

Parse the output from Step 1. Group errors by domain:
- **Type errors**: Issues from `npm run typecheck` (TypeScript `tsc --noEmit`)
- **Lint errors**: Issues from `npm run lint` (ESLint on `src/`)
- **Format errors**: Issues from `npm run format:check` (Prettier check on `src/`)

If there are zero errors across all domains, report success and stop.

## Step 3: Spawn Parallel Agents

For each domain that has issues, use the `subagent` tool to spawn a sub-agent to fix all errors in that domain. Run independent domains in parallel.

Each sub-agent prompt MUST include:
1. The full list of errors for that domain (copy-paste the raw output)
2. The exact command to re-run to verify the fix (e.g. `npm run typecheck`, `npm run lint`, `npm run format`)
3. Instructions to read each file before editing
4. Instructions to re-run the check command after fixing to confirm zero errors

For **format errors**, the agent should just run `npm run format` (Prettier auto-fix).
For **lint errors**, the agent should first try `npm run lint:fix` (ESLint auto-fix), then manually fix any remaining issues.
For **type errors**, the agent must manually fix each TypeScript error.

## Step 4: Verify

After all agents complete, re-run all checks to verify all issues are resolved:

```bash
npm run typecheck && npm run lint && npm run format:check
```

If any issues remain, repeat Steps 2-3 for the remaining errors.
