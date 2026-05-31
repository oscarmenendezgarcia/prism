'use strict';

/**
 * Folio — Standard PKZIP Pack/Unpack (zip.js)
 *
 * Zero-dependency PKZIP implementation using Node.js built-in `zlib`:
 *   - packDir(srcDir)          → Buffer   (standard PKZIP archive)
 *   - unpackBuffer(buf, dest)  → void     (zip-slip-safe extraction)
 *
 * Format: PKZIP (same spec as .docx/.epub), DEFLATE (method 8) per entry,
 * with automatic fallback to STORE (method 0) for incompressible data.
 * Central directory + EOCD at the end for standard ZIP reader compatibility.
 *
 * Security: every entry path in unpackBuffer is asserted within destDir;
 * absolute paths and '..' segments are rejected before any write.
 *
 * Invariants:
 *  - No import outside Node.js built-ins.
 *  - No npm dependencies.
 *  - No import of anything outside src/services/folio/ at the module level.
 *    (This file is self-contained; used only from archive.js / index.js.)
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// CRC-32 (PKZIP standard, table-based — no npm dep)
// ---------------------------------------------------------------------------

/** Pre-computed CRC-32 lookup table (IEEE 802.3 polynomial). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c;
  }
  return t;
})();

/**
 * Compute CRC-32 of `buf`, optionally chaining a prior `initial` value.
 *
 * @param {Buffer|Uint8Array} buf
 * @param {number} [initial=0]  — prior CRC value for chaining
 * @returns {number}  unsigned 32-bit integer
 */
function crc32(buf, initial = 0) {
  let crc = initial ^ 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// DOS date/time encoding (ZIP stores timestamps in MS-DOS format)
// ---------------------------------------------------------------------------

/**
 * Convert a JS Date to the two 16-bit DOS date/time fields.
 *
 * @param {Date} date
 * @returns {{ dosDate: number, dosTime: number }}
 */
function toDosDateTime(date) {
  const dosDate =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);

  return { dosDate: dosDate >>> 0, dosTime: dosTime >>> 0 };
}

// ---------------------------------------------------------------------------
// ZIP constants
// ---------------------------------------------------------------------------

const SIG_LOCAL_FILE    = 0x04034B50;
const SIG_CENTRAL_DIR   = 0x02014B50;
const SIG_EOCD          = 0x06054B50;

const VERSION_MADE_BY   = 20; // ZIP spec 2.0
const VERSION_NEEDED    = 20;

const METHOD_STORE      = 0;
const METHOD_DEFLATE    = 8;

// ---------------------------------------------------------------------------
// Pack: srcDir → Buffer
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths under `dir`, returning paths relative
 * to `base` using forward-slash separators (POSIX convention in ZIP).
 *
 * @param {string} dir
 * @param {string} base
 * @returns {string[]}
 */
function collectFiles(dir, base) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw new Error(`Cannot read directory "${dir}": ${e.message}`);
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // Relative path — always forward-slash for ZIP entry names
    const rel  = path.relative(base, full).split(path.sep).join('/');

    if (entry.isDirectory()) {
      const sub = collectFiles(full, base);
      results.push(...sub);
    } else if (entry.isFile()) {
      results.push(rel);
    }
    // Symlinks are intentionally ignored (security)
  }
  return results;
}

/**
 * Write a little-endian 16-bit unsigned integer into `buf` at `offset`.
 *
 * @param {Buffer} buf
 * @param {number} value
 * @param {number} offset
 * @returns {number}  next offset
 */
function writeU16(buf, value, offset) {
  buf.writeUInt16LE(value >>> 0, offset);
  return offset + 2;
}

/**
 * Write a little-endian 32-bit unsigned integer into `buf` at `offset`.
 *
 * @param {Buffer} buf
 * @param {number} value
 * @param {number} offset
 * @returns {number}  next offset
 */
function writeU32(buf, value, offset) {
  buf.writeUInt32LE(value >>> 0, offset);
  return offset + 4;
}

/**
 * Pack a directory into a standard PKZIP archive.
 *
 * Compression: DEFLATE (method 8) per entry; STORE (method 0) if DEFLATE
 * output is larger than uncompressed size.
 *
 * @param {string} srcDir  — directory to pack
 * @returns {Buffer}       — standard PKZIP archive
 */
