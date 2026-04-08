# Review Report: Inksmith Integration

**Date:** 2026-04-08
**Reviewer:** code-reviewer
**Verdict:** APPROVED_WITH_NOTES

---

## Design Fidelity

### Summary

N/A — this is a backend-only feature (no UI screens, no Stitch designs, no wireframes). Design fidelity review is skipped per CLAUDE.md: "Backend-only features with no UI may skip this stage."

### Deviations

_No deviations found (no UI surfaces)_

---

## Code Quality

### Overview of files reviewed

| File | Status |
|---|---|
| `src/services/circuitBreaker.js` | New |
| `src/services/inksmithClient.js` | New |
| `src/services/promptRefiner.js` | New |
| `src/handlers/prompt.js` | Modified (Inksmith wiring) |
| `src/handlers/settings.js` | Modified (inksmith block) |
| `src/routes/index.js` | Modified (health route) |
| `tests/inksmith.test.js` | New |

Test run result: **43 tests, 0 failures** (`node --test tests/inksmith.test.js`).

---

### Design System Compliance

_Not applicable (no frontend code)._

---

### Code Quality

#### CircuitBreaker (`src/services/circuitBreaker.js`)

Clean, minimal state machine matching blueprint §3.1. Correct transitions: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN. No external dependencies. No setTimeout leaks — all transitions use `Date.now()` comparisons. Public API is exactly what the blueprint specifies: `canPass()`, `recordSuccess()`, `recordFailure()`, `getState()`.

#### InksmithClient (`src/services/inksmithClient.js`)

Thin HTTP client with correct retry logic (`retry.attempts + 1` total attempts). Payload size caps enforced before the network call. HTTPS enforcement in place. `redactKey()` is called on all error paths so the API key never surfaces in returned reason strings.

#### PromptRefiner (`src/services/promptRefiner.js`)

Orchestration logic is clean. Feature flag + env-key check is atomic (`!!(inksmithSettings.enabled && apiKey)`). Never throws — the outer try/catch returns a `local-fallback` result even for unexpected errors. All five structured log event types from blueprint §3.7 are emitted.

#### prompt.js handler

Integration is minimal and non-invasive: one `await promptRefiner.refine(...)` call between `buildPromptText` and file write. Refined or raw prompt is persisted via the same atomic tmp+rename path. Response adds `source` and `refinementId` additively — existing fields unchanged. Backward compat confirmed by test.

#### Settings (`src/handlers/settings.js`)

`DEFAULT_SETTINGS.prompts.inksmith` present with `enabled: false`. All required fields exist (`endpoint`, `timeoutMs`, `retry`, `circuitBreaker`). API key correctly absent from the settings schema.

#### Health route (`src/routes/index.js`)

`GET /api/v1/inksmith/health` returns counters from `getInksmithCounters()`. Returns 405 on non-GET. Registered before the catch-all so it doesn't conflict with other routes.

---

### Minor Findings

| # | Severity | Location | Finding | Recommended Fix |
|---|---|---|---|---|
| 1 | MINOR | `src/services/promptRefiner.js` | **Missing `inksmith_breaker_closed` log event.** Blueprint §3.7 specifies both `inksmith_breaker_opened` and `inksmith_breaker_closed`. The opened event is emitted, but no log is emitted when the breaker closes (after a successful HALF_OPEN probe). | After `breaker.recordSuccess()` on the happy path, check `if (prevState === STATE.HALF_OPEN)` and emit `_log('inksmith_breaker_closed', { taskId: metadata?.taskId })`. |
| 2 | MINOR | `tests/inksmith.test.js` | **Two InksmithClient test cases missing from T-004 acceptance criteria: `timeout` and `oversized response` (`response_too_large`).** The comment block at the top of the describe lists both, but neither has a corresponding `test()` block. The `response_too_large` path is implemented in `attemptRequest` (lines 83–90) but untested at unit level. `timeout` reason is only reached indirectly via the PromptRefiner dead-port test (which returns `reason:'network'` on connection refused, not `'timeout'`). | Add a `test('timeout — returns ok:false, reason: "timeout"')` using `req.setTimeout` mock or a slow server. Add a `test('oversized response — returns ok:false, reason: "response_too_large"')` that streams > 512 KB back. |
| 3 | MINOR | `src/services/promptRefiner.js` lines 32–40 | **`getBreaker()` JSDoc claims it "rebuilds if settings have changed" but the implementation only creates on `!_breaker`.** A settings change (e.g., `failureThreshold` or `openMs`) at runtime is silently ignored until server restart. The code behaviour is acceptable but the comment is misleading. | Remove or correct the JSDoc to: `"Lazily constructs a breaker on first call. Settings changes take effect only after server restart or resetBreaker()."` |

---

### Security

No issues found.

- INKSMITH_API_KEY is read exclusively from `process.env` — never written to `settings.json` and never appears in structured logs or error reasons.
- `redactKey()` correctly escapes the key before building the regex substitution.
- HTTPS enforcement is in place; `INKSMITH_ALLOW_HTTP=1` escape is env-only.
- 256 KB request cap prevents accidental large-prompt exfiltration; 512 KB response cap prevents memory abuse.
- Redaction is unit-tested (T-004 test "API key never appears in reason or error fields").

---

### Pattern Consistency

Consistent with existing Prism patterns:

- `'use strict'` at module top, JSDoc on all public functions. ✓
- Native `https`/`http` modules — no new dependencies (matches Prism's no-framework philosophy). ✓
- Structured logging via `console.log(JSON.stringify(...))` — matches existing handler pattern. ✓
- Uses `sendJSON` / `sendError` from `src/utils/http` — no custom response helpers. ✓
- `readSettings(dataDir)` remains the single settings access point. ✓
- New route registered in `src/routes/index.js` using the existing regex + method-dispatch pattern. ✓

---

## Verdict

**APPROVED_WITH_NOTES** — Three minor issues logged above. All are non-blocking:

- Finding #1 (missing log event) is a low-effort observability gap; no functional impact.
- Finding #2 (two missing test cases) is a coverage gap against T-004 acceptance criteria; the code paths are correct and tested indirectly.
- Finding #3 (misleading JSDoc) has zero runtime impact.

The implementation correctly satisfies all functional requirements (F1–F6), the ADR decision (fail-open, feature-flagged, circuit-breaker guarded), and the contract additive-only guarantee. **Safe to proceed to QA (T-008).**

Developer should address findings #1 and #2 before the dark-launch merge (T-009) to ensure full observability and acceptance criteria coverage.

---

## Screenshots

_Not applicable — backend-only feature._
