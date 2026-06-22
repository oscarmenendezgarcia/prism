# Bug Report: Agent Auto-Sync on Server Startup (QOL-6)

**Date:** 2026-06-14
**Feature:** QOL-6 — Auto-sync de agentes al actualizar

---

## Summary

| ID | Severity | Type | Status |
|----|----------|------|--------|
| BUG-001 | Low | Code Quality | Open |
| BUG-002 | Low | Functional (Observability) | Open |

> Zero Critical or High bugs. Feature is ready to merge.

---

## BUG-001: Unused `os` Import in `agentSync.js`

- **Severity:** Low
- **Type:** Code Quality / Dead Code
- **Component:** `src/services/agentSync.js`, line 18
- **Test:** TC-020

**Reproduction Steps:**
1. Open `src/services/agentSync.js`
2. Observe line 18: `const os = require('os');`
3. Search the rest of the file for any usage of `os.*` → zero results

**Expected Behavior:** Every `require()` in a module is used. `os` is correctly used in `server.js` (for `os.homedir()`) and `bin/init.js`, but `agentSync.js` never calls any `os.*` function.

**Actual Behavior:** `const os = require('os');` is loaded on every `require('./src/services/agentSync')` call but never consumed. This is dead code.

**Root Cause Analysis:** The import was likely added during initial scaffolding when `os.homedir()` was considered for resolving `agentsDir` inside the service. The decision was correctly made to keep that resolution in the callers (`server.js`, `bin/init.js`), but the import was not removed from the service.

**Proposed Fix:** Remove line 18 from `src/services/agentSync.js`:

```diff
- const os     = require('os');
```

No functional change — `os` is not used anywhere in the module. Safe to remove with zero risk.

---

## BUG-002: Missing "Nothing to Do" Summary Log on Idempotent Restart

- **Severity:** Low
- **Type:** Functional — Observability deviation from blueprint
- **Component:** `server.js`, lines 143–151
- **Test:** TC-021

**Reproduction Steps:**
1. Start the server with a fully up-to-date agents directory (all files at current Prism version, manifest baseline set).
2. Observe the server stdout.
3. Expected: `[agent-sync] nothing to do (9 agents up to date)` (blueprint §11).
4. Actual: No `[agent-sync]` summary line is emitted at all.

**Expected Behavior:** Blueprint §11 specifies the following log line for the steady-state (all-noChange) case:
```
[agent-sync] nothing to do (9 agents up to date)
```
This provides operators with an explicit confirmation that sync ran and found everything current — useful when grepping `[agent-sync]` in logs to audit startup behaviour.

**Actual Behavior:** The `parts[]` array in `server.js` only accumulates entries for `synced`, `skipped`, and `errors`. When the result is all `noChange`, `parts` remains empty and the `if (parts.length > 0)` guard prevents any summary from being logged. The individual file-level logs (emitted from `agentSync.js`) are also silent because all files are no-ops (no log is emitted for noChange files).

Result: a successful idempotent sync produces zero `[agent-sync]` output, which is indistinguishable in logs from sync being disabled or skipped entirely.

**Root Cause Analysis:** The `parts[]` accumulation logic in `server.js` was written to cover the "interesting" cases (updates, skips, errors) but missed the steady-state observability requirement from the blueprint.

**Proposed Fix:** Add a `noChange` branch to the summary block in `server.js`:

```js
// Existing block (lines 143–151)
if (!options.silent) {
  const parts = [];
  if (_syncResult.synced.length)   parts.push(`synced ${_syncResult.synced.length}`);
  if (_syncResult.skipped.length)  parts.push(`skipped (user-modified) ${_syncResult.skipped.length}`);
  if (_syncResult.errors.length)   parts.push(`errors ${_syncResult.errors.length}`);
  if (parts.length > 0) {
    console.log(`[agent-sync] ${parts.join(', ')}`);
  }
  // ADD: nothing-to-do case
+ else {
+   console.log(`[agent-sync] nothing to do (${_syncResult.noChange.length} agents up to date)`);
+ }
}
```

This is a one-line additive change with no risk of regression. The code-reviewer flagged this as "optional" — fixing it closes the blueprint §11 observability gap.
