---
title: ARIA Pattern for Navigation Overflow Dropdowns
author: agent
pinned: false
created: 2026-06-03T10:09:49.047Z
updated: 2026-06-03T10:09:49.047Z
---

## ARIA Pattern for Navigation Overflow Dropdowns

Navigation overflow menus (e.g. a "+N" button that reveals hidden tabs) must use the **menu/menuitem** ARIA pattern, NOT listbox/option.

### Correct pattern

```html
<button aria-haspopup="menu" aria-expanded="true">+3</button>
<ul role="menu">
  <li role="menuitem" aria-checked="true">Space A</li>
  <li role="menuitem" aria-checked="false">Space B</li>
</ul>
```

### Why NOT listbox/option

`role="listbox"` / `role="option"` is the semantic for **form-select widgets** where a value is being chosen from a list (analogous to `<select>`). Screen readers announce it as a selection control.

A navigation overflow dropdown **triggers an action** (switch to a space), not a form value selection. The menu/menuitem pattern is what screen readers expect for action menus, and it correctly announces the active item with `aria-checked` rather than `aria-selected`.

### Checklist

- Trigger button: `aria-haspopup="menu"`, `aria-expanded`
- Container: `role="menu"`
- Each item: `role="menuitem"`, `aria-checked` for current/active state
- Do **not** use: `role="listbox"`, `role="option"`, `aria-selected` in this context

*Caught and fixed in space-tabs-overflow BUG-003, 2026-06-03.*
