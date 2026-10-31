import { describe, it, expect } from 'vitest';
import { DEFAULT_SORT, appendFilters, cleanFilters, filterCount, hasFilters, readLocation, writeLocation } from '@/utils/issueFilters';

const base = { space: 's1', view: 'board' as const, filters: {}, sort: DEFAULT_SORT };

describe('cleanFilters', () => {
  it('leaves out what does not filter, and repeats', () => {
    expect(cleanFilters({ status: [], q: '  ', label: ['a', 'a'], due: undefined })).toEqual({ label: ['a'] });
  });

  it('keeps an empty assignee or epic, which means none', () => {
    expect(cleanFilters({ assignee: [''], epic: [''] })).toEqual({ assignee: [''], epic: [''] });
  });

  it('counts fields, not values', () => {
    expect(filterCount({ status: ['a', 'b'], q: 'x' })).toBe(2);
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ due: 'none' })).toBe(true);
  });
});

describe('appendFilters', () => {
  it('only says the day when it matters', () => {
    const without = new URLSearchParams();
    appendFilters(without, { q: 'x' });
    expect(without.has('today')).toBe(false);
    const withDue = new URLSearchParams();
    appendFilters(withDue, { due: 'week' });
    expect(withDue.get('today')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the address of the page', () => {
  it('a plain board has none', () => {
    expect(writeLocation('', base)).toBe('');
  });

  it('survives the way there and back', () => {
    const state = {
      space: 's 1', view: 'list' as const,
      filters: { status: ['constructor', 'to do'], assignee: ['', 'Ana López'], epic: [''], priority: ['high' as const], label: ['a&b'], due: 'overdue' as const, q: 'pay=1' },
      sort: { field: 'due' as const, dir: 'asc' as const },
    };
    const read = readLocation(writeLocation('', state));
    expect(read).toEqual(state);
  });

  it('does not freeze the day of an overdue filter in a link', () => {
    expect(writeLocation('', { ...base, filters: { due: 'overdue' } })).not.toContain('today');
  });

  it('keeps what is not about it, and removes what no longer applies', () => {
    const query = writeLocation('?issue=WEB-1&view=list&status=a&sort=due&dir=asc', base);
    expect(query).toBe('?issue=WEB-1');
  });

  it('leaves out what it cannot make sense of', () => {
    const read = readLocation(`?view=gantt&due=soon&sort=rowid&dir=sideways&type=bogus&priority=huge`);
    expect(read.view).toBe('board');
    expect(read.filters).toEqual({});
    expect(read.sort).toEqual(DEFAULT_SORT);
  });

  it('cuts text the server would refuse', () => {
    expect(readLocation(`?q=${'x'.repeat(300)}`).filters.q).toHaveLength(200);
  });

  it('a filter needs its space to mean the same in another browser', () => {
    expect(writeLocation('', { ...base, filters: { q: 'x' } })).toContain('space=s1');
  });
});
