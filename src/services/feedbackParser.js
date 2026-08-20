'use strict';

/**
 * feedbackParser.js — Generic gate-verdict parser for the pipeline feedback gate.
 *
 * Any pipeline stage can act as a quality gate. A gate agent declares itself via
 * `gate:` frontmatter in its agent .md (artifact + loopBackTo) and writes a
 * machine-readable verdict block into its artifact:
 *
 *   ```prism-gate
 *   pass: false
 *   findings:
 *     - Login form missing validation
 *     - No test for the empty-input case
 *   ```
 *
 * The pipeline parses ONLY this block — it is agent-agnostic, so adding a new
 * gate (e.g. security-reviewer) needs no pipeline changes.
 *
 * Design constraints:
 *   - No I/O, no external calls. Pure and stateless.
 *   - Never throws — defaults to "no verdict" ({ pass: null }) on any error.
 */

/**
 * @typedef {{ pass: boolean|null, findings: string[] }} GateVerdict
 *   pass === null  → no verdict block found (caller decides the absence policy).
 */

const GATE_BLOCK = /```+\s*prism-gate\s*\n([\s\S]*?)```/i;

/**
 * Parse a gate verdict from an artifact's content.
 *
 * @param {string} content
 * @returns {GateVerdict}
 */
function parseGateVerdict(content) {
  const NONE = { pass: null, findings: [] };
  if (typeof content !== 'string' || !content) return NONE;

  try {
    const m = content.match(GATE_BLOCK);
    if (!m) return NONE;
    const block = m[1];

    const passMatch = block.match(/(?:^|\n)\s*pass\s*:\s*(true|false)\b/i);
    const pass = passMatch ? passMatch[1].toLowerCase() === 'true' : null;

    // Collect `findings:` list items (`- ...`) until the list ends.
    const findings = [];
    let inFindings = false;
    for (const line of block.split('\n')) {
      if (/^\s*findings\s*:/i.test(line)) { inFindings = true; continue; }
      if (!inFindings) continue;
      const item = line.match(/^\s*-\s+(.*\S)\s*$/);
      if (item) findings.push(item[1].trim());
      else if (line.trim()) break; // a non-bullet, non-blank line ends the list
    }

    return { pass, findings };
  } catch {
    return NONE;
  }
}

module.exports = { parseGateVerdict };
