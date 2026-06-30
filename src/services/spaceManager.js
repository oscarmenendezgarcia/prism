'use strict';

/**
 * Prism — SpaceManager (SQLite-backed)
 *
 * Provides CRUD operations for Space records stored in the SQLite DB via the
 * Store interface. The public API is identical to the previous JSON-backed
 * version so all callers (server.js, routes/index.js, tests) require no changes.
 *
 * Accepts either:
 *   createSpaceManager(store)    — new call style (server.js passes a Store instance)
 *   createSpaceManager(dataDir)  — legacy call style (existing unit tests pass a string)
 *
 * When a string is passed, a Store is created against that dataDir so the
 * existing tests continue to work without modification.
 */

const crypto = require('crypto');
const { createStore } = require('./store');
const { validateFolioBackend } = require('./folioValidation');
const { validateStageModelsMap } = require('./modelConfigResolver');

const SPACE_NAME_MAX      = 100;
const NICKNAME_VALUE_MAX  = 50;

// ---------------------------------------------------------------------------
// Module factory — binds to a Store instance so tests can use in-memory DBs.
// ---------------------------------------------------------------------------

/**
 * Create a SpaceManager bound to the given Store (or data directory).
 *
 * @param {import('./store').Store | string} storeOrDataDir
 * @returns {SpaceManager}
 */
