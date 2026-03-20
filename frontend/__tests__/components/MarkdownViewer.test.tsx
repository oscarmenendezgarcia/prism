import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownViewer } from '../../src/components/shared/MarkdownViewer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMd(content: string, className?: string) {
  return render(<MarkdownViewer content={content} className={className} />);
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

describe('MarkdownViewer — wrapper', () => {
  it('renders a wrapper div with markdown-viewer class', () => {
    const { container } = renderMd('Hello');
    expect(container.firstChild).toHaveClass('markdown-viewer');
  });

  it('forwards extra className to the wrapper', () => {
    const { container } = renderMd('x', 'extra-class');
    expect(container.firstChild).toHaveClass('extra-class');
  });

  it('renders empty content without crashing', () => {
    const { container } = renderMd('');
    expect(container.firstChild).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

describe('MarkdownViewer — headings', () => {
  it('renders h1', () => {
    renderMd('# Title');
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
  });

  it('renders h2', () => {
    renderMd('## Section');
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
  });

  it('renders h3', () => {
    renderMd('### Sub');
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeInTheDocument();
  });

  it('renders h4', () => {
    renderMd('#### H4');
    expect(screen.getByRole('heading', { level: 4, name: 'H4' })).toBeInTheDocument();
  });

  it('renders h5', () => {
    renderMd('##### H5');
    expect(screen.getByRole('heading', { level: 5, name: 'H5' })).toBeInTheDocument();
  });

  it('renders h6', () => {
    renderMd('###### H6');
    expect(screen.getByRole('heading', { level: 6, name: 'H6' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Paragraphs and inline elements
// ---------------------------------------------------------------------------

describe('MarkdownViewer — paragraphs and inline elements', () => {
  it('renders a plain paragraph', () => {
    renderMd('Hello world');
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders bold text', () => {
    renderMd('**bold**');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders italic text', () => {
    renderMd('*italic*');
    expect(screen.getByText('italic').tagName).toBe('EM');
  });

  it('renders strikethrough (GFM)', () => {
    renderMd('~~strike~~');
    expect(screen.getByText('strike').tagName).toBe('DEL');
  });

  it('renders inline code', () => {
    renderMd('use `foo()` here');
    expect(screen.getByText('foo()')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('MarkdownViewer — links', () => {
  it('renders a link with correct href', () => {
    renderMd('[Click](https://example.com)');
    const link = screen.getByRole('link', { name: 'Click' });
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('opens links in a new tab', () => {
    renderMd('[link](https://example.com)');
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

describe('MarkdownViewer — lists', () => {
  it('renders an unordered list', () => {
    renderMd('- Item A\n- Item B');
    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('Item B')).toBeInTheDocument();
  });

  it('renders an ordered list', () => {
    renderMd('1. First\n2. Second');
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('renders GFM task list checkboxes', () => {
    renderMd('- [x] Done\n- [ ] Todo');
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

describe('MarkdownViewer — code blocks', () => {
  it('renders a fenced code block inside a pre element', () => {
    const { container } = renderMd('```\nconsole.log("hi")\n```');
    const pre = container.querySelector('pre');
    expect(pre).toBeInTheDocument();
    expect(pre?.textContent).toContain('console.log');
  });

  it('renders a fenced code block with language class', () => {
    const { container } = renderMd('```typescript\nconst x = 1;\n```');
    const code = container.querySelector('code.language-typescript');
    expect(code).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Blockquote
// ---------------------------------------------------------------------------

describe('MarkdownViewer — blockquote', () => {
  it('renders a blockquote', () => {
    const { container } = renderMd('> quoted text');
    const bq = container.querySelector('blockquote');
    expect(bq).toBeInTheDocument();
    expect(bq?.textContent).toContain('quoted text');
  });
});

// ---------------------------------------------------------------------------
// Horizontal rule
// ---------------------------------------------------------------------------

describe('MarkdownViewer — horizontal rule', () => {
  it('renders a horizontal rule', () => {
    const { container } = renderMd('---');
    expect(container.querySelector('hr')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// GFM Tables
// ---------------------------------------------------------------------------

describe('MarkdownViewer — GFM tables', () => {
  const TABLE_MD = `
| Name | Age |
|------|-----|
| Alice | 30 |
| Bob   | 25 |
`.trim();

  it('renders a table element', () => {
    const { container } = renderMd(TABLE_MD);
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  it('renders thead and tbody', () => {
    const { container } = renderMd(TABLE_MD);
    expect(container.querySelector('thead')).toBeInTheDocument();
    expect(container.querySelector('tbody')).toBeInTheDocument();
  });

  it('renders header cells', () => {
    renderMd(TABLE_MD);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
  });

  it('renders data cells', () => {
    renderMd(TABLE_MD);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Complex document
// ---------------------------------------------------------------------------

describe('MarkdownViewer — complex document', () => {
  const COMPLEX = `
# ADR-1: Authentication

## Status
Accepted

## Context
We need **secure** authentication.

- Option A: JWT
- Option B: sessions

\`\`\`typescript
const token = sign(payload, secret);
\`\`\`

> Prefer stateless tokens for scalability.

---

| Criterion | JWT | Session |
|-----------|-----|---------|
| Stateless | Yes | No      |
`.trim();

  it('renders all major elements without crashing', () => {
    renderMd(COMPLEX);
    expect(screen.getByRole('heading', { level: 1, name: 'ADR-1: Authentication' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('secure')).toBeInTheDocument();
    expect(screen.getByText('Option A: JWT')).toBeInTheDocument();
  });
});
