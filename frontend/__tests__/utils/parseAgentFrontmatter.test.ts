/**
 * Unit tests for parseAgentFrontmatter utility.
 * Covers: valid, partial, malformed YAML, no frontmatter, edge cases.
 */

import { describe, it, expect } from 'vitest';
import { parseAgentFrontmatter } from '@/utils/parseAgentFrontmatter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fm(yaml: string, body = 'Agent body here.'): string {
  return `---\n${yaml}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('parseAgentFrontmatter — valid frontmatter', () => {
  it('parses model, effort, and skills (block list)', () => {
    const content = fm(
      'model: claude-opus-4-5\neffort: high\nskills:\n  - ui-ux-pro-max\n  - deep-research'
    );
    const result = parseAgentFrontmatter(content);
    expect(result.model).toBe('claude-opus-4-5');
    expect(result.effort).toBe('high');
    expect(result.skills).toEqual(['ui-ux-pro-max', 'deep-research']);
  });

  it('parses skills as inline array', () => {
    const content = fm('skills: [ui-ux-pro-max, design-taste-frontend]');
    expect(parseAgentFrontmatter(content).skills).toEqual([
      'ui-ux-pro-max',
      'design-taste-frontend',
    ]);
  });

  it('parses only model when effort and skills are absent', () => {
    const result = parseAgentFrontmatter(fm('model: claude-sonnet-4-5'));
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.effort).toBeUndefined();
    expect(result.skills).toEqual([]);
  });

  it('parses quoted model strings', () => {
    const result = parseAgentFrontmatter(fm('model: "claude-haiku-4-5"'));
    expect(result.model).toBe('claude-haiku-4-5');
  });

  it('parses model with single quotes', () => {
    const result = parseAgentFrontmatter(fm("model: 'claude-sonnet-4-5'"));
    expect(result.model).toBe('claude-sonnet-4-5');
  });

  it('returns empty skills array when skills list is empty block', () => {
    const content = fm('model: claude-sonnet-4-5\nskills:\n');
    const result = parseAgentFrontmatter(content);
    expect(result.skills).toEqual([]);
  });

  it('handles inline skills with spaces around items', () => {
    const content = fm('skills: [ ui-ux-pro-max , deep-research ]');
    expect(parseAgentFrontmatter(content).skills).toEqual([
      'ui-ux-pro-max',
      'deep-research',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Missing / partial frontmatter
// ---------------------------------------------------------------------------

describe('parseAgentFrontmatter — missing or partial keys', () => {
  it('returns skills:[] when frontmatter is missing entirely', () => {
    const result = parseAgentFrontmatter('# Just a markdown file\nNo frontmatter here.');
    expect(result).toEqual({ skills: [] });
  });

  it('returns skills:[] for an empty string', () => {
    expect(parseAgentFrontmatter('')).toEqual({ skills: [] });
  });

  it('returns skills:[] when only the opening --- is present', () => {
    expect(parseAgentFrontmatter('---')).toEqual({ skills: [] });
  });

  it('returns skills:[] when frontmatter is just dashes', () => {
    expect(parseAgentFrontmatter('---\n---\nBody')).toEqual({ skills: [] });
  });

  it('handles frontmatter with unknown keys gracefully', () => {
    const content = fm('name: senior-architect\ndescription: Does architecture stuff');
    const result = parseAgentFrontmatter(content);
    expect(result).toEqual({ skills: [] });
  });
});

// ---------------------------------------------------------------------------
// Malformed YAML
// ---------------------------------------------------------------------------

describe('parseAgentFrontmatter — malformed input', () => {
  it('never throws on null input', () => {
    // @ts-expect-error testing JS runtime null
    expect(() => parseAgentFrontmatter(null)).not.toThrow();
  });

  it('never throws on undefined input', () => {
    // @ts-expect-error testing JS runtime undefined
    expect(() => parseAgentFrontmatter(undefined)).not.toThrow();
  });

  it('never throws on a number input', () => {
    // @ts-expect-error testing JS runtime number
    expect(() => parseAgentFrontmatter(42)).not.toThrow();
  });

  it('returns skills:[] on malformed YAML body', () => {
    const result = parseAgentFrontmatter('---\n: : : broken yaml :::\n---\nBody');
    expect(result.skills).toEqual([]);
  });

  it('never throws on deeply nested YAML (not supported, but safe)', () => {
    const content = fm('nested:\n  key:\n    deeper: value');
    expect(() => parseAgentFrontmatter(content)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Coverage: inline array edge cases
// ---------------------------------------------------------------------------

describe('parseAgentFrontmatter — inline array edge cases', () => {
  it('handles empty inline array []', () => {
    const result = parseAgentFrontmatter(fm('skills: []'));
    expect(result.skills).toEqual([]);
  });

  it('handles single-item inline array', () => {
    const result = parseAgentFrontmatter(fm('skills: [ui-ux-pro-max]'));
    expect(result.skills).toEqual(['ui-ux-pro-max']);
  });

  it('filters out empty tokens from inline array', () => {
    const result = parseAgentFrontmatter(fm('skills: [a,,b]'));
    expect(result.skills).toEqual(['a', 'b']);
  });
});
