import { describe, it, expect } from 'vitest';
import { resolveAgentName, resolveAgentShortLabel } from '../../src/utils/agentName';
import type { Space } from '../../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id:        'test-space',
    name:      'Test Space',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// resolveAgentName
// ---------------------------------------------------------------------------

describe('resolveAgentName', () => {
  describe('level 1: space.agentNicknames', () => {
    it('returns the space nickname when set', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': 'El Jefe' } });
      expect(resolveAgentName('senior-architect', space)).toBe('El Jefe');
    });

    it('trims the nickname before returning', () => {
      const space = makeSpace({ agentNicknames: { 'developer-agent': '  Rafa  ' } });
      expect(resolveAgentName('developer-agent', space)).toBe('Rafa');
    });

    it('falls through when nickname is empty string', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': '' } });
      // Should fall through to STAGE_DISPLAY
      expect(resolveAgentName('senior-architect', space)).toBe('Senior Architect');
    });

    it('falls through when nickname is whitespace-only', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': '   ' } });
      expect(resolveAgentName('senior-architect', space)).toBe('Senior Architect');
    });

    it('falls through when agentNicknames is an empty map', () => {
      const space = makeSpace({ agentNicknames: {} });
      expect(resolveAgentName('senior-architect', space)).toBe('Senior Architect');
    });
  });

  describe('level 2: STAGE_DISPLAY static map', () => {
    it('returns static display name for known agent with no space', () => {
      expect(resolveAgentName('senior-architect', null)).toBe('Senior Architect');
    });

    it('returns "UX / API Designer" for ux-api-designer', () => {
      expect(resolveAgentName('ux-api-designer', null)).toBe('UX / API Designer');
    });

    it('returns "Developer Agent" for developer-agent', () => {
      expect(resolveAgentName('developer-agent', null)).toBe('Developer Agent');
    });

    it('returns "QA Engineer E2E" for qa-engineer-e2e', () => {
      expect(resolveAgentName('qa-engineer-e2e', null)).toBe('QA Engineer E2E');
    });

    it('returns "Code Reviewer" for code-reviewer', () => {
      expect(resolveAgentName('code-reviewer', null)).toBe('Code Reviewer');
    });

    it('uses static map when space has no agentNicknames field', () => {
      const space = makeSpace(); // no agentNicknames
      expect(resolveAgentName('developer-agent', space)).toBe('Developer Agent');
    });
  });

  describe('level 3: agents[].displayName', () => {
    it('uses agent metadata displayName for unknown agent ID', () => {
      const agents = [{ id: 'custom-bot', displayName: 'Custom Bot' }];
      expect(resolveAgentName('custom-bot', null, agents)).toBe('Custom Bot');
    });

    it('skips agents list entry when STAGE_DISPLAY would match first', () => {
      // senior-architect is in STAGE_DISPLAY, so agents list is not consulted
      const agents = [{ id: 'senior-architect', displayName: 'Override Name' }];
      expect(resolveAgentName('senior-architect', null, agents)).toBe('Senior Architect');
    });

    it('uses agents list when no space nickname and not in STAGE_DISPLAY', () => {
      const space  = makeSpace({ agentNicknames: {} });
      const agents = [{ id: 'my-custom-agent', displayName: 'My Custom Agent' }];
      expect(resolveAgentName('my-custom-agent', space, agents)).toBe('My Custom Agent');
    });
  });

  describe('level 4: raw agentId fallback', () => {
    it('returns the raw agentId when no other level matches', () => {
      expect(resolveAgentName('unknown-agent', null)).toBe('unknown-agent');
    });

    it('returns the raw agentId when space is undefined', () => {
      expect(resolveAgentName('unknown-agent', undefined)).toBe('unknown-agent');
    });

    it('returns the raw agentId when agents list has no match', () => {
      const agents = [{ id: 'other-agent', displayName: 'Other' }];
      expect(resolveAgentName('unknown-agent', null, agents)).toBe('unknown-agent');
    });
  });

  describe('edge cases', () => {
    it('handles undefined space gracefully', () => {
      expect(() => resolveAgentName('senior-architect', undefined)).not.toThrow();
    });

    it('nickname takes priority over static map', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': 'Boss' } });
      expect(resolveAgentName('senior-architect', space)).toBe('Boss');
    });
  });
});

// ---------------------------------------------------------------------------
// resolveAgentShortLabel
// ---------------------------------------------------------------------------

describe('resolveAgentShortLabel', () => {
  describe('level 1: nickname truncation', () => {
    it('returns nickname as-is when ≤ 6 characters', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': 'Boss' } });
      expect(resolveAgentShortLabel('senior-architect', space)).toBe('Boss');
    });

    it('returns nickname as-is when exactly 6 characters', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': 'El Jef' } });
      expect(resolveAgentShortLabel('senior-architect', space)).toBe('El Jef');
    });

    it('truncates nickname to 6 chars + ellipsis when longer', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': 'El Jefe' } });
      expect(resolveAgentShortLabel('senior-architect', space)).toBe('El Jef…');
    });

    it('truncates longer nickname correctly', () => {
      const space = makeSpace({ agentNicknames: { 'developer-agent': 'Arquitecto Principal' } });
      expect(resolveAgentShortLabel('developer-agent', space)).toBe('Arquit…');
    });

    it('falls through when nickname is empty string', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': '' } });
      expect(resolveAgentShortLabel('senior-architect', space)).toBe('Architect');
    });

    it('falls through when nickname is whitespace-only', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': '   ' } });
      expect(resolveAgentShortLabel('senior-architect', space)).toBe('Architect');
    });
  });

  describe('level 2: STAGE_LABELS static map', () => {
    it('returns "Architect" for senior-architect with no space', () => {
      expect(resolveAgentShortLabel('senior-architect', null)).toBe('Architect');
    });

    it('returns "UX" for ux-api-designer', () => {
      expect(resolveAgentShortLabel('ux-api-designer', null)).toBe('UX');
    });

    it('returns "Dev" for developer-agent', () => {
      expect(resolveAgentShortLabel('developer-agent', null)).toBe('Dev');
    });

    it('returns "QA" for qa-engineer-e2e', () => {
      expect(resolveAgentShortLabel('qa-engineer-e2e', null)).toBe('QA');
    });

    it('returns "Rev" for code-reviewer', () => {
      expect(resolveAgentShortLabel('code-reviewer', null)).toBe('Rev');
    });

    it('returns "Orch" for orchestrator', () => {
      expect(resolveAgentShortLabel('orchestrator', null)).toBe('Orch');
    });
  });

  describe('level 3: agentId.split("-")[0] fallback', () => {
    it('returns first segment of unknown agent ID', () => {
      expect(resolveAgentShortLabel('custom-bot-agent', null)).toBe('custom');
    });

    it('returns the full ID when there are no hyphens', () => {
      expect(resolveAgentShortLabel('bot', null)).toBe('bot');
    });
  });

  describe('edge cases', () => {
    it('handles undefined space gracefully', () => {
      expect(() => resolveAgentShortLabel('senior-architect', undefined)).not.toThrow();
    });

    it('nickname takes priority over static short label', () => {
      const space = makeSpace({ agentNicknames: { 'senior-architect': 'Chief' } });
      expect(resolveAgentShortLabel('senior-architect', space)).toBe('Chief');
    });
  });
});
