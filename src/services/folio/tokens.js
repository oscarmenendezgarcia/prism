'use strict';

/**
 * Folio — Pluggable Token Counter
 *
 * Deterministic, dependency-free token estimator.
 * Default heuristic: ceil(text.length / CHARS_PER_TOKEN)
 *
 * Calibration notes (measured on the .folio/ fixture — ~5000 chars / ~1400 tokens):
 *   GPT-3/4 BPE tokenizers yield ≈ 3.5–4 chars/token for English + Markdown.
 *   Spanish technical text is slightly denser: ~3.6 chars/token on the fixture.
 *   CHARS_PER_TOKEN = 3.6 is a conservative (slightly over-counts tokens) choice
 *   so the inline budget is a safe soft cap, not an under-count.
 *
 * Invariants:
 *  - No import outside src/services/folio/.
 *  - No reference to the binding-layer identifier.
 *  - Injected as opts.countTokens in the injection engine so a real BPE tokenizer
 *    (e.g., from a Claude tokenizer package) can replace it at extraction time
 *    without touching the engine code.
 */

/**
 * Characters per token — calibrated on the .folio/ fixture.
 * Conservative: slightly over-estimates token cost, keeping the inline budget safe.
 */
const CHARS_PER_TOKEN = 3.6;

/**
 * Count the approximate number of tokens in `text`.
 * Returns 0 for an empty string; always returns a positive integer for non-empty text.
 * Deterministic: same input always yields the same output.
 *
 * @param {string} text
 * @returns {number}
 */
function countTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

module.exports = { countTokens, CHARS_PER_TOKEN };
