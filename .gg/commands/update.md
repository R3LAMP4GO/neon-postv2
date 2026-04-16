---
name: update
description: Update dependencies, fix deprecations and warnings
---

## Step 1: Check for Updates

Run `npm outdated` to see which dependencies have newer versions available. Review the output and note all outdated packages, paying attention to current vs wanted vs latest versions.

## Step 2: Update Dependencies

Run `npm update` to update all packages to the latest versions allowed by semver ranges in package.json.

For major version bumps (current vs latest), evaluate each one individually:
- Check the package's changelog for breaking changes
- Run `npm install <package>@latest` only after confirming compatibility

Then run `npm audit` to check for security vulnerabilities. If any are found, run `npm audit fix`. Only use `npm audit fix --force` after reviewing what it will change.

## Step 3: Check for Deprecations & Warnings

Run `npm install 2>&1` and read ALL output carefully. Look for:
- Deprecation warnings (e.g. "npm warn deprecated")
- Security vulnerabilities
- Peer dependency warnings
- Engine compatibility warnings
- Breaking changes

Capture the full output and analyze every warning line.

## Step 4: Fix Issues

For each warning/deprecation found:
1. Research the recommended replacement package or fix (use web_fetch on the package's npm page or changelog)
2. Update the dependency to a non-deprecated alternative
3. If code imports from a deprecated package, update the import and usage to the replacement
4. Re-run `npm install` and verify the specific warning is gone

Repeat until all warnings are resolved.

## Step 5: Run Quality Checks

Run all project quality checks and fix any issues:

```bash
npm run typecheck && npm run lint
```

If typecheck or lint fails due to updated APIs:
1. Read the error messages carefully
2. Check the updated package's migration guide or changelog
3. Update the affected code to use the new API
4. Re-run until all checks pass

Then run the test suite:

```bash
npm run test
```

Fix any test failures caused by dependency updates.

## Step 6: Verify Clean Install

Delete node_modules and package-lock.json, then do a fresh install to verify zero warnings:

```bash
rm -rf node_modules package-lock.json
npm install 2>&1
```

Read the output carefully. There should be ZERO deprecation warnings and ZERO vulnerability warnings. If any remain, go back to Step 4.

Confirm the final state:
```bash
npm run typecheck && npm run lint && npm run test
```
