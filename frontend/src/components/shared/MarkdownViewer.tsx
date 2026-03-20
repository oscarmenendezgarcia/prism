/**
 * MarkdownViewer — renders a markdown string as styled HTML.
 *
 * Uses react-markdown + remark-gfm (GFM: tables, strikethrough, task lists,
 * autolinks). All element styles use design-system Tailwind tokens so the
 * component respects the dark/light theme without any inline styles.
 *
 * Usage:
 *   <MarkdownViewer content="# Hello\n\nWorld" />
 *   <MarkdownViewer content={md} className="max-h-96 overflow-y-auto" />
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownViewerProps {
  /** The raw markdown string to render. */
  content: string;
  /** Extra classes applied to the wrapper div. */
  className?: string;
}

/**
 * Element-level renderers that translate markdown AST nodes to Tailwind-
 * styled HTML. Every colour and spacing value comes from a design token.
 */
const components: Components = {
  // ── Block elements ─────────────────────────────────────────────────────

  h1: ({ children }) => (
    <h1 className="text-2xl font-bold text-text-primary mt-6 mb-3 pb-2 border-b border-border first:mt-0">
      {children}
    </h1>
  ),

  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-text-primary mt-5 mb-2 pb-1 border-b border-border/60">
      {children}
    </h2>
  ),

  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-text-primary mt-4 mb-2">
      {children}
    </h3>
  ),

  h4: ({ children }) => (
    <h4 className="text-base font-semibold text-text-primary mt-3 mb-1">
      {children}
    </h4>
  ),

  h5: ({ children }) => (
    <h5 className="text-sm font-semibold text-text-secondary mt-3 mb-1">
      {children}
    </h5>
  ),

  h6: ({ children }) => (
    <h6 className="text-xs font-semibold text-text-disabled uppercase tracking-wide mt-3 mb-1">
      {children}
    </h6>
  ),

  p: ({ children }) => (
    <p className="text-sm text-text-primary leading-relaxed mb-3 last:mb-0">
      {children}
    </p>
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-primary/50 pl-4 py-1 my-3 bg-primary-container/30 rounded-r-md text-text-secondary italic">
      {children}
    </blockquote>
  ),

  // ── Lists ──────────────────────────────────────────────────────────────

  ul: ({ children }) => (
    <ul className="list-disc list-outside pl-5 mb-3 space-y-1 text-sm text-text-primary">
      {children}
    </ul>
  ),

  ol: ({ children }) => (
    <ol className="list-decimal list-outside pl-5 mb-3 space-y-1 text-sm text-text-primary">
      {children}
    </ol>
  ),

  li: ({ children }) => (
    <li className="leading-relaxed pl-1">{children}</li>
  ),

  // ── Code ───────────────────────────────────────────────────────────────

  /** Fenced code blocks — uses mono font + surface-variant bg */
  pre: ({ children }) => (
    <pre className="bg-surface-variant border border-border rounded-md p-4 my-3 overflow-x-auto text-sm font-mono text-text-primary whitespace-pre leading-snug">
      {children}
    </pre>
  ),

  /**
   * Inline code vs. fenced code block.
   * react-markdown passes the `node` prop; fenced code appears as <pre><code>.
   * When inside a <pre> the <pre> already handles styling, so we omit the
   * inline pill styles.
   */
  code: ({ children, className: langClassName }) => {
    // Fenced code (has a language class like "language-ts")
    if (langClassName) {
      return (
        <code className={`${langClassName} text-xs font-mono text-text-primary`}>
          {children}
        </code>
      );
    }
    // Inline code
    return (
      <code className="px-1.5 py-0.5 rounded-xs bg-surface-variant border border-border/60 text-xs font-mono text-primary">
        {children}
      </code>
    );
  },

  // ── Table (GFM) ────────────────────────────────────────────────────────

  table: ({ children }) => (
    <div className="overflow-x-auto my-3 rounded-md border border-border overflow-hidden">
      <table className="w-full text-xs border-collapse">
        {children}
      </table>
    </div>
  ),

  thead: ({ children }) => (
    <thead className="bg-surface-variant">{children}</thead>
  ),

  tbody: ({ children }) => (
    <tbody>{children}</tbody>
  ),

  tr: ({ children }) => (
    <tr className="border-t border-border hover:bg-surface-variant/50 transition-colors duration-100">
      {children}
    </tr>
  ),

  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-text-secondary border-r border-border last:border-r-0">
      {children}
    </th>
  ),

  td: ({ children }) => (
    <td className="px-3 py-2 text-text-primary border-r border-border/40 last:border-r-0">
      {children}
    </td>
  ),

  // ── Inline elements ────────────────────────────────────────────────────

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary-hover transition-colors duration-150"
    >
      {children}
    </a>
  ),

  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),

  em: ({ children }) => (
    <em className="italic text-text-secondary">{children}</em>
  ),

  del: ({ children }) => (
    <del className="line-through text-text-disabled">{children}</del>
  ),

  // ── Horizontal rule ────────────────────────────────────────────────────

  hr: () => <hr className="border-t border-border my-4" />,

  // ── GFM task list checkbox ─────────────────────────────────────────────

  input: ({ type, checked, disabled }) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          readOnly
          className="mr-2 rounded-xs accent-primary cursor-default"
        />
      );
    }
    return null;
  },
};

export function MarkdownViewer({ content, className = '' }: MarkdownViewerProps) {
  return (
    <div className={`markdown-viewer ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
