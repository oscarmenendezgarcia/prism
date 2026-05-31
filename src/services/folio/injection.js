'use strict';

/**
 * Folio — Stage-Aware Context Injection Engine
 *
 * `buildContext(store, folioId, query, opts)` assembles the Folio context block
 * for a single pipeline stage.  It is the only place where BM25 ranking, budget
 * accounting, deduplication, and truncation live.
 *
 * Invariants:
 *  - No import outside src/services/folio/.
 *  - No reference to the Prism binding-layer identifier (space → folio resolution is the binding layer's job).
 *  - Never throws on a bad query — searchPages already swallows FTS syntax errors;
 *    if it returns [] the block degrades gracefully to index-only.
 *
 * BM25 sign convention (verified against folio/store.js):
 *   store.searchPages returns the raw SQLite bm25() value in the `score` field.
 *   bm25() is NEGATIVE for good matches (more negative = stronger match).
 *   ORDER BY bm25() in the SQL therefore sorts best-to-worst.
 *   We normalise: rel = -score + pinnedBoost?   so that HIGHER rel = STRONGER.
 *   Threshold comparison is always `rel >= scoreThreshold` (threshold is positive).
 *
 * Token budget:
 *   countTokens is applied to the ASSEMBLED output (not per-page estimates).
 *   Default countTokens = folio/tokens.countTokens (char-based, pluggable via opts).
 */

const { countTokens: defaultCountTokens, CHARS_PER_TOKEN } = require('./tokens');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum token budget required to bother truncating a page inline. */
const MIN_SLICE_TOKENS = 50;

/** Default configuration (all overridable via opts). */
const DEFAULTS = {
  scoreThreshold:     2.0,   // normalized rel ≥ this → inline
  maxInlinePages:     3,
  maxInlineTokens:    1500,
  indexTokenBudget:   200,
  constraintChapters: ['restricciones', 'constraints'],
  pinnedBoost:        1.0,   // added to rel for pinned pages (boost only — not unconditional)
  searchLimit:        20,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a page as a Markdown block suitable for inline injection.
 * Format: ### {chapterSlug}/{pageSlug}\n\n{content}
 *
 * @param {Page} page
 * @returns {string}
 */
function renderPage(page) {
  const header  = `### ${page.chapterSlug}/${page.slug}`;
  const content = page.content ?? '';
  return content.trim() ? `${header}\n\n${content}` : header;
}

/**
 * Truncate a rendered page string to fit within `budgetTokens`, appending the
 * standard recovery marker so agents can retrieve the full page on demand.
 *
 * Returns the truncated string, or null if the budget is too small for anything
 * useful (< MIN_SLICE_TOKENS after accounting for the marker itself).
 *
 * @param {string}   rendered       - Output of renderPage(page).
 * @param {Page}     page           - Original page object (for the slug in the marker).
 * @param {number}   budgetTokens   - Remaining token budget.
 * @param {Function} countTokens    - Token counting function.
 * @returns {string | null}
 */
function truncateToTokenBudget(rendered, page, budgetTokens, countTokens) {
  // Note: use double-quotes instead of [[...]] to avoid colliding with the ref resolution syntax.
  const marker = ` [truncado — "${page.chapterSlug}/${page.slug}" disponible via folio_get_page]`;
  const markerTokens  = countTokens(marker);
  const contentBudget = budgetTokens - markerTokens;

  if (contentBudget < MIN_SLICE_TOKENS) return null;

  const fullTokens = countTokens(rendered);
  if (fullTokens <= contentBudget) {
    // Already fits — return as-is with marker (still marked truncated because
    // the caller only calls this when a truncation is requested)
    return rendered + marker;
  }

  // Estimate the target char count from the token ratio.
  // For the default char-based counter this is exact; for a real BPE tokenizer
  // it is an approximation — we refine iteratively below.
  const charsPerTok = rendered.length / Math.max(fullTokens, 1);
  let targetChars   = Math.floor(contentBudget * charsPerTok);

  // Never exceed the string length.
  targetChars = Math.min(targetChars, rendered.length);

  let candidate = rendered.slice(0, targetChars);

  // Iterative refinement: reduce by 10% steps until we fit.
  // Typically 0–2 iterations with the char-based counter; bounded at 20 steps.
  let steps = 0;
  while (countTokens(candidate) > contentBudget && candidate.length > 0 && steps < 20) {
    targetChars = Math.floor(targetChars * 0.9);
    candidate   = rendered.slice(0, targetChars);
    steps++;
  }

  // If we still can't fit a meaningful slice, bail out.
  if (countTokens(candidate) > contentBudget || candidate.length === 0) return null;

  return candidate + marker;
}

// ---------------------------------------------------------------------------
// Query sanitization for FTS5
// ---------------------------------------------------------------------------

/** Common stopwords to skip (language-neutral; Spanish + English). */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'in', 'on', 'at', 'to', 'of', 'is', 'it',
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'por', 'para', 'en', 'con', 'que',
  'se', 'no', 'del', 'al', 'su', 'sus', 'es', 'son', 'ser', 'que', 'mas',
]);

