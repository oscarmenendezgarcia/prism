/**
 * Shared TypeScript types matching the Prism REST API contracts exactly.
 * ADR-002: migrate frontend to React + TypeScript.
 */

/** The id of a status, which is a column of the board. Each space has its own. */
export type Column = string;

/** What a status means, whatever it is called. */
export type StatusCategory = 'todo' | 'in-progress' | 'done';

export interface Status {
  id: string;
  name: string;
  category: StatusCategory;
}

export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export type ModelCliTool = 'claude' | 'opencode' | 'pi' | 'hermes';

/** A harness discovered on this machine via GET /api/v1/harnesses. */
export interface HarnessInfo {
  cliTool:     ModelCliTool;
  available:   boolean;
  path:        string | null;
  modelFormat: 'preset' | 'provider/model';
  installUrl:  string;
}

export interface HarnessesResponse {
  harnesses: HarnessInfo[];
}

/** A space (project board). */
export interface Space {
  id: string;
  name: string;
  /** Prefix of its issues' keys, such as WEB in WEB-142. */
  key?: string;
  /** Its statuses, in the order of the board. */
  statuses?: Status[];
  /** Where an agent's finished work lands. */
  finishStatusId?: string;
  workingDirectory?: string;
  /** true when the space is pinned in SpaceTabs (always visible, never in overflow). */
  pinned?: boolean;
  /** zero-based position within the pinned zone. Absent for non-pinned spaces. */
  pinnedRank?: number;
  /** What follows the agent when it finishes a task. */
  hooks?: SpaceHooks;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceHooks {
  /** Must pass in the worktree before the task is done. */
  checkCommand: string | null;
  autoPr: boolean;
  /** The status an agent's finished work moves to, when the space chose one. */
  finishStatus?: string;
}

/** The harness and model a run uses. */
export interface AgentChoice {
  cliTool: string;
  model?: string;
}

/** A task's latest run, as GET /spaces/:id/task-runs returns it. */
export interface TaskRunView {
  runId: string;
  taskId: string;
  status: 'working' | 'checking' | 'question' | 'failed' | 'stopped' | 'done';
  cliTool: string;
  model: string | null;
  iteration: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  result: {
    branch: string;
    baseBranch: string | null;
    ref: string | null;
    fileCount: number | null;
    additions: number | null;
    deletions: number | null;
    saveError: string | null;
    head?: string | null;
    pr?: { url: string; number: number; pushedHead: string | null } | null;
  } | null;
  hook: {
    name: string;
    type: 'command' | 'pr';
    command?: string;
    status: 'running' | 'passed' | 'failed' | 'interrupted';
    exitCode?: number | null;
    timedOut?: boolean;
    outputTail?: string;
  } | null;
  failure: {
    kind: 'agent' | 'check' | 'pr' | 'save';
    exitCode: number | null;
    timedOut?: boolean;
    reason?: string | null;
  } | null;
}

export interface ChangedFile {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

/** Attachment metadata (content stripped in list responses, except for type='link'). */
export interface Attachment {
  name: string;
  type: 'text' | 'file' | 'link';
  /** Only present when type === 'link' (URL preserved for hostname extraction). */
  content?: string;
}

/** Full attachment content (only returned by the single-attachment endpoint). */
export interface AttachmentContent {
  name: string;
  type: 'text' | 'file' | 'link';
  content: string;
  /** Only present when type === 'file' */
  source?: string;
}

/**
 * Semantic task type — v1.2.0.
 * Replaces the legacy 'task' | 'research' enum (see scripts/migrate-card-types.js).
 */
export type TaskType = 'feature' | 'bug' | 'tech-debt' | 'chore' | 'epic';

/**
 * A comment on a task (note, question, or answer).
 * ADR-1 (task-comments): embedded in task.comments[].
 */
export interface Comment {
  id: string;
  author: string;
  text: string;
  type: 'note' | 'question' | 'answer';
  /** UUID of the parent comment (for threading answers under questions). */
  parentId?: string;
  resolved: boolean;
  createdAt: string;
  updatedAt?: string;
}

/** A Kanban task. */
export interface Task {
  id: string;
  /** Such as WEB-142. */
  key?: string;
  number?: number;
  statusId?: string;
  category?: StatusCategory;
  title: string;
  type: TaskType;
  priority?: Priority;
  labels?: string[];
  /** The epic it belongs to, or the issue it is a sub-task of. */
  parentId?: string | null;
  /** As YYYY-MM-DD. */
  dueDate?: string | null;
  /** In points. */
  estimate?: number | null;
  rank?: number;           // positional order within column (QOL-1)
  description?: string;
  assigned?: string;
  attachments?: Attachment[];
  /** Thread of comments (notes, questions, answers). Aditively returned by GET task. */
  comments?: Comment[];
  /** IDs of dependency tasks in the same space. Absent when empty. */
  dependsOn?: string[];
  /** Derived: true when at least one dep is not in 'done'. Only present when dependsOn is non-empty. */
  isBlocked?: boolean;
  /** Derived: count of non-done deps. Only present when dependsOn is non-empty. */
  blockedByCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Board response — tasks grouped by status. */
export type BoardTasks = Record<Column, Task[]>;

/** One change in an issue's history. */
export interface HistoryEntry {
  id: number;
  actor: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
}

/** Payload for POST /spaces/:spaceId/tasks */
export interface CreateTaskPayload {
  title: string;
  type: TaskType;
  /** Omit from body when empty — never send null. */
  assigned?: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
  parentId?: string;
  dueDate?: string;
  estimate?: number;
  /** Optional dependency task IDs. Server validates existence + no cycles. */
  dependsOn?: string[];
}

/**
 * Payload for PUT /spaces/:spaceId/tasks/:taskId — partial update.
 * All fields are optional; server applies only the keys present in the body.
 * ADR-1 (task-detail-edit): no new backend endpoint — existing PUT already
 * supports partial updates by checking `'key' in body`.
 */
export interface UpdateTaskPayload {
  title?: string;
  type?: TaskType;
  /** Empty string deletes the field on the server. */
  description?: string;
  /** Empty string deletes the field on the server. */
  assigned?: string;
  priority?: Priority;
  /** [] clears them. */
  labels?: string[];
  /** null removes it from its epic or parent. */
  parentId?: string | null;
  dueDate?: string | null;
  estimate?: number | null;
  /**
   * Dependency task IDs. [] clears all deps; omit to leave unchanged.
   * Server validates existence (422) and no cycles (409).
   */
  dependsOn?: string[];
}

/** Response from PUT /spaces/:spaceId/tasks/:id/move */
export interface MoveTaskResponse {
  task: Task;
  from: Column;
  to: Column;
}

/** Attachment modal state. */
export interface AttachmentModalState {
  open: boolean;
  spaceId: string;
  taskId: string;
  index: number;
  name: string;
  /** Full attachment list for the task — enables prev/next navigation. */
  attachments: Attachment[];
}

/** Space modal state. */
export interface SpaceModalState {
  open: boolean;
  mode: 'create' | 'rename';
  space?: Space;
}

/** Delete-space dialog state. */
export interface DeleteSpaceDialogState {
  open: boolean;
  spaceId: string;
}

/** Toast notification state. */
export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  /** Optional action button rendered inside the toast. */
  action?: { label: string; onClick: () => void };
}

/** Markdown viewer modal state — used to show .md attachments rendered. */
export interface MarkdownModalState {
  open: boolean;
  /** Display title shown in the modal header. */
  title: string;
  /** Raw markdown string to render. */
  content: string;
  /** Optional source file path (shown in a footer banner). */
  source?: string;
}

/** Run object returned by the run actions. */
export interface BackendRun {
  runId: string;
  status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'interrupted';
  spaceId: string;
  taskId: string;
  createdAt: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Global search types (ADR-1: global-search)
// ---------------------------------------------------------------------------

/** A single result row returned by GET /api/v1/tasks/search. */
export interface SearchResult {
  task:      Task;
  spaceId:   string;
  spaceName: string;
  column:    Column;
}

/** Response shape for GET /api/v1/tasks/search. */
export interface SearchResponse {
  query:   string;
  count:   number;
  results: SearchResult[];
}

// -------------------------------------------------------------------------
// Working directory check
// -------------------------------------------------------------------------

/** Response from POST /api/v1/fs/validate. */
export interface ValidationResult {
  path: string;
  isValid: boolean;
  isGitRepo?: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type Role = 'admin' | 'member' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt?: string;
  lastSeenAt?: string | null;
}

export interface AuthStatus {
  needsSetup: boolean;
  user: User | null;
}

export interface AccountLink {
  kind: 'invite' | 'reset';
  email: string;
  role: Role | null;
  createdBy: string;
}
