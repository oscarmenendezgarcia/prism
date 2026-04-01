# User Stories: Tagger Agent
**Feature:** Agente tagger — clasificacion automatica de cards por tipo
**Persona principal:** Desarrollador tecnico (usuario unico local)
**Date:** 2026-04-01

---

## Epicas

| Epica | Descripcion | MoSCoW |
|-------|-------------|--------|
| E-1 | Trigger del tagger | Must |
| E-2 | Revision de sugerencias | Must |
| E-3 | Aplicacion de cambios | Must |
| E-4 | Mejora de descripciones | Should |
| E-5 | Manejo de errores y estados de fallo | Must |

---

## E-1: Trigger del tagger

### Story E-1.1
**Como** desarrollador que gestiona mi board Kanban local,
**quiero** ver un boton "Auto-tag" en el header de cada espacio,
**para** poder iniciar la clasificacion automatica de cards con un solo clic.

**Criterios de aceptacion:**
- [ ] El boton "Auto-tag" es visible en el header del board para todo espacio
- [ ] El boton muestra un icono sparkles (auto_fix_high) y el label "Auto-tag"
- [ ] El boton usa el estilo ghost del sistema de diseno (Button variant="ghost")
- [ ] El boton tiene minimo 44px de area tactil en mobile (96px wide en desktop)
- [ ] `aria-label="Auto-tag this space with AI"` esta presente en el elemento

**Definition of Done:**
- Componente TaggerButton.tsx existe en `frontend/src/components/board/`
- Integrado en Board.tsx junto a los botones existentes
- Visible y funcional en dark theme y light theme
- TypeScript compila sin errores

**Prioridad:** Must
**Story Points:** 2

---

### Story E-1.2
**Como** desarrollador,
**quiero** que el boton "Auto-tag" se deshabilite y muestre un spinner mientras el tagger esta en ejecucion,
**para** evitar lanzar dos ejecuciones concurrentes y saber que el sistema esta procesando.

**Criterios de aceptacion:**
- [ ] Al hacer clic, el boton cambia a estado loading inmediatamente (< 100ms)
- [ ] En loading: icono spinner 14px reemplaza al sparkles, label cambia a "Tagging..."
- [ ] En loading: boton tiene `disabled` y `aria-busy="true"`, cursor not-allowed
- [ ] En loading: los botones New Task y Filter tambien se deshabilitan
- [ ] Si la respuesta llega (exito o error), el boton vuelve al estado normal
- [ ] Si no llega respuesta en 30s, el frontend restaura el boton y muestra toast de error

**Definition of Done:**
- Estado loading controlado por `taggerLoading` en useAppStore
- No es posible hacer clic dos veces (pointer-events disabled + aria-disabled)
- Animacion del spinner usa la clase Tailwind existente (spin keyframe)

**Prioridad:** Must
**Story Points:** 1

---

## E-2: Revision de sugerencias

### Story E-2.1
**Como** desarrollador,
**quiero** ver un modal de revision que liste todas las sugerencias del tagger,
**para** poder revisar cada cambio propuesto antes de aplicarlo.

**Criterios de aceptacion:**
- [ ] El modal se abre automaticamente cuando llegan las sugerencias (taggerModalOpen=true)
- [ ] El modal usa el componente Modal compartido (portal, backdrop, Escape, focus trap)
- [ ] El header del modal muestra: titulo "Auto-tag suggestions", modelo usado, numero de sugerencias y skipped
- [ ] Cada sugerencia ocupa una fila con: toggle accept/reject, titulo de la card, badge tipo actual, flecha, badge tipo inferido, indicador de confianza
- [ ] El modal tiene scroll vertical si hay mas de 4 sugerencias (max-h-[80vh])
- [ ] La tecla Escape cierra el modal sin aplicar cambios (comportamiento del Modal compartido)

**Definition of Done:**
- Componente TaggerReviewModal.tsx en `frontend/src/components/modals/`
- Usa `<Modal>` compartido que implementa Escape y focus trap
- Visible y usable en viewport 320px de ancho

**Prioridad:** Must
**Story Points:** 3

---

### Story E-2.2
**Como** desarrollador,
**quiero** que las sugerencias de baja confianza esten pre-rechazadas por defecto,
**para** evitar aplicar cambios probablemente incorrectos sin revisarlos explicitamente.

