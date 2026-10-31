'use strict';

/**
 * Shared HTTP response helpers and request body parser.
 * Used across all route handlers in the Prism API server.
 */

const crypto = require('crypto');
const zlib   = require('zlib');

/** Below this, gzip costs more than it saves. */
const GZIP_MIN_BYTES = 1024;

/**
 * Whether a request takes gzip. Without a request to go by, as with a stand-in response in a
 * test, the answer is no.
 *
 * @param {import('http').IncomingMessage} [req]
 * @returns {boolean}
 */
function acceptsGzip(req) {
  const header = req?.headers?.['accept-encoding'];
  if (typeof header !== 'string') return false;
  return header.split(',').some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(';').map((s) => s.trim());
    if (coding !== 'gzip') return false;
    const q = params.find((param) => param.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

function writeJSON(res, status, payload, headers = {}) {
  let body = Buffer.from(payload);
  const out = { 'Content-Type': 'application/json; charset=utf-8', ...headers };
  if (body.length > GZIP_MIN_BYTES) {
    out.Vary = 'Accept-Encoding';
    if (acceptsGzip(res.req)) {
      body = zlib.gzipSync(body);
      out['Content-Encoding'] = 'gzip';
    }
  }
  out['Content-Length'] = body.length;
  res.writeHead(status, out);
  res.end(body);
}

/**
 * Write a JSON response with the given HTTP status code, compressed if the request takes it
 * and it is worth it.
 */
function sendJSON(res, status, body) {
  writeJSON(res, status, JSON.stringify(body));
}

/** Whether an If-None-Match header names this ETag. Proxies may have weakened it on the way. */
function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((candidate) => {
    const tag = candidate.trim().replace(/^W\//, '');
    return tag === etag || tag === '*';
  });
}

/**
 * Write a JSON response that a client can ask for again without getting it again: its ETag is
 * the hash of the body, and a request that already has it gets a 304 with no body.
 */
function sendJSONWithETag(req, res, body) {
  const payload = JSON.stringify(body);
  const etag = `"${crypto.createHash('sha1').update(payload).digest('hex')}"`;
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, { ...headers, Vary: 'Accept-Encoding' });
    res.end();
    return;
  }
  writeJSON(res, 200, payload, headers);
}

/**
 * Write a structured JSON error response.
 * @param {object} extra - Additional fields merged into error object.
 */
function sendError(res, status, code, message, extra = {}) {
  sendJSON(res, status, { error: { code, message, ...extra } });
}

const ACTOR_MAX_LEN = 100;

/**
 * Who is making a request, as the history and comments will sign it. It comes from the session,
 * whatever the client says. Only a server without accounts, which tests start, has nothing else
 * to go by.
 *
 * @param {import('http').IncomingMessage} req
 * @param {string} [claimed] - Who the client says it is.
 * @returns {string}
 */
function readActor(req, claimed = req.headers?.['x-prism-actor']) {
  if (req.user && !req.user.unverified) return req.user.name;
  const actor = String(claimed ?? '').trim().slice(0, ACTOR_MAX_LEN);
  return actor || 'API';
}

/**
 * Parse an incoming request body as JSON.
 * Hard limit: 512 KB.
 * Rejects with Error('PAYLOAD_TOO_LARGE') or Error('INVALID_JSON').
 */
function parseBody(req) {
  return parseBodyWithLimit(req, 512 * 1024);
}

/**
 * Parse an incoming request body as JSON with a configurable byte limit.
 * Used by endpoints that accept larger payloads (e.g. config save — up to 1 MB).
 *
 * @param {import('http').IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<object|null>}
 */
function parseBodyWithLimit(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks   = [];
    let totalBytes = 0;

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (req.stillAllowed && !req.stillAllowed()) {
        reject(new Error('ACCESS_CHANGED'));
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw.length > 0 ? JSON.parse(raw) : null);
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', reject);
  });
}

module.exports = {
  readActor, sendJSON, sendJSONWithETag, sendError, acceptsGzip, parseBody, parseBodyWithLimit };
