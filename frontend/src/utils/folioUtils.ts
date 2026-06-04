/**
 * Shared helpers for Folio UI components.
 *
 * Extracted from FolioPageList and FolioPageEditor (BUG-004) so the
 * implementations stay in sync. BUG-007 is fixed here: months are used
 * at ≥ 30 days instead of the previous "N weeks" tier.
 */

/**
 * Returns a human-readable relative time string for a page's `updatedAt` ISO
 * timestamp (e.g. "just now", "3 hours ago", "2 months ago").
 *
 * Pair with a `title` attribute showing the absolute datetime for precision.
 */
export function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1)  return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24)  return `${diffHrs} hour${diffHrs === 1 ? '' : 's'} ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
}

/**
 * Maps a page `author` value to the neutral display label shown in the UI.
 * Never exposes raw "user" / "agent" strings to the user — vocabulary stays
 * neutral and domain-agnostic (Story 2.1, ADR-1 §vocabulario).
 */
export function authorLabel(author: 'user' | 'agent'): string {
  return author === 'user' ? 'You' : 'Agent';
}
