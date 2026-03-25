/**
 * Prism — SpaceManager
 *
 * ADR-1 (Spaces) §D1 — Directory-per-space data model.
 *
 * Provides CRUD operations for Space metadata stored in data/spaces.json.
 * Each space also owns a subdirectory under data/spaces/{id}/ containing
 * its three column JSON files.
 *
 * All writes to spaces.json use the atomic .tmp + rename pattern (ADR-002).
 * All public functions are synchronous — file I/O volumes are trivially
 * small (dozens of spaces at most).
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const COLUMN_NAMES     = ['todo', 'in-progress', 'done'];
const SPACE_NAME_MAX   = 100;

// ---------------------------------------------------------------------------
// Module factory — binds to a specific dataDir so tests can use temp dirs.
// ---------------------------------------------------------------------------

/**
 * Create a SpaceManager bound to the given data directory.
 *
 * @param {string} dataDir - Absolute path to the data directory.
 * @returns {SpaceManager}
 */
function createSpaceManager(dataDir) {
  const manifestPath = path.join(dataDir, 'spaces.json');
  const spacesDir    = path.join(dataDir, 'spaces');

  // -------------------------------------------------------------------------
  // Manifest I/O
  // -------------------------------------------------------------------------

  /** Read and parse spaces.json. Returns [] if the file does not exist. */
  function readManifest() {
    if (!fs.existsSync(manifestPath)) return [];
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  }

  /** Write spaces.json atomically. */
  function writeManifest(spaces) {
    const tmpPath = manifestPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(spaces, null, 2), 'utf8');
    fs.renameSync(tmpPath, manifestPath);
  }

  // -------------------------------------------------------------------------
  // Name validation helper
  // -------------------------------------------------------------------------

  /**
   * Validate a space name.
   * @param {string} rawName
   * @returns {{ valid: boolean, name: string, error?: string }}
   */
  function validateName(rawName) {
    if (typeof rawName !== 'string') {
      return { valid: false, name: '', error: 'Space name must be a string.' };
    }
    const name = rawName.trim();
    if (name.length === 0) {
      return { valid: false, name, error: 'Space name is required.' };
    }
    if (name.length > SPACE_NAME_MAX) {
      return {
        valid: false,
        name,
        error: `Space name must not exceed ${SPACE_NAME_MAX} characters.`,
      };
    }
    return { valid: true, name };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * List all spaces ordered by creation date ascending.
   * @returns {object[]}
   */
  function listSpaces() {
    return readManifest();
  }

  /**
   * Get a single space by ID.
   * @param {string} id
   * @returns {{ ok: true, space: object } | { ok: false, code: string, message: string }}
   */
  function getSpace(id) {
    const spaces = readManifest();
    const space  = spaces.find((s) => s.id === id);
    if (!space) {
      return {
        ok:      false,
        code:    'SPACE_NOT_FOUND',
        message: `No space with ID "${id}" was found.`,
      };
    }
    return { ok: true, space };
  }

  /**
   * Create a new space.
   *
   * @param {string}   name
   * @param {string}   [workingDirectory]
   * @param {string[]} [pipeline]
   * @param {string}   [_id] - Internal ID override. Used only by ensureAllSpaces()
   *   to guarantee a stable 'default' ID on fresh installs so that the legacy
   *   /api/v1/tasks/* shim keeps working (ADR-1 section D2 / BUG-001).
   *   Not exposed through the HTTP API.
   * @returns {{ ok: true, space: object } | { ok: false, code: string, message: string }}
   */
  function createSpace(name, workingDirectory, pipeline, projectClaudeMdPath, _id) {
    const validation = validateName(name);
    if (!validation.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', message: validation.error };
    }

    const spaces = readManifest();
    const normalised = validation.name.toLowerCase();

    if (spaces.some((s) => s.name.toLowerCase() === normalised)) {
      return {
        ok:      false,
        code:    'DUPLICATE_NAME',
        message: `A space named "${validation.name}" already exists.`,
      };
    }

    const now = new Date().toISOString();
    const space = {
      id:        _id || crypto.randomUUID(),
      name:      validation.name,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(Array.isArray(pipeline) && pipeline.length > 0 ? { pipeline } : {}),
      ...(projectClaudeMdPath && typeof projectClaudeMdPath === 'string' ? { projectClaudeMdPath } : {}),
      createdAt: now,
      updatedAt: now,
    };

    // Create the space directory with empty column files.
    const spaceDir = path.join(spacesDir, space.id);
    fs.mkdirSync(spaceDir, { recursive: true });
    for (const column of COLUMN_NAMES) {
      fs.writeFileSync(path.join(spaceDir, `${column}.json`), '[]', 'utf8');
    }

    spaces.push(space);
    writeManifest(spaces);

    console.log(`[spaceManager] Created space "${space.name}" (${space.id})`);
    return { ok: true, space };
  }

  /**
   * Rename a space.
   * @param {string} id
   * @param {string} newName
   * @returns {{ ok: true, space: object } | { ok: false, code: string, message: string }}
   */
  function renameSpace(id, newName, workingDirectory, pipeline, projectClaudeMdPath) {
    const validation = validateName(newName);
    if (!validation.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', message: validation.error };
    }

    const spaces = readManifest();
    const idx    = spaces.findIndex((s) => s.id === id);

    if (idx === -1) {
      return {
        ok:      false,
        code:    'SPACE_NOT_FOUND',
        message: `No space with ID "${id}" was found.`,
      };
    }

    const normalised = validation.name.toLowerCase();
    const duplicate  = spaces.find(
      (s, i) => i !== idx && s.name.toLowerCase() === normalised
    );
    if (duplicate) {
      return {
        ok:      false,
        code:    'DUPLICATE_NAME',
        message: `A space named "${validation.name}" already exists.`,
      };
    }

    spaces[idx] = {
      ...spaces[idx],
      name:      validation.name,
      updatedAt: new Date().toISOString(),
      // workingDirectory: empty string clears it, undefined leaves it unchanged
      ...(workingDirectory !== undefined ? { workingDirectory: workingDirectory || undefined } : {}),
      // pipeline: empty array clears it, undefined leaves it unchanged
      ...(pipeline !== undefined
        ? { pipeline: (Array.isArray(pipeline) && pipeline.length > 0) ? pipeline : undefined }
        : {}),
      // projectClaudeMdPath: empty string clears it, undefined leaves it unchanged
      ...(projectClaudeMdPath !== undefined
        ? { projectClaudeMdPath: projectClaudeMdPath || undefined }
        : {}),
    };

    writeManifest(spaces);

    console.log(`[spaceManager] Renamed space ${id} → "${validation.name}"`);
    return { ok: true, space: spaces[idx] };
  }

  /**
   * Delete a space and remove its directory from disk.
   * Refuses to delete the last remaining space (LAST_SPACE).
   *
   * @param {string} id
   * @returns {{ ok: true, id: string } | { ok: false, code: string, message: string }}
   */
  function deleteSpace(id) {
    const spaces = readManifest();

    const idx = spaces.findIndex((s) => s.id === id);
    if (idx === -1) {
      return {
        ok:      false,
        code:    'SPACE_NOT_FOUND',
        message: `No space with ID "${id}" was found.`,
      };
    }

    if (spaces.length <= 1) {
      return {
        ok:      false,
        code:    'LAST_SPACE',
        message: 'Cannot delete the only remaining space.',
      };
    }

    // Remove the space directory.
    const spaceDir = path.join(spacesDir, id);
    if (fs.existsSync(spaceDir)) {
      fs.rmSync(spaceDir, { recursive: true, force: true });
    }

    spaces.splice(idx, 1);
    writeManifest(spaces);

    console.log(`[spaceManager] Deleted space ${id}`);
    return { ok: true, id };
  }

  /**
   * Ensure all spaces in the manifest have their directory and column files.
   * Creates any missing files. Logs warnings for orphaned directories.
   * On a fresh install (empty manifest), bootstraps a default "General" space.
   */
  function ensureAllSpaces() {
    const spaces = readManifest();

    if (spaces.length === 0) {
      // ADR-1 section D2 / BUG-001: The legacy /api/v1/tasks/* shim routes to
      // spaceId='default'. On a fresh install the first space MUST carry the
      // literal id 'default' so both the shim and test helpers work correctly.
      console.log('[spaceManager] No spaces found — creating default General space (id: default)');
      createSpace('General', undefined, undefined, undefined, 'default');
      return;
    }

    for (const space of spaces) {
      const spaceDir = path.join(spacesDir, space.id);
      if (!fs.existsSync(spaceDir)) {
        console.warn(`[spaceManager] WARN: space directory missing for "${space.name}" (${space.id}) — recreating`);
        fs.mkdirSync(spaceDir, { recursive: true });
      }
      for (const column of COLUMN_NAMES) {
        const filePath = path.join(spaceDir, `${column}.json`);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, '[]', 'utf8');
          console.warn(`[spaceManager] WARN: recreated missing column file ${filePath}`);
        }
      }
    }
  }

  return {
    listSpaces,
    getSpace,
    createSpace,
    renameSpace,
    deleteSpace,
    ensureAllSpaces,
    /** Expose manifest path for testing. */
    get manifestPath() { return manifestPath; },
    /** Expose spaces directory for testing. */
    get spacesDir() { return spacesDir; },
  };
}

module.exports = { createSpaceManager };
