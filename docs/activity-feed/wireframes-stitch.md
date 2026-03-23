# Stitch Designs: Activity Feed — Prism Kanban

**Project:** Prism — Activity Feed Panel
**Stitch Project ID:** `3163940427384051777`
**Project URL:** https://stitch.withgoogle.com/projects/3163940427384051777
**Generated:** 2026-03-23
**Design system used:** Prism Midnight / Obsidian Lens (dark, Inter font, MD3-derived tokens)

---

## Screens

### S-01 — Panel Default State (Live Events)

**Screen ID:** `636dd646200f46a9bafdf798b2b2edcd`
**Stitch resource name:** `projects/3163940427384051777/screens/636dd646200f46a9bafdf798b2b2edcd`
**HTML download URL:**
```
https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzgzMWMwOGRjMzU4MjQ5M2M5NmNkYWUzYjA3MGQ5OTEwEgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhMzMTYzOTQwNDI3Mzg0MDUxNzc3&filename=&opi=96797242
```
**Local HTML:** `stitch-screens/activity-feed/s-01-default.html`
**Screenshot URL:** `https://lh3.googleusercontent.com/aida/ADBb0uihFNHQDJqgpmiyhns2bI5TyLorKaJvi4KuC8liRJY-XGQMDTVJ8P4A6nibh7LPIVAILQbemdfcW1U1TwS5_u-F1MlUhy5yGc7JcnmVfnkNki0YSJI5MU-69PlYvhfbRzAre9oUT3FqdlnnE80ZKDKByVqOAHyWTT_iIIdN3u41ElGTK1hpQrlxnOgaIFfCxvqqDIoMKiMzmygcWqTv_lUItehXoehLBA6iWxJt4_Imlo9H8i3PrifB0g`

**Description:** Activity Feed panel open with 6 live event cards. Shows green "Live" status indicator, type/date filter bar, event cards with icon + description + metadata, blue unread left-border strips on newest events, and "Load more" footer. Drag handle on left edge.

---

### S-02 — Panel Empty State

**Screen ID:** `7933ea9887ea4693b97ec400ff3b7e4e`
**Stitch resource name:** `projects/3163940427384051777/screens/7933ea9887ea4693b97ec400ff3b7e4e`
**HTML download URL:**
```
https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sXzMwZGMyY2I0MTM1OTQyODQ5ZDMzNDRhYWYwOGYzZjY3EgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhMzMTYzOTQwNDI3Mzg0MDUxNzc3&filename=&opi=96797242
```
**Local HTML:** `stitch-screens/activity-feed/s-02-empty.html`
**Screenshot URL:** `https://lh3.googleusercontent.com/aida/ADBb0uheeBIL40J34jPznKrohGWadO0xYAcK7YlFtkF0Gz--iQIo8C_njx41lVsPiPEAI_RNio3r7ZSgKMU_h-WNI-syjqI1oGhMm7cYFBXjkolFzPwF3geEFFwqNhnCzImz7d--MxtAPN5hAWnUjKzIgBqGerNJ6RXllSISPwrby5KQD25YHn1R6YqnUCaaniXyU6HUgGdzbZA_RLMRAwRYwEy0_bYqsg6TjTZQWel_4YbLLm0e2YaSlMJ4fls`

**Description:** Panel open with type filter set to "task.moved" and "Today" date chip active. No matching events. Centered empty state with `notifications_off` icon (48px, muted gray), "No events yet" heading, and helper subtext.

---

### S-03 — Panel Loading State

