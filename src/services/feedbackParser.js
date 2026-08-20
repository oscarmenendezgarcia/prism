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
 * -------------------------------------------------------------------------
 * STRICT-PARSER STANCE (round 3 — 2026-08-20)
 * -------------------------------------------------------------------------
 * Every prior round of the manager-driven gate PR produced the SAME class of
 * bug: a verdict or its findings vanished silently through some new mechanism.
 * The parser now REFUSES TO GUESS. When it cannot be certain, it returns
 * `{ pass: null }` and lets Policy C fail the run loudly — a loud failure is
 * always recoverable, a silent one is not.
 *
 * Concretely, "no verdict" (pass: null) is returned when ANY of the following
 * holds, in addition to the historical "no prism-gate block found":
 *   - the artifact contains more than one prism-gate block whose parsed
 *     contents disagree (a common footgun: agents echoing the instructional
 *     example block from their own .md prompt into the real artifact);
 *   - a fenced code block cannot be balanced (unclosed opening fence);
 *   - the `pass:` line is present but not a boolean; or `pass:` is missing.
 *
 * The block-extraction rule follows CommonMark: an opening fence of N
 * backticks (N >= 3) is closed only by a line containing >= N backticks,
 * so a nested triple-backtick snippet inside a finding (repro commands,
 * stack traces) does NOT terminate the block.
 *
 * Design constraints:
 *   - No I/O, no external calls. Pure and stateless.
 *   - Never throws — every failure path collapses to `{ pass: null }`.
 * -------------------------------------------------------------------------
 */

/**
 * @typedef {{ pass: boolean|null, findings: string[] }} GateVerdict
 *   pass === null  → no verdict block found OR verdict is ambiguous.
 *                    Caller decides the absence policy (Policy C: fail loud).
 */

const NONE = Object.freeze({ pass: null, findings: [] });

/**
 * Extract every `prism-gate` fenced block from `content`.
 *
 * Uses CommonMark fence rules: the opening fence line is `^\s*(`{3,})\s*prism-gate\s*$`
 * and the closing fence is `^\s*(`{3,})\s*$` where the closing backtick count is
 * >= the opening count. Anything between (including inner ```blocks) is treated
 * as opaque content — so a QA repro snippet fenced with ``` inside a finding
 * does not truncate the outer block.
 *
 * Returns { blocks: string[], unbalanced: boolean }.
 * `unbalanced: true` means an opening `prism-gate` fence was seen but no matching
 * closing fence was found before EOF — the parser must treat this as ambiguous.
 *
 * @param {string} content
 * @returns {{ blocks: string[], unbalanced: boolean }}
 */
function extractGateBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^\s*(`{3,})\s*prism-gate\s*$/);
    if (!open) { i++; continue; }
    const fenceLen = open[1].length;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j].match(/^\s*(`{3,})\s*$/);
      if (m && m[1].length >= fenceLen) { close = j; break; }
    }
    if (close === -1) return { blocks, unbalanced: true };
    blocks.push(lines.slice(i + 1, close).join('\n'));
    i = close + 1;
  }
  return { blocks, unbalanced: false };
}

/**
 * Parse ONE gate-block body (already stripped of its fence lines).
 * Returns { pass, findings } where pass is boolean|null. pass === null when
 * the block is present but its `pass:` line is missing or not a boolean.
 *
 * @param {string} block
 * @returns {GateVerdict}
 */
function parseSingleBlock(block) {
  const passMatch = block.match(/(?:^|\n)\s*pass\s*:\s*(true|false)\b/i);
  const pass = passMatch ? passMatch[1].toLowerCase() === 'true' : null;

  // Collect `findings:` list items (`- ...`). Lines indented deeper than the
  // first bullet's dash column are treated as wrapped continuations of the
  // current finding (LLM-written YAML routinely wraps long text). Only a
  // non-bullet, non-blank line at or shallower than the bullet indent ends
  // the list.
  const findings = [];
  let inFindings = false;
  let bulletIndent = null;
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

    const leadingWs = line.match(/^(\s*)/)[1].length;
    if (bulletIndent !== null && leadingWs > bulletIndent && findings.length) {
      findings[findings.length - 1] += ' ' + line.trim();
      continue;
    }
    break;
  }

  return { pass, findings };
}

/**
 * Two verdicts "agree" when their pass booleans are equal AND their findings
 * arrays are identical (order-sensitive). Used to reject ambiguous artifacts
 * that contain multiple prism-gate blocks whose contents disagree.
 */
function verdictsAgree(a, b) {
  if (a.pass !== b.pass) return false;
  if (a.findings.length !== b.findings.length) return false;
  for (let i = 0; i < a.findings.length; i++) {
    if (a.findings[i] !== b.findings[i]) return false;
  }
  return true;
}

/**
 * Parse a gate verdict from an artifact's content.
 *
 * Returns `{ pass: null, findings: [] }` in EVERY ambiguous case — the caller
 * (Policy C) is expected to fail the run loudly on `pass === null`, which is
 * strictly better than returning a partial or guessed result.
 *
 * @param {string} content
 * @returns {GateVerdict}
 */
function parseGateVerdict(content) {
  if (typeof content !== 'string' || !content) return { ...NONE };

  try {
    const { blocks, unbalanced } = extractGateBlocks(content);

    // Ambiguity 1: an opening prism-gate fence with no matching closer.
    if (unbalanced) return { ...NONE };

    if (blocks.length === 0) return { ...NONE };

    const parsed = blocks.map(parseSingleBlock);

    // Ambiguity 2: multiple prism-gate blocks whose contents disagree.
    // This catches the classic footgun where an agent echoes the example block
    // from its own prompt template and also emits a real verdict — the two
    // blocks disagree, so refuse rather than "take-the-last" and guess wrong.
    if (parsed.length > 1) {
      const first = parsed[0];
      for (let i = 1; i < parsed.length; i++) {
        if (!verdictsAgree(first, parsed[i])) return { ...NONE };
      }
    }

    const verdict = parsed[0];
    // Ambiguity 3: block present but pass: line missing or not boolean.
    if (verdict.pass === null) return { ...NONE };

    return verdict;
  } catch {
    return { ...NONE };
  }
}

module.exports = { parseGateVerdict, extractGateBlocks };
