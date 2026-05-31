'use strict';

/**
 * Folio — Markdown Serialisation (markdown.js)
 *
 * Pure functions for round-tripping a Page entity to/from a `.md` file
 * (YAML frontmatter + markdown body) and reading/writing a `folio.json`
 * manifest.
 *
 * Invariants:
 *  - No SQLite, no import outside src/services/folio/.
 *  - No I/O policy: the "where to write" decision lives in backend.js.
 *  - The in-module YAML subset parser handles only:
 *      scalars (string, boolean, null) and a string array for `tags`.
 *    Do NOT pull in a general YAML library (supply-chain + attack surface).
 *  - Slug segments are validated via the shared parseSlug grammar from store.js.
 *
 * Markdown format:
 *   ---
 *   title: My Page
 *   author: user
 *   pinned: false
 *   created: 2026-05-31T00:00:00.000Z
 *   updated: 2026-05-31T00:00:00.000Z
 *   tags: [stack, runtime]
 *   ---
 *
 *   <markdown body = page.content>
 *
 * Manifest format (folio.json):
 *   { "name": "...", "formatVersion": "1.0", "createdAt": "...", "description": "?" }
 */

const fs   = require('fs');
const path = require('path');

const { parseSlug, titleCase } = require('./store');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORMAT_VERSION = '1.0';
const FRONTMATTER_DELIMITER = '---';

// ---------------------------------------------------------------------------
// Internal YAML subset parser
// ---------------------------------------------------------------------------

/**
 * Parse a constrained YAML-like block (scalars + one string array).
 * Lines must be `key: value` pairs.  Unknown keys are round-tripped as strings.
 *
 * @param {string[]} lines
 * @returns {Record<string, any>}
 */
function parseYamlSubset(lines) {
  const result = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key    = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    if (!key) continue;

    // String array: [a, b, c]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      const inner = rawVal.slice(1, -1).trim();
      result[key] = inner
        ? inner.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      continue;
    }

    // Boolean literals
    if (rawVal === 'true')  { result[key] = true;  continue; }
    if (rawVal === 'false') { result[key] = false; continue; }

    // Null / empty
    if (rawVal === '' || rawVal === 'null') { result[key] = null; continue; }

    // Default: treat as string (covers ISO dates, plain text, colons in values)
    result[key] = rawVal;
  }
  return result;
}

/**
 * Split a raw `.md` file into frontmatter lines + body string.
 * If no valid frontmatter block is found, returns empty frontmatter and the
 * whole raw string as body.
 *
 * @param {string} raw
 * @returns {{ fmLines: string[], body: string }}
 */
function splitFrontmatter(raw) {
  const lines = raw.split('\n');

  // Require the file to start with '---'
  if (lines.length < 2 || lines[0].trim() !== FRONTMATTER_DELIMITER) {
    return { fmLines: [], body: raw };
  }

  // Scan for closing '---'
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    // No closing delimiter — treat as no frontmatter
    return { fmLines: [], body: raw };
  }

  const fmLines   = lines.slice(1, endIdx);
  const bodyLines = lines.slice(endIdx + 1);

  // Skip the single blank line we insert between '---' and body during render
  const body = (bodyLines.length > 0 && bodyLines[0] === '')
    ? bodyLines.slice(1).join('\n')
    : bodyLines.join('\n');

  return { fmLines, body };
}

// ---------------------------------------------------------------------------
// Public: page serialisation
// ---------------------------------------------------------------------------

/**
 * Render a Page entity to a `.md` file string (YAML frontmatter + body).
 *
 * Round-trip contract: `parsePage({ chapterSlug, pageSlug, raw: renderPage(page) })`
 * recovers every field losslessly including content containing `---` or `## `.
 *
 * The body is separated from the closing `---` by a single blank line.
 * splitFrontmatter() strips that blank line on parse, so the round-trip is exact.
 *
 * @param {{ title: string, author: string, pinned: boolean, createdAt: string, updatedAt: string, content: string, tags?: string[] }} page
 * @returns {string}
 */
function renderPage(page) {
  const lines = [
    FRONTMATTER_DELIMITER,
    `title: ${page.title ?? ''}`,
    `author: ${page.author ?? 'user'}`,
    `pinned: ${page.pinned ? 'true' : 'false'}`,
    `created: ${page.createdAt ?? ''}`,
    `updated: ${page.updatedAt ?? ''}`,
  ];

  if (Array.isArray(page.tags) && page.tags.length > 0) {
    lines.push(`tags: [${page.tags.join(', ')}]`);
  }

  // Closing delimiter + blank separator + body (body may itself contain '---' lines)
  lines.push(FRONTMATTER_DELIMITER, '', page.content ?? '');

  return lines.join('\n');
}

/**
 * Parse a raw `.md` file back into a partial Page record.
 * The caller (backend.js) provides `chapterSlug` and `pageSlug` from the
 * file path; this function fills in the frontmatter fields + content.
 *
 * Slug segments are validated against the shared grammar.  An invalid segment
 * throws a TypeError (caller decides how to handle).
 *
 * @param {{ chapterSlug: string, pageSlug: string, raw: string }} opts
 * @returns {{ title: string, content: string, author: string, pinned: boolean, createdAt: string, updatedAt: string, tags: string[] | undefined }}
 */
function parsePage({ chapterSlug, pageSlug, raw }) {
  // Validate slugs via shared grammar (throws TypeError on invalid)
  parseSlug(`${chapterSlug}/${pageSlug}`);

  const { fmLines, body } = splitFrontmatter(raw);
  const fm = parseYamlSubset(fmLines);

  const now = new Date().toISOString();

  return {
    title:     typeof fm.title === 'string'   ? fm.title     : titleCase(pageSlug),
    content:   body,
    author:    (fm.author === 'user' || fm.author === 'agent') ? fm.author : 'user',
    pinned:    Boolean(fm.pinned),
    createdAt: typeof fm.created === 'string' ? fm.created   : now,
    updatedAt: typeof fm.updated === 'string' ? fm.updated   : now,
    tags:      Array.isArray(fm.tags)         ? fm.tags      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public: folio.json manifest
// ---------------------------------------------------------------------------

/**
 * Read and parse a `folio.json` manifest from the given file path.
 * Returns a defaults object if the file is absent or malformed.
 *
 * @param {string} filePath  — absolute path to folio.json
 * @returns {{ name: string, formatVersion: string, createdAt: string, description?: string }}
 */
function readManifest(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      name:          parsed.name          ?? path.basename(path.dirname(filePath)),
      formatVersion: parsed.formatVersion ?? FORMAT_VERSION,
      createdAt:     parsed.createdAt     ?? new Date().toISOString(),
      description:   parsed.description  ?? undefined,
    };
  } catch (err) {
    // File absent or invalid JSON — return defaults
    return {
      name:          path.basename(path.dirname(filePath)),
      formatVersion: FORMAT_VERSION,
      createdAt:     new Date().toISOString(),
    };
  }
}

/**
 * Write a `folio.json` manifest atomically (tmp → rename).
 *
 * @param {string} filePath  — absolute path to folio.json
 * @param {{ name: string, formatVersion?: string, createdAt: string, description?: string }} manifest
 */
function writeManifest(filePath, manifest) {
  const toWrite = {
    name:          manifest.name,
    formatVersion: manifest.formatVersion ?? FORMAT_VERSION,
    createdAt:     manifest.createdAt,
  };
  if (manifest.description !== undefined) {
    toWrite.description = manifest.description;
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  renderPage,
  parsePage,
  readManifest,
  writeManifest,
  // Exported for testing
  parseYamlSubset,
  splitFrontmatter,
};
