'use strict';

/**
 * Shared constants used across multiple server modules.
 */

/** What a status can mean. Dependencies, reports and agents read this, not its name. */
const CATEGORIES = ['todo', 'in-progress', 'done'];

module.exports = { CATEGORIES };
