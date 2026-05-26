/**
 * Returns a human-readable relative time string (e.g. "9 days ago").
 * Falls back to an empty string for invalid/missing input.
 *
 * Intended for Created/Updated metadata fields — pair with formatTimestamp()
 * as the tooltip title for the precise absolute value.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';

  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1)   return 'just now';
  if (minutes < 60)  return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24)    return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7)      return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5)     return `${weeks}w ago`;

  const months = Math.floor(days / 30);
  if (months < 12)   return `${months}mo ago`;

  return `${Math.floor(days / 365)}y ago`;
}
