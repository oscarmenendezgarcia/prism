# Bugs: Version Check + `prism update` Command

## BUG-001: PRISM_NO_UPDATE_CHECK=0 incorrectly suppresses the version check

- **Severity**: Medium
- **Type**: Functional
- **Component**: `bin/cli.js` line 187
- **Reproduction Steps**:
  1. Install prism-kanban globally.
  2. Set the environment variable: `export PRISM_NO_UPDATE_CHECK=0`
  3. Run any `prism` command: `prism --version`
  4. Observe: the version check is suppressed (no update notice even if one is available).
  5. Expected: `PRISM_NO_UPDATE_CHECK=0` should be treated as "opt-in to checking" (falsy intent).
- **Expected Behavior**: Per AC-004.2 of the user stories: `PRISM_NO_UPDATE_CHECK=0` and `PRISM_NO_UPDATE_CHECK=""` should NOT suppress the check. Only non-empty, non-zero values suppress it.
- **Actual Behavior**: `if (process.env.PRISM_NO_UPDATE_CHECK)` evaluates `"0"` as truthy in JavaScript (non-empty string), so the check is suppressed.
- **Root Cause Analysis**: The implementation uses a bare JavaScript truthy check on the env var string. In Node.js, all non-empty strings are truthy — including `"0"`, `"false"`, `"no"`. The spec intended conventional Unix shell semantics where `"0"` means disabled-but-explicitly-set.
- **Proposed Fix**: Replace the truthy check with an explicit value comparison:
  ```
  const noCheckEnv = process.env.PRISM_NO_UPDATE_CHECK;
  if (noCheckEnv !== undefined && noCheckEnv !== '' && noCheckEnv !== '0') {
    flags.noUpdateCheck = true;
  }
  ```
  This matches the spec: `"1"`, `"true"`, `"yes"` suppress; `"0"` and `""` do not.

---

## BUG-002: `prism update` offers a downgrade when the installed version is ahead of npm (dev build)

- **Severity**: Medium
- **Type**: Functional
- **Component**: `bin/update.js` line 79
- **Reproduction Steps**:
  1. Have a dev build of prism installed where the local `package.json` version is `1.0.1`.
  2. The npm registry has `1.0.0` as the latest published version.
  3. Run `prism update`.
  4. Observe: `Update prism-kanban v1.0.1 → v1.0.0? [y/N]` — a downgrade is offered.
- **Expected Behavior**: When the installed version is greater than or equal to the npm latest, the command should print "prism is already on the latest version" and exit 0. A downgrade should never be offered.
- **Actual Behavior**: `update.js` uses strict string equality (`latestVersion === installedVersion`) to determine "already up to date". If the values differ (including when installed > latest), the update prompt is shown with the npm version as the "target" — effectively prompting to downgrade.
- **Root Cause Analysis**: The "already up to date" check does not use the `isNewer()` comparator that was purpose-built in `update-check.js`. String equality cannot distinguish between installed-newer and installed-older cases.
- **Proposed Fix**: Import and use `isNewer` from `update-check.js`:
  ```
  const { fetchLatestVersion, isNewer } = require('./update-check.js');
  // ...
  if (!isNewer(installedVersion, latestVersion)) {
    process.stdout.write(`prism is already on the latest version (v${installedVersion})\n`);
    return exitFn(0);
  }
  ```
  This handles equal versions, installed-ahead, and installed-behind correctly.

---

## Summary

| ID | Severity | Component | Status |
|----|----------|-----------|--------|
| BUG-001 | Medium | bin/cli.js | Unresolved |
| BUG-002 | Medium | bin/update.js | Unresolved |

**Merge gate**: Zero unresolved Critical or High bugs required. The two Medium bugs above do not block merge but should be fixed in a follow-up before the feature is widely used in production environments where dev builds are common or where `PRISM_NO_UPDATE_CHECK=0` is used in CI configuration files.