/**
 * Extract up to `max` unique significant terms from a single text segment.
 *
 * @param {string} text      - Input segment (already lowercased, FTS-cleaned).
 * @param {Set<string>} seen - Deduplication set shared across segments (mutated).
 * @param {number} max       - Max terms to extract from this segment.
 * @returns {string[]}
 */
function extractTerms(text, seen, max) {
  const out = [];
  for (const t of text.split(/\s+/).filter(Boolean)) {
    if (t.length < 3)    continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t))     continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Sanitize a free-text query for the SQLite FTS5 MATCH operator.
 *
 * The query is assembled from `task.title + task.description + stage descriptor`.
 * We need it to:
 *  1. Not crash FTS5 (strip operator chars: hyphens, quotes, etc.).
 *  2. Not be so long that AND semantics produce zero hits (FTS5 requires ALL
 *     terms to appear in a document — a 30-word query almost always returns nothing).
 *  3. Preserve per-stage differentiation — the stage descriptor must contribute
 *     terms even when the task title/description fills the "first K terms" budget.
 *
 * Strategy: take up to 4 terms from the first two-thirds of the raw string
 * (task portion) and up to 4 terms from the last third (descriptor portion),
 * deduplicated.  Join with OR so BM25 scores by relevance rather than acting
 * as a strict AND filter.
 *
 * @param {string} raw   - Combined "title description descriptor" string.
 * @returns {string}     - FTS5-safe OR query, or '' if no valid terms.
 */
