/**
 * Unit tests for resolveEffectiveModel utility.
 * Covers every scope × override-present/absent branch.
 */

import { describe, it, expect } from 'vitest';
import { resolveEffectiveModel } from '@/utils/modelRouting';
import type { StageModelsMap } from '@/types';

const OPUS    = 'claude-opus-4-5';
const SONNET  = 'claude-sonnet-4-5';
const HAIKU   = 'claude-haiku-4-5';
const FRONT   = 'claude-haiku-frontmatter';

const cfg = (model: string) => ({ provider: 'claude' as const, model, cliTool: 'claude' as const });

// ---------------------------------------------------------------------------
// scope === 'global'
// ---------------------------------------------------------------------------

describe('resolveEffectiveModel — global scope', () => {
  it('returns globalMap model with source=global when override exists', () => {
    const globalMap: StageModelsMap = { 'senior-architect': cfg(OPUS) };
    const result = resolveEffectiveModel('senior-architect', 'global', globalMap, null, FRONT);
    expect(result).toEqual({ model: OPUS, source: 'global' });
  });

  it('returns frontmatter model with source=default when no global override', () => {
    const result = resolveEffectiveModel('senior-architect', 'global', {}, null, FRONT);
    expect(result).toEqual({ model: FRONT, source: 'default' });
  });

  it('returns empty string with source=default when no global override and no frontmatter', () => {
    const result = resolveEffectiveModel('developer-agent', 'global', {}, null, undefined);
    expect(result).toEqual({ model: '', source: 'default' });
  });

  it('ignores spaceMap entirely in global scope', () => {
    const spaceMap: StageModelsMap = { 'developer-agent': cfg(HAIKU) };
    const result = resolveEffectiveModel('developer-agent', 'global', {}, spaceMap, SONNET);
    expect(result).toEqual({ model: SONNET, source: 'default' });
  });

  it('ignores spaceMap even when globalMap has an override', () => {
    const globalMap: StageModelsMap = { 'developer-agent': cfg(OPUS) };
    const spaceMap: StageModelsMap  = { 'developer-agent': cfg(HAIKU) };
    const result = resolveEffectiveModel('developer-agent', 'global', globalMap, spaceMap, FRONT);
    expect(result).toEqual({ model: OPUS, source: 'global' });
  });

  it('handles null entry in globalMap (cleared override)', () => {
    const globalMap: StageModelsMap = { 'developer-agent': null };
    const result = resolveEffectiveModel('developer-agent', 'global', globalMap, null, FRONT);
    expect(result).toEqual({ model: FRONT, source: 'default' });
  });
});

// ---------------------------------------------------------------------------
// scope === 'space'
// ---------------------------------------------------------------------------

describe('resolveEffectiveModel — space scope', () => {
  it('returns spaceMap model with source=space when space override exists', () => {
    const globalMap: StageModelsMap = {};
    const spaceMap: StageModelsMap  = { 'ux-api-designer': cfg(HAIKU) };
    const result = resolveEffectiveModel('ux-api-designer', 'space', globalMap, spaceMap, FRONT);
    expect(result).toEqual({ model: HAIKU, source: 'space' });
  });

  it('falls through to global when no space override', () => {
    const globalMap: StageModelsMap = { 'ux-api-designer': cfg(OPUS) };
    const spaceMap: StageModelsMap  = {};
    const result = resolveEffectiveModel('ux-api-designer', 'space', globalMap, spaceMap, FRONT);
    expect(result).toEqual({ model: OPUS, source: 'global' });
  });

  it('falls through to default when neither space nor global override', () => {
    const result = resolveEffectiveModel('ux-api-designer', 'space', {}, {}, FRONT);
    expect(result).toEqual({ model: FRONT, source: 'default' });
  });

  it('falls through to empty default when no overrides and no frontmatter', () => {
    const result = resolveEffectiveModel('ux-api-designer', 'space', {}, null, undefined);
    expect(result).toEqual({ model: '', source: 'default' });
  });

  it('handles null spaceMap (no space selected)', () => {
    const globalMap: StageModelsMap = { 'ux-api-designer': cfg(OPUS) };
    const result = resolveEffectiveModel('ux-api-designer', 'space', globalMap, null, FRONT);
    expect(result).toEqual({ model: OPUS, source: 'global' });
  });

  it('handles null entry in spaceMap (cleared space override)', () => {
    const globalMap: StageModelsMap = { 'code-reviewer': cfg(SONNET) };
    const spaceMap: StageModelsMap  = { 'code-reviewer': null };
    const result = resolveEffectiveModel('code-reviewer', 'space', globalMap, spaceMap, FRONT);
    expect(result).toEqual({ model: SONNET, source: 'global' });
  });

  it('returns space source when space overrides global', () => {
    const globalMap: StageModelsMap = { 'qa-engineer-e2e': cfg(OPUS) };
    const spaceMap: StageModelsMap  = { 'qa-engineer-e2e': cfg(HAIKU) };
    const result = resolveEffectiveModel('qa-engineer-e2e', 'space', globalMap, spaceMap, FRONT);
    expect(result).toEqual({ model: HAIKU, source: 'space' });
  });
});

// ---------------------------------------------------------------------------
// Unknown agentId
// ---------------------------------------------------------------------------

describe('resolveEffectiveModel — unknown agentId', () => {
  it('degrades to default with frontmatter for unknown agent', () => {
    const result = resolveEffectiveModel('unknown-agent', 'global', {}, null, SONNET);
    expect(result).toEqual({ model: SONNET, source: 'default' });
  });

  it('degrades to empty default for unknown agent with no frontmatter', () => {
    const result = resolveEffectiveModel('unknown-agent', 'space', {}, {}, undefined);
    expect(result).toEqual({ model: '', source: 'default' });
  });
});
