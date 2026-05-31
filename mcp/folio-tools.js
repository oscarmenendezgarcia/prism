/**
 * Folio — MCP Adapter (folio-tools.js)
 *
 * Exports `registerFolioTools(server, service)` — a thin, logic-free adapter
 * that maps each Folio MCP tool 1:1 onto the FolioService facade.
 *
 * No business logic lives here beyond:
 *   • slug parsing (chapter/page split, # section detection)
 *   • folio-existence guard for write tools (Trade-off 2.3 from blueprint)
 *   • file-backend refusal for folio_delete (R1 from ADR)
 *   • result shaping to MCP { content, isError } format
 *
 * This module imports ONLY `zod` — it never selects a backend, never touches
 * space_id, and is shared by the standalone stdio server today and the future
 * Prism in-process server unchanged.
 *
 * Wiring note: not connected to mcp/mcp-server.js (HTTP/kanban-coupled).
 * Full wiring is deferred to the Folio HTTP API task. The standalone entry
 * point is mcp/folio-mcp-server.js.
 *
 * Tools registered (11 total):
 *   Read:   folio_search, folio_get_page, folio_list_chapters,
 *           folio_list_attachments, folio_get_attachment
 *   Write:  folio_create_page, folio_update_page, folio_delete_page
 *   Mgmt:   folio_list, folio_create, folio_delete
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a successful result in the MCP content shape.
 * @param {string} text
 * @returns {{ content: Array<{type:string,text:string}> }}
 */
function ok(text) {
  return { content: [{ type: 'text', text }] };
}

/**
 * Wrap a successful image result in the MCP content shape.
 * @param {string} data   base64 encoded
 * @param {string} mimeType
 * @returns {{ content: Array<{type:string,data:string,mimeType:string}> }}
 */
function okImage(data, mimeType) {
  return { content: [{ type: 'image', data, mimeType }] };
}

/**
 * Wrap an error message in the MCP error shape.
 * @param {string} message
 * @returns {{ content: Array<{type:string,text:string}>, isError: true }}
 */
function err(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Parse a page slug ("chapter/page") — returns parts or an error response.
 * @param {string} slug
 * @returns {{ chapterSlug: string, pageSlug: string } | { errorResponse: object }}
 */
function parsePageSlug(slug) {
  const parts = slug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { errorResponse: err(`Invalid slug "${slug}": must be "chapter/page"`) };
  }
  return { chapterSlug: parts[0], pageSlug: parts[1] };
}

/**
 * Resolve a page by slug from a folio. Returns the page or an error response.
 * @param {object} service  FolioService
 * @param {string} folioId
 * @param {string} slug     "chapter/page"
 * @returns {{ page: object } | { errorResponse: object }}
 */