function sanitizeFtsQuery(raw) {
  const cleaned = raw
    .replace(/[-"^*():;,!?]/g, ' ')  // strip FTS5 operator chars + punctuation
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();

  if (!cleaned) return '';

  // Split into task portion (first 2/3) and descriptor portion (last 1/3).
  // This ensures the stage descriptor always contributes terms to the query,
  // which is what creates per-stage relevance differentiation.
  const splitAt = Math.floor(cleaned.length * 2 / 3);
  const taskPart       = cleaned.slice(0, splitAt);
  const descriptorPart = cleaned.slice(splitAt);

  const seen = new Set();
  const taskTerms       = extractTerms(taskPart, seen, 4);
  const descriptorTerms = extractTerms(descriptorPart, seen, 4);

  const allTerms = [...taskTerms, ...descriptorTerms];
  if (allTerms.length === 0) return '';

  // OR semantics: rank by how many query terms appear in a document.
  // BM25 scores higher for documents with more matching terms.
  return allTerms.join(' OR ');
}

// ---------------------------------------------------------------------------
// Core engine
// ---------------------------------------------------------------------------

/**
 * Assemble a stage-relevant Folio context block.
 *
 * @param {FolioStore}  store      - Core Folio store (searchPages, listChapters, listPages).
 * @param {string}      folioId    - Target folio.
 * @param {string}      query      - BM25 query string (task.title + description + stage descriptor).
 * @param {object}      [opts]     - Configuration overrides.
 * @param {number}      [opts.scoreThreshold]     - Minimum normalised rel score for inline.
 * @param {number}      [opts.maxInlinePages]      - Hard cap on inline page count.
 * @param {number}      [opts.maxInlineTokens]     - Hard cap on inline token budget.
 * @param {number}      [opts.indexTokenBudget]    - Token budget for the Layer-1 index.
 * @param {string[]}    [opts.constraintChapters]  - Chapter slugs that are always inlined.
 * @param {number}      [opts.pinnedBoost]         - Added to normalised rel for pinned pages.
 * @param {number}      [opts.searchLimit]         - Max BM25 candidates to retrieve.
 * @param {Function}    [opts.countTokens]         - Pluggable token counter.
 * @returns {{ text: string, tokens: number, inline: Array, referenced: Array, truncated: Array }}
 */
function buildContext(store, folioId, query, opts = {}) {
  const cfg = {
    scoreThreshold:     opts.scoreThreshold     ?? DEFAULTS.scoreThreshold,
    maxInlinePages:     opts.maxInlinePages      ?? DEFAULTS.maxInlinePages,
    maxInlineTokens:    opts.maxInlineTokens     ?? DEFAULTS.maxInlineTokens,
    indexTokenBudget:   opts.indexTokenBudget    ?? DEFAULTS.indexTokenBudget,
    constraintChapters: opts.constraintChapters  ?? DEFAULTS.constraintChapters,
    pinnedBoost:        opts.pinnedBoost         ?? DEFAULTS.pinnedBoost,
    searchLimit:        opts.searchLimit         ?? DEFAULTS.searchLimit,
    countTokens:        opts.countTokens         ?? defaultCountTokens,
  };

  const { countTokens } = cfg;

  // ── Layer 1: Index (always present, separate ~200-tok budget) ──────────────
  // Provides the free reference list and is the cold-start safety net.

  const chapters = store.listChapters(folioId);

  // Build chapter → page count.  One pass over all pages avoids N round-trips.
  const allPages        = store.listPages(folioId);
  const countByChapter  = {};
  for (const p of allPages) {
    countByChapter[p.chapterSlug] = (countByChapter[p.chapterSlug] || 0) + 1;
  }

  // Accumulate index lines up to indexTokenBudget.
  let indexText = 'Index — chapters in this knowledge base:';
  for (const ch of chapters) {
    const count     = countByChapter[ch.slug] || 0;
    const unitLabel = count === 1 ? 'page' : 'pages';
    const line      = `\n- ${ch.slug} (${count} ${unitLabel})`;
    if (countTokens(indexText + line) > cfg.indexTokenBudget) break;
    indexText += line;
  }

  // ── BM25 candidates ────────────────────────────────────────────────────────
  // BM25 sign: bm25() is NEGATIVE for good matches (SQLite convention).
  // Normalise: rel = -score, then add pinnedBoost for pinned pages.
  // Result: HIGHER rel = STRONGER match.
  //
  // The query is sanitized before passing to FTS5 to prevent special characters
  // (hyphens in compound words like "stage-aware", "trade-offs") from being
  // interpreted as FTS5 NOT operators and causing parse errors.

  const hits    = store.searchPages(folioId, sanitizeFtsQuery(query), { limit: cfg.searchLimit });
  /** @type {Map<string, { page: Page, rel: number }>} */
  const hitMap  = new Map();
  for (const { page, score } of hits) {
    const rel = -score + (page.pinned ? cfg.pinnedBoost : 0);
    hitMap.set(page.id, { page, rel });
  }

  // ── Tier 0: Constraint pages (chapter_slug ∈ constraintChapters, always inline) ──
  const constraintPages = [];
  for (const chSlug of cfg.constraintChapters) {
    const pages = store.listPages(folioId, chSlug);
    constraintPages.push(...pages);
  }

  // ── BM25 hits that pass the threshold, sorted strongest-first ─────────────
  const thresholdHits = [...hitMap.values()]
    .filter(({ rel }) => rel >= cfg.scoreThreshold)
    .sort((a, b) => b.rel - a.rel)
    .map(({ page }) => page);

  // ── Inline assembly: constraints first, then threshold hits ───────────────
  const emitted      = new Set();   // page.id — dedup guard
  const inlineItems  = [];          // { slug, title, truncated, _rendered }
  const truncatedItems = [];        // { slug } — pages that were inline-truncated
  let tokensUsed     = 0;

  const inlineCandidates = [
    ...constraintPages,
    ...thresholdHits,
  ];

  for (const page of inlineCandidates) {
    if (emitted.has(page.id)) continue;              // dedup
    if (inlineItems.length >= cfg.maxInlinePages) break; // page-count cap

    const rendered  = renderPage(page);
    const pageCost  = countTokens(rendered);
    const remaining = cfg.maxInlineTokens - tokensUsed;

    if (pageCost <= remaining) {
      // Fits in full.
      inlineItems.push({
        slug:      `${page.chapterSlug}/${page.slug}`,
        title:     page.title,
        truncated: false,
        _rendered: rendered,
      });
      tokensUsed += pageCost;
      emitted.add(page.id);
    } else {
      // Try a truncated slice.
      if (remaining >= MIN_SLICE_TOKENS) {
        const truncStr = truncateToTokenBudget(rendered, page, remaining, countTokens);
        if (truncStr !== null) {
          inlineItems.push({
            slug:      `${page.chapterSlug}/${page.slug}`,
            title:     page.title,
            truncated: true,
            _rendered: truncStr,
          });
          truncatedItems.push({ slug: `${page.chapterSlug}/${page.slug}` });
          tokensUsed = cfg.maxInlineTokens;
          emitted.add(page.id);
        }
      }
      // Token cap reached — stop inline assembly.
      break;
    }
  }

  // ── Tier 2: Reference — all BM25 hits NOT already inlined ─────────────────
  // Includes both below-threshold matches and above-threshold pages bumped by the cap.
  const referencedItems = [];
  for (const { page } of hitMap.values()) {
    if (!emitted.has(page.id)) {
      referencedItems.push({
        slug:  `${page.chapterSlug}/${page.slug}`,
        title: page.title,
      });
    }
  }

  // ── Assemble final text ────────────────────────────────────────────────────

  let text = indexText;

  if (inlineItems.length > 0) {
    text += '\n\nInline (most relevant to this stage):';
    for (const item of inlineItems) {
      text += '\n\n' + item._rendered;
    }
  }

  if (referencedItems.length > 0) {
    // Note: plain "chapter/slug" format (no [[]] brackets) to avoid colliding with
    // the [[...]] reference resolution syntax used in task titles and descriptions.
    const slugList = referencedItems.map((r) => `"${r.slug}"`).join(', ');
    text += '\n\nRelevant (fetch with folio_get_page if useful): ' + slugList;
  }

  text += '\n\nUse folio_get_page to fetch the full content of any page listed above.';

  return {
    text,
    tokens:     countTokens(text),
    inline:     inlineItems.map(({ slug, title, truncated }) => ({ slug, title, truncated })),
    referenced: referencedItems,
    truncated:  truncatedItems,
  };
}

module.exports = { buildContext, DEFAULTS, MIN_SLICE_TOKENS };
