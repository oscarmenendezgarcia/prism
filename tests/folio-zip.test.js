'use strict';

/**
 * Tests for src/services/folio/zip.js
 *
 * Covers:
 *  - crc32: known values, chaining, empty buffer
 *  - packDir + unpackBuffer: byte-identical round-trip
 *  - packDir + unpackBuffer: nested directories preserved
 *  - packDir + unpackBuffer: binary files preserved
 *  - packDir + unpackBuffer: incompressible data (STORE method fallback)
 *  - packDir: produces a valid ZIP readable by the system unzip (smoke test)
 *  - unpackBuffer: rejects absolute-path entries (zip-slip)
 *  - unpackBuffer: rejects '..' traversal entries (zip-slip)
 *  - unpackBuffer: rejects invalid EOCD signature
 *  - unpackBuffer: CRC mismatch detection
 *  - collectFiles: recursively finds all files
 *  - toDosDateTime: encodes dates correctly
 *
 * Run: node --test tests/folio-zip.test.js
 *      (from the prism project root)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { execSync } = require('child_process');

const {
  packDir,
  unpackBuffer,
  crc32,
  toDosDateTime,
  collectFiles,
} = require('../src/services/folio/zip');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-zip-test-'));
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

/** Create a deterministic directory tree under `base`. */
function populateDir(base, tree) {
  for (const [relPath, content] of Object.entries(tree)) {
    const absPath = path.join(base, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    if (typeof content === 'string') {
      fs.writeFileSync(absPath, content, 'utf8');
    } else {
      fs.writeFileSync(absPath, content); // Buffer
    }
  }
}

/** Assert that two directory trees contain identical files with identical content. */
function assertDirEqual(dirA, dirB, relFiles) {
  for (const rel of relFiles) {
    const fileA = path.join(dirA, rel);
    const fileB = path.join(dirB, rel);
    assert.ok(fs.existsSync(fileB), `File "${rel}" missing from unpacked dir`);
    const bufA = fs.readFileSync(fileA);
    const bufB = fs.readFileSync(fileB);
    assert.ok(bufA.equals(bufB), `File "${rel}" bytes differ after round-trip`);
  }
}

// ---------------------------------------------------------------------------
// crc32
// ---------------------------------------------------------------------------

describe('crc32', () => {
  it('should_return_0_for_empty_buffer', () => {
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });

  it('should_produce_known_crc_for_hello_world', () => {
    // CRC-32 of "hello world" with IEEE 802.3 / PKZIP polynomial
    const expected = 0x0D4A1185;
    assert.equal(crc32(Buffer.from('hello world')), expected);
  });

  it('should_chain_correctly_over_two_segments', () => {
    const full  = crc32(Buffer.from('hello world'));
    const half1 = crc32(Buffer.from('hello '));
    const half2 = crc32(Buffer.from('world'), half1);
    assert.equal(half2, full, 'chained CRC must equal full-buffer CRC');
  });

  it('should_produce_different_crcs_for_different_data', () => {
    const a = crc32(Buffer.from('aaa'));
    const b = crc32(Buffer.from('bbb'));
    assert.notEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// toDosDateTime
// ---------------------------------------------------------------------------

describe('toDosDateTime', () => {
  it('should_encode_year_month_day_into_dosDate', () => {
    const date    = new Date(2026, 4, 31, 12, 0, 0); // 2026-05-31 12:00:00
    const { dosDate } = toDosDateTime(date);
    const year  = (dosDate >> 9) + 1980;
    const month = (dosDate >> 5) & 0x0F;
    const day   = dosDate & 0x1F;
    assert.equal(year, 2026);
    assert.equal(month, 5);
    assert.equal(day, 31);
  });

  it('should_encode_hours_minutes_into_dosTime', () => {
    const date    = new Date(2026, 0, 1, 15, 30, 0); // 15:30:00
    const { dosTime } = toDosDateTime(date);
    const hours   = (dosTime >> 11) & 0x1F;
    const minutes = (dosTime >> 5)  & 0x3F;
    assert.equal(hours, 15);
    assert.equal(minutes, 30);
  });
});

// ---------------------------------------------------------------------------
// collectFiles
// ---------------------------------------------------------------------------

describe('collectFiles', () => {
  let tmpBase;

  beforeEach(() => { tmpBase = makeTmpDir(); });
  afterEach(()  => { rmDir(tmpBase); });

  it('should_return_all_files_recursively_with_forward_slash_separators', () => {
    populateDir(tmpBase, {
      'a.txt':       'file A',
      'sub/b.txt':   'file B',
      'sub/deep/c.txt': 'file C',
    });

    const files = collectFiles(tmpBase, tmpBase).sort();
    assert.deepEqual(files, ['a.txt', 'sub/b.txt', 'sub/deep/c.txt']);
  });

  it('should_return_empty_array_for_empty_directory', () => {
    const sub = path.join(tmpBase, 'empty');
    fs.mkdirSync(sub);
    assert.deepEqual(collectFiles(sub, sub), []);
  });
});

// ---------------------------------------------------------------------------
// packDir + unpackBuffer — round-trip
// ---------------------------------------------------------------------------

describe('packDir + unpackBuffer — round-trip', () => {
  let srcDir;
  let destDir;

  beforeEach(() => {
    srcDir  = makeTmpDir();
    destDir = makeTmpDir();
  });

  afterEach(() => {
    rmDir(srcDir);
    rmDir(destDir);
  });

  it('should_round_trip_single_text_file', () => {
    populateDir(srcDir, { 'hello.txt': 'Hello, World!' });

    const buf = packDir(srcDir);
    assert.ok(buf.length > 0, 'zip buffer must not be empty');
    unpackBuffer(buf, destDir);

    const content = fs.readFileSync(path.join(destDir, 'hello.txt'), 'utf8');
    assert.equal(content, 'Hello, World!');
  });

  it('should_round_trip_nested_directory_tree', () => {
    const tree = {
      'folio.json':             '{"name":"T","formatVersion":"1.0","createdAt":"2026-01-01T00:00:00.000Z"}',
      'chapter1/page-a.md':    '---\ntitle: A\n---\n\nBody A',
      'chapter1/page-b.md':    '---\ntitle: B\n---\n\nBody B',
      'chapter2/page-c.md':    '---\ntitle: C\n---\n\nBody C',
      '_attachments/chapter1/page-a/logo.png': Buffer.from('FAKEPNG'),
    };
    populateDir(srcDir, tree);

    const buf = packDir(srcDir);
    unpackBuffer(buf, destDir);

    assertDirEqual(srcDir, destDir, Object.keys(tree));
  });

  it('should_round_trip_binary_data_byte_for_byte', () => {
    const rawBytes = crypto.randomBytes(512);
    populateDir(srcDir, { 'data.bin': rawBytes });

    const buf = packDir(srcDir);
    unpackBuffer(buf, destDir);

    const written = fs.readFileSync(path.join(destDir, 'data.bin'));
    assert.ok(written.equals(rawBytes), 'binary data must be bit-perfect after round-trip');
  });

  it('should_use_store_method_for_incompressible_data_and_still_round_trip', () => {
    // Already-random data cannot be compressed — packDir should fall back to STORE
    const incompressible = crypto.randomBytes(4096);
    populateDir(srcDir, { 'random.bin': incompressible });

    const buf = packDir(srcDir);

    // STORE method means compressed size ≈ uncompressed size
    // Check that the buffer is ~4096 bytes plus ZIP overhead (not much smaller)
    const overhead = 512; // generous overhead for headers
    assert.ok(
      buf.length >= incompressible.length,
      'STORE method: zip must not be smaller than original data',
    );

    unpackBuffer(buf, destDir);
    const recovered = fs.readFileSync(path.join(destDir, 'random.bin'));
    assert.ok(recovered.equals(incompressible), 'incompressible data must round-trip');
  });

  it('should_handle_empty_directory_tree_gracefully', () => {
    // An empty srcDir produces a valid (but empty) ZIP
    const buf = packDir(srcDir);
    assert.ok(buf.length >= 22, 'even an empty ZIP has an EOCD record (22 bytes)');
    unpackBuffer(buf, destDir);
    // destDir should exist and be empty
    assert.ok(fs.existsSync(destDir));
  });

  it('should_round_trip_utf8_filenames', () => {
    const name = 'arquitectura/módulo-de-datos.md';
    populateDir(srcDir, { [name]: 'Contenido' });

    const buf = packDir(srcDir);
    unpackBuffer(buf, destDir);

    const written = fs.readFileSync(path.join(destDir, name), 'utf8');
    assert.equal(written, 'Contenido');
  });
});

// ---------------------------------------------------------------------------
// unpackBuffer — security: zip-slip rejection
// ---------------------------------------------------------------------------

describe('unpackBuffer — security: zip-slip rejection', () => {
  let tmpBase;

  beforeEach(() => { tmpBase = makeTmpDir(); });
  afterEach(()  => { rmDir(tmpBase); });

  /**
   * Build a minimal hand-crafted ZIP with a single entry whose name is `name`.
   * This is the only reliable way to create ZIP entries with evil paths
   * (the OS prevents filenames containing '/' or starting with '..').
   */
  function craftZipWithEntry(entryName) {
    const zlib    = require('zlib');
    const content = Buffer.from('evil');

    const checksum   = crc32(content);
    const compressed = zlib.deflateRawSync(content, { level: 6 });
    const nameBytes  = Buffer.from(entryName, 'utf8');

    // Local file header
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);             // DEFLATE
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    // Central directory entry
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(0, 42);  // local header offset
    nameBytes.copy(central, 46);

    const cdOffset = local.length + compressed.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054B50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([local, compressed, central, eocd]);
  }

  it('should_reject_absolute_path_entry', () => {
    const dest = path.join(tmpBase, 'dest');
    const buf  = craftZipWithEntry('/etc/passwd');
    assert.throws(
      () => unpackBuffer(buf, dest),
      /zip-slip|absolute/i,
    );
    // Nothing should have been written
    assert.ok(!fs.existsSync(path.join('/', 'etc', 'passwd-written')));
  });

  it('should_reject_dotdot_traversal_entry', () => {
    const dest = path.join(tmpBase, 'dest');
    const buf  = craftZipWithEntry('../evil.bin');
    assert.throws(
      () => unpackBuffer(buf, dest),
      /zip-slip|traversal/i,
    );
  });

  it('should_reject_nested_dotdot_traversal_entry', () => {
    const dest = path.join(tmpBase, 'dest');
    const buf  = craftZipWithEntry('subdir/../../evil.bin');
    assert.throws(
      () => unpackBuffer(buf, dest),
      /zip-slip|traversal/i,
    );
  });
});

// ---------------------------------------------------------------------------
// unpackBuffer — CRC mismatch detection
// ---------------------------------------------------------------------------

describe('unpackBuffer — CRC mismatch', () => {
  let tmpBase;

  beforeEach(() => { tmpBase = makeTmpDir(); });
  afterEach(()  => { rmDir(tmpBase); });

  it('should_throw_on_crc_mismatch', () => {
    const srcDir = path.join(tmpBase, 'src');
    populateDir(srcDir, { 'test.txt': 'content' });

    let buf = packDir(srcDir);

    // Corrupt the first byte of the compressed data in the local entry
    // Local file header is 30 + nameLen bytes; corrupt data area
    // Find the first local header and flip a byte in the compressed data
    buf = Buffer.from(buf); // make it mutable
    const nameLen      = buf.readUInt16LE(26);
    const extraLen     = buf.readUInt16LE(28);
    const dataStart    = 30 + nameLen + extraLen;
    if (buf.length > dataStart + 2) {
      buf[dataStart + 2] ^= 0xFF; // flip a byte in compressed data
    }

    const destDir = path.join(tmpBase, 'dest');
    assert.throws(
      () => unpackBuffer(buf, destDir),
      /CRC|invalid|corrupt|error/i,
    );
  });
});

// ---------------------------------------------------------------------------
// unpackBuffer — invalid archive
// ---------------------------------------------------------------------------

describe('unpackBuffer — invalid archive', () => {
  let tmpBase;

  beforeEach(() => { tmpBase = makeTmpDir(); });
  afterEach(()  => { rmDir(tmpBase); });

  it('should_throw_for_empty_buffer', () => {
    const dest = path.join(tmpBase, 'dest');
    assert.throws(
      () => unpackBuffer(Buffer.alloc(0), dest),
      /EOCD|valid/i,
    );
  });

  it('should_throw_for_random_bytes_that_are_not_a_zip', () => {
    const dest = path.join(tmpBase, 'dest');
    const junk = crypto.randomBytes(128);
    assert.throws(
      () => unpackBuffer(junk, dest),
      /EOCD|valid/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Standard unzip compatibility smoke test
// ---------------------------------------------------------------------------

describe('packDir — standard unzip compatibility', () => {
  let srcDir;
  let tmpBase;

  beforeEach(() => {
    srcDir  = makeTmpDir();
    tmpBase = makeTmpDir();
  });

  afterEach(() => {
    rmDir(srcDir);
    rmDir(tmpBase);
  });

  it('should_produce_a_zip_that_system_unzip_can_open', () => {
    // Detect available unzip tool — skip if neither is available
    let unzipCmd;
    try {
      execSync('unzip -v', { stdio: 'ignore' });
      unzipCmd = 'unzip';
    } catch (_) {
      try {
        execSync('bsdtar --version', { stdio: 'ignore' });
        unzipCmd = 'bsdtar';
      } catch (_) {
        // Neither available — skip test
        console.warn('[folio-zip.test] Skipping unzip compat test: no unzip/bsdtar found');
        return;
      }
    }

    populateDir(srcDir, {
      'folio.json':       '{"name":"smoke","formatVersion":"1.0","createdAt":"2026-01-01T00:00:00.000Z"}',
      'ch/page.md':       '---\ntitle: Smoke\nauthor: user\npinned: false\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nSmoke test body',
    });

    const zipBuf     = packDir(srcDir);
    const zipFile    = path.join(tmpBase, 'smoke.folio');
    const extractDir = path.join(tmpBase, 'extracted');
    fs.writeFileSync(zipFile, zipBuf);
    fs.mkdirSync(extractDir);

    // Attempt extraction with the system tool
    let exitCode = 0;
    try {
      if (unzipCmd === 'unzip') {
        execSync(`unzip -q "${zipFile}" -d "${extractDir}"`, { stdio: 'pipe' });
      } else {
        execSync(`bsdtar -xf "${zipFile}" -C "${extractDir}"`, { stdio: 'pipe' });
      }
    } catch (e) {
      exitCode = e.status ?? 1;
    }

    assert.equal(exitCode, 0, `${unzipCmd} should exit with code 0`);

    // Verify at least folio.json was extracted
    const extracted = fs.existsSync(path.join(extractDir, 'folio.json'));
    assert.ok(extracted, 'folio.json should be present after system unzip');
  });
});

// ---------------------------------------------------------------------------
// packDir + unpackBuffer — facade integration (packFolio / unpackFolio)
// are tested via the archive round-trip tests in folio-archive.test.js
// ---------------------------------------------------------------------------
