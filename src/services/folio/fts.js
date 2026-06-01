'use strict';

/**
 * Folio — FTS5 query sanitizer (shared)
 *
 * Turns free-text into a safe SQLite FTS5 MATCH expression. Applied inside
 * store.searchPages so EVERY search (MCP folio_search, file backend, refs
 * autocomplete, injection) gets the same behavior:
 *
 *  1. Strip FTS5 operator/punctuation chars and split on whitespace.
 *  2. Drop stopwords and very short tokens; dedupe.
 *  3. Double-quote each remaining term so it is treated as a literal token —
 *     immune to FTS5 operator/column-qualifier parsing (fixes the `unique-folio-1`
 *     class of MATCH syntax errors where a bare `folio` token was misread).
 *  4. Join with OR so BM25 ranks by how many query terms a document contains,
 *     instead of FTS5's default AND (which makes any multi-word query — e.g.
 *     "feed new field schema" — return zero hits unless ALL words co-occur).
 *
 * Idempotent in effect: re-sanitizing an already-OR'd query strips the `OR`
 * stopwords and re-joins the same terms, so callers that pre-sanitize are safe.
 */

/** Language-neutral stopwords (English + Spanish). Includes FTS operators. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'not', 'near', 'for', 'in', 'on', 'at', 'to',
  'of', 'is', 'it', 'as', 'by', 'be',
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'por', 'para', 'en', 'con', 'que',
  'se', 'no', 'del', 'al', 'su', 'sus', 'es', 'son', 'ser', 'mas',
]);

/**
 * @param {string} raw                 - Free-text query.
 * @param {object} [opts]
 * @param {number} [opts.maxTerms=10]  - Cap on terms (keeps the query bounded).
 * @param {number} [opts.minLen=2]     - Drop tokens shorter than this.
 * @returns {string}                   - FTS5 MATCH expression, or '' if no terms.
 */
function sanitizeFtsQuery(raw, opts = {}) {
  if (typeof raw !== 'string') return '';
  const maxTerms = opts.maxTerms ?? 10;
  const minLen   = opts.minLen ?? 2;

  const cleaned = raw
    .replace(/["^*():;,.!?/\\]/g, ' ')  // strip quotes + FTS operators + punctuation
    .replace(/-/g, ' ')                  // hyphens → spaces (avoid NEAR/`-` parsing)
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

  if (!cleaned) return '';

  const seen  = new Set();
  const terms = [];
  for (const t of cleaned.split(/\s+/)) {
    if (t.length < minLen)  continue;
    if (STOPWORDS.has(t))   continue;
    if (seen.has(t))        continue;
    seen.add(t);
    terms.push(t);
    if (terms.length >= maxTerms) break;
  }

  if (terms.length === 0) return '';

  // Quote each term (literal token) and OR them together.
  return terms.map((t) => `"${t}"`).join(' OR ');
}

module.exports = { sanitizeFtsQuery, STOPWORDS };
