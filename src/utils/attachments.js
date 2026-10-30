'use strict';

/**
 * Prism — which files on the server an attachment may stand for.
 */

const fs   = require('fs');
const path = require('path');

/** What a repository holds that is not for everyone who can read its issues. */
const PRIVATE_IN_REPO = (relative) => relative.split(path.sep).some((part) => part === '.git' || part.startsWith('.env'));

/**
 * Whether a file attachment may be read: it really is in the folder of the space, once links
 * are followed, so that it cannot read anything else on the server. Prism's own data stays
 * out even if it lives in there, as it does when Prism runs from a checkout.
 *
 * @param {string} file
 * @param {string|undefined|null} folder
 * @param {string} [dataDir]
 * @returns {boolean}
 */
function isReadableAttachment(file, folder, dataDir) {
  if (!folder) return false;
  try {
    const root = fs.realpathSync(folder);
    const data = dataDir && dataDir !== ':memory:' ? fs.realpathSync(dataDir) : null;
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
      // Not there. Say so only for a path inside, or this would tell what exists elsewhere.
      real = path.resolve(file);
    }
    if (!real.startsWith(root + path.sep)) return false;
    if (data && (real === data || real.startsWith(data + path.sep))) return false;
    return !PRIVATE_IN_REPO(path.relative(root, real));
  } catch {
    return false;
  }
}

module.exports = { isReadableAttachment };
