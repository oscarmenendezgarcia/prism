'use strict';

/**
 * Shared HTTP response helpers and request body parser.
 * Used across all route handlers in the Prism API server.
 */

/**
 * Write a JSON response with the given HTTP status code.
 */
function sendJSON(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
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
  readActor, sendJSON, sendError, parseBody, parseBodyWithLimit };