function packDir(srcDir) {
  const resolvedSrc = path.resolve(srcDir);
  const relFiles    = collectFiles(resolvedSrc, resolvedSrc);

  if (relFiles.length > 0xFFFF) {
    throw new RangeError(
      `ZIP archive supports at most 65535 entries (${relFiles.length} files found)`,
    );
  }

  const now           = new Date();
  const { dosDate, dosTime } = toDosDateTime(now);
  const localParts    = [];  // chunks: [localHeader, compData, ...]
  const centralDirs   = [];  // central directory entry buffers
  let   dataOffset    = 0;   // running byte offset into the archive

  for (const relPath of relFiles) {
    const absPath   = path.join(resolvedSrc, relPath);
    const rawData   = fs.readFileSync(absPath);
    const nameBytes = Buffer.from(relPath, 'utf8');

    // Attempt DEFLATE; fall back to STORE for incompressible data
    let compData = zlib.deflateRawSync(rawData, { level: 6 });
    let method   = METHOD_DEFLATE;
    if (compData.length >= rawData.length) {
      compData = rawData;
      method   = METHOD_STORE;
    }

    const checksum   = crc32(rawData);
    const compSize   = compData.length;
    const uncompSize = rawData.length;

    // ── Local file header (30 bytes + nameLen + extraLen) ──────────────────
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    let p = 0;
    p = writeU32(localHeader, SIG_LOCAL_FILE, p);
    p = writeU16(localHeader, VERSION_NEEDED, p);
    p = writeU16(localHeader, 0, p);                 // flags
    p = writeU16(localHeader, method, p);
    p = writeU16(localHeader, dosTime, p);
    p = writeU16(localHeader, dosDate, p);
    p = writeU32(localHeader, checksum, p);
    p = writeU32(localHeader, compSize, p);
    p = writeU32(localHeader, uncompSize, p);
    p = writeU16(localHeader, nameBytes.length, p);
    p = writeU16(localHeader, 0, p);                 // extra field length
    nameBytes.copy(localHeader, p);

    const localHeaderOffset = dataOffset;
    localParts.push(localHeader, compData);
    dataOffset += localHeader.length + compData.length;

    // ── Central directory entry (46 bytes + nameLen) ──────────────────────
    const central = Buffer.alloc(46 + nameBytes.length);
    let q = 0;
    q = writeU32(central, SIG_CENTRAL_DIR, q);
    q = writeU16(central, VERSION_MADE_BY, q);
    q = writeU16(central, VERSION_NEEDED, q);
    q = writeU16(central, 0, q);                     // flags
    q = writeU16(central, method, q);
    q = writeU16(central, dosTime, q);
    q = writeU16(central, dosDate, q);
    q = writeU32(central, checksum, q);
    q = writeU32(central, compSize, q);
    q = writeU32(central, uncompSize, q);
    q = writeU16(central, nameBytes.length, q);
    q = writeU16(central, 0, q);                     // extra field length
    q = writeU16(central, 0, q);                     // comment length
    q = writeU16(central, 0, q);                     // disk number start
    q = writeU16(central, 0, q);                     // internal attributes
    q = writeU32(central, 0, q);                     // external attributes
    q = writeU32(central, localHeaderOffset, q);     // local header offset
    nameBytes.copy(central, q);
    centralDirs.push(central);
  }

  const cdOffset  = dataOffset;
  const cdBuffer  = Buffer.concat(centralDirs);
  const cdSize    = cdBuffer.length;
  const numFiles  = relFiles.length;

  // ── End of Central Directory (22 bytes) ──────────────────────────────────
  const eocd = Buffer.alloc(22);
  let e = 0;
  e = writeU32(eocd, SIG_EOCD, e);
  e = writeU16(eocd, 0, e);                          // disk number
  e = writeU16(eocd, 0, e);                          // disk with central dir
  e = writeU16(eocd, numFiles, e);                   // entries on this disk
  e = writeU16(eocd, numFiles, e);                   // total entries
  e = writeU32(eocd, cdSize, e);                     // size of central dir
  e = writeU32(eocd, cdOffset, e);                   // offset of central dir
  writeU16(eocd, 0, e);                              // comment length

  return Buffer.concat([...localParts, cdBuffer, eocd]);
}

// ---------------------------------------------------------------------------
// Unpack: Buffer → destDir (zip-slip-safe)
// ---------------------------------------------------------------------------

/**
 * Assert that `resolvedPath` is within `rootDir`.
 * Throws RangeError on zip-slip / path-traversal detection.
 */
function assertWithinRoot(resolvedPath, rootDir) {
  const rel = path.relative(rootDir, resolvedPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RangeError(
      `Zip-slip detected: "${resolvedPath}" would escape root "${rootDir}"`,
    );
  }
}

