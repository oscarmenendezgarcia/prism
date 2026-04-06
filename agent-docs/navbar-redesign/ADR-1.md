# ADR-1: Ubicación del ThemeToggle en el header de Prism

## Status
Accepted

## Context

El header de Prism contiene, de izquierda a derecha:

```
[Brand]  [RunIndicator — centrado]  [PanelToggles] | [New Task] | [ThemeToggle]
```

El `ThemeToggle` existe y funciona. Está aislado al extremo derecho del header, separado del grupo de panel toggles por el botón "New Task" y un divisor visual.

Con el rediseño en curso (navbar-redesign), los panel toggles pasan de icono-solo a icono + label en dos líneas (40px de alto), y el orden cambia a: Terminal > Settings > History > Logs > Config. El ThemeToggle **no formaba parte de ese rediseño** — su destino quedó sin especificar (Asunción A-3 en wireframes.md).

### Naturaleza funcional del ThemeToggle frente a los panel toggles

| Criterio | Panel Toggles (5 botones) | ThemeToggle |
|---|---|---|
| Función | Abrir/cerrar un panel de contenido | Cambiar preferencia de presentación visual |
| Estado reflejado en | `useAppStore` (paneles abiertos) | `useTheme` + localStorage |
| Ciclo de estados | on / off | system → light → dark → system |
| Feedback de estado | bg azul + border + texto azul (panel visible) | Icono cambia (brightness_auto / light_mode / dark_mode) |
| Frecuencia de uso | Alta — cada sesión | Baja — una vez por preferencia |
| Grupo semántico | Navegación de paneles de trabajo | Preferencia de apariencia |

El ThemeToggle es **semánticamente distinto** de los panel toggles. No abre un panel, no refleja estado de la aplicación, y tiene un ciclo de 3 estados que no encaja en el patrón aria-pressed binario del grupo.

### Presión de espacio en el header

Con el rediseño:
- 5 panel toggles de 40px × min-72px cada uno + gap-4px = ~376px mínimo
- Separadores (2 × ~17px) = ~34px
- "New Task" button = ~110px
- Brand = ~90px
- RunIndicator (centrado, variable) = ~180px

En un viewport de 1280px el header tiene ~1280px disponibles. La suma de elementos fijos ocupa ~610px, dejando ~670px para el RunIndicator y márgenes. El espacio es justo pero viable. Añadir un elemento extra al grupo de toggles (72px más) empuja el límite en 1280px.

---

## Decision

**El ThemeToggle permanece separado del grupo de panel toggles, en su posición actual al extremo derecho del header, con dos ajustes menores:**

1. Su tamaño se iguala al de los panel toggles rediseñados: `h-10` (40px) en lugar de `h-9` (36px), para alineación vertical consistente dentro del flex row.
2. El separador que lo antecede (`w-px h-6 bg-border/60 mx-2`) se conserva, actuando como divisor semántico entre "acciones de trabajo" y "preferencias de entorno".

El ThemeToggle **no recibe label de texto** en esta fase. Su icono (brightness_auto / light_mode / dark_mode) es suficientemente reconocible para un usuario técnico, y el `title` + `aria-label` cubren la accesibilidad. Añadir un label "Theme" introduciría ruido en un elemento secundario que ya tiene identidad visual clara.

---

## Rationale

### Por qué no Opción 2 — Integrar en el grupo de panel toggles

Integrar el ThemeToggle dentro del grupo de toggles de paneles viola el principio de **cohesión semántica**. Los 5 panel toggles comparten un invariante: todos abren/cierran un panel de contenido y tienen estado binario aria-pressed. El ThemeToggle no cumple ninguno de estos criterios:

- No abre ningún panel.
- Tiene 3 estados (no binario), por lo que su aria-pressed no aplica.
- Su acción afecta a la capa de presentación global, no al layout de contenido.

Desde el punto de vista del usuario, encontrar "Theme" entre "Terminal" y "Settings" genera confusión cognitiva: ¿por qué cambiar el tema cierra/abre algo?

Adicionalmente, añadir un sexto botón de 72px al grupo aumenta la anchura del header en ese bloque en ~76px (72px + 4px gap), lo que en 1280px fuerza al RunIndicator a comprimir o al layout a romper.

