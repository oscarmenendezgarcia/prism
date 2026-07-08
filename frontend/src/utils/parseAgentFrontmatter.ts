/**
 * parseAgentFrontmatter — defensive YAML-frontmatter extractor for agent .md files.
 *
 * Extracts the `model`, `effort`, and `skills` fields from the YAML front-matter
 * block (between `---` delimiters at the top of the file). Never throws — returns
 * sensible defaults when frontmatter is absent, malformed, or missing keys.
 *
 * Supported skills formats:
 *   skills: [ui-ux-pro-max, design-taste-frontend]          ← inline
 *   skills:                                                 ← block list
 *     - ui-ux-pro-max
 *     - design-taste-frontend
 */

export interface AgentFrontmatter {
  model?:  string;
  effort?: string;
  skills:  string[];
}

/**
 * Parse the YAML frontmatter block from an agent .md file content string.
 * Returns `{ model, effort, skills }` where `skills` is always an array.
 * Returns `{ skills: [] }` on any parse failure.
 */
export function parseAgentFrontmatter(content: string): AgentFrontmatter {
  try {
    if (!content || typeof content !== 'string') return { skills: [] };

    // Front-matter block must start at line 1 with `---`
    const trimmed = content.trimStart();
    if (!trimmed.startsWith('---')) return { skills: [] };

    const afterOpen = trimmed.slice(3);
    const closeIdx = afterOpen.indexOf('\n---');
    if (closeIdx === -1) return { skills: [] };

    const yamlBlock = afterOpen.slice(0, closeIdx);
    return parseYamlBlock(yamlBlock);
  } catch {
    return { skills: [] };
  }
}

// ---------------------------------------------------------------------------
// Internal: minimal YAML parser (only handles the three known keys)
// ---------------------------------------------------------------------------

function parseYamlBlock(block: string): AgentFrontmatter {
  const lines = block.split('\n');
  const result: AgentFrontmatter = { skills: [] };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const rawKey   = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (rawKey === 'model' && rawValue) {
      result.model = unquote(rawValue);
    } else if (rawKey === 'effort' && rawValue) {
      result.effort = unquote(rawValue);
    } else if (rawKey === 'skills') {
      // Inline array: skills: [a, b, c]
      if (rawValue.startsWith('[')) {
        result.skills = parseInlineArray(rawValue);
      } else {
        // Block list: next lines starting with `  - `
        const skills: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].trimStart().startsWith('-')) {
          const item = lines[j].replace(/^\s*-\s*/, '').trim();
          if (item) skills.push(unquote(item));
          j++;
        }
        result.skills = skills;
        i = j;
        continue;
      }
    }

    i++;
  }

  return result;
}

function parseInlineArray(raw: string): string[] {
  // Remove surrounding [ ] and split on comma
  const inner = raw.replace(/^\[/, '').replace(/\].*$/, '');
  return inner
    .split(',')
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
