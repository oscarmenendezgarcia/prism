/**
 * DirectoryPicker — inline file tree for selecting a working directory.
 *
 * Renders a folder-icon button next to the working directory input.
 * Clicking it opens an inline tree panel that lets users browse and
 * select a directory. Degrades gracefully to manual text entry if the
 * backend is unavailable.
 *
 * Design spec: agent-docs/space-settings-file-browser/wireframes.md
 */

import React, { useState, useEffect, useRef, useCallback, KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { getFsHome, browseDirectory } from '@/api/client';
import type { DirectoryItem } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNode {
  /** Full absolute path to this node. */
  path: string;
  /** Display name (last segment). */
  name: string;
  /** Nesting depth (0 = root). */
  depth: number;
  /** True for a file leaf (only surfaced in mode="file"). */
  isFile: boolean;
  isExpanded: boolean;
  isAccessible: boolean;
  isLoading: boolean;
  /** Null = not yet loaded; [] = loaded, no children. */
  children: TreeNode[] | null;
}

interface DirectoryPickerProps {
  /** Controlled value — current path. */
  value: string;
  /** Called when the user selects a path. */
  onChange: (path: string) => void;
  /**
   * What can be selected. "directory" (default) browses + selects folders;
   * "file" also lists files and only a file is a valid selection (folders are
   * navigation only).
   */
  mode?: 'directory' | 'file';
  /** aria-label override for the trigger button. */
  buttonLabel?: string;
  /** Whether the input is disabled. */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pathDisplayName(absPath: string, homePath: string): string {
  if (absPath === homePath) return '~ (home)';
  if (absPath.startsWith(homePath + '/')) return '~' + absPath.slice(homePath.length);
  return absPath;
}

function buildBreadcrumb(absPath: string, homePath: string): string {
  const display = pathDisplayName(absPath, homePath);
  return display.replace(/\//g, ' / ');
}

function makeNode(absPath: string, name: string, depth: number, isFile: boolean, item?: DirectoryItem): TreeNode {
  return {
    path:         absPath,
    name,
    depth,
    isFile,
    isExpanded:   false,
    isAccessible: item ? item.isAccessible : true,
    isLoading:    false,
    children:     null,
  };
}

/** Map a directory listing's items to child nodes, honouring the picker mode. */
function listingChildren(listing: { path: string; items: DirectoryItem[] }, depth: number, mode: 'directory' | 'file'): TreeNode[] {
  return listing.items
    .filter((it) => mode === 'file' ? (it.type === 'dir' || it.type === 'file') : it.type === 'dir')
    .map((it) => makeNode(`${listing.path}/${it.name}`, it.name, depth, it.type === 'file', it));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DirectoryPicker({ value, onChange, mode = 'directory', buttonLabel, disabled = false }: DirectoryPickerProps) {
  const isFileMode = mode === 'file';
  const triggerLabel = buttonLabel ?? (isFileMode ? 'Browse for file' : 'Browse for directory');
  const [open, setOpen]               = useState(false);
  const [homePath, setHomePath]       = useState<string | null>(null);
  const [nodes, setNodes]             = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [rootLoading, setRootLoading] = useState(false);
  const [coords, setCoords]           = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  const panelRef   = useRef<HTMLDivElement>(null);
  const buttonRef  = useRef<HTMLButtonElement>(null);

  // ---------------------------------------------------------------------------
  // Positioning — the panel is portalled to <body> so it is never clipped by
  // the modal's overflow container. It is anchored to the input row so it lines
  // up with the field (full row width) rather than the narrow folder button.
  // ---------------------------------------------------------------------------

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    // Align to the field row (input + button) when present; fall back to the button.
    const anchor = (btn.closest('[data-dir-picker-anchor]') as HTMLElement | null) ?? btn;
    const r = anchor.getBoundingClientRect();

    const GAP = 4;
    const MARGIN = 8;          // keep clear of the viewport edge
    const DESIRED = 420;       // preferred panel height
    const vh = window.innerHeight;
    const spaceBelow = vh - r.bottom - GAP - MARGIN;
    const spaceAbove = r.top - GAP - MARGIN;

    // Open downward unless there is meaningfully more room above.
    if (spaceBelow >= Math.min(DESIRED, 220) || spaceBelow >= spaceAbove) {
      setCoords({ left: r.left, top: r.bottom + GAP, width: r.width, maxHeight: Math.min(DESIRED, spaceBelow) });
    } else {
      const maxHeight = Math.min(DESIRED, spaceAbove);
      setCoords({ left: r.left, top: r.top - GAP - maxHeight, width: r.width, maxHeight });
    }
  }, []);

  // Reposition while open: on mount, scroll (capture catches the modal body),
  // and resize.
  useEffect(() => {
    if (!open) return;
    updatePosition();
    const handler = () => updatePosition();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open, updatePosition]);

  // Close on outside click (pointer down outside both the panel and the trigger).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ---------------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------------

  const openPicker = useCallback(async () => {
    if (disabled) return;
    setOpen(true);
    setLoadError(null);
    setRootLoading(true);

    try {
      const { homePath: home } = await getFsHome();
      setHomePath(home);

      // Start at current value's directory, or home
      const startPath = value.trim() || home;
      const listing   = await browseDirectory(startPath, false, mode === 'file');

      const rootNode: TreeNode = {
        path:         listing.path,
        name:         pathDisplayName(listing.path, home),
        depth:        0,
        isFile:       false,
        isExpanded:   true,
        isAccessible: true,
        isLoading:    false,
        children:     listingChildren(listing, 1, mode),
      };

      setNodes([rootNode]);
      setSelectedPath(value.trim() || listing.path);
      setFocusedIndex(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load directories';
      setLoadError(msg);
    } finally {
      setRootLoading(false);
    }
  }, [disabled, value, mode]);

  const closePicker = useCallback(() => {
    setOpen(false);
    // Return focus to trigger button
    setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);

  // ---------------------------------------------------------------------------
  // Tree manipulation
  // ---------------------------------------------------------------------------

  /** Flatten nodes into a display list (depth-first). */
  const flatNodes = useCallback((): TreeNode[] => {
    const result: TreeNode[] = [];
    function walk(n: TreeNode) {
      result.push(n);
      if (n.isExpanded && n.children) {
        for (const child of n.children) walk(child);
      }
    }
    for (const n of nodes) walk(n);
    return result;
  }, [nodes]);

  const expandNode = useCallback(async (targetPath: string) => {
    // Mark as loading
    setNodes((prev) => updateNode(prev, targetPath, (n) => ({ ...n, isLoading: true })));

    try {
      const listing = await browseDirectory(targetPath, false, mode === 'file');
      const children = listingChildren(listing, 0, mode); // depth set below

      setNodes((prev) => {
        return updateNode(prev, targetPath, (n) => ({
          ...n,
          isLoading: false,
          isExpanded: true,
          children: children.map((c) => ({ ...c, depth: n.depth + 1 })),
        }));
      });
    } catch {
      setNodes((prev) => updateNode(prev, targetPath, (n) => ({ ...n, isLoading: false })));
    }
  }, [mode]);

  const collapseNode = useCallback((targetPath: string) => {
    setNodes((prev) => updateNode(prev, targetPath, (n) => ({ ...n, isExpanded: false })));
  }, []);

  const handleNodeClick = useCallback((node: TreeNode) => {
    if (!node.isAccessible) return;
    setSelectedPath(node.path);

    const flat = flatNodes();
    const idx  = flat.findIndex((n) => n.path === node.path);
    if (idx >= 0) setFocusedIndex(idx);

    // Files are leaves — selecting one is the final choice, never expands.
    if (node.isFile) return;

    if (node.isExpanded) {
      collapseNode(node.path);
    } else {
      if (node.children !== null) {
        // Already loaded — just toggle
        setNodes((prev) => updateNode(prev, node.path, (n) => ({ ...n, isExpanded: true })));
      } else {
        expandNode(node.path);
      }
    }
  }, [flatNodes, collapseNode, expandNode]);

  const handleSelect = useCallback(() => {
    if (selectedPath) {
      onChange(selectedPath);
    }
    closePicker();
  }, [selectedPath, onChange, closePicker]);

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const flat = flatNodes();
    if (!flat.length) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(focusedIndex + 1, flat.length - 1);
        setFocusedIndex(next);
        setSelectedPath(flat[next].path);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = Math.max(focusedIndex - 1, 0);
        setFocusedIndex(prev);
        setSelectedPath(flat[prev].path);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        const node = flat[focusedIndex];
        if (node && !node.isExpanded && node.isAccessible) {
          if (node.children !== null) {
            setNodes((prev) => updateNode(prev, node.path, (n) => ({ ...n, isExpanded: true })));
          } else {
            expandNode(node.path);
          }
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const node = flat[focusedIndex];
        if (node && node.isExpanded) {
          collapseNode(node.path);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const node = flat[focusedIndex];
        if (!node) break;
        // In file mode, Enter on a folder navigates (same expand/collapse as a
        // click) instead of selecting — reuse handleNodeClick.
        if (isFileMode && !node.isFile) { handleNodeClick(node); break; }
        setSelectedPath(node.path);
        onChange(node.path);
        closePicker();
        break;
      }
      case 'Escape': {
        e.preventDefault();
        closePicker();
        break;
      }
    }
  }, [flatNodes, focusedIndex, expandNode, collapseNode, onChange, closePicker, isFileMode, handleNodeClick]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const flat          = flatNodes();
  const selectedNode  = flat.find((n) => n.path === selectedPath) ?? null;
  const breadcrumb    = selectedPath && homePath ? buildBreadcrumb(selectedPath, homePath) : '';
  // In file mode only a file is a valid selection; folders are navigation only.
  const selectDisabled = !selectedPath || (isFileMode && !selectedNode?.isFile);

  return (
    <div className="relative shrink-0">
      {/* Folder icon button — placed by the parent input row */}
      <button
        ref={buttonRef}
        type="button"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="tree"
        disabled={disabled}
        onClick={() => (open ? closePicker() : openPicker())}
        className={[
          'flex items-center justify-center w-11 h-[46px] rounded-lg border transition-colors duration-fast',
          'border-border bg-surface hover:bg-surface-elevated',
          'focus:outline-none focus:ring-2 focus:ring-primary/50',
          open ? 'border-primary text-primary' : 'text-text-secondary hover:text-text-primary',
          disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
        ].join(' ')}
      >
        <span className="material-symbols-outlined text-[18px] leading-none" aria-hidden="true">
          folder_open
        </span>
      </button>

      {/* Inline tree panel — portalled to <body> so the modal's overflow never
          clips it, positioned (fixed) under the field row. */}
      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: coords.left, top: coords.top, width: coords.width, maxHeight: coords.maxHeight }} // lint-ok: runtime anchor coordinates cannot be expressed as static Tailwind tokens
          className="z-[200] flex flex-col bg-surface border border-border rounded-lg shadow-lg overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Panel header */}
          <div className="shrink-0 px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">{isFileMode ? 'Select a file' : 'Select a directory'}</span>
            <button
              type="button"
              aria-label="Close directory browser"
              onClick={closePicker}
              className="text-text-secondary hover:text-text-primary transition-colors p-0.5 rounded"
            >
              <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">close</span>
            </button>
          </div>

          {/* Tree body */}
          <div
            className="flex-1 min-h-0 overflow-y-auto"
            role="tree"
            aria-label="Directory browser"
            tabIndex={0}
          >
            {rootLoading && (
              <div className="px-4 py-6 text-xs text-text-disabled text-center">
                Loading directories…
              </div>
            )}

            {loadError && !rootLoading && (
              <div className="px-4 py-4 text-xs text-error text-center" role="alert">
                {loadError}
                <div className="mt-1 text-text-disabled">You can still type a path manually.</div>
              </div>
            )}

            {!rootLoading && !loadError && flat.map((node, idx) => (
              <DirectoryRow
                key={node.path}
                node={node}
                isFocused={idx === focusedIndex}
                isSelected={node.path === selectedPath}
                onClick={() => handleNodeClick(node)}
                onFocus={() => setFocusedIndex(idx)}
              />
            ))}
          </div>

          {/* Breadcrumb + actions */}
          {!rootLoading && !loadError && (
            <div className="shrink-0">
              {breadcrumb && (
                <div className="px-3 py-1.5 border-t border-border text-xs text-text-secondary truncate">
                  {breadcrumb}
                </div>
              )}

              <div className="px-3 py-2 border-t border-border flex items-center justify-end gap-2">
                <span className="text-[10px] text-text-disabled mr-auto hidden sm:block">
                  ↑↓ navigate · → expand · ← collapse · Enter select
                </span>
                <button
                  type="button"
                  onClick={closePicker}
                  className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={selectDisabled}
                  onClick={handleSelect}
                  className={[
                    'px-3 py-1.5 text-xs rounded font-medium transition-colors',
                    selectDisabled
                      ? 'bg-surface-elevated text-text-disabled cursor-not-allowed'
                      : 'bg-primary text-on-primary hover:bg-primary/90',
                  ].join(' ')}
                >
                  Select
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DirectoryRow sub-component
// ---------------------------------------------------------------------------

interface DirectoryRowProps {
  node: TreeNode;
  isFocused: boolean;
  isSelected: boolean;
  onClick: () => void;
  onFocus: () => void;
}

function DirectoryRow({ node, isFocused, isSelected, onClick, onFocus }: DirectoryRowProps) {
  const indent = node.depth * 16;

  const rowClass = [
    'flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer select-none',
    'border-l-2 transition-colors duration-fast',
    isSelected
      ? 'border-primary bg-primary/10 text-text-primary'
      : isFocused
      ? 'border-border/60 bg-surface-elevated text-text-primary'
      : 'border-transparent hover:bg-surface-elevated/50 text-text-secondary hover:text-text-primary',
    !node.isAccessible ? 'opacity-40 cursor-not-allowed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      role="treeitem"
      aria-expanded={node.children !== null ? node.isExpanded : undefined}
      aria-selected={isSelected}
      aria-label={`${node.name}${!node.isAccessible ? ', not accessible' : ''}`}
      tabIndex={-1}
      className={rowClass}
      style={{ paddingLeft: `${12 + indent}px` }} // lint-ok: dynamic depth-based indentation cannot be expressed with static Tailwind tokens
      onClick={onClick}
      onFocus={onFocus}
    >
      {/* Expand/collapse chevron — files are leaves, so render a spacer instead. */}
      <span
        className="material-symbols-outlined text-[14px] leading-none text-text-disabled flex-shrink-0 w-[14px]"
        aria-hidden="true"
      >
        {node.isFile
          ? ''
          : node.isLoading
          ? 'sync'
          : node.isExpanded
          ? 'expand_more'
          : 'chevron_right'}
      </span>

      {/* Folder / file icon */}
      <span
        className="material-symbols-outlined text-[15px] leading-none flex-shrink-0 text-text-secondary"
        aria-hidden="true"
      >
        {node.isFile ? 'description' : node.isExpanded ? 'folder_open' : 'folder'}
      </span>

      {/* Name */}
      <span className="truncate text-[13px]">{node.name}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure tree-state helper (immutable update)
// ---------------------------------------------------------------------------

function updateNode(nodes: TreeNode[], targetPath: string, updater: (n: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return updater(n);
    if (n.children) return { ...n, children: updateNode(n.children, targetPath, updater) };
    return n;
  });
}
