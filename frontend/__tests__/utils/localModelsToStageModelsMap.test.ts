/**
 * QA unit tests for localModelsToStageModelsMap utility.
 *
 * Covers:
 *   - Non-empty model string → StageModelsMap entry with provider+cliTool='claude'
 *   - Empty string → null (clear override)
 *   - Whitespace-only string → null (trimmed)
 *   - Multiple agents
 *   - Empty input map → empty output
 */

import { describe, it, expect } from 'vitest';
import { localModelsToStageModelsMap } from '@/utils/modelRouting';

describe('localModelsToStageModelsMap — happy paths', () => {
  it('converts a model string to a StageModelsMap entry', () => {
    const result = localModelsToStageModelsMap({ 'senior-architect': 'claude-opus-4-5' });
    expect(result['senior-architect']).toEqual({
      provider: 'claude',
      model: 'claude-opus-4-5',
      cliTool: 'claude',
    });
  });

  it('converts multiple agents correctly', () => {
    const result = localModelsToStageModelsMap({
      'senior-architect': 'claude-opus-4-5',
      'developer-agent': 'claude-sonnet-4-5',
    });
    expect(result['senior-architect']?.model).toBe('claude-opus-4-5');
    expect(result['developer-agent']?.model).toBe('claude-sonnet-4-5');
  });

  it('returns an empty map for an empty input', () => {
    const result = localModelsToStageModelsMap({});
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('localModelsToStageModelsMap — clear override (null)', () => {
  it('converts empty string to null (clears override)', () => {
    const result = localModelsToStageModelsMap({ 'developer-agent': '' });
    expect(result['developer-agent']).toBeNull();
  });

  it('converts whitespace-only string to null after trim', () => {
    const result = localModelsToStageModelsMap({ 'developer-agent': '   ' });
    expect(result['developer-agent']).toBeNull();
  });
});

describe('localModelsToStageModelsMap — provider / cliTool fields', () => {
  it('always sets provider to "claude"', () => {
    const result = localModelsToStageModelsMap({ 'qa-engineer-e2e': 'claude-haiku-4-5' });
    expect(result['qa-engineer-e2e']?.provider).toBe('claude');
  });

  it('always sets cliTool to "claude"', () => {
    const result = localModelsToStageModelsMap({ 'qa-engineer-e2e': 'claude-haiku-4-5' });
    expect(result['qa-engineer-e2e']?.cliTool).toBe('claude');
  });

  it('trims leading/trailing whitespace from model string', () => {
    const result = localModelsToStageModelsMap({ 'developer-agent': '  claude-opus-4-5  ' });
    expect(result['developer-agent']?.model).toBe('claude-opus-4-5');
  });
});
