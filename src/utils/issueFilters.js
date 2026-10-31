'use strict';

/**
 * Which issues a list or a board shows: what the query string says, and the SQL for it.
 * Values of a field are any of them, and fields all at once. An empty value of assignee or
 * epic means having none.
 */

const LIST_FIELDS = ['status', 'assignee', 'type', 'priority', 'epic', 'label'];
const VALID_TYPES = ['feature', 'bug', 'tech-debt', 'chore', 'epic'];
const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const VALID_DUE = ['overdue', 'week', 'none'];
const MAX_VALUE = 200;
const MAX_QUERY = 8000;
const MAX_VALUES = 200;
const MAX_TEXT = 200;

/** The local date, as due dates are written. */
function dayOf(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {URLSearchParams} qs
 * @param {{ types: string[], priorities: string[] }} valid
 * @returns {{ filters: object } | { error: string }}
 */
function parseIssueFilters(qs, { types, priorities }) {
  const filters = {};
  for (const field of LIST_FIELDS) {
    if (!qs.has(field)) continue;
    // Only assignees and epics can be none.
    const values = [...new Set(qs.getAll(field))].filter((v) => v !== '' || field === 'assignee' || field === 'epic');
    if (values.length === 0) continue;
    if (values.length > MAX_VALUES) return { error: `${field} must not exceed ${MAX_VALUES} values` };
    filters[field] = values;
  }
  const wrongType = filters.type?.find((v) => !types.includes(v));
  if (wrongType !== undefined) return { error: `Invalid type '${wrongType}'. Must be one of: ${types.join(', ')}` };
  const wrongPriority = filters.priority?.find((v) => !priorities.includes(v));
  if (wrongPriority !== undefined) return { error: `Invalid priority '${wrongPriority}'. Must be one of: ${priorities.join(', ')}` };

  const due = qs.get('due');
  if (due) {
    if (!VALID_DUE.includes(due)) return { error: `Invalid due '${due}'. Must be one of: ${VALID_DUE.join(', ')}` };
    filters.due = due;
  }
  const today = qs.get('today');
  if (today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return { error: 'today must be a date as YYYY-MM-DD' };
    filters.today = today;
  }
  const q = qs.get('q')?.trim();
  if (q) {
    if (q.length > MAX_TEXT) return { error: `q must not exceed ${MAX_TEXT} characters` };
    filters.q = q;
  }
  return { filters };
}

/**
 * Filters to keep, as the frontend holds them: lists, and due and q as values. They go through
 * the same checks as a query, so that a saved filter never gets a refusal when it is used.
 *
 * @param {unknown} value
 * @returns {{ filters: object } | { error: string }}
 */
function validSavedFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'filters must be an object' };
  const qs = new URLSearchParams();
  for (const [field, values] of Object.entries(value)) {
    if (LIST_FIELDS.includes(field)) {
      if (!Array.isArray(values) || !values.every((v) => typeof v === 'string' && v.length <= MAX_VALUE)) {
        return { error: `${field} must be a list of short texts` };
      }
      for (const one of values) qs.append(field, one);
    } else if (field === 'due' || field === 'q') {
      if (typeof values !== 'string') return { error: `${field} must be a text` };
      qs.set(field, values);
    } else {
      return { error: `Cannot filter by: ${field}` };
    }
  }
  const parsed = parseIssueFilters(qs, { types: VALID_TYPES, priorities: VALID_PRIORITIES });
  if (parsed.error) return parsed;
  if (!isFiltering(parsed.filters)) return { error: 'filters must filter by something' };
  // Past a size, the server refuses the query before anyone reads it.
  if (qs.toString().length > MAX_QUERY) return { error: 'filters are too long to use' };
  return parsed;
}

/** Whether these filters leave anything out. */
function isFiltering(filters = {}) {
  return ['status', 'assignee', 'type', 'priority', 'epic', 'label', 'due', 'q'].some((field) => filters[field] !== undefined);
}

/** The tables the conditions below read: t is the issue, p its parent and g the parent of that. */
const FILTER_JOINS = 'LEFT JOIN tasks p ON p.id = t.parent_id LEFT JOIN tasks g ON g.id = p.parent_id';

/** The epic an issue is in: an epic is in itself, and sub-tasks in that of their parent. */
const EPIC_OF = `CASE WHEN t.type = 'epic' THEN t.id WHEN p.type = 'epic' THEN p.id
  WHEN g.type = 'epic' THEN g.id END`;

