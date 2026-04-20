#!/usr/bin/env node
/**
 * check-design-invariants.mjs
 *
 * Enforces Prism design-system invariants across frontend component files.
 * Part of the lint gate defined in blueprint §7 (T-014).
 *
 * ── Rules ────────────────────────────────────────────────────────────────────
 *
 * 1. NO `style={{...}}` attributes in frontend/src/**
 *    Use Tailwind token utilities (bg-*, text-*, border-*, etc.) or
 *    arbitrary-value tokens (bg-[var(--color-x)]) instead.
 *
 * 2. NO raw hex color literals (#RGB / #RRGGBB / #RRGGBBAA) in TSX files.
 *    Route all colors through CSS custom-property tokens:
 *      ✓  bg-[var(--color-primary)]
 *      ✗  bg-[#7C6DFA]
 *
 * ── Exceptions ───────────────────────────────────────────────────────────────
 *
 * Add `// lint-ok: <reason>` on the SAME line as the violation to whitelist it.
 * Approved exception categories (blueprint §7, invariant 1):
 *   - CSS custom-property injection (`--panel-w`, etc.) — Tailwind cannot set
 *     runtime CSS vars at the element level.
 *   - Runtime-computed positions from getBoundingClientRect() — no static
 *     Tailwind equivalent.
 *   - font-variation-settings — no Tailwind utility available.
 *
 * ── Whitelist file ────────────────────────────────────────────────────────────
 *
 * For whole-file exceptions (rare), create frontend/scripts/.design-whitelist
 * with one relative path per line (relative to frontend/src):
 *
 *   # Example: third-party-wrapper that can't be changed
 *   vendor/SomeWidget.tsx
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   node frontend/scripts/check-design-invariants.mjs
 *
 * Exit codes:
 *   0  — all checks pass
 *   1  — one or more violations found (list printed to stderr)
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const SRC_DIR        = join(__dirname, '../src');
const WHITELIST_FILE = join(__dirname, '.design-whitelist');

// ── Patterns ──────────────────────────────────────────────────────────────────

/** Matches JSX inline-style attributes: style={{ */
const INLINE_STYLE_RE = /style=\{\{/;

/**
 * Matches raw hex literals that are NOT inside a CSS custom-property arbitrary
 * value (`var(--…)`).  Covers #RGB (3), #RRGGBB (6), #RRGGBBAA (8).
 *
 * Strategy: require the hash to be preceded by a quote, space, backtick, or
 * open-bracket (as in `bg-[#abc]`) so we don't catch things like id="abc123".
 */
const RAW_HEX_RE = /(?:["'`\[]|:\s*)#([0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/;

/** Marks a line as an approved exception. */
const LINT_OK_RE = /\/\/\s*lint-ok:/;

/** Lines that are pure source-code comments (not JSX comment nodes). */
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*)/;

// ── Whitelist ─────────────────────────────────────────────────────────────────

const whitelistedFiles = new Set();
if (existsSync(WHITELIST_FILE)) {
  readFileSync(WHITELIST_FILE, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .forEach(rel => whitelistedFiles.add(join(SRC_DIR, rel)));
}

// ── File walker ───────────────────────────────────────────────────────────────

function* walkTsx(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTsx(full);
    } else if (entry.isFile() && extname(full) === '.tsx') {
      yield full;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const violations = [];

for (const file of walkTsx(SRC_DIR)) {
  if (whitelistedFiles.has(file)) continue;

  const rel   = relative(SRC_DIR, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    // Skip pure code-comment lines — they often contain example snippets.
    if (COMMENT_LINE_RE.test(line)) return;

    // Any line carrying `// lint-ok:` is an approved exception.
    if (LINT_OK_RE.test(line)) return;

    if (INLINE_STYLE_RE.test(line)) {
      violations.push(
        `  src/${rel}:${lineNo}\n` +
        `    inline style={{}} — use Tailwind token utilities instead.\n` +
        `    Add // lint-ok: <reason> if this specific case is unavoidable.`,
      );
    }

    if (RAW_HEX_RE.test(line)) {
      violations.push(
        `  src/${rel}:${lineNo}\n` +
        `    raw hex color — replace with bg-[var(--color-x)] or a token utility.\n` +
        `    Add // lint-ok: <reason> if this specific case is unavoidable.`,
      );
    }
  });
}

if (violations.length > 0) {
  process.stderr.write(
    `\n✗  Design invariant violations (${violations.length}):\n\n` +
    violations.join('\n\n') +
    `\n\nSee blueprint §7 for full rules.\n\n`,
  );
  process.exit(1);
}

process.stdout.write('✓  Design invariants OK\n');