**Criterios de aceptacion:**
- [ ] Sugerencias con confidence="high" o "medium" tienen el toggle en ON (accept) por defecto
- [ ] Sugerencias con confidence="low" tienen el toggle en OFF (reject) por defecto
- [ ] Las filas con confidence="low" tienen un fondo amber/error-container visible (bg-error-container/20)
- [ ] Las filas con confidence="low" tienen un borde izquierdo 2px en color error
- [ ] El indicador de confianza usa puntos (●) + texto descriptivo: "HIGH", "MED", "LOW"
- [ ] El indicador de confianza usa color + texto (nunca solo color, WCAG 1.4.1)

**Definition of Done:**
- Logica de estado inicial de cada toggle implementada en TaggerReviewModal
- Colores verificados contra tokens del design system (no inline styles)
- Test unitario verifica que LOW = OFF, HIGH/MED = ON por defecto

**Prioridad:** Must
**Story Points:** 2

---

### Story E-2.3
**Como** desarrollador,
**quiero** poder aceptar o rechazar cada sugerencia individualmente con un toggle,
**para** tener control granular sobre que cambios se aplican.

**Criterios de aceptacion:**
- [ ] Cada fila tiene un toggle (switch) que cambia entre accept y reject
- [ ] El toggle tiene `aria-label="Accept suggestion for [titulo de la card]"`
- [ ] El toggle tiene `aria-checked` que refleja el estado actual
- [ ] El toggle es navegable con teclado (Tab + Space/Enter)
- [ ] El contador del boton "Apply selected (N)" se actualiza en tiempo real al cambiar toggles
- [ ] Si todos los toggles estan en OFF, el boton Apply se deshabilita

**Definition of Done:**
- Toggle implementado con switch nativo o componente accesible
- aria-live="polite" en el contador del boton Apply para anunciar cambios al screen reader
- Test unitario verifica que toggling una fila actualiza el contador

**Prioridad:** Must
**Story Points:** 2

---

## E-3: Aplicacion de cambios

### Story E-3.1
**Como** desarrollador,
**quiero** aplicar todas las sugerencias aceptadas con un solo clic en "Apply selected (N)",
**para** actualizar el tipo de las cards seleccionadas sin tener que editar cada una manualmente.

**Criterios de aceptacion:**
- [ ] El boton "Apply selected (N)" muestra el numero actualizado de sugerencias aceptadas
- [ ] Al hacer clic, se llama a `PUT /api/v1/spaces/:spaceId/tasks/:id` por cada sugerencia aceptada
- [ ] Las llamadas se hacen en secuencia (no en paralelo) para evitar conflictos
- [ ] Durante Apply: el boton muestra "Applying X of N..." con spinner
- [ ] Durante Apply: el boton Cancel se deshabilita
- [ ] Cada fila muestra su estado individual: spinner / checkmark / error
- [ ] Al completar Apply: el modal se cierra, el board se refresca, aparece toast de exito

**Definition of Done:**
- Logica de Apply implementada en TaggerReviewModal
- refreshBoard() llamado desde closeTagger() en el store
- Toast de exito usa `useAppStore.getState().showToast(message, 'success')`
- Test unitario verifica que N peticiones PUT son realizadas para N sugerencias aceptadas

**Prioridad:** Must
**Story Points:** 3

---

### Story E-3.2
**Como** desarrollador,
**quiero** que el modal muestre un estado vacio si no hay sugerencias,
**para** saber que mi board ya esta bien tipado sin necesidad de acciones adicionales.

**Criterios de aceptacion:**
- [ ] Si suggestions=[] en la respuesta del API, el modal muestra el estado empty
- [ ] El estado empty tiene icono sparkles 48px, titulo "All cards are already correctly typed.", subtitulo descriptivo
- [ ] El footer del estado empty tiene solo un boton "Close" (ghost, centrado)
- [ ] El toast de la accion indica "No changes suggested — your board looks great!"

**Definition of Done:**
- Estado empty renderizado correctamente (no es un error, es informacion positiva)
- El tono es positivo (no de error)

**Prioridad:** Should
**Story Points:** 1

---

## E-4: Mejora de descripciones

### Story E-4.1
**Como** desarrollador,
**quiero** poder activar la opcion "Improve descriptions" en el modal de revision,
**para** que Claude tambien reescriba las descripciones de las cards de forma mas clara y accionable.

**Criterios de aceptacion:**
- [ ] En el modal hay un checkbox "Improve descriptions" desmarcado por defecto
- [ ] Al marcar el checkbox, se relanza la llamada al API con `improveDescriptions: true`
- [ ] Las filas de sugerencias muestran un diff inline (descripcion eliminada vs nueva)
- [ ] El diff usa formato: lineas eliminadas en rojo/error-container, nuevas en verde/success-container
- [ ] El diff usa font mono (JetBrains Mono) 12px
- [ ] Si la descripcion nueva es identica a la original, no se muestra el diff

