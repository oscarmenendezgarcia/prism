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

// BUG-001 fix: use a GLOBAL regex and take the LAST match, not the first.
// Rationale: agent .md prompts themselves contain an EXAMPLE `prism-gate` block
// as instructional text. An agent that echoes any part of its prompt into its
// artifact would otherwise have its real (later) verdict silently overridden
// by the example block that appears earlier in the file. The real verdict is
// always the last one — everything before it is prose, an example, or context.
const GATE_BLOCK_ALL = /```+\s*prism-gate\s*\n([\s\S]*?)```/gi;

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
    // BUG-001 fix: iterate all matches and keep the LAST one.
    let block = null;
    for (const m of content.matchAll(GATE_BLOCK_ALL)) block = m[1];
    if (block === null) return NONE;

    const passMatch = block.match(/(?:^|\n)\s*pass\s*:\s*(true|false)\b/i);
    const pass = passMatch ? passMatch[1].toLowerCase() === 'true' : null;

    // Collect `findings:` list items (`- ...`) until the list ends.
    //
    // BUG-002 fix: treat lines indented MORE than the bullet dash as
    // continuation lines belonging to the current finding, rather than as
    // list terminators. Only a non-bullet, non-blank line at or shallower
    // than the bullet indent ends the list. LLM-written YAML routinely
    // wraps long bullet text onto extra indented lines; the previous
    // truncation dropped every finding after the first wrapped one.
    const findings = [];
    let inFindings = false;
    let bulletIndent = null; // column of the `-` of the first bullet
    for (const line of block.split('\n')) {
      if (/^\s*findings\s*:/i.test(line)) { inFindings = true; continue; }
      if (!inFindings) continue;

      if (!line.trim()) continue; // blank lines never end the list

      const item = line.match(/^(\s*)-\s+(.*\S)\s*$/);
      if (item) {
        if (bulletIndent === null) bulletIndent = item[1].length;
        findings.push(item[2].trim());
        continue;
      }

      // Non-bullet, non-blank line. If it is more indented than the bullet
      // dash, it's a wrapped continuation of the current finding — append
      // it (space-joined) and keep going. Otherwise, the list has ended.
      const leadingWs = line.match(/^(\s*)/)[1].length;
      if (bulletIndent !== null && leadingWs > bulletIndent && findings.length) {
        findings[findings.length - 1] += ' ' + line.trim();
        continue;
      }
      break;
    }

    return { pass, findings };
  } catch {
    return NONE;
  }
}

module.exports = { parseGateVerdict };
