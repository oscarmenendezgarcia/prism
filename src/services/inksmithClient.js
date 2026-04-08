'use strict';

/**
 * Thin HTTP client for the Inksmith prompt-refinement service — blueprint §3.1, T-004.
 *
 * Contract (assumed — blueprint §3.4, §7):
 *   POST <endpoint>
 *   Authorization: Bearer <INKSMITH_API_KEY>
 *   { prompt: string, metadata: object }
 *   → 200 { refinedPrompt: string, refinementId: string, model?: string, usage?: object }
 *
 * Security guarantees:
 *   - API key never appears in thrown errors, logged output, or rejection reasons.
 *   - Non-HTTPS endpoints rejected unless INKSMITH_ALLOW_HTTP=1.
 *   - Request body capped at 256 KB; response body capped at 512 KB.
 *
 * Retry behaviour:
 *   - 1 retry on network error or 5xx, with configurable backoff (default 200ms).
 *   - Timeout enforced per attempt via socket timeout + req.destroy().
 */

const https = require('https');
const http  = require('http');
const url   = require('url');

const MAX_REQUEST_BYTES  = 256 * 1024;  // 256 KB
const MAX_RESPONSE_BYTES = 512 * 1024;  // 512 KB

const REDACTED = '[REDACTED]';

/**
 * Replace the API key value with [REDACTED] in an error message string.
 * Operates on the string representation only — never inspect the key itself.
 *
 * @param {string} message
 * @param {string} apiKey
 * @returns {string}
 */
function redactKey(message, apiKey) {
  if (!apiKey || !message) return message;
  // Escape regex special chars in the key before substituting.
  const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return message.replace(new RegExp(escaped, 'g'), REDACTED);
}

/**
 * Sleep for `ms` milliseconds. Used for retry backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a single HTTPS POST attempt.
 *
 * @param {object} parsedUrl  - url.parse() result for the endpoint
 * @param {string} payload    - JSON-serialised request body
 * @param {string} apiKey     - Bearer token (never logged)
 * @param {number} timeoutMs  - Hard socket timeout per attempt
 * @returns {Promise<{ statusCode: number, body: string }>}
 */
function attemptRequest(parsedUrl, payload, apiKey, timeoutMs) {
  const transport = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path:     parsedUrl.path || '/',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization':  `Bearer ${apiKey}`,
      },
    };

    const req = transport.request(options, (res) => {
      const chunks    = [];
      let totalBytes  = 0;
      let oversized   = false;

      res.on('data', (chunk) => {
        if (oversized) return;
        totalBytes += chunk.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          oversized = true;
          req.destroy();
          reject(new Error('response_too_large'));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        if (!oversized) {
          resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        }
      });

      res.on('error', (err) => {
        reject(new Error(`response_stream_error: ${err.message}`));
      });
    });

    // Hard timeout per attempt
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Call the Inksmith refinement endpoint with retry.
 *
 * @param {string} rawPrompt         - Full assembled prompt text.
 * @param {object} metadata          - { agentId, taskId, spaceId, source }
 * @param {object} inksmithSettings  - The `prompts.inksmith` config block from settings.
 * @returns {Promise<{
 *   ok: boolean,
 *   refinedPrompt?: string,
 *   refinementId?: string,
 *   model?: string,
 *   usage?: object,
 *   reason?: string,
 *   httpStatus?: number
 * }>}
 *
 * Never throws. Returns `{ ok: false, reason, httpStatus? }` on all failure paths.
 */
async function refine(rawPrompt, metadata, inksmithSettings) {
  const {
    endpoint,
    timeoutMs = 1500,
    retry     = { attempts: 1, backoffMs: 200 },
  } = inksmithSettings;

  const apiKey = process.env.INKSMITH_API_KEY || '';

  // ── Security: enforce HTTPS ──────────────────────────────────────────────
  const parsedUrl = url.parse(endpoint);
  if (parsedUrl.protocol !== 'https:' && process.env.INKSMITH_ALLOW_HTTP !== '1') {
    return { ok: false, reason: 'insecure_endpoint' };
  }

  // ── Request payload ──────────────────────────────────────────────────────
  const requestBody = { prompt: rawPrompt, metadata: { ...metadata, source: 'prism' } };
  const payload     = JSON.stringify(requestBody);

  if (Buffer.byteLength(payload) > MAX_REQUEST_BYTES) {
    return { ok: false, reason: 'request_too_large' };
  }

  // ── Attempt with retry ───────────────────────────────────────────────────
  const maxAttempts = (retry.attempts || 1) + 1; // +1 for the initial attempt
  const backoffMs   = retry.backoffMs || 200;
  let lastReason    = 'unknown';
  let lastStatus;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await sleep(backoffMs * attempt); // exponential: 200ms, 400ms …
    }

    let result;
    try {
      result = await attemptRequest(parsedUrl, payload, apiKey, timeoutMs);
    } catch (err) {
      const msg  = redactKey(err.message || '', apiKey);
      lastReason = msg.includes('timeout') ? 'timeout' : 'network';
      continue; // retry
    }

    const { statusCode, body } = result;

    // 2xx → parse and validate
    if (statusCode >= 200 && statusCode < 300) {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return { ok: false, reason: 'malformed_json' };
      }

      if (!parsed.refinedPrompt || typeof parsed.refinedPrompt !== 'string' || parsed.refinedPrompt.trim() === '') {
        return { ok: false, reason: 'schema_mismatch' };
      }

      return {
        ok:            true,
        refinedPrompt: parsed.refinedPrompt,
        refinementId:  parsed.refinementId  || null,
        model:         parsed.model         || null,
        usage:         parsed.usage         || null,
      };
    }

    // 5xx → retry-eligible
    if (statusCode >= 500) {
      lastReason = '5xx';
      lastStatus = statusCode;
      continue;
    }

    // 4xx → not retry-eligible
    return { ok: false, reason: '4xx', httpStatus: statusCode };
  }

  return { ok: false, reason: lastReason, httpStatus: lastStatus };
}

module.exports = { refine, redactKey };
