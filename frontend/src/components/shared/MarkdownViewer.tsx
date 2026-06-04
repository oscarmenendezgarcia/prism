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
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { useAppStore } from '@/stores/useAppStore';
import { useFolioStore } from '@/stores/useFolioStore';

// ---------------------------------------------------------------------------
// Folio reference linkification
// ---------------------------------------------------------------------------

/**
 * A complete reference: [[chapter/page]] or [[chapter/page#section]].
 * Slug grammar mirrors the Folio core (lowercase alphanumerics + hyphens).
 * Incomplete/whitespace tokens (mid-typing) never match — only finished refs.
 */
const FOLIO_REF_RE = /\[\[([a-z0-9-]+\/[a-z0-9-]+(?:#[a-z0-9-]+)?)\]\]/g;

/**
 * Rewrite the raw markdown so each complete [[chapter/page]] becomes a real
 * markdown link with a `folio:` destination — e.g. `[\[\[a/b\]\]](folio:a/b)`,
 * which renders the bracketed text and an href the <a> renderer intercepts.
 *
 * Done on the SOURCE STRING, not the mdast: CommonMark parses `[[…]]` as
 * bracketed link-reference syntax, so the full token never survives as a single
 * text node a tree visitor could catch (it gets split across nodes). The link
 * text keeps escaped brackets so the reader still sees `[[a/b]]`.
 */
function linkifyFolioRefs(src: string): string {
  const replaceRefs = (segment: string) =>
    segment.replace(FOLIO_REF_RE, (full, slug) => {
      const text = full.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
      return `[${text}](folio:${slug})`;
    });

  // Keep code verbatim: a [[ref]] inside a fenced block or inline code is
  // literal text, and rewriting it there would both be wrong and corrupt the
  // code. Tokenise into code / non-code and only linkify the non-code parts.
  const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = CODE.exec(src)) !== null) {
    out += replaceRefs(src.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += replaceRefs(src.slice(last));
  return out;
}

/**
 * Renders a clicked folio reference: opens the Folio panel and navigates to the
 * referenced page (section anchors are stripped — we open the page). The folio
 * is space-scoped, so this resolves against the active space's folio.
 */
function FolioRefLink({ slug, children }: { slug: string; children: React.ReactNode }) {
  const openFolio = useAppStore((s) => s.openFolio);
  const openPage  = useFolioStore((s) => s.openPage);

  const navigate = () => {
    const slashIdx = slug.indexOf('/');
    if (slashIdx === -1) return;
    const chapterSlug = slug.slice(0, slashIdx);
    const pageSlug    = slug.slice(slashIdx + 1).split('#')[0];
    if (!chapterSlug || !pageSlug) return;
    openFolio();
    void openPage(chapterSlug, pageSlug);
  };

  return (
    <button
      type="button"
      onClick={navigate}
      className="text-primary font-medium hover:underline underline-offset-2 rounded-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      title={`Open folio page: ${slug}`}
    >
      {children}
    </button>
  );
}

interface MarkdownViewerProps {
  /** The raw markdown string to render. */
  content: string;
  /** Extra classes applied to the wrapper div. */
  className?: string;
  /**
   * Rendering variant:
   * - "default": compact styles (text-sm, leading-relaxed) — for previews/panels.
   * - "prose": comfortable reading styles (text-base, leading-[1.7]) — for the document reader.
   */
  variant?: 'default' | 'prose';
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
    <blockquote className="border-l-4 border-primary/50 pl-4 py-1 my-3 bg-primary-container/30 rounded-r-md text-text-secondary italic [&>p]:mb-0">
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
    <pre className="bg-surface-variant border border-border rounded-md p-4 my-3 overflow-x-auto text-sm font-mono text-text-primary whitespace-pre leading-relaxed">
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
      <table className="w-full text-sm border-collapse">
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

  a: ({ href, children }) => {
    // Folio references ([[chapter/page]]) are encoded as folio: links by the
    // remarkFolioRefs plugin — render them as in-app navigation, not <a href>.
    if (href && href.startsWith('folio:')) {
      return <FolioRefLink slug={href.slice('folio:'.length)}>{children}</FolioRefLink>;
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary-hover transition-colors duration-150"
      >
        {children}
      </a>
    );
  },

  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),

  em: ({ children }) => (
    <em className="italic text-text-secondary">{children}</em>
  ),

  del: ({ children }) => (
    <del className="line-through text-text-disabled">{children}</del>
  ),

  // ── Images ─────────────────────────────────────────────────────────────

  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ''}
      className="max-w-full h-auto rounded-md my-3 border border-border/60"
      loading="lazy"
    />
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

/**
 * Element-level renderers for prose variant — larger text and comfortable
 * line-height for long-form document reading.
 */
const proseComponents: Components = {
  ...components,

  p: ({ children }) => (
    <p className="text-base text-text-secondary leading-[1.7] mb-4 last:mb-0">
      {children}
    </p>
  ),

  // Inline code in prose: text-sm so it doesn't feel tiny next to text-base body.
  code: ({ children, className: langClassName }) => {
    if (langClassName) {
      return (
        <code className={`${langClassName} text-xs font-mono text-text-primary`}>
          {children}
        </code>
      );
    }
    return (
      <code className="px-1.5 py-0.5 rounded-xs bg-surface-variant border border-border/60 text-sm font-mono text-primary">
        {children}
      </code>
    );
  },

  ul: ({ children }) => (
    <ul className="list-disc list-outside pl-5 mb-4 space-y-1.5 text-base text-text-primary">
      {children}
    </ul>
  ),

  ol: ({ children }) => (
    <ol className="list-decimal list-outside pl-5 mb-4 space-y-1.5 text-base text-text-primary">
      {children}
    </ol>
  ),

  li: ({ children }) => (
    <li className="leading-[1.7] pl-1">{children}</li>
  ),
};

export function MarkdownViewer({ content, className = '', variant = 'default' }: MarkdownViewerProps) {
  const resolvedComponents = variant === 'prose' ? proseComponents : components;
  // Turn [[chapter/page]] into folio: links before parsing (see linkifyFolioRefs).
  const source = React.useMemo(() => linkifyFolioRefs(content), [content]);
  return (
    <div className={`markdown-viewer ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Preserve the folio: scheme; react-markdown's default transform would strip it.
        urlTransform={(url) => (url.startsWith('folio:') ? url : defaultUrlTransform(url))}
        components={resolvedComponents}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
