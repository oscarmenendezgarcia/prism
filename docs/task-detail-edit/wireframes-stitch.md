# Stitch Screens: Task Detail & Edit Side Panel

## Project

- **Stitch Project ID:** `15790477920468951127`
- **Project URL:** `https://stitch.withgoogle.com/projects/15790477920468951127`

## Generation Status

`mcp__stitch__generate_screen_from_text` returned empty output on three attempts (2026-03-24) with both `GEMINI_3_1_PRO` and `GEMINI_3_FLASH` models. This is a known transient Stitch API issue. Retries were stopped per tool instructions (DO NOT RETRY after multiple empty-output responses).

**Fallback:** HTML wireframe screens were produced by hand and saved to `stitch-screens/`. They implement the same design specification as the ASCII wireframes in `wireframes.md` using real CSS and the Prism dark-theme token values. The developer can use these HTML files directly as implementation reference.

---

## Screens

| Screen ID | Title | Device | File | Stitch Screen ID |
|-----------|-------|--------|------|-----------------|
| S-01 | Board + Panel (default) | Desktop | `stitch-screens/S-01-board-panel-default.html` | — (generation failed) |
| S-02 | Panel saving state | Desktop | `stitch-screens/S-02-panel-saving.html` | — (generation failed) |
| S-03 | Mobile full-screen panel | Mobile | `stitch-screens/S-03-mobile-panel.html` | — (generation failed) |

---

## Retry Instructions

When Stitch generation is operational again, run:

```
mcp__stitch__generate_screen_from_text({
  projectId: "15790477920468951127",
  deviceType: "DESKTOP",
  modelId: "GEMINI_3_FLASH",
  prompt: "Dark kanban board with task detail panel, see docs/task-detail-edit/wireframes.md S-01"
})
```

Use the screen names S-01, S-02, S-03 as titles. Save each `htmlCode.downloadUrl` to the corresponding file in `stitch-screens/`.
