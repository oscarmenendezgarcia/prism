/**
 * Generate a RFC 4122 v4 UUID with a non-secure-context fallback.
 *
 * `crypto.randomUUID()` is ONLY available in secure contexts (HTTPS or
 * localhost). When Prism is opened over plain HTTP on a LAN IP — e.g. a phone
 * at http://192.168.1.32:3000 — `crypto.randomUUID` is `undefined`, so calling
 * it throws `TypeError: crypto.randomUUID is not a function`. Because the
 * terminal store calls it at module-init time, that throw aborts the whole
 * bundle and the app renders a blank screen on mobile while working on desktop.
 *
 * This helper uses crypto.randomUUID when present, falls back to
 * crypto.getRandomValues (available in non-secure contexts), and finally to
 * Math.random as a last resort.
 */
export function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through to the manual implementation */
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Set the version (4) and variant (10xx) bits per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  );
}
