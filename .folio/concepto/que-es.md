---
title: Qué es Folio
author: user
pinned: true
created: 2026-05-31
updated: 2026-05-31
tags: [vision, producto]
---

## Qué es

Folio es una **base de conocimiento navegable y aumentable** compartida entre un usuario y sus agentes. Resuelve que cada tarea nueva, los agentes empiezan de cero: re-descubren el stack, re-leen los mismos ficheros, ignoran decisiones pasadas.

Los tres términos del nombre hacen trabajo real:
- **Base de conocimiento** — persiste y se acumula, no es memoria efímera de sesión.
- **Navegable** — el usuario explora, edita y entiende qué sabe su agente.
- **Aumentable** — crece con el uso; tanto el usuario como el agente añaden.

## Tesis central

El valor es **asimétrico en el tiempo**. La primera tarea, el agente no sabe nada. La décima, ya tiene patrones. La centésima, es mejor que cualquier doc estático. Cuanto más se usa el espacio, más inteligente se vuelve el agente. Eso da retención natural.

## Casos de uso (la brújula de diseño)

No es solo para código. El modelo es el mismo, el contenido cambia:
- **Dev** — stack, arquitectura, convenciones, decisiones, lecciones, estado.
- **Oncall** — runbooks, incidencias, servicios frágiles, contactos. El agente `oncall-helper` busca incidencias pasadas y propone los pasos que funcionaron.
- **Escritura** — personajes, reglas del mundo, capítulos.
- **Research** — fuentes, hallazgos, preguntas abiertas.

El usuario que instala v1 es developer, pero el modelo de datos NO asume código. Vocabulario neutral. Ver [[concepto/vocabulario]].