**Definition of Done:**
- Checkbox en el subheader del modal
- Logica de re-run con improveDescriptions=true implementada
- Diff renderizado correctamente (color + texto prefix, WCAG 1.4.1)

**Asuncion:** El usuario entiende que activar "Improve descriptions" lanza una nueva llamada a la API (2-6s adicionales). Mostrar spinner mientras re-run.

**Prioridad:** Should
**Story Points:** 3

---

## E-5: Manejo de errores

### Story E-5.1
**Como** desarrollador,
**quiero** ver un mensaje de error claro si la API de Anthropic falla o la clave no esta configurada,
**para** entender que ocurrio y saber como resolverlo sin entrar en panico.

**Criterios de aceptacion:**
- [ ] Si el servidor retorna 503 ANTHROPIC_KEY_MISSING: toast de error con mensaje "ANTHROPIC_API_KEY no esta configurado en el servidor. Exporta la variable y reinicia el servidor." + boton "Cerrar"
- [ ] Si el servidor retorna 502 ANTHROPIC_API_ERROR: toast de error con mensaje "El servicio de AI no respondio. Intenta de nuevo." + boton "Reintentar"
- [ ] Si hay error de red (fetch falla): toast de error con mensaje "No se pudo conectar al servidor. Verifica que el servidor este corriendo." + boton "Reintentar"
- [ ] Si retorna 409 TAGGER_ALREADY_RUNNING: toast informativo (no de error) "El tagger ya esta en ejecucion. Espera unos segundos."
- [ ] En todos los casos, el boton "Auto-tag" vuelve al estado idle
- [ ] Los mensajes de error no exponen stack traces, claves o informacion tecnica interna

**Definition of Done:**
- `setTaggerError()` en el store se llama con el mensaje correcto para cada caso
- Toast usa el sistema de toasts existente (showToast)
- Test unitario cubre los 5 codigos de error

**Prioridad:** Must
**Story Points:** 2

---

### Story E-5.2
**Como** desarrollador,
**quiero** que un error en una card individual durante el Apply no cancele el resto de aplicaciones,
**para** que las cards que si se pueden actualizar no queden pendientes.

**Criterios de aceptacion:**
- [ ] Si PUT falla para una card concreta, la fila muestra un icono de error rojo con mensaje inline
- [ ] El Apply continua con las siguientes cards (no abortar al primer error)
- [ ] Al finalizar, el toast indica "X de N cambios aplicados. Y errores." si hubo errores parciales
- [ ] Las cards con error permanecen en el modal para que el usuario pueda reintentar manualmente
- [ ] El board se refresca igualmente para reflejar los cambios exitosos

**Definition of Done:**
- Logica de Apply itera con try/catch por card
- Estado de error por fila implementado en el estado local del modal
- Toast con resumen de exitos y errores

**Prioridad:** Must
**Story Points:** 2

---

## Resumen MoSCoW

| Prioridad | Stories | Story Points |
|-----------|---------|--------------|
| Must | E-1.1, E-1.2, E-2.1, E-2.2, E-2.3, E-3.1, E-3.2, E-5.1, E-5.2 | 18 |
| Should | E-4.1 | 3 |
| Could | - | - |
| Won't | Apply directo sin modal, SSE streaming, multi-usuario | - |

**Total estimado:** 21 story points

---

## Asunciones documentadas

| ID | Asuncion | Impacto si es incorrecta |
|----|----------|--------------------------|
| A-1 | El usuario es unico (monouser), no hay conflictos de concurrencia entre usuarios | Si hay multi-usuario, se necesita locking mas sofisticado |
| A-2 | El board tiene maximo 100 cards (NFR-1) | Si hay mas, la latencia puede superar 8s y la UX necesita SSE |
| A-3 | El usuario no quiere aplicar cambios sin revisarlos | Si la confianza en el modelo sube, podria querer un modo auto-apply |
| A-4 | Las sugerencias de confianza LOW pre-rechazadas son preferibles a mostrarlas aceptadas | Si el usuario trabaja con boards donde LOW es relevante, esto puede molestar |
| A-5 | La rellamada al API con improveDescriptions=true es aceptable (doble coste de tokens) | Si el coste es una preocupacion, el checkbox debe lanzar el re-run solo si el usuario confirma |
