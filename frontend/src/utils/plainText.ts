/**
 * A Markdown description as one line of plain text, for the preview on a card. It reads the
 * Markdown with the same parser as the panel, so that both agree on what is a symbol and what
 * is text, as in `__init__.py`.
 */

import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

interface MarkdownNode {
  type: string;
  value?: string;
  alt?: string;
  children?: MarkdownNode[];
}

const parser = unified().use(remarkParse).use(remarkGfm);

/** A card shows two lines: this is plenty, and the rest would only slow down the board. */
const MAX_CHARS = 500;

const CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem', 'table']);

function inlineText(node: MarkdownNode): string {
  if (node.type === 'image') return node.alt ?? '';
  if (node.type === 'break' || node.type === 'tableCell') return ` ${(node.children ?? []).map(inlineText).join('')} `;
  return node.value ?? (node.children ?? []).map(inlineText).join('');
}

function blocksOf(node: MarkdownNode): string[] {
  if (CONTAINERS.has(node.type)) return (node.children ?? []).flatMap(blocksOf);
  if (node.type === 'definition' || node.type === 'footnoteDefinition' || node.type === 'thematicBreak') return [];
  return [inlineText(node)];
}

/** Its blocks are split by dots: "Problem · It fails on login · Only on mobile". */
export function plainText(markdown: string): string {
  const root = parser.parse(markdown.slice(0, MAX_CHARS)) as MarkdownNode;
  return blocksOf(root)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
}
