---
title: Write-back de agentes
author: user
pinned: false
created: 2026-05-31
updated: 2026-05-31
tags: [write-back, pipeline, acrecion]
---

## Los agentes escriben para que la memoria crezca con el uso

Es la tesis "aumentable". Política:

## 1. Solo escriben si el folio YA existe

Si el usuario no activó folio, el pipeline corre sin folio y nadie lo crea por la puerta de atrás. Preserva el opt-in. No folio → no inyección, no write-back, cero overhead. (Implementado vía `createIfMissing: false`, ver [[modelo-datos/activacion]].)

## 2. Un ÚNICO write de consolidación al final del pipeline

No 5 stages escribiendo sueltos (eso genera ruido que envenena la inyección). Un solo paso al terminar produce como mucho unas pocas pages: una decisión si se tomó, una lección si hubo bug, y actualizar `estado`. Un solo punto de control de calidad.

## 3. Trazabilidad

Todo write de agente queda con `author='agent'` → el usuario puede filtrar y podar. Edición directa, sin flujo de revisión.

## 4. Conservador

Solo conocimiento de alta señal, no un volcado de todo lo ocurrido.

## Concurrencia (diferible v1)

Dos runs en paralelo sobre la misma page = last-write-wins + updated_at. Aceptable en v1; se revisa con uso real.
