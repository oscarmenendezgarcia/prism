'use strict';

/**
 * Folio — Reference Resolver (resolver.js)
 *
 * Replaces `[[chapter/page]]` and `[[chapter/page#section]]` references in a
 * text blob with resolved content.
 *
 * Whole-page:   `[[chapter/page]]`          → page.content
 * Section:      `[[chapter/page#section]]`  → the H2 block whose GitHub-
 *                                             slugified title matches <section>
 *                                             (heading line through next `## ` or EOF)
 *
 * Resolution is non-destructive and idempotent:
 *   - Missing page/section → ref is left verbatim + console.warn emitted
 *   - Multiple refs in one text are all resolved
 *   - Calling resolveRefs twice on already-resolved text is safe (no `[[`
 *     patterns remain after a full resolution pass)
 *
 * Invariants:
 *   - No SQLite, no import outside src/services/folio/.
 *   - Lookups use service.getPageBySlug (UNIQUE-indexed O(1)).
 *   - Section matching is by GitHub-slugified H2 title, case-insensitive.
 *     Anchor by H2 title only — never by line number.
 */

const { parseSlug } = require('./store');

// ---------------------------------------------------------------------------
// GitHub-slug helper
// ---------------------------------------------------------------------------

/**
 * Convert an H2 heading title to a GitHub-compatible slug.
 * Lowercase, replace spaces with hyphens, strip non-word chars.
 *
 * @param {string} text
 * @returns {string}
 */
function githubSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // remove special chars (keep alphanumeric, spaces, hyphens)
    .trim()
    .replace(/\s+/g, '-');      // collapse spaces to single hyphen
}

// ---------------------------------------------------------------------------
// Headings extractor
// ---------------------------------------------------------------------------

/**
 * Extract all H2 headings from a markdown string, in document order.
 * Returns an array of { title, slug } objects where slug is the
 * GitHub-slugified version of the heading title.
 *
 * @param {string} content
 * @returns {Array<{ title: string, slug: string }>}
 */
function extractHeadings(content) {
  if (typeof content !== 'string') return [];
  const headings = [];
  const regex = /^## (.+)$/gm;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const title = m[1].trim();
    headings.push({ title, slug: githubSlug(title) });
  }
  return headings;
}

// ---------------------------------------------------------------------------
// Section extractor
// ---------------------------------------------------------------------------

/**
 * Extract the H2 block from `content` whose GitHub-slugified title matches
 * `sectionSlug` (case-insensitive slug comparison).
 *
 * The extracted block includes the `## Heading` line itself and continues
 * through the line before the next `## ` heading or to EOF.
 *
 * Returns null if no matching H2 heading is found.
 *
 * @param {string} content
 * @param {string} sectionSlug
 * @returns {string | null}
 */
function extractSection(content, sectionSlug) {
  const lines = content.split('\n');
  const targetSlug = sectionSlug.toLowerCase();

  let startIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (.+)/);
    if (m) {
      const slug = githubSlug(m[1]);
      if (slug === targetSlug) {
        startIdx = i;
        break;
      }
    }
  }

  if (startIdx === -1) return null;

  // Find the end of this section (next H2 or EOF)
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      endIdx = i;
      break;
    }
  }

  // Trim trailing blank lines for a clean extract
  let trimEnd = endIdx;
  while (trimEnd > startIdx + 1 && lines[trimEnd - 1].trim() === '') {
    trimEnd--;
  }

  return lines.slice(startIdx, trimEnd).join('\n');
}

// ---------------------------------------------------------------------------
// Resolver factory
// ---------------------------------------------------------------------------

const REF_PATTERN = /\[\[([^\]]+)\]\]/g;

/**
 * Create a resolver bound to a FolioService-shaped object.
 *
 * The service must expose:
 *   `getPageBySlug(folioId, chapterSlug, pageSlug) → Page | null`
 *
 * @param {{ getPageBySlug: Function }} service
 * @returns {{ resolveRefs: Function }}
 */
function createResolver(service) {

  /**
   * Resolve all `[[...]]` references in `text`, scoped to `folioId`.
   * Unresolved references are left verbatim and produce a console.warn.
   *
   * @param {string} text
   * @param {string} folioId
   * @returns {string}
   */
  function resolveRefs(text, folioId) {
    if (typeof text !== 'string') return text;

    return text.replace(REF_PATTERN, (match, ref) => {
      // Split ref into slug and optional section: "chapter/page#section"
      const hashIdx = ref.indexOf('#');
      const rawSlug = hashIdx !== -1 ? ref.slice(0, hashIdx) : ref;
      const section = hashIdx !== -1 ? ref.slice(hashIdx + 1) : null;

      // Validate slug grammar
      let chapterSlug, pageSlug;
      try {
        ({ chapterSlug, pageSlug } = parseSlug(rawSlug.trim()));
      } catch (_) {
        console.warn(`[folio.resolver] invalid slug in reference: ${match}`);
        return match;
      }

      // Look up the page
      const page = service.getPageBySlug(folioId, chapterSlug, pageSlug);
      if (!page) {
        console.warn(`[folio.resolver] unresolved reference ${match} — page "${rawSlug}" not found in folio "${folioId}"`);
        return match;
      }

      // Whole-page resolution
      if (!section) {
        return page.content;
      }

      // Section resolution
      const block = extractSection(page.content, section);
      if (block === null) {
        console.warn(`[folio.resolver] unresolved section "${section}" in reference ${match} — heading not found`);
        return match;
      }

      return block;
    });
  }

  return { resolveRefs };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  createResolver,
  // Exported for testing
  githubSlug,
  extractSection,
  extractHeadings,
};