**Screen ID:** `0ec8917bd68f4b4aa2f6a097e049a077`
**Stitch resource name:** `projects/3163940427384051777/screens/0ec8917bd68f4b4aa2f6a097e049a077`
**HTML download URL:**
```
https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ7Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpaCiVodG1sX2IxMWQ3NjhlY2ZhYjRhYzNiMTcxYmJiNzRlZmFmMmM5EgsSBxC5gqi72AQYAZIBIwoKcHJvamVjdF9pZBIVQhMzMTYzOTQwNDI3Mzg0MDUxNzc3&filename=&opi=96797242
```
**Local HTML:** `stitch-screens/activity-feed/s-03-loading.html`
**Screenshot URL:** `https://lh3.googleusercontent.com/aida/ADBb0uhSicxWZsJnxmyzxDj0_4m79UwE9qp69iDr79nHaqR9PSXa2NoFoWviqnjTqhx-YmBlTXvYR46CxoZbkKnq_xRao6TjOjc1NKvGSf5oBMvnWeFf-uKqxnwaJhj67Oc5vj0bPhYk7ganHn3qMSnKbmRm23dNmTuxMhNZD_29etrrJeGVmRq7PX2WUjenIYU_giZ_whMO1HBQFaFVLeAJXi_FuboAzQ1ST9Od7vj2o28ab5eoY7xUm0f_nig`

**Description:** Panel open during initial history fetch. Amber "Connecting..." status indicator. Filter bar at 60% opacity. 4 skeleton loading cards with shimmer animation (base #2a2a2a, highlight #3a3a3a, 1.5s infinite). No footer visible.

---

### S-04 — App Layout: Header Badge + Open Panel (ASCII Fallback)

Stitch generation returned empty for this screen (Stitch tool limitation with full-viewport compositions). See ASCII wireframe in `wireframes.md`.

**Covers:** Full app layout showing notifications badge with unread count "3" on header button, and ActivityFeedPanel open alongside the kanban board with unread event indicators (blue left-border strips on 3 newest cards).

---

### S-05 — Panel: Active Filter State (ASCII Fallback)

Stitch generation returned empty for this screen. See ASCII wireframe in `wireframes.md`.

**Covers:** Type filter set to "task.moved" (blue ring on select, clear X button visible), "7d" date chip active, amber filter-active banner "2 of 47 events — filters active", 2 matching event cards, "Load more (no more)" footer.

---

### S-06 — Panel: Disconnected / Reconnecting State (ASCII Fallback)

Stitch generation returned empty for this screen. See ASCII wireframe in `wireframes.md`.

**Covers:** Red "Disconnected" status dot + label, reconnect bar (dark red bg, wifi_off icon, "Reconnecting in 4s...", "Reconnect now" link), disabled filter bar at 50% opacity, amber "Events may be outdated" strip, 4 event cards at 60% opacity.

---

## Design Tokens Applied

| Token | Value | Usage |
|-------|-------|-------|
| `surface` | `#111125` | App background |
| `surface_container_lowest` | `#0c0c1f` | Panel background |
| `surface_container` | `#1e1e32` | Event card background |
| `surface_container_high` | `#28283d` | Event card hover |
| `on_surface` | `#e2e0fc` | Primary text |
| `on_surface_variant` | `#c2c6d6` | Secondary/muted text |
| `primary` | `#adc6ff` | Blue accent (moved icon, active chip bg) |
| `primary_container` | `#4d8eff` | Active chip background |
| `tertiary` | `#4ae176` | Green (created icon, Live status dot) |
| `error` | `#ffb4ab` | Red (deleted icon, Disconnected dot) |
| `tertiary_container` | `#00a74b` | Amber-ish (updated icon) |
| `outline_variant` | `#424754` | Ghost borders at 15% opacity |

## Notes for Developer

1. The Stitch HTML files in `stitch-screens/activity-feed/` contain the full HTML+CSS for the 3 generated screens. They can be opened directly in a browser as reference.
2. For S-04 through S-06, use the ASCII wireframes in `wireframes.md` as the authoritative design reference.
3. The component must use `usePanelResize` with `storageKey: 'prism:panel-width:activity'` — same pattern as `TerminalPanel`.
4. All Tailwind token names in wireframes correspond to the tokens defined in `frontend/tailwind.config.js` and `frontend/src/index.css`.
