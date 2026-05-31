---
title: Bootstrap desde el repo
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [bootstrap, repo, cold-start]
---

## Relleno inicial cuando hay repo

Disparado por la **presencia de repo** (inferido del working dir del space), NO por un picker de intent. Sin repo (ops, writing, research) → no hay bootstrap, el folio se acreta con el uso.

## Separar estructura de contenido

- **Estructura** (qué chapters): emerge del uso. El primer slug crea su chapter. Sin templates.
- **Contenido** (las pages): solo se auto-rellena si hay una fuente para leer. El repo es esa fuente para spaces dev.

## El bootstrap es conservador

Un agente lee el repo y escribe SOLO conocimiento de alta confianza y difícil de re-descubrir:
- Stack (runtime, deps clave, comando de tests).
- Estructura de carpetas / entry points.
- Arquitectura básica (cómo fluye una request).

NO inventa decisiones ni lecciones — esas se acretan del trabajo real vía [[flujos/write-back]].

## Por qué conservador

Un agente que lee un repo entero y escribe un folio gordo aluciná y sobre-documenta → pages de bajo señal que envenenan la inyección. Mejor pocas pages correctas. Todo lo que escribe el bootstrap queda con `author='agent'`.