### Por qué no Opción 3 — Dropdown / menú de usuario

Un dropdown introduce una capa de interacción adicional (click → menú → click) para una acción que actualmente requiere un solo click. Prism es una herramienta para un único developer técnico, sin modelo de usuarios, perfil ni cuenta. No existe un "menú de usuario" natural donde anclar la preferencia de tema. Crear ese contenedor solo para alojar el toggle sería sobreingeniería.

El dropdown también oculta una función que el rediseño quiere que sea visible y directamente accesible.

### Por qué no Opción 4 — Esquina fija (FAB)

Una posición `fixed` coloca el ThemeToggle fuera del flujo del header, sobre el contenido de los paneles. Esto genera:

- Colisión visual con paneles laterales (Terminal, Settings, etc.) que ocupan el lateral derecho.
- Duplicación de capas z-index que complica el sistema de superposición actual.
- Inconsistencia con el design language de Prism (no hay ningún otro elemento FAB).
- Regresión en mobile donde el FAB puede cubrir contenido.

El patrón FAB es adecuado para acciones primarias frecuentes (como "New Task" podría serlo). Para una preferencia de apariencia de baja frecuencia, es una solución desproporcionada.

### Por qué sí Opción 1 — Mantener posición actual (con ajuste de altura)

- **Aislamiento semántico preservado**: el separador visual comunica "esto es diferente" sin explicación adicional.
- **Cero riesgo de ruptura de layout**: el único cambio es subir la altura de 36px a 40px para alineación.
- **Consistencia con el design system**: el componente ya existe, funciona, y cumple los tokens MD3 aplicados.
- **Principio de mínima sorpresa**: el usuario ya conoce su posición. El rediseño no altera la interacción.
- **Dark theme como default**: dado que dark mode es el default del proyecto, la mayoría de usuarios nunca necesitará cambiar el tema. Mantenerlo como elemento secundario (no dentro del grupo primario de navegación) refleja correctamente su importancia.

---

## Consequences

### Positive
- El header mantiene su estructura y jerarquía semántica.
- Sin aumento de anchura en el grupo de panel toggles — no hay riesgo de overflow en 1280px.
- El `ThemeToggle` sigue siendo accesible en un click, sin capas de menú.
- La separación visual (divisor) formaliza la distinción entre "panel navigation" y "display preferences".
- Cero cambios en la lógica existente de `useTheme` ni en los stores.

### Negative / Risks
- **Riesgo bajo:** El ThemeToggle queda "flotando" solo después del divisor, sin compañía visual. Mitigación: si en el futuro se añaden más preferencias de entorno (densidad, idioma, notificaciones), pueden unirse a esta zona sin rediseño.
- **Riesgo bajo:** La diferencia de altura (36px → 40px) requiere una modificación CSS de una línea en `ThemeToggle.tsx`. Sin impacto funcional.
- **Riesgo descartado:** No se valora añadir label "Theme" ahora; si el equipo cambia de opinión, puede añadirse en una iteración futura sin afectar a este ADR.

---

## Alternatives Considered

### Opción A — Integrar en el grupo de panel toggles
Discartada: viola cohesión semántica (ThemeToggle no abre paneles), rompe el patrón aria-pressed binario del grupo, y añade ~76px a un header ya ajustado en 1280px.

### Opción B — Mover a dropdown/menú de usuario
Descartada: añade una capa de interacción innecesaria para Prism (app single-user sin concepto de perfil). Oculta una función que debe ser directamente accesible.

### Opción C — Esquina fija (FAB)
Descartada: colisiona con paneles laterales, introduce problemas de z-index, no existe precedente FAB en el design language de Prism, y es desproporcionado para una acción de baja frecuencia.

---

## Impact on Ongoing Redesign

Este ADR complementa el rediseño de panel toggles (navbar-redesign) sin modificar ninguna decisión ya tomada:

