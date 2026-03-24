# Bug Report: Pipeline Log Viewer (T-6)

**QA date:** 2026-03-24
**Branch:** feature/task-detail-edit
**Merge gate result:** PASSED — zero Critical/High bugs

---

## Summary

| ID | Severity | Type | Component | Status |
|----|----------|------|-----------|--------|
| BUG-001 | Medium | Code Style | `PipelineLogPanel.tsx` | Open |
| BUG-002 | Low | Functional / Spec Drift | `StageTabBar.tsx` | Open |
| BUG-003 | Low | UX / Spec Drift | `LogViewer.tsx` | Open |

---

## BUG-001: Inline `width` style on PipelineLogPanel violates design system rules

- **Severity:** Medium
- **Type:** Code Style
- **Component:** `frontend/src/components/pipeline-log/PipelineLogPanel.tsx` line 124
- **Test reference:** TC-069

**Reproduction Steps:**
1. Open `PipelineLogPanel.tsx`.
2. Inspect the `<aside>` element at line 124.
3. Observe: `style={{ '--panel-w': '${width}px', width: '${width}px' } as React.CSSProperties}`.

**Expected Behavior:**
The `width` dimension should be applied via the CSS custom property `--panel-w` and a corresponding CSS class (using Tailwind arbitrary value or CSS), matching the pattern used by `TerminalPanel.tsx` which only sets `style={{ '--panel-w': '${width}px' }}` and relies on the CSS variable for the visual width.

**Actual Behavior:**
The `width` value is set directly as an inline style property (`width: ${width}px`). This violates the CLAUDE.md project rule: "No `style={{}}` attributes — use Tailwind arbitrary values instead." It also deviates from the established pattern in the sibling component `TerminalPanel.tsx`.

**Root Cause Analysis:**
The developer included the explicit `width` inline style alongside the CSS variable to ensure the panel width is applied even if no CSS rule reads `--panel-w`. The `TerminalPanel` relies on a CSS rule that consumes `--panel-w`. If that CSS rule is absent for `PipelineLogPanel`, the `width` inline style is a functional workaround, but it violates the project's style convention.

**Proposed Fix:**
Check whether a CSS rule in `frontend/src/index.css` (or a Tailwind arbitrary utility) consumes `--panel-w` for the panel. If so, remove the `width` from the inline style object, leaving only `'--panel-w': '${width}px'`. If no CSS rule exists yet, add a Tailwind class `w-[var(--panel-w)]` to the `<aside>` className instead of the inline `width`.

---

## BUG-002: `timeout` stage status shows `close` icon instead of `timer_off`

- **Severity:** Low
- **Type:** Functional / Spec Drift
- **Component:** `frontend/src/components/pipeline-log/StageTabBar.tsx` lines 75-84
- **Test reference:** TC-048, TC-070

**Reproduction Steps:**
1. Open a pipeline run where one stage has timed out (status = 'timeout').
2. Open the Pipeline Log panel.
3. Observe the tab for the timed-out stage — it shows a `close` icon (red ×).

**Expected Behavior:**
Per user story E2-S2 acceptance criterion 4:
> `timeout` → icono `timer_off` en color warning (#FF9500).

The `timeout` status should render a `timer_off` Material Symbols icon in warning color, visually distinguishing it from `failed` (which correctly shows `close` in error red).

**Actual Behavior:**
Both `failed` and `timeout` are handled by the same branch in `StatusIcon`:
```
if (status === 'failed' || status === 'timeout') {
  return <span className="... text-error">close</span>;
}
```
The `timeout` stage renders the same red `close` icon as `failed`. The icons are not distinguishable, and the color is `text-error` (red) rather than `text-warning` (amber/orange).

**Root Cause Analysis:**
The developer grouped `failed` and `timeout` in a single branch for simplicity. The spec requires separate treatment for `timeout`: a distinct icon (`timer_off`) and a warning color.

**Proposed Fix:**
Add a separate branch for `timeout` before the combined `failed/timeout` branch:
- Icon: `timer_off`
- Color class: `text-warning` (the project's Tailwind token for `#FF9500`)
- Remove `timeout` from the existing `failed || timeout` branch.

Additionally, add a test case for `timeout` that asserts the `timer_off` icon and `text-warning` class.

**WCAG note:** User story E2-S2 criterion 7 states status must be communicated with icon + color, never only color. The current `close` icon conveys "error/stop" semantics — for `timeout`, `timer_off` more accurately conveys the meaning. This is an accessibility spec drift.

---

## BUG-003: LogViewer error state shows raw technical error string instead of user-friendly message

- **Severity:** Low
- **Type:** UX / Spec Drift
- **Component:** `frontend/src/components/pipeline-log/LogViewer.tsx` lines 67-79
- **Test reference:** TC-071

**Reproduction Steps:**
1. Simulate a fetch failure in `usePipelineLogPolling` for any stage.
2. Open the Pipeline Log panel and navigate to the affected stage.
3. Observe the error state rendered by `LogViewer`.

**Expected Behavior:**
Per user story E4-S3 acceptance criteria:
> Texto "No se pudo cargar el log." en text-primary, 13px.
> Texto "El servidor no respondio. Se reintentara automaticamente." en text-secondary, 11px.
> El mensaje NO expone el error tecnico interno (sin stack traces ni codigos HTTP).

**Actual Behavior:**
`LogViewer` renders the raw error message string passed via the `error` prop directly:
```tsx
<p className="text-xs text-error font-mono break-all">{error}</p>
```
The `error` prop is populated from `err.message` in `usePipelineLogPolling`, which includes technical strings like `[PipelineLog] fetch error stage=0 code=INTERNAL_ERROR status=500`. This violates the spec requirement that no technical details be exposed to the user.

Additionally, the error text is styled as `font-mono` (monospace) and `text-error` (red), while the spec calls for `text-primary` (13px) for the main message and `text-secondary` (11px) for the explanation. The current implementation also does not include the secondary explanation text at all.

**Root Cause Analysis:**
The `LogViewer` component was designed to receive the error string directly from the store, passing through whatever message the polling hook set. The polling hook constructs technical error messages for debugging purposes (correct per blueprint §3.4 observability notes), but these are not appropriate for end-user display. The component should use hardcoded user-friendly strings rather than rendering the raw technical error.

**Proposed Fix:**
In `LogViewer.tsx`, replace the raw `{error}` rendering with fixed user-friendly copy matching the spec:
- Primary text: "No se pudo cargar el log." in `text-primary text-[13px]`
- Secondary text: "El servidor no respondio. Se reintentara automaticamente." in `text-secondary text-[11px]`
- Remove `font-mono` and `break-all` from the error paragraph (those classes make sense for log content, not error messages).
- The `error` prop can remain as a non-null signal without its value being rendered.

Update the corresponding test in `LogViewer.test.tsx` to assert the hardcoded strings rather than the raw error message value.
