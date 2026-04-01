# Wireframes Stitch — Tagger Agent
**Feature:** Agente tagger — clasificacion automatica de cards por tipo
**Proyecto Stitch:** kanban-local
**ProjectId:** `15790477920468951127`
**Date:** 2026-04-01

---

## Estado de generacion

| ID | Screen | Estado | ScreenId Stitch | HTML local |
|----|--------|--------|-----------------|------------|
| S-01 | tagger-button-idle | FALLBACK (timeout Stitch) | — | — |
| S-02 | tagger-button-loading | FALLBACK (timeout Stitch) | — | — |
| S-03 | tagger-review-modal | GENERADO | `e209d2d783624b6287c4a3be4c1d19e6` | `stitch-screens/tagger-review-modal.html` |

**Nota:** Stitch `generate_screen_from_text` retorno timeout persistente para las screens S-01
y S-02 (comportamiento conocido desde marzo 2026 — bug de disponibilidad del servicio).
Se generaron wireframes ASCII completos en `wireframes.md` como fallback para esas dos screens.
La screen S-03 (TaggerReviewModal) si fue generada correctamente.

---

## Screen S-03: Tagger Review Modal

**ScreenId:** `e209d2d783624b6287c4a3be4c1d19e6`
**Titulo en Stitch:** "Tagger Review Modal"
**Device:** Desktop (2560x2048)

**HTML descargado:** `agent-docs/tagger-agent/stitch-screens/tagger-review-modal.html`

**Screenshot URL:**
```
https://lh3.googleusercontent.com/aida/ADBb0ujvAtzLBY45FUzIUX4-bHihs1pqkMP9XMu1xw7KCWHdr-gLFdIHtHUtPY2WcfdyGkjm5YPqL19JjBEKgQ3Iv0RkmVJyks-Ci6Acqy2CsjWOpfNgOpIxjJuBGRnI37DhmmorpDqauVHwxUqCm4f55sbM1g6nppo0ZKBLtBPwTWHZeC3s6FunvSrMEu1g-KaTjEvNq6Nik2zXOkDnsBVUaJ-j9815USumLO7goG_7bCb_ko8nfc2wE3sIxtmZ
```

**HTML Download URL:**
```
https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzgzODQ3MjIwYzcyYTQyMmNhNTcxMzM3ZmRlYmUxZDBhEgsSBxC5gqi72AQYAZIBJAoKcHJvamVjdF9pZBIWQhQxNTc5MDQ3NzkyMDQ2ODk1MTEyNw&filename=&opi=96797242
```

**Elementos del diseno generado:**
- Modal centrado sobre overlay oscuro con board Kanban difuminado de fondo
- Header: icono sparkles + titulo "Auto-tag suggestions" + badge "claude-3-5-sonnet"
- Subheader: checkbox "Improve descriptions" sin marcar
- 4 filas de sugerencia con toggle, badges de tipo (actual → inferido) e indicadores de confianza
- Fila 4 con fondo amber + borde izquierdo rojo (confianza LOW, toggle en OFF)
- Footer: "Cancel" ghost + "Apply selected (3)" primary (#0A84FF)
- Tokens aplicados: bg #2C2C2E, border #3A3A3C, radius 20px, font Inter

**Notas de adaptacion para el desarrollador:**
El HTML generado por Stitch usa tokens del sistema "Technical Kineticism" (MD3 dark).
Al implementar en React, usar los tokens del proyecto Prism definidos en `tailwind.config.js`:
- `bg-surface` en lugar de surface_container_high
- `border-border` en lugar de outline_variant
- `text-text-primary` en lugar de on_surface
- `<Badge>` compartido en lugar de chips custom
- `<Modal>` compartido para el wrapper del modal (no reimplementar backdrop/Escape)

---

## Pantallas S-01 y S-02 — Wireframes ASCII de referencia

Ver `wireframes.md` seccion "Wireframe S-01" y "Wireframe S-02" para la especificacion completa.

Resumen rapido para el desarrollador:

**S-01 TaggerButton idle:**
- Boton ghost en el header del board
- Icono: Material Symbol `auto_fix_high` 16px
- Label: "Auto-tag" (oculto en xs, visible en md+)
- `aria-label="Auto-tag this space with AI"`

**S-02 TaggerButton loading:**
- Spinner animado 14px (spin keyframe existente en tailwind)
- Label: "Tagging..."
- `disabled`, `aria-busy="true"`, `cursor-not-allowed`, `opacity-60`
- Otros botones del header tambien deshabilitados (NFR-5)
