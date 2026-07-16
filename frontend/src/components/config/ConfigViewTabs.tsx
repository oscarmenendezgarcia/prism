/**
 * ConfigViewTabs — two-option segmented control in the ConfigPanel header.
 *
 * Options: "Agents & Routing" (default) | "Files"
 * Accessibility: role="tablist" with aria-selected on each tab.
 */

import React from 'react';

export type ConfigView = 'agents' | 'files' | 'preferences';

interface ConfigViewTabsProps {
  view:     ConfigView;
  onChange: (view: ConfigView) => void;
}

const TABS: { id: ConfigView; label: string; icon: string }[] = [
  { id: 'agents',      label: 'Agents & Routing', icon: 'smart_toy' },
  { id: 'files',       label: 'Files',            icon: 'description' },
  { id: 'preferences', label: 'Preferences',      icon: 'tune' },
];

export function ConfigViewTabs({ view, onChange }: ConfigViewTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Config panel view"
      className="flex gap-1 px-3 py-2 border-b border-border"
    >
      {TABS.map((tab) => {
        const isActive = view === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`config-tabpanel-${tab.id}`}
            id={`config-tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={[
              'flex-1 flex items-center justify-center gap-1.5',
              'text-[12px] font-semibold px-2.5 py-1.5 rounded-lg',
              'transition-all duration-fast',
              isActive
                ? 'bg-primary-container text-primary'
                : 'bg-transparent text-text-secondary hover:bg-surface-variant hover:text-text-primary',
            ].join(' ')}
          >
            <span className="material-symbols-outlined text-base leading-none" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
