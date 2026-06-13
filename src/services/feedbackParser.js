'use strict';

/**
 * feedbackParser.js — Pure artifact parsers for the pipeline feedback gate.
 *
 * LOOP-1 (feedback-gate): parses code-reviewer and qa-engineer-e2e artifacts
 * to structured results used by pipelineManager to decide whether to loop back
 * to developer-agent.
 *
 * Design constraints:
 *   - No require('fs'), no I/O, no external calls.
 *   - All functions are pure and stateless.
 *   - Neither function ever throws — defaults to "no loop needed" on any error.
 */

// ---------------------------------------------------------------------------
// Types (JSDoc only — CJS has no type system)
// ---------------------------------------------------------------------------

/**
 * @typedef {{ verdict: 'APPROVED'|'APPROVED_WITH_NOTES'|'CHANGES_REQUIRED'|null, summary: string, raw: boolean }} ReviewVerdict
 * @typedef {{ hasCritical: boolean, hasHigh: boolean, bugCount: number, bugs: Array<{id: string|null, severity: 'Critical'|'High', title: string}>, raw: boolean }} BugsResult
 */

// ---------------------------------------------------------------------------
// parseReviewReport
// ---------------------------------------------------------------------------

/**
 * Parse the content of review-report.md to a structured verdict.
 *
 * Algorithms (in order):
 *   1. Bold inline:  **Verdict:** APPROVED_WITH_NOTES | CHANGES_REQUIRED | APPROVED
 *   2. Heading form: ## Verdict: ... or ## Result: ...
 *   3. Table cell:   | APPROVED_WITH_NOTES | or | CHANGES_REQUIRED | or | APPROVED |
 *
 * APPROVED_WITH_NOTES is always matched before APPROVED in every pattern so that
 * the longer token cannot be consumed by the shorter one.
 *
 * Summary: collected from bullet items immediately under an "Issues" or "Findings"
 * heading (max 5 items, max 300 chars total).
 *
 * @param {string} content
 * @returns {ReviewVerdict}
 */
function parseReviewReport(content) {
  const EMPTY = { verdict: null, summary: '', raw: false };
  if (typeof content !== 'string' || !content.trim()) return EMPTY;

  try {
    const lines = content.split('\n');

    // Pattern 1: **Verdict:** VALUE — APPROVED_WITH_NOTES must precede APPROVED.
    const BOLD_PATTERN = /\*\*Verdict:\*\*\s*(APPROVED_WITH_NOTES|CHANGES_REQUIRED|APPROVED)/i;

    // Pattern 2: heading-level verdict — ## Verdict: VALUE or ## Result: VALUE
    // Covers forms like: ## Verdict: APPROVED_WITH_NOTES
    const HEADING_PATTERN = /^#+\s*(?:Verdict|Result)\b[^:\n]*:\s*(APPROVED_WITH_NOTES|CHANGES_REQUIRED|APPROVED)/im;

    // Pattern 3: table cell — | VALUE |
    const TABLE_PATTERN = /\|\s*(APPROVED_WITH_NOTES|CHANGES_REQUIRED|APPROVED)\s*\|/i;

    let verdict = null;

    // Try bold inline first (most specific).
    const boldMatch = content.match(BOLD_PATTERN);
    if (boldMatch) {
      verdict = boldMatch[1].toUpperCase();
    }

    // Try heading form.
    if (!verdict) {
      const headingMatch = content.match(HEADING_PATTERN);
      if (headingMatch) {
        verdict = headingMatch[1].toUpperCase();
      }
    }

    // Try table cell form.
    if (!verdict) {
      const tableMatch = content.match(TABLE_PATTERN);
      if (tableMatch) {
        verdict = tableMatch[1].toUpperCase();
      }
    }

    // Collect summary from Issues/Findings sections.
    const summaryItems = [];
    let inIssuesSection = false;
    let bulletCount = 0;

    for (const line of lines) {
      // Detect start of an Issues or Findings section.
      if (/^#+\s*(Issues|Findings|Problems|Defects|Changes Required)/i.test(line)) {
        inIssuesSection = true;
        continue;
      }

      // End of the section (new heading that is not an issues heading).
      if (/^#+/.test(line) && !/^#+\s*(Issues|Findings|Problems|Defects|Changes Required)/i.test(line)) {
        inIssuesSection = false;
      }

      // Collect up to 5 bullet items.
      if (inIssuesSection && bulletCount < 5 && /^\s*[-*+]\s/.test(line)) {
        const text = line.replace(/^\s*[-*+]\s+/, '').trim();
        if (text) {
          summaryItems.push(text);
          bulletCount++;
        }
      }
    }

    let summary = summaryItems.join('; ');
    if (summary.length > 300) summary = summary.slice(0, 297) + '...';

    return { verdict, summary, raw: verdict !== null };
  } catch {
    return EMPTY;
  }
}

// ---------------------------------------------------------------------------
// parseBugsReport
// ---------------------------------------------------------------------------

/**
 * Parse the content of bugs.md to a structured bug list with severity.
 *
 * Severity detection for each level (Critical / High) searches in:
 *   - Bold inline:   **Severity**: Critical  or  **severity**: high
 *   - Table cell:    | Critical |  or  | High |
 *   - Heading attr:  ## BUG-001 ... Critical  or  ## BUG-X ... High
 *
 * For each match, extracts:
 *   - id:    BUG-\w+ from the same line, or null if absent
 *   - title: first 100 chars of the matched line (stripped of Markdown)
 *
 * @param {string} content
 * @returns {BugsResult}
 */
function parseBugsReport(content) {
  const EMPTY = { hasCritical: false, hasHigh: false, bugCount: 0, bugs: [], raw: false };
  if (typeof content !== 'string' || !content.trim()) return EMPTY;

  try {
    const lines = content.split('\n');
    const bugs = [];

    for (const line of lines) {
      let severity = null;

      // --- Critical ---
      if (
        /\*\*severity\*\*\s*:\s*critical/i.test(line) ||
        /\|\s*critical\s*\|/i.test(line) ||
        /^#+\s+BUG[- ]\w+[^\n]*critical/i.test(line)
      ) {
        severity = 'Critical';
      }

      // --- High (only if not already matched as Critical) ---
      if (
        !severity &&
        (
          /\*\*severity\*\*\s*:\s*high/i.test(line) ||
          /\|\s*high\s*\|/i.test(line) ||
          /^#+\s+BUG[- ]\w+[^\n]*high/i.test(line)
        )
      ) {
        severity = 'High';
      }

      if (!severity) continue;

      // Extract BUG-ID from the line.
      const idMatch = line.match(/\bBUG[- ](\w+)\b/i);
      const id = idMatch ? `BUG-${idMatch[1]}` : null;

      // Build title from stripped line, truncated to 100 chars.
      const title = line
        .replace(/^#+\s*/, '')          // remove heading markers
        .replace(/\*\*/g, '')           // remove bold markers
        .replace(/\|/g, '')             // remove table pipes
        .replace(/^\s*[-*+]\s*/, '')    // remove bullet markers
        .trim()
        .slice(0, 100);

      bugs.push({ id, severity, title });
    }

    const hasCritical = bugs.some((b) => b.severity === 'Critical');
    const hasHigh     = bugs.some((b) => b.severity === 'High');
    const bugCount    = bugs.length;
    const raw         = bugs.length > 0;

    return { hasCritical, hasHigh, bugCount, bugs, raw };
  } catch {
    return EMPTY;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { parseReviewReport, parseBugsReport };