- Los wireframes S-01 y S-02 muestran correctamente al ThemeToggle separado (`[☾]` y `[☀]`), alineado con esta decisión.
- La Asunción A-3 de wireframes.md ("ThemeToggle mantiene su diseño actual, icon-only, sin label") queda formalmente aceptada por este ADR.
- El único cambio implementable es ajustar `h-9` → `h-10` en `ThemeToggle.tsx` para igualar la altura con los panel toggles rediseñados (40px). Esta es una modificación de 1 línea CSS, asignable al mismo task de implementación del rediseño general.

---

## Review
Suggested review date: 2026-10-06

Si para esa fecha el header ha crecido con nuevas preferencias de entorno (density, i18n, notifications), evaluar si una zona "Settings strip" o un dropdown de preferencias se justifica.

---

## §T-6 — Especificación de implementación del ThemeToggle

> Añadido: 2026-04-06. Resuelve las 4 preguntas de diseño pendientes para la tarea T-6.

### Pregunta 1 — ¿Label de texto?

**Decisión: sin label.**

El ADR original estableció esta posición con tres razones (baja frecuencia de uso, iconos universalmente reconocibles, separación semántica del grupo de panel toggles). La revisión de T-6 no altera esta decisión.

La alternativa de label dinámico que muestra el estado actual ("Dark", "Light", "System") fue evaluada y descartada: introduce un elemento que cambia visualmente en cada click — comportamiento anómalo en un header que por lo demás es estático. El icono ya comunica el estado activo; el `aria-label` cubre la accesibilidad describiendo la acción siguiente.

### Pregunta 2 — ¿Idle border `border border-white/[0.08]`?

**Decisión: sin idle border.**

Los panel toggles llevan idle border para reforzar que forman un grupo cohesivo de botones interactivos. El ThemeToggle ya está separado de ese grupo por un divisor (`w-px h-6 bg-border/60`) que comunica explícitamente "esto es diferente". Añadir el mismo idle border replicaría el lenguaje visual del grupo y debilitaría esa distinción semántica.

El affordance de interactividad se cubre con el hover state (`hover:bg-surface-variant hover:text-text-primary`), que aparece inmediatamente al pasar el cursor.

### Pregunta 3 — `rounded-xl` vs `rounded-lg`?

**Decisión: mantener `rounded-xl` (12px).**

El ADR §Consequences afirmó explícitamente "rounded-xl se conserva en ThemeToggle". Esta sección confirma esa decisión como deliberada, no como descuido.

Justificación: `rounded-xl` en un botón de 40×40px produce una forma de "pastilla compacta" que diferencia visualmente al ThemeToggle de los panel toggles (que usan `rounded-lg` y son más anchos). El mayor radio relativo refuerza a nivel subconsciente que el elemento es singular y de naturaleza distinta. Uniformizar a `rounded-lg` eliminaría ese diferenciador sin ganancia funcional.

### Pregunta 4 — ¿Ancho: `w-9`, `w-10`, o `min-w-[72px] px-3`?

**Decisión: `w-10` (40px), botón cuadrado.**

Sin label no hay justificación para `min-w-[72px]`. La elección entre `w-9` (36px) y `w-10` (40px) se resuelve a favor de `w-10` por dos razones:

1. **Alineación visual**: con `h-10` ya definido, un botón cuadrado `w-10 h-10` evita la asimetría de un rectángulo 36×40px que no tiene razón de ser.
2. **Target de Fitts**: 40×40px cumple holgadamente el mínimo de 44×44px recomendado por WCAG 2.5.5 en la dimensión vertical; la ligera diferencia en horizontal (40 vs 44px) es aceptable para un elemento de uso infrecuente. `w-9` en cambio produce 36×40px, un rectángulo sin cuadrado que resulta ligeramente menos cómodo de clickar.

El `min-w-[72px] px-3` queda reservado exclusivamente para los panel toggles con label.

### Especificación final del className

```tsx
className="inline-flex items-center justify-center w-10 h-10 rounded-xl text-text-secondary
           hover:bg-surface-variant hover:text-text-primary
           disabled:opacity-40 disabled:cursor-not-allowed
           transition-all duration-150 ease-apple leading-none"
```

Cambios respecto al estado actual de T-4 (`w-9 h-10 rounded-xl`):
- `w-9` → `w-10` (botón cuadrado 40×40px)
- Todo lo demás permanece igual.
