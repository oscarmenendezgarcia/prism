'use strict';

/**
 * Folio Backend Validation (T-002 — folio-backend-selection)
 *
 * Validates the `folioBackend` field when a space is created or updated.
 *
 * Rules:
 *  - Unknown value → invalid "unknown backend".
 *  - 'file' without a workingDirectory → invalid "file backend requires a working directory".
 *  - Changing backend when a folio is already activated → invalid (immutable after activation).
 *  - NULL / undefined → default to 'sqlite'.
 *  - 'sqlite' always valid.
 *
 * Returns the project { valid, errors, data } tuple.
 */

const VALID_BACKENDS = new Set(['sqlite', 'file']);

/**
 * Validate the folioBackend setting for a space.
 *
 * @param {object} opts
 * @param {string|undefined} opts.folioBackend          - The requested backend value.
 * @param {string|undefined} opts.workingDirectory      - The space's working directory (if any).
 * @param {boolean}          [opts.existingFolioActivated=false] - Whether the space already has an activated folio.
 * @param {string|undefined} [opts.existingBackend]     - The space's current backend (for change-detection).
 * @returns {{ valid: boolean, errors: string[], data: { folioBackend: string } }}
 */
function validateFolioBackend({ folioBackend, workingDirectory, existingFolioActivated = false, existingBackend } = {}) {
  const errors = [];

  // Default NULL/undefined → 'sqlite'.
  const effective = folioBackend != null ? folioBackend : 'sqlite';

  if (!VALID_BACKENDS.has(effective)) {
    errors.push(`Unknown folio backend "${effective}". Valid values are: sqlite, file.`);
    return { valid: false, errors, data: { folioBackend: 'sqlite' } };
  }

  if (effective === 'file' && !workingDirectory) {
    errors.push('The file folio backend requires the space to have a working directory.');
    return { valid: false, errors, data: { folioBackend: 'sqlite' } };
  }

  // Immutable after activation: reject changing backend when a folio is already activated.
  if (
    existingFolioActivated &&
    existingBackend !== undefined &&
    existingBackend !== effective
  ) {
    errors.push(
      'Cannot change the folio backend after the folio has been activated. ' +
      'Use export/import to move content between backends.',
    );
    return { valid: false, errors, data: { folioBackend: existingBackend } };
  }

  return { valid: true, errors: [], data: { folioBackend: effective } };
}

module.exports = { validateFolioBackend };