/**
 * Find the End-of-Central-Directory signature, searching backwards from the
 * end of `buf` (supports up to 65535-byte ZIP comment).
 *
 * @param {Buffer} buf
 * @returns {number}  byte offset of EOCD, or -1 if not found
 */
function findEOCDOffset(buf) {
  // Minimum EOCD is at buf.length - 22; search backwards
  const earliest = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Unpack a PKZIP archive Buffer into destDir.
 *
 * - Reads from the central directory (authoritative).
 * - Local file headers are used only to find the data start offset.
 * - Zip-slip-safe: all entry paths are validated against destDir before write.
 * - Symlink entries (entries ending in `/`) are skipped.
 * - Only STORE (method 0) and DEFLATE (method 8) are supported.
 * - Each output file is written atomically (tmp → rename).
 *
 * @param {Buffer} buf
 * @param {string} destDir  — directory to extract into (created if absent)
 */
function unpackBuffer(buf, destDir) {
  const resolvedDest = path.resolve(destDir);
  fs.mkdirSync(resolvedDest, { recursive: true });

  // ── Locate EOCD ───────────────────────────────────────────────────────────
  const eocdOffset = findEOCDOffset(buf);
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP archive: EOCD signature not found');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset     = buf.readUInt32LE(eocdOffset + 16);

  // ── Parse central directory ───────────────────────────────────────────────
  let cdPos = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(cdPos) !== SIG_CENTRAL_DIR) {
      throw new Error(
        `Invalid ZIP: expected central directory signature at offset ${cdPos}`,
      );
    }

    const method       = buf.readUInt16LE(cdPos + 10);
    const checksum     = buf.readUInt32LE(cdPos + 16);
    const compSize     = buf.readUInt32LE(cdPos + 20);
    const uncompSize   = buf.readUInt32LE(cdPos + 24);
    const nameLen      = buf.readUInt16LE(cdPos + 28);
    const extraLen     = buf.readUInt16LE(cdPos + 30);
    const commentLen   = buf.readUInt16LE(cdPos + 32);
    const localOffset  = buf.readUInt32LE(cdPos + 42);
    const entryName    = buf.toString('utf8', cdPos + 46, cdPos + 46 + nameLen);

    cdPos += 46 + nameLen + extraLen + commentLen;

    // Skip directory entries
    if (entryName.endsWith('/')) continue;

    // ── Security: reject absolute paths and '..' segments ─────────────────
    if (path.isAbsolute(entryName)) {
      throw new RangeError(
        `Zip-slip (absolute path) in entry: "${entryName}"`,
      );
    }
    // Check every component — path.normalize converts `..` tricks
    const normalised = path.normalize(entryName);
    if (normalised.startsWith('..') || normalised.includes(`..${path.sep}`)) {
      throw new RangeError(
        `Zip-slip (traversal) in entry: "${entryName}"`,
      );
    }

    const destPath = path.resolve(resolvedDest, entryName);
    assertWithinRoot(destPath, resolvedDest);

    // ── Read local file header to determine data start ─────────────────────
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL_FILE) {
      throw new Error(
        `Invalid ZIP: expected local file header signature at offset ${localOffset}`,
      );
    }
    const localNameLen  = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart     = localOffset + 30 + localNameLen + localExtraLen;

    const compData = buf.subarray(dataStart, dataStart + compSize);

    // ── Decompress ────────────────────────────────────────────────────────
    let data;
    if (method === METHOD_STORE) {
      data = Buffer.from(compData); // copy so we own the buffer
    } else if (method === METHOD_DEFLATE) {
      data = zlib.inflateRawSync(compData);
    } else {
      throw new Error(
        `Unsupported compression method ${method} in entry "${entryName}"`,
      );
    }

    // ── Verify CRC ────────────────────────────────────────────────────────
    const actualCrc = crc32(data);
    if (actualCrc !== checksum) {
      throw new Error(
        `CRC mismatch in "${entryName}": expected 0x${checksum.toString(16).padStart(8, '0')}` +
        `, got 0x${actualCrc.toString(16).padStart(8, '0')}`,
      );
    }

    // ── Write atomically ──────────────────────────────────────────────────
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.tmp`;
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, destPath);
  }

  console.warn(
    `[folio.zip] op=unpack entries=${totalEntries} destDir=${resolvedDest} outcome=ok`,
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  packDir,
  unpackBuffer,
  // Exported for testing
  crc32,
  toDosDateTime,
  collectFiles,
};