/** A named-parameters condition on one field: any of its values, and none at all if it has ''. */
function anyOf(column, values, name, params, encode = (v) => v) {
  const named = values.filter((v) => v !== '');
  const parts = [];
  if (named.length > 0) {
    params[name] = JSON.stringify(named.map(encode));
    parts.push(`${column} IN (SELECT value FROM json_each(@${name}))`);
  }
  if (named.length < values.length) parts.push(`${column} IS NULL`);
  return `(${parts.join(' OR ')})`;
}

/**
 * The conditions of these filters, over FILTER_JOINS.
 *
 * @param {object} filters
 * @param {string|null} [spaceKey] A key with another prefix is not of this space.
 * @returns {{ sql: string, params: object }} sql is a list of `AND ...`, or empty.
 */
function issueConditions(filters = {}, spaceKey = null) {
  const params = {};
  const conditions = [];
  if (filters.status) conditions.push(anyOf('t.status_id', filters.status, 'fStatus', params));
  // Assignees are stored as JSON, like the other optional text of an issue.
  if (filters.assignee) conditions.push(anyOf('t.assigned', filters.assignee, 'fAssignee', params, JSON.stringify));
  if (filters.type) conditions.push(anyOf('t.type', filters.type, 'fType', params));
  if (filters.priority) conditions.push(anyOf('t.priority', filters.priority, 'fPriority', params));
  if (filters.epic) conditions.push(anyOf(`(${EPIC_OF})`, filters.epic, 'fEpic', params));
  if (filters.label) {
    params.fLabel = JSON.stringify(filters.label);
    conditions.push(`EXISTS (SELECT 1 FROM json_each(t.labels) l WHERE l.value IN (SELECT value FROM json_each(@fLabel)))`);
  }
  if (filters.due === 'none') {
    conditions.push('t.due_date IS NULL');
  } else if (filters.due) {
    const today = filters.today ?? dayOf(new Date());
    params.fToday = today;
    if (filters.due === 'overdue') {
      conditions.push(`(t.due_date < @fToday AND t.column != 'done')`);
    } else {
      const [year, month, day] = today.split('-').map(Number);
      params.fWeek = dayOf(new Date(year, month - 1, day + 7));
      conditions.push(`(t.due_date >= @fToday AND t.due_date <= @fWeek AND t.column != 'done')`);
    }
  }
  if (filters.q) {
    params.fText = `%${filters.q.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    const key = /^(?:([A-Za-z][A-Za-z0-9]*)-)?(\d+)$/.exec(filters.q);
    const number = key && (!key[1] || key[1].toUpperCase() === spaceKey) ? key[2] : null;
    if (number) params.fNumber = Number(number);
    conditions.push(`(prism_lower(t.title) LIKE @fText ESCAPE '\\'${number ? ' OR t.number = @fNumber' : ''})`);
  }
  return { sql: conditions.map((c) => `AND ${c}`).join(' '), params };
}

/** How a list can be ordered. Whatever has no value goes last, whichever the direction. */
const SORTS = {
  key:      { by: 't.number' },
  title:    { by: 'prism_lower(t.title)' },
  status:   { by: 'st.position' },
  priority: { by: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END` },
  assignee: { by: 'prism_lower(t.assigned)', nullable: true },
  type:     { by: 't.type' },
  epic:     { by: `prism_lower(CASE WHEN t.type = 'epic' THEN NULL WHEN p.type = 'epic' THEN p.title WHEN g.type = 'epic' THEN g.title END)`, nullable: true },
  estimate: { by: 't.estimate', nullable: true },
  due:      { by: 't.due_date', nullable: true },
  updated:  { by: 't.updated_at' },
  created:  { by: 't.created_at' },
};

/** @returns {string} An ORDER BY that always gives the same order. */
function issueOrder(sort, descending) {
  const { by, nullable } = SORTS[sort];
  const dir = descending ? 'DESC' : 'ASC';
  return `ORDER BY ${nullable ? `(${by}) IS NULL, ` : ''}${by} ${dir}, t.number ${dir}, t.rowid ${dir}`;
}

/** The labels an issue ends up with after a change to several. */
function nextLabels(labels = [], { addLabels = [], removeLabels = [] }) {
  return [...new Set([...labels, ...addLabels])].filter((label) => !removeLabels.includes(label));
}

module.exports = { FILTER_JOINS, SORTS, VALID_PRIORITIES, VALID_TYPES, dayOf, isFiltering, issueConditions, issueOrder, nextLabels, parseIssueFilters, validSavedFilters };