function resolvePageBySlug(service, folioId, slug) {
  const parsed = parsePageSlug(slug);
  if (parsed.errorResponse) return parsed;
  const { chapterSlug, pageSlug } = parsed;
  const page = service.getPageBySlug(folioId, chapterSlug, pageSlug);
  if (!page) {
    return { errorResponse: err(`Not found: ${slug}`) };
  }
  return { page };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

/**
 * Register all 11 Folio MCP tools on an MCP McpServer instance.
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
        return ok(JSON.stringify(
          results.map(({ page, score }) => ({
            slug:    `${page.chapterSlug}/${page.slug}`,
            title:   page.title,
            score,
            snippet: page.content.slice(0, 200),
          })),
          null,
          2,
        ));
      } catch (e) {
        return err(`Error: ${e.message}`);
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
            return err(`Not found: ${slug}`);
          }
          return ok(content);
        }

        // Whole-page request
        const parsed = parsePageSlug(slug);
        if (parsed.errorResponse) return parsed.errorResponse;
        const { chapterSlug, pageSlug } = parsed;
        const page = service.getPageBySlug(folioId, chapterSlug, pageSlug);
        if (!page) {
          return err(`Not found: ${slug}`);
        }
        return ok(JSON.stringify(page, null, 2));
      } catch (e) {
        return err(`Error: ${e.message}`);
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
        return ok(JSON.stringify(result, null, 2));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );

  // ── folio_list_attachments ────────────────────────────────────────────────
  // NOTE: folioId is required (task signature used slug-only shorthand, but
  // a page slug is unique only per folio — see blueprint Trade-off 2.2).

  server.tool(
    'folio_list_attachments',
    'List attachment metadata (id, name, mimeType, size) for a Folio page. No blob bytes.',
    {
      slug:    z.string().describe('Page slug as "chapter/page"'),
      folioId: z.string().describe('Folio UUID'),
    },
    async ({ slug, folioId }) => {
      try {
        const resolved = resolvePageBySlug(service, folioId, slug);
        if (resolved.errorResponse) return resolved.errorResponse;
        const { page } = resolved;
        const attachments = service.listAttachments(folioId, page.id);
        return ok(JSON.stringify(
          attachments.map((a) => ({
            id:       a.id,
            name:     a.name,
            mimeType: a.mimeType,
            ...(a.size !== undefined ? { size: a.size } : {}),
          })),
          null,
          2,
        ));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );

  // ── folio_get_attachment ──────────────────────────────────────────────────

  server.tool(
    'folio_get_attachment',
    'Get an attachment blob from a Folio page. Images returned as MCP image content; other types as base64 JSON envelope.',
    {
      slug:    z.string().describe('Page slug as "chapter/page"'),
      name:    z.string().describe('Attachment file name'),
      folioId: z.string().describe('Folio UUID'),
    },
    async ({ slug, name, folioId }) => {
      try {
        const resolved = resolvePageBySlug(service, folioId, slug);
        if (resolved.errorResponse) return resolved.errorResponse;
        const { page } = resolved;

        // Find by name in the attachment list (listAttachments = metadata only)
        const attachments = service.listAttachments(folioId, page.id);
        const meta        = attachments.find((a) => a.name === name);
        if (!meta) {
          return err(`Attachment "${name}" not found on page "${slug}"`);
        }

        // Fetch the full blob
        const att = service.getAttachment(folioId, meta.id);
        if (!att || !att.data) {
          return err(`Attachment "${name}" data not found on page "${slug}"`);
        }

        const base64 = Buffer.isBuffer(att.data)
          ? att.data.toString('base64')
          : Buffer.from(att.data).toString('base64');

        if (att.mimeType && att.mimeType.startsWith('image/')) {
          return okImage(base64, att.mimeType);
        }

        return ok(JSON.stringify({ name: att.name, mimeType: att.mimeType, base64 }));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );

  // ── folio_create_page ─────────────────────────────────────────────────────
  // Hardened: guard with getFolio(folioId) first (createIfMissing:false at MCP
  // edge — blueprint Trade-off 2.3). Author is always 'agent'.

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
        // Activation guard: agents must not back-door-create a folio
        const folio = service.getFolio(folioId);
        if (!folio) {
          return err(`Folio not active: ${folioId}`);
        }
        const page = service.createPage(folioId, slug, content, {
          author: 'agent',
          title,
        });
        return ok(JSON.stringify(page, null, 2));
      } catch (e) {
        const isConflict = e.name === 'FolioConflictError' || e.code === 'FOLIO_CONFLICT';
        return err(`${isConflict ? 'Conflict' : 'Error'}: ${e.message}`);
      }
    },
  );

  // ── folio_update_page ─────────────────────────────────────────────────────

  server.tool(
    'folio_update_page',
    'Update the content of an existing Folio page. Title and pin state updates are out of v1 scope.',
    {
      slug:    z.string().describe('Page slug as "chapter/page"'),
      content: z.string().describe('New page content in Markdown'),
      folioId: z.string().describe('Folio UUID'),
    },
    async ({ slug, content, folioId }) => {
      try {
        const resolved = resolvePageBySlug(service, folioId, slug);
        if (resolved.errorResponse) return resolved.errorResponse;
        const { page } = resolved;
        const updated = service.updatePage(folioId, page.id, { content });
        return ok(JSON.stringify(updated, null, 2));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );

  // ── folio_delete_page ─────────────────────────────────────────────────────

  server.tool(
    'folio_delete_page',
    'Delete a Folio page by slug. Returns { deleted: true } on success or { deleted: false } if not found.',
    {
      slug:    z.string().describe('Page slug as "chapter/page"'),
      folioId: z.string().describe('Folio UUID'),
    },
    async ({ slug, folioId }) => {
      try {
        const resolved = resolvePageBySlug(service, folioId, slug);
        if (resolved.errorResponse) {
          // Unknown slug → not found, not an error
          return ok(JSON.stringify({ deleted: false }));
        }
        const { page } = resolved;
        const deleted = service.deletePage(folioId, page.id);
        return ok(JSON.stringify({ deleted }));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );

  // ── folio_list ────────────────────────────────────────────────────────────

  server.tool(
    'folio_list',
    'List all folios in the backend. Returns [{ id, name, createdAt }].',
    {},
    async () => {
      try {
        const folios = service.listFolios();
        return ok(JSON.stringify(
          folios.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt })),
          null,
          2,
        ));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );

  // ── folio_create ──────────────────────────────────────────────────────────

  server.tool(
    'folio_create',
    'Create a new Folio. This is an explicit user gesture — agents should not call this on behalf of users without confirmation.',
    {
      name: z.string().min(1).describe('Human-readable folio name'),
    },
    async ({ name }) => {
      try {
        const folio = service.createFolio({ name });
        return ok(JSON.stringify({ id: folio.id, name: folio.name, createdAt: folio.createdAt }));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );

  // ── folio_delete ──────────────────────────────────────────────────────────
  // DESTRUCTIVE. Refused on the file backend (R1 from ADR — an agent must
  // not be able to wipe a user's .folio/ working directory).

  server.tool(
    'folio_delete',
    'Delete a Folio and ALL its chapters, pages, attachments and FTS rows. DESTRUCTIVE. Not available on the file backend.',
    {
      folioId: z.string().describe('Folio UUID to delete'),
    },
    async ({ folioId }) => {
      try {
        // File-backend guard — agents must not wipe the user's .folio/ dir
        if (service.backend && service.backend.kind === 'file') {
          return err('folio-level delete unsupported on file backend; use the CLI');
        }
        const deleted = service.deleteFolio(folioId);
        return ok(JSON.stringify({ deleted }));
      } catch (e) {
        return err(`Error: ${e.message}`);
      }
    },
  );
}
