'use strict';

/**
 * Folio — Core SQLite DDL
 *
 * Defines and applies the space-agnostic core schema for the Folio knowledge
 * base: folios, chapters, pages (with denormalized folio_id + chapter_slug),
 * pages_fts (FTS5 external-content), and attachments.
 *
 * Key design invariants:
 *  - This file is space-agnostic: the binding table lives in folioBinding.js.
 *  - This file imports NOTHING outside src/services/folio/.
 *  - applySchema(db) is idempotent — safe to call on every startup.
 *
 * Usage:
 *   const { applySchema } = require('./db');  // no-op import shown in folioBinding
 *   applySchema(db);  // db = better-sqlite3 Database instance
 */

// ---------------------------------------------------------------------------
// Core schema SQL (space-agnostic)
// ---------------------------------------------------------------------------

const CORE_SCHEMA_SQL = `
-- ===== CORE (extractable, space-agnostic) ===================================

CREATE TABLE IF NOT EXISTS folios (
  id          TEXT PRIMARY KEY,           -- crypto.randomUUID()
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL               -- ISO-8601 UTC
);

CREATE TABLE IF NOT EXISTS chapters (
  id          TEXT PRIMARY KEY,
  folio_id    TEXT NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  slug        TEXT NOT NULL,              -- [a-z0-9]+(-[a-z0-9]+)*, emergent from page slug
  position    INTEGER NOT NULL,           -- 0-based insertion order within folio
  created_at  TEXT NOT NULL,
  UNIQUE (folio_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_chapters_folio ON chapters(folio_id, position);

CREATE TABLE IF NOT EXISTS pages (
  id           TEXT PRIMARY KEY,
  chapter_id   TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  folio_id     TEXT NOT NULL,             -- denormalized: enables UNIQUE + O(1) ref lookup
  chapter_slug TEXT NOT NULL,             -- denormalized from chapters.slug
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL,             -- page slug, [a-z0-9]+(-[a-z0-9]+)*
  content      TEXT NOT NULL DEFAULT '',  -- markdown
  author       TEXT NOT NULL CHECK (author IN ('user', 'agent')),
  pinned       INTEGER NOT NULL DEFAULT 0,-- boolean 0/1; boost, NOT unconditional inject
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (folio_id, chapter_slug, slug)   -- per-folio global slug uniqueness
);

CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(chapter_id);
CREATE INDEX IF NOT EXISTS idx_pages_folio   ON pages(folio_id, pinned);
-- The UNIQUE(folio_id, chapter_slug, slug) constraint also serves as a
-- covering index for [[chapter/page]] reference resolution.

-- Full-text search (external-content mode, mirrors tasks_fts pattern).
-- Uses pages' implicit integer rowid as content_rowid; pages.id stays TEXT UUID.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  title,
  content,
  content='pages',
  content_rowid='rowid'
);

-- Triggers keep pages_fts in sync with pages (insert / delete / update).
-- Pattern is identical to the audited tasks_fts triggers.
CREATE TRIGGER IF NOT EXISTS pages_fts_insert AFTER INSERT ON pages BEGIN
  INSERT INTO pages_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_delete AFTER DELETE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS pages_fts_update AFTER UPDATE ON pages BEGIN
  INSERT INTO pages_fts(pages_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO pages_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
END;

CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  data        BLOB NOT NULL,              -- only for files NOT tracked in the repo
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_page ON attachments(page_id);
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply the Folio core schema to an already-open better-sqlite3 Database.
 *
 * Idempotent: uses CREATE ... IF NOT EXISTS throughout, so it is safe to
 * call on every application startup.
 *
 * @param {import('better-sqlite3').Database} db
 */
function applySchema(db) {
  db.exec(CORE_SCHEMA_SQL);
}

module.exports = { applySchema };
