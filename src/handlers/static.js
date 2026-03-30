'use strict';

/**
 * Static file handler.
 * Serves built frontend assets from the dist/ directory (Vite build output).
 * Falls back to index.html for SPA client-side routes (paths without extensions).
 */

const fs   = require('fs');
const path = require('path');

/** MIME types for static file serving */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

// Vite build output — the only static root.
// The legacy public/ directory was removed after the React migration.
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'dist');

/**
 * Handle a request for a static file.
 * Path traversal is prevented by resolving against PUBLIC_DIR.
 */
function handleStatic(req, res) {
  const urlPath      = req.url.split('?')[0];
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);

  const resolved = path.resolve(PUBLIC_DIR, relativePath);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== PUBLIC_DIR) {
    const payload = JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    return res.end(payload);
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    // SPA fallback: serve index.html for client-side routes (e.g. /cards).
    // Only fall back if the path has no file extension (i.e. it looks like a route, not an asset).
    const ext = path.extname(urlPath);
    if (!ext) {
      const indexPath = path.resolve(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': content.length });
        return res.end(content);
      }
    }
    const payload = JSON.stringify({ error: { code: 'NOT_FOUND', message: `File '${urlPath}' not found` } });
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    return res.end(payload);
  }

  const ext         = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(resolved);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
    res.end(content);
  } catch (err) {
    console.error(`Static file error for ${resolved}:`, err);
    const payload = JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Failed to read file' } });
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  }
}

module.exports = { handleStatic };
