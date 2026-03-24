# Wireframes Stitch: Pipeline Log Viewer

## Proyecto Stitch

**Nombre:** Prism — Pipeline Log Viewer
**Project ID:** `8212977200307130138`
**URL:** https://stitch.withgoogle.com/projects/8212977200307130138
**Tema:** Dark, Inter + JetBrains Mono, primary #0A84FF

---

## Screens

| ID | Screen ID | Titulo | Estado | HTML Local |
|----|-----------|--------|--------|------------|
| S-01 | `fff7846ae6bf4c299f2af37868f50001` | Prism — Pipeline Log Viewer | Default (logs en vivo, stage Dev activo) | `stitch-screens/S-01-default-logs-live.html` |
| S-02 | `a42caefc583a4e27a5c7a6b8bcd788aa` | Prism — QA Empty State | Empty Pending (stage QA no iniciado) | `stitch-screens/S-02-empty-pending.html` |
| S-03 | `c3fa5af7da7d40f5b9f1a20797063af8` | Prism — Pipeline Log Viewer (Waiting) | Waiting for Output (running, sin contenido) | `stitch-screens/S-03-waiting-for-output.html` |
| S-04 | `7e32e40a0eee43408c5efb815fbb3fa0` | Prism — Pipeline Log Fetch Error | Error de fetch | `stitch-screens/S-04-fetch-error.html` |
| S-05 | `4485d37521c14bfebe962d7b0bf933cc` | Prism — Pipeline Log Viewer (Detached) | Scroll Detached (boton visible) | `stitch-screens/S-05-scroll-detached.html` |
| S-06 | `c72013c6ff97435892b6ea720e105e72` | Prism — Completed Run Log Viewer | Run completado (todos stages done) | `stitch-screens/S-06-completed-run.html` |

---

## HTML Download URLs (validas por sesion)

```
S-01: https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sX2FiOWE0Yzk5MGUxZTQ2MjliZWRiMDI5ZWUzYzNmMTViEgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhM4MjEyOTc3MjAwMzA3MTMwMTM4&filename=&opi=96797242
S-02: https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzY5N2NiNDI4NDlhMzQwNTFiNzQ1MTYyYmY0MzVmMzU2EgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhM4MjEyOTc3MjAwMzA3MTMwMTM4&filename=&opi=96797242
S-03: https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sX2UxYjExZDM0Y2QzNzRkYmJhYjcwOWExYjQ2NWQ5ODQzEgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhM4MjEyOTc3MjAwMzA3MTMwMTM4&filename=&opi=96797242
S-04: https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzYwYzcyODExY2M5YjRkZTI5NTJiMTU4ZWQ5MmI5YzE1EgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhM4MjEyOTc3MjAwMzA3MTMwMTM4&filename=&opi=96797242
S-05: https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sX2I1OThjYzBiNGE1MzQ3YTlhNDJhNGYzMzdmZWRhOTA2EgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhM4MjEyOTc3MjAwMzA3MTMwMTM4&filename=&opi=96797242
S-06: https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sX2RiODNjNDA0ZThjMzQwZDA5M2FkY2M5NzMxZmVlNmVhEgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhM4MjEyOTc3MjAwMzA3MTMwMTM4&filename=&opi=96797242
```

---

## Notas de implementacion para el Developer Agent

Los screens HTML en `stitch-screens/` son la referencia visual de partida. El developer debe:

1. Adaptar los tokens del HTML generado a los tokens reales del proyecto (Tailwind CSS v4):
   - `surface` = `bg-surface` = `var(--color-surface)`
   - `surface-variant` = `bg-surface-variant` = `var(--color-surface-variant)`
   - `primary` = `text-primary` / `border-primary` = `var(--color-primary)` (#0A84FF)
   - `text-secondary` = `var(--color-text-secondary)`
   - `border` = `border-border` = `var(--color-border)`

2. No usar `style={{}}` inline — solo clases Tailwind o valores arbitrarios.

3. Los iconos son Material Symbols Outlined (ya cargados en `frontend/index.html`):
   - `article` → toggle button
   - `close` → cerrar panel
   - `check_circle` → stage completado
   - `progress_activity` → stage running (+ animate-spin)
   - `hourglass_empty` → stage pending
   - `timer_off` → stage timeout
   - `error_outline` → fetch error
   - `keyboard_arrow_down` → scroll to bottom

4. El panel sigue el mismo patron que `TerminalPanel` y `RunHistoryPanel`:
   - `<aside>` con `border-l border-border bg-surface`
   - `usePanelResize` para el resize
   - Montado en `App.tsx` en el mismo flex row de paneles
