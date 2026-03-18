/**
 * Shared TypeScript types matching the Prism REST API contracts exactly.
 * ADR-002: migrate frontend to React + TypeScript.
 */

/** The three canonical Kanban columns. */
export type Column = 'todo' | 'in-progress' | 'done';

/** A space (project board). */
export interface Space {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Attachment metadata (content stripped in list responses). */
export interface Attachment {
  name: string;
  type: 'text' | 'file';
}

/** Full attachment content (only returned by the single-attachment endpoint). */
export interface AttachmentContent {
  name: string;
  type: 'text' | 'file';
  content: string;
  /** Only present when type === 'file' */
  source?: string;
}

/** A Kanban task. */
export interface Task {
  id: string;
  title: string;
  type: 'task' | 'research';
  description?: string;
  assigned?: string;
  attachments?: Attachment[];
  createdAt: string;
  updatedAt: string;
}

/** Board response — tasks grouped by column. */
export type BoardTasks = Record<Column, Task[]>;

/** Payload for POST /spaces/:spaceId/tasks */
export interface CreateTaskPayload {
  title: string;
  type: 'task' | 'research';
  /** Omit from body when empty — never send null. */
  assigned?: string;
  description?: string;
}

/** Response from PUT /spaces/:spaceId/tasks/:id/move */
export interface MoveTaskResponse {
  task: Task;
  from: Column;
  to: Column;
}

/** Generic API error shape returned by the server. */
export interface ApiError {
  code: string;
  message: string;
}

/** Attachment modal state. */
export interface AttachmentModalState {
  open: boolean;
  spaceId: string;
  taskId: string;
  index: number;
  name: string;
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
  type: 'success' | 'error';
}

/** Terminal connection status. */
export type TerminalStatus = 'connecting' | 'connected' | 'disconnected';

// ---------------------------------------------------------------------------
// Config editor types (ADR-1: Config Editor Panel)
// ---------------------------------------------------------------------------

/** A config file descriptor returned by the list endpoint (no content). */
export interface ConfigFile {
  id: string;
  name: string;
  scope: 'global' | 'project';
  directory: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** A config file with its full text content, returned by the read endpoint. */
export interface ConfigFileContent {
  id: string;
  name: string;
  scope: 'global' | 'project';
  content: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** Result returned after a successful save — metadata only, no content echo. */
export interface ConfigFileSaveResult {
  id: string;
  name: string;
  scope: 'global' | 'project';
  sizeBytes: number;
  modifiedAt: string;
}
