/**
 * Format an ISO8601 date string into a human-readable label.
 * Mirrors the formatTimestamp() function from the legacy app.js.
 * Uses the local timezone of the browser.
 * Example output: "Mar 9, 2026 - 14:32"
 *
 * @param iso - ISO8601 date string (e.g. "2026-03-09T14:32:00.000Z")
 * @returns Formatted date-time string, or empty string for invalid/missing input.
 */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const month = MONTHS[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day}, ${year} - ${hh}:${mm}`;
}
