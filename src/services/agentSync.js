'use strict';

/**
 * agentSync — SHA-256 manifest-based safe sync of Prism agent files.
 *
 * Syncs <packageRoot>/agents/*.md → <agentsDir>/ on every server startup.
 * Never overwrites files the user has customised (detected via manifest divergence).
 *
 * Manifest: <agentsDir>/.prism-manifest.json
 *   Records the SHA-256 hash of every agent file as last written by Prism.
 *   If the destination's current hash matches the manifest hash → Prism owns it.
 *   If they differ → user has edited it → skip.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const MANIFEST_VERSION  = '1.0';
const MANIFEST_FILENAME = '.prism-manifest.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a Buffer or string.
 * @param {Buffer|string} content
 * @returns {string}
 */
function computeHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Read and parse .prism-manifest.json from agentsDir.
 * Returns an empty manifest structure on any error (missing file, malformed JSON).
 *
 * @param {string} agentsDir
 * @param {Function} [log]
 * @returns {{ version: string, managed: Object.<string, { hash: string, prismVersion: string, syncedAt: string }> }}
 */
function readManifest(agentsDir, log) {
  const manifestPath = path.join(agentsDir, MANIFEST_FILENAME);
  const empty = { version: MANIFEST_VERSION, managed: {} };

  if (!fs.existsSync(manifestPath)) {
    return empty;
  }

  try {
    const raw = fs.readFileSync(manifestPath, 'utf8').trim();
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    // Basic shape validation — tolerate missing fields
    if (!parsed || typeof parsed !== 'object' || !parsed.managed) {
      if (log) log('[agent-sync] WARNING — manifest is malformed; treating as empty');
      return empty;
    }
    return parsed;
  } catch {
    if (log) log('[agent-sync] WARNING — manifest JSON parse error; treating as empty');
    return empty;
  }
}

/**
 * Write the manifest atomically (.tmp → rename).
 * Only writes if `changed` is true.
 *
 * @param {string} agentsDir
 * @param {{ version: string, managed: object }} manifest
 */
function writeManifest(agentsDir, manifest) {
  const manifestPath = path.join(agentsDir, MANIFEST_FILENAME);
  const tmp          = manifestPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, manifestPath);
}

// ---------------------------------------------------------------------------
// syncAgents
// ---------------------------------------------------------------------------

/**
 * Sync Prism-managed agent files from <packageRoot>/agents/ to <agentsDir>.
 *
 * Algorithm per file:
 *   Case 1 — dest missing:                 copy, write manifest entry
 *   Case 2 — dest exists + manifest entry:
 *     2a: dest == manifest == src  → noChange (no disk write)
 *     2b: dest == manifest != src  → update (Prism has newer version)
 *     2c: dest != manifest          → skip (user modified)
 *   Case 3 — dest exists, no manifest entry (migration / first run):
 *     3a: src == dest → noChange, write manifest entry
 *     3b: src != dest → update with migration-bias, write manifest entry
 *
 * @param {object}   opts
 * @param {string}   opts.packageRoot    - absolute path to Prism package root
 * @param {string}   opts.agentsDir      - destination directory (PIPELINE_AGENTS_DIR)
 * @param {string}   [opts.prismVersion] - current Prism version (from package.json)
 * @param {Function} [opts.log]          - logger, signature (msg: string) => void
 * @returns {{ synced: string[], skipped: string[], noChange: string[], errors: string[] }}
 */
function syncAgents({ packageRoot, agentsDir, prismVersion = 'unknown', log = () => {} }) {
  const result = { synced: [], skipped: [], noChange: [], errors: [] };

  const srcDir = path.join(packageRoot, 'agents');

  // Tolerate missing agents/ directory
  if (!fs.existsSync(srcDir)) {
    return result;
  }

  // Ensure destination directory exists
  fs.mkdirSync(agentsDir, { recursive: true });

  // Read manifest once at the start
  const manifest = readManifest(agentsDir, log);
  let manifestDirty = false;

  // List all agent files from the source
  let files;
  try {
    files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
  } catch (err) {
    log(`[agent-sync] ERROR — cannot read agents/ source dir: ${err.message}`);
    result.errors.push('agents/');
    return result;
  }

  for (const filename of files) {
    try {
      const srcPath  = path.join(srcDir, filename);
      const destPath = path.join(agentsDir, filename);

      const srcContent = fs.readFileSync(srcPath);
      const srcHash    = computeHash(srcContent);

      const destExists     = fs.existsSync(destPath);
      const manifestEntry  = manifest.managed[filename];
      const now            = new Date().toISOString();

      if (!destExists) {
        // Case 1: destination does not exist — install
        fs.writeFileSync(destPath, srcContent);
        manifest.managed[filename] = { hash: srcHash, prismVersion, syncedAt: now };
        manifestDirty = true;
        result.synced.push(filename);
        log(`[agent-sync] installed: ${filename}`);

      } else if (manifestEntry) {
        // Case 2: destination exists and we have a manifest entry
        const destContent  = fs.readFileSync(destPath);
        const destHash     = computeHash(destContent);
        const manifestHash = manifestEntry.hash;

        if (destHash === manifestHash) {
          // Prism's last write is still intact
          if (srcHash === destHash) {
            // Case 2a: source, dest, and manifest all agree → no-op
            result.noChange.push(filename);
          } else {
            // Case 2b: Prism has a newer version → update
            const oldVersion = manifestEntry.prismVersion || 'unknown';
            fs.writeFileSync(destPath, srcContent);
            manifest.managed[filename] = { hash: srcHash, prismVersion, syncedAt: now };
            manifestDirty = true;
            result.synced.push(filename);
            log(`[agent-sync] updated: ${filename} (prism v${oldVersion} → v${prismVersion})`);
          }
        } else {
          // Case 2c: user has modified the destination → skip
          result.skipped.push(filename);
          log(`[agent-sync] skipped (user-modified): ${filename}`);
        }

      } else {
        // Case 3: destination exists but no manifest entry (migration / first run)
        const destContent = fs.readFileSync(destPath);
        const destHash    = computeHash(destContent);

        if (srcHash === destHash) {
          // Case 3a: already identical → just baseline the manifest
          manifest.managed[filename] = { hash: srcHash, prismVersion, syncedAt: now };
          manifestDirty = true;
          result.noChange.push(filename);
        } else {
          // Case 3b: migration bias — update once, establish manifest baseline
          fs.writeFileSync(destPath, srcContent);
          manifest.managed[filename] = { hash: srcHash, prismVersion, syncedAt: now };
          manifestDirty = true;
          result.synced.push(filename);
          log(`[agent-sync] first-sync updated: ${filename} (no prior baseline)`);
        }
      }
    } catch (err) {
      log(`[agent-sync] ERROR — ${filename}: ${err.message}`);
      result.errors.push(filename);
    }
  }

  // Write manifest atomically only if something changed
  if (manifestDirty) {
    try {
      writeManifest(agentsDir, manifest);
    } catch (err) {
      log(`[agent-sync] ERROR — failed to write manifest: ${err.message}`);
    }
  }

  return result;
}

module.exports = { syncAgents, readManifest, writeManifest, computeHash };