function createSpaceManager(storeOrDataDir) {
  // Accept a dataDir string for backward compatibility with existing tests.
  // When a string is passed, open (or create) a SQLite store for that directory.
  const store = typeof storeOrDataDir === 'string'
    ? createStore(storeOrDataDir)
    : storeOrDataDir;
  // -------------------------------------------------------------------------
  // Name validation helpers
  // -------------------------------------------------------------------------

  /**
   * Validate and normalise an agentNicknames map.
   */
  function normaliseNicknames(raw) {
    if (raw === undefined || raw === null) {
      return { ok: true, nicknames: {} };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'agentNicknames must be an object.' };
    }
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value !== 'string') {
        return { ok: false, code: 'VALIDATION_ERROR', message: `Nickname for "${key}" must be a string.` };
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > NICKNAME_VALUE_MAX) {
        return {
          ok:      false,
          code:    'VALIDATION_ERROR',
          message: `Nickname for "${key}" must not exceed ${NICKNAME_VALUE_MAX} characters.`,
        };
      }
      result[key] = trimmed;
    }
    return { ok: true, nicknames: result };
  }

  /**
   * Validate a space name.
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
   */
  function listSpaces() {
    return store.listSpaces();
  }

  /**
   * Get a single space by ID.
   */
  function getSpace(id) {
    const space = store.getSpace(id);
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
   */
  function createSpace(name, workingDirectory, pipeline, projectClaudeMdPath, _id, folioBackend) {
    const validation = validateName(name);
    if (!validation.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', message: validation.error };
    }

    const spaces    = store.listSpaces();
    const normalised = validation.name.toLowerCase();

    if (spaces.some((s) => s.name.toLowerCase() === normalised)) {
      return {
        ok:      false,
        code:    'DUPLICATE_NAME',
        message: `A space named "${validation.name}" already exists.`,
      };
    }

    // Default repo-backed spaces to the file backend: the .folio/ directory
    // travels with the repo (git = sync) and matches where the standalone MCP
    // server and pipeline write-back operate, so UI + MCP + git stay in sync.
    // Spaces without a working directory stay on sqlite. Explicit value wins.
    const resolvedBackend = folioBackend != null
      ? folioBackend
      : (workingDirectory ? 'file' : 'sqlite');

    // Validate folioBackend setting.
    const folioValidation = validateFolioBackend({ folioBackend: resolvedBackend, workingDirectory });
    if (!folioValidation.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', message: folioValidation.errors[0] };
    }
    const effectiveBackend = folioValidation.data.folioBackend;

    const now = new Date().toISOString();
    const space = {
      id:        _id || crypto.randomUUID(),
      name:      validation.name,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(Array.isArray(pipeline) && pipeline.length > 0 ? { pipeline } : {}),
      ...(projectClaudeMdPath && typeof projectClaudeMdPath === 'string'
        ? { projectClaudeMdPath }
        : {}),
      // Only store folioBackend when it's non-default (omit 'sqlite' to keep payload small).
      ...(effectiveBackend !== 'sqlite' ? { folioBackend: effectiveBackend } : {}),
      createdAt: now,
      updatedAt: now,
    };

    store.upsertSpace(space);

    console.log(`[spaceManager] Created space "${space.name}" (${space.id})`);
    return { ok: true, space };
  }

  /**
   * Rename a space (also updates optional fields).
   *
   * @param {string}  id                - Space ID.
   * @param {string|null|undefined} newName - New display name. When null/undefined/'',
   *   falls back to the existing name so callers can do pin-only updates without
   *   providing a name. (partial PUT support.)
   * @param {string}  [workingDirectory]
   * @param {string[]} [pipeline]
   * @param {string}  [projectClaudeMdPath]
   * @param {object}  [agentNicknames]
   * @param {string}  [folioBackend]
   * @param {boolean} [pinned]           - Pin/unpin the space.
   * @param {number|null} [pinnedRank]   - Rank within the pinned zone.
   */
  function renameSpace(id, newName, workingDirectory, pipeline, projectClaudeMdPath, agentNicknames, folioBackend, pinned, pinnedRank, stageModels) {
    const existing = store.getSpace(id);
    if (!existing) {
      return {
        ok:      false,
        code:    'SPACE_NOT_FOUND',
        message: `No space with ID "${id}" was found.`,
      };
    }

    // `name` is optional: fall back to the existing name when not supplied (null/undefined).
    // An explicit empty string is still a validation error — callers who want a pin-only
    // update should omit the name field entirely (the route passes undefined in that case).
    const nameToUse = (newName != null) ? newName : existing.name;

    const validation = validateName(nameToUse);
    if (!validation.valid) {
      return { ok: false, code: 'VALIDATION_ERROR', message: validation.error };
    }

    const normalised = validation.name.toLowerCase();
    const duplicate  = store.listSpaces().find(
      (s) => s.id !== id && s.name.toLowerCase() === normalised
    );
    if (duplicate) {
      return {
        ok:      false,
        code:    'DUPLICATE_NAME',
        message: `A space named "${validation.name}" already exists.`,
      };
    }

    let normalisedNicknames;
    if (agentNicknames !== undefined) {
      const nickResult = normaliseNicknames(agentNicknames);
      if (!nickResult.ok) return nickResult;
      normalisedNicknames = nickResult.nicknames;
    }

    // MODEL-1: validate stageModels if provided (null clears all; object sets per-agent).
    if (stageModels !== undefined) {
      const { valid, error } = validateStageModelsMap(stageModels);
      if (!valid) {
        return { ok: false, code: 'VALIDATION_ERROR', message: error };
      }
    }

    // Validate folioBackend if provided.
    let resolvedFolioBackend;
    if (folioBackend !== undefined) {
      // Determine effective working directory for validation.
      const effectiveWd = workingDirectory !== undefined
        ? (workingDirectory || undefined)
        : existing.workingDirectory;

      // Check if a folio is already activated for this space (immutable-after-activation rule).
      // We reach into store.folio.binding lazily — if it's not available (e.g. tests), we skip.
      let existingFolioActivated = false;
      if (store.folio && store.folio.binding) {
        try {
          existingFolioActivated = store.folio.binding.hasFolio(id);
        } catch (_) {
          // defensive — never block a rename due to folio check failure
        }
      }

      const folioValidation = validateFolioBackend({
        folioBackend,
        workingDirectory:       effectiveWd,
        existingFolioActivated,
        existingBackend:        existing.folioBackend,
      });
      if (!folioValidation.valid) {
        return { ok: false, code: 'VALIDATION_ERROR', message: folioValidation.errors[0] };
      }
      resolvedFolioBackend = folioValidation.data.folioBackend;
    } else if (
      workingDirectory && !existing.workingDirectory && existing.folioBackend == null &&
      store.folio && store.folio.binding
    ) {
      // Working directory newly added to a repo-less space: apply the same
      // default as createSpace (repo → file) so UI + MCP + git share one .folio/.
      // Only when the folio is NOT yet activated — flipping would otherwise orphan
      // existing sqlite content (a real migration must move it first, then delete).
      // Fail-safe: if we cannot confirm it's empty, do NOT flip (stay on sqlite).
      let activated = true;
      try { activated = store.folio.binding.hasFolio(id); } catch (_) { activated = true; }
      if (!activated) resolvedFolioBackend = 'file';
    }

    const updated = {
      ...existing,
      name:      validation.name,
      updatedAt: new Date().toISOString(),
      ...(workingDirectory !== undefined
        ? { workingDirectory: workingDirectory || undefined }
        : {}),
      ...(pipeline !== undefined
        ? { pipeline: (Array.isArray(pipeline) && pipeline.length > 0) ? pipeline : undefined }
        : {}),
      ...(projectClaudeMdPath !== undefined
        ? { projectClaudeMdPath: projectClaudeMdPath || undefined }
        : {}),
      ...(normalisedNicknames !== undefined
        ? {
            agentNicknames:
              Object.keys(normalisedNicknames).length > 0 ? normalisedNicknames : undefined,
          }
        : {}),
      // Only update folioBackend when it was explicitly provided.
      ...(resolvedFolioBackend !== undefined
        ? { folioBackend: resolvedFolioBackend !== 'sqlite' ? resolvedFolioBackend : undefined }
        : {}),
      // MODEL-1: only update stageModels when explicitly provided.
      ...(stageModels !== undefined
        ? { stageModels }
        : {}),
      // pin/rank fields — only update when explicitly provided.
      ...(pinned !== undefined ? { pinned } : {}),
      ...(pinnedRank !== undefined ? { pinnedRank: pinnedRank ?? undefined } : {}),
    };

    // Remove undefined keys to keep DB storage clean.
    for (const key of Object.keys(updated)) {
      if (updated[key] === undefined) delete updated[key];
    }

    store.upsertSpace(updated);

    console.log(`[spaceManager] Renamed space ${id} → "${validation.name}"`);
    return { ok: true, space: updated };
  }

  /**
   * Delete a space. Refuses to delete the last remaining space.
   * Task cascade is handled by the DB (ON DELETE CASCADE).
   */
  function deleteSpace(id) {
    const spaces = store.listSpaces();

    if (!spaces.find((s) => s.id === id)) {
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

    store.deleteSpace(id);

    console.log(`[spaceManager] Deleted space ${id}`);
    return { ok: true, id };
  }

  /**
   * Ensure at least one space exists. On a fresh install, bootstraps a
   * default "General" space with the stable id 'default' (legacy shim).
   */
  function ensureAllSpaces() {
    const spaces = store.listSpaces();
    if (spaces.length === 0) {
      console.log('[spaceManager] No spaces found — creating default General space (id: default)');
      createSpace('General', undefined, undefined, undefined, 'default');
    }
    // No directory checks needed — DB schema handles integrity.
  }

  return {
    listSpaces,
    getSpace,
    createSpace,
    renameSpace,
    deleteSpace,
    ensureAllSpaces,
    normaliseNicknames,
    // Retain these properties so existing tests that read them don't break.
    // They are intentionally no-op/dummy values since we no longer use the FS.
    get manifestPath() { return null; },
    get spacesDir()    { return null; },
  };
}

module.exports = { createSpaceManager };
