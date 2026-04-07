import { describe, it, expect } from 'vitest';
import { formatTimestamp } from '../../src/utils/formatTimestamp';

describe('formatTimestamp', () => {
  it('returns empty string for null', () => {
    expect(formatTimestamp(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatTimestamp(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatTimestamp('')).toBe('');
  });

  it('returns empty string for an invalid ISO string', () => {
    expect(formatTimestamp('not-a-date')).toBe('');
  });

  it('formats a valid UTC ISO string into local date-time', () => {
    // Use a fixed UTC time; the local conversion depends on the test runner TZ.
    // We validate the shape, not the exact local time.
    const result = formatTimestamp('2026-03-09T00:00:00.000Z');
    // Should match pattern: "Mon DD, YYYY - HH:MM"
    expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4} - \d{2}:\d{2}$/);
  });

  it('includes the correct year', () => {
    const result = formatTimestamp('2026-06-15T10:30:00.000Z');
    expect(result).toContain('2026');
  });

  it('pads hours and minutes with leading zeros', () => {
    // Force a date where we can predict the local time won't have single digits — test padding
    const result = formatTimestamp('2026-01-01T00:05:00.000Z');
    // The minute should be padded: "00" or "05" depending on TZ, but both are 2 digits
    expect(result).toMatch(/\d{2}:\d{2}$/);
  });
});
