/**
 * Prism — Pipeline Template route handlers
 *
 * Routes:
 *   GET    /api/v1/pipeline-templates            → handleListTemplates
 *   POST   /api/v1/pipeline-templates            → handleCreateTemplate
 *   GET    /api/v1/pipeline-templates/:id        → handleGetTemplate
 *   PUT    /api/v1/pipeline-templates/:id        → handleUpdateTemplate
 *   DELETE /api/v1/pipeline-templates/:id        → handleDeleteTemplate
 */

'use strict';

const { sendJSON, sendError, parseBody } = require('../utils/http');
const { createTemplateManager }          = require('../services/templateManager');

// ---------------------------------------------------------------------------
// Route patterns (compiled once at module load)
// NOTE: TEMPLATES_LIST_ROUTE must be checked BEFORE TEMPLATES_SINGLE_ROUTE
// so that GET /api/v1/pipeline-templates doesn't match the single-id regex.
// ---------------------------------------------------------------------------

const TEMPLATES_LIST_ROUTE   = /^\/api\/v1\/pipeline-templates$/;
const TEMPLATES_SINGLE_ROUTE = /^\/api\/v1\/pipeline-templates\/([^/]+)$/;

// ---------------------------------------------------------------------------
// Handler factory — accepts dataDir so the manager is bound to the right dir
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/pipeline-templates
 */
async function handleListTemplates(req, res, dataDir) {
  const tm = createTemplateManager(dataDir);
  return sendJSON(res, 200, tm.listTemplates());
}

/**
 * POST /api/v1/pipeline-templates
 */
async function handleCreateTemplate(req, res, dataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const tm     = createTemplateManager(dataDir);
  const result = tm.createTemplate(body);

  if (!result.ok) {
    const status = result.code === 'DUPLICATE_NAME' ? 409 : 400;
    return sendError(res, status, result.code, result.message);
  }

  return sendJSON(res, 201, result.template);
}

/**
 * GET /api/v1/pipeline-templates/:id
 */
async function handleGetTemplate(req, res, templateId, dataDir) {
  const tm     = createTemplateManager(dataDir);
  const result = tm.getTemplate(templateId);

  if (!result.ok) {
    return sendError(res, 404, result.code, result.message);
  }

  return sendJSON(res, 200, result.template);
}

/**
 * PUT /api/v1/pipeline-templates/:id
 */
async function handleUpdateTemplate(req, res, templateId, dataDir) {
  let body;
  try {
    body = await parseBody(req);
  } catch (err) {
    return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  const tm     = createTemplateManager(dataDir);
  const result = tm.updateTemplate(templateId, body);

  if (!result.ok) {
    const status = result.code === 'TEMPLATE_NOT_FOUND' ? 404 : 400;
    return sendError(res, status, result.code, result.message);
  }

  return sendJSON(res, 200, result.template);
}

/**
 * DELETE /api/v1/pipeline-templates/:id
 */
async function handleDeleteTemplate(req, res, templateId, dataDir) {
  const tm     = createTemplateManager(dataDir);
  const result = tm.deleteTemplate(templateId);

  if (!result.ok) {
    return sendError(res, 404, result.code, result.message);
  }

  return sendJSON(res, 200, { deleted: true, id: result.id });
}

module.exports = {
  TEMPLATES_LIST_ROUTE,
  TEMPLATES_SINGLE_ROUTE,
  handleListTemplates,
  handleCreateTemplate,
  handleGetTemplate,
  handleUpdateTemplate,
  handleDeleteTemplate,
};
