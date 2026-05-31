/**
 * Folio — MCP Adapter Scaffold (folio-tools.js)
 *
 * Exports `registerFolioTools(server, service)` which registers the initial
 * set of Folio MCP tools against an MCP McpServer instance.
 *
 * The `service` is a FolioService produced by `createFolioService(backend)`.
 * This file is intentionally decoupled from the backend selection — the
 * caller (a future in-process Prism MCP server, a standalone HTTP wrapper,
 * or the folio CLI) provides the wired service.
 *
 * Wiring note: the current `mcp/mcp-server.js` is HTTP-coupled (calls the
 * Prism REST API via kanban-client.js).  Folio does not yet have a REST API,
 * so registerFolioTools is NOT wired into mcp-server.js in this task.
 * Full wiring is deferred to the Folio HTTP API task (board task #3 / future).
 * A future `folio mcp` command will run a standalone MCP server that wires
 * the file backend and calls registerFolioTools in-process.
 *
 * Tools registered here (board task #1 scope):
 *   folio_search         — FTS5/BM25 search
 *   folio_get_page       — get a page by slug (or slug#section via resolver)
 *   folio_list_chapters  — list chapters in a folio
 *   folio_create_page    — create a page (author='agent', createIfMissing semantics deferred)
 *
 * Full CRUD + attachment + folio-management tools are board task #3.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register Folio MCP tools on an MCP McpServer.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {object} service  — FolioService from createFolioService(backend)
 */
export function registerFolioTools(server, service) {

  // ── folio_search ──────────────────────────────────────────────────────────

  server.tool(
    'folio_search',
    'Search Folio pages using FTS5/BM25 ranking. Returns ranked pages matching the query.',
    {
      query:   z.string().min(1).describe('Full-text search query'),
      folioId: z.string().describe('Folio UUID to search within'),
      limit:   z.number().int().min(1).max(100).optional().describe('Maximum results (default 20)'),
    },
    async ({ query, folioId, limit }) => {
      try {
        const results = service.searchPages(folioId, query, { limit });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              results.map(({ page, score }) => ({
                slug:    `${page.chapterSlug}/${page.slug}`,
                title:   page.title,
                score,
                snippet: page.content.slice(0, 200),
              })),
              null,
              2,
            ),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── folio_get_page ────────────────────────────────────────────────────────

  server.tool(
    'folio_get_page',
    'Get a Folio page by slug ("chapter/page") or a specific H2 section ("chapter/page#section-slug").',
    {
      slug:    z.string().describe('Page slug as "chapter/page" or "chapter/page#section-slug"'),
      folioId: z.string().describe('Folio UUID'),
    },
    async ({ slug, folioId }) => {
      try {
        const hashIdx = slug.indexOf('#');
        if (hashIdx !== -1) {
          // Section request — resolve via resolveRefs
          const ref     = `[[${slug}]]`;
          const content = service.resolveRefs(ref, folioId);
          if (content === ref) {
            // Still unreplaced — page or section not found
            return {
              content: [{ type: 'text', text: `Not found: ${slug}` }],
              isError: true,
            };
          }
          return { content: [{ type: 'text', text: content }] };
        }

        // Whole-page request
        const parts = slug.split('/');
        if (parts.length !== 2) {
          return {
            content: [{ type: 'text', text: `Invalid slug "${slug}": must be "chapter/page"` }],
            isError: true,
          };
        }
        const [chapterSlug, pageSlug] = parts;
        const page = service.getPageBySlug(folioId, chapterSlug, pageSlug);
        if (!page) {
          return { content: [{ type: 'text', text: `Not found: ${slug}` }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── folio_list_chapters ───────────────────────────────────────────────────

  server.tool(
    'folio_list_chapters',
    'List all chapters in a Folio with their page counts.',
    {
      folioId: z.string().describe('Folio UUID'),
    },
    async ({ folioId }) => {
      try {
        const chapters = service.listChapters(folioId);
        const result   = chapters.map((ch) => ({
          slug:     ch.slug,
          title:    ch.title,
          position: ch.position,
          pages:    service.listPages(folioId, ch.slug).length,
        }));
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // ── folio_create_page ─────────────────────────────────────────────────────

  server.tool(
    'folio_create_page',
    'Create a new Folio page. The chapter is created automatically if absent. Author is always "agent".',
    {
      slug:    z.string().describe('Full slug as "chapter/page"'),
      content: z.string().describe('Page content in Markdown'),
      folioId: z.string().describe('Folio UUID'),
      title:   z.string().optional().describe('Page title (inferred from slug if absent)'),
    },
    async ({ slug, content, folioId, title }) => {
      try {
        const page = service.createPage(folioId, slug, content, {
          author: 'agent',
          title,
        });
        return { content: [{ type: 'text', text: JSON.stringify(page, null, 2) }] };
      } catch (err) {
        const isConflict = err.name === 'FolioConflictError' || err.code === 'FOLIO_CONFLICT';
        return {
          content: [{ type: 'text', text: `${isConflict ? 'Conflict' : 'Error'}: ${err.message}` }],
          isError: true,
        };
      }
    },
  );
}
