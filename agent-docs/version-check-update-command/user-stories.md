# User Stories: Version Check + `prism update` Command

## Feature Context

CLI feature que agrega dos capacidades relacionadas a `prism-kanban`:

1. Chequeo de version no-bloqueante al arrancar cualquier subcomando.
2. Subcomando `prism update` para instalar la ultima version con confirmacion.

No hay API REST ni frontend involucrado. Toda la UX es texto en terminal (stdout/stderr).

---

## Epics

### Epic 1 — Startup Version Check (chequeo al arrancar)

#### Historia US-001: Aviso de nueva version disponible

**Como** usuario que ejecuta comandos `prism` regularmente,
**quiero** ver un aviso no-bloqueante cuando hay una version mas nueva disponible,
**para** saber que debo actualizar sin necesidad de consultar npm manualmente.

**Acceptance Criteria:**

- AC-001.1: Cuando `semver(latest) > semver(installed)`, se imprime en stderr el siguiente texto exacto antes de que el subcomando principal produzca su propia salida (o inmediatamente despues si la red responde tarde):
  ```
  ✦ Nueva versión disponible: vX.Y.Z → vA.B.C. Ejecuta: prism update
  ```
  donde `X.Y.Z` es la version instalada y `A.B.C` es la ultima publicada en npm.
- AC-001.2: El aviso se imprime en **stderr**, nunca en stdout, para no contaminar salidas pipes ni logs estructurados.
- AC-001.3: El aviso solo aparece cuando la version instalada es estrictamente menor que la publicada. Si son iguales o la instalada es mayor (build local), no se imprime nada.
- AC-001.4: El aviso incluye el simbolo UTF-8 `✦` (U+2726). En terminales que no soporten UTF-8 el texto debe seguir siendo legible (el simbolo puede omitirse o sustituirse por `*`, pero la implementacion base usa `✦`).
- AC-001.5: El aviso no bloquea ni retrasa el arranque del subcomando principal. `prism start --port 3000` debe iniciar el servidor en latencia normal independientemente del resultado del chequeo.

**Definition of Done:**

- Modulo `bin/update-check.js` exporta `scheduleUpdateCheck(flags)` que retorna `void` sincronamente.
- Aviso visible en terminal con color/formato adecuado al resto del CLI (sin ANSI colors si el terminal no los soporta, sin styles CSS).
- Tests unitarios cubren la ruta de impresion (stderr mock verificado).

**Priority:** Must

**Story Points:** 3

---

#### Historia US-002: Cache de 24 horas (sin peticion en cada comando)

**Como** usuario que ejecuta multiples comandos `prism` en un mismo dia,
**quiero** que el chequeo de version no haga una peticion HTTP en cada invocacion,
**para** que el CLI sea rapido y no genere trafico innecesario al registry de npm.

**Acceptance Criteria:**

- AC-002.1: Tras una primera consulta exitosa al registry, el resultado se guarda en `$XDG_DATA_HOME/prism/update-cache.json` (o `~/.local/share/prism/update-cache.json` si `XDG_DATA_HOME` no esta definido).
- AC-002.2: Invocaciones posteriores dentro de las 24 horas leen el cache y no realizan ninguna peticion HTTP.
- AC-002.3: El cache contiene al menos los campos `checkedAt` (timestamp `Date.now()`) y `latestVersion` (string semver).
- AC-002.4: Si el archivo de cache no puede escribirse (directorio de solo lectura), el chequeo continua sin cache y sin error visible para el usuario. La incapacidad de escribir el cache nunca provoca una excepcion no capturada.
- AC-002.5: La ruta del cache puede sobreescribirse mediante la variable de entorno `PRISM_UPDATE_CACHE` (para tests y entornos especiales).

**Definition of Done:**

- El cache se escribe en la ruta correcta con el schema definido en el blueprint.
- Tests verifican: cache valido evita fetch, cache caducado dispara fetch, cache ausente dispara fetch.
- Tests usan directorio temporal para el cache (no el home real del desarrollador).

**Priority:** Must

**Story Points:** 2

---

#### Historia US-003: Fallo silencioso en modo offline o con timeout

**Como** usuario que ejecuta `prism` en un entorno sin acceso a internet (avion, VPN restrictiva, red corporativa con whitelist),
**quiero** que el CLI no falle ni muestre errores al no poder contactar el registry de npm,
**para** que mi flujo de trabajo no se interrumpa por la funcion de actualizacion.

**Acceptance Criteria:**

- AC-003.1: Si la peticion HTTP al registry supera 2500 ms, se cancela silenciosamente. No se imprime ningun mensaje de error en stdout ni stderr.
- AC-003.2: Si la peticion falla por cualquier error de red (DNS, ECONNREFUSED, ETIMEDOUT, parse error), el chequeo se descarta silenciosamente. El proceso principal continua con normalidad.
- AC-003.3: El timeout de 2500 ms aplica solo al chequeo en background. El subcomando `prism update`, al ser una accion explicita del usuario, usa un timeout mayor de 5000 ms y si falla muestra un mensaje de error (ver US-007).
- AC-003.4: No se escribe ningun mensaje en el log de la aplicacion ni en archivos de log del sistema cuando el chequeo de background falla.

**Definition of Done:**

- Test con fetch mock de respuesta lenta (> 2500 ms) confirma: cero output en stderr, cero exceptions, proceso termina normalmente.
- Test con fetch mock que rechaza (simula ECONNREFUSED) confirma el mismo comportamiento.

**Priority:** Must

**Story Points:** 1

---

#### Historia US-004: Supresion del chequeo en CI y scripts (--no-update-check / PRISM_NO_UPDATE_CHECK)

**Como** operador de CI/CD o autor de scripts de automatizacion,
**quiero** poder deshabilitar el chequeo de version por completo,
**para** que pipelines automatizados no dependan de conectividad al registry de npm ni reciban output inesperado en stderr.

**Acceptance Criteria:**

- AC-004.1: El flag `--no-update-check` (pasado en cualquier posicion de los argumentos) suprime el chequeo de version. `scheduleUpdateCheck` se convierte en no-op. No se imprime nada, no se hace fetch, no se lee ni escribe cache.
- AC-004.2: La variable de entorno `PRISM_NO_UPDATE_CHECK=1` (o cualquier valor "truthy" que no sea `"0"` o `""`) tiene el mismo efecto que `--no-update-check`. El flag de entorno permite supresion sin modificar los argumentos del comando.
- AC-004.3: `--no-update-check` no produce ningun warning de "flag desconocido" en el output existente del CLI.
- AC-004.4: `PRISM_NO_UPDATE_CHECK` no produce ninguna advertencia si se define en el entorno.
- AC-004.5: La supresion aplica a todos los subcomandos: `prism start`, `prism init`, `prism update`, y cualquier otro futuro.
- AC-004.6: El texto `--no-update-check` aparece documentado en la salida de `prism --help`.

**Nota de implementacion:** La recomendacion para entornos CI es documentar el uso de `PRISM_NO_UPDATE_CHECK=1` en la guia de configuracion de CI, dado que no requiere modificar argumentos de los comandos existentes.

**Definition of Done:**

- Tests verifican que con el flag y con la variable de entorno no se llama a fetch y no hay output en stderr.
- `prism --help` incluye documentacion del flag.
- Test de regresion: `prism bogus` sigue exitando con codigo 2 (comportamiento existente).

**Priority:** Must

**Story Points:** 1

---

### Epic 2 — `prism update` Subcommand

#### Historia US-005: Ver la version instalada y la ultima disponible antes de confirmar

**Como** usuario que ejecuta `prism update`,
**quiero** ver tanto la version actualmente instalada como la ultima version disponible,
**para** tomar una decision informada antes de confirmar la actualizacion.

**Acceptance Criteria:**

- AC-005.1: Al ejecutar `prism update`, si hay una version mas nueva, se muestra el siguiente prompt en stdout:
  ```
  Actualizar prism-kanban v0.6.0 → v1.2.3? [y/N]
  ```
  donde `v0.6.0` es la version instalada y `v1.2.3` la ultima en npm.
- AC-005.2: Si la version instalada ya es la ultima, se muestra en stdout:
  ```
  prism ya está en la última versión (v1.2.3)
  ```
  y el proceso termina con codigo de salida 0 sin preguntar nada.
- AC-005.3: La comparacion de versiones es semver numerica (comparacion de tuplas [major, minor, patch]). No se usa ninguna libreria externa.
- AC-005.4: La version instalada se lee de `package.json` (campo `version`) en el momento de la ejecucion.

**Definition of Done:**

- Test verifica el texto exacto del prompt cuando hay actualizacion disponible.
- Test verifica el texto exacto del mensaje "ya en ultima version".
- Ambos mensajes van a stdout (no stderr).

**Priority:** Must

**Story Points:** 1

---

#### Historia US-006: Confirmacion interactiva antes de instalar (modo TTY)

**Como** usuario interactivo en una terminal,
**quiero** que `prism update` me pida confirmacion antes de instalar,
**para** no ejecutar accidentalmente una actualizacion sin quererlo.

**Acceptance Criteria:**

- AC-006.1: En modo TTY (`process.stdout.isTTY` truthy), el comando espera una linea de entrada del usuario antes de proceder.
- AC-006.2: El usuario puede confirmar escribiendo `y`, `Y` o `yes` (insensible a mayusculas).
- AC-006.3: Cualquier otra entrada (incluyendo Enter sin texto, `n`, `N`, `no`) cancela la operacion. Se imprime en stdout:
  ```
  Cancelado.
  ```
  El proceso termina con codigo de salida 0.
- AC-006.4: El prompt muestra `[y/N]` con `N` en mayuscula para indicar que la opcion por defecto es "no confirmar".
- AC-006.5: Si el usuario presiona Ctrl+C durante el prompt, el proceso termina limpiamente (el comportamiento de SIGINT es el del shell nativo, no se requiere manejo especial).

**Definition of Done:**

- Test con stdin simulado que envia `y\n` verifica que npm install es invocado.
- Test con stdin simulado que envia `\n` (enter vacio) verifica que npm install NO es invocado y se imprime "Cancelado."
- Test con stdin simulado que envia `n\n` verifica el mismo comportamiento de cancelacion.

**Priority:** Must

**Story Points:** 1

---

#### Historia US-007: Auto-confirmacion en modo no interactivo (CI/pipelines)

**Como** operador de CI/CD que usa `prism update` en un pipeline automatizado,
**quiero** que el comando se ejecute sin bloquear esperando input,
**para** que el pipeline no se quede colgado esperando una respuesta de teclado.

**Acceptance Criteria:**

- AC-007.1: En modo no-TTY (`process.stdout.isTTY` falsy), el comando auto-confirma sin leer stdin.
- AC-007.2: En modo no-TTY, si hay actualizacion disponible, se procede directamente a ejecutar `npm install -g prism-kanban@latest` sin imprimir el prompt `[y/N]`.
- AC-007.3: En modo no-TTY con version ya actualizada, el comportamiento es identico al modo TTY: mensaje de "ya en ultima version" y salida 0.
- AC-007.4: El auto-confirm en CI no imprime ningun aviso adicional al usuario (no imprime "auto-confirmando en CI" ni nada similar). La ausencia del prompt es suficiente indicacion.

**Definition of Done:**

- Test con `process.stdout.isTTY = undefined/false` verifica que spawnSync es llamado sin leer stdin.
- Test confirma que no se imprime el prompt `[y/N]` en modo no-TTY cuando hay actualizacion.

**Priority:** Must

**Story Points:** 1

---

#### Historia US-008: Ejecucion visible de npm install con salida en tiempo real

**Como** usuario que confirmo la actualizacion,
**quiero** ver el progreso de npm install en mi terminal mientras se ejecuta,
**para** saber que la instalacion esta en curso y poder diagnosticar si falla.

**Acceptance Criteria:**

- AC-008.1: `npm install -g prism-kanban@latest` se ejecuta con `stdio: 'inherit'`, de forma que la salida de npm (barra de progreso, mensajes de resolucion de dependencias) es visible directamente en la terminal del usuario.
- AC-008.2: El comando invocado es exactamente `npm install -g prism-kanban@latest`. No se usan variantes como `npx`, `yarn`, ni `pnpm`.
- AC-008.3: `npm` debe estar accesible en el PATH del usuario. Si no lo esta, el error de "comando no encontrado" es visible porque stdio es heredado.
- AC-008.4: El proceso de `prism update` espera a que `npm install` termine antes de imprimir el mensaje de resultado (`spawnSync`, no `spawn`).

**Definition of Done:**

- Test verifica que spawnSync es llamado con argumentos `['install', '-g', 'prism-kanban@latest']` y opciones `{ stdio: 'inherit' }`.
- Test verifica que es `spawnSync` (sincronico) y no `spawn` ni `exec`.

**Priority:** Must

**Story Points:** 1

---

#### Historia US-009: Mensaje de exito tras actualizacion exitosa

**Como** usuario que ejecuto `prism update` y npm install termino exitosamente,
**quiero** ver una confirmacion clara de que la actualizacion fue completada,
**para** saber que puedo continuar usando la version nueva.

**Acceptance Criteria:**

- AC-009.1: Si `npm install` termina con codigo de salida 0, se imprime en stdout:
  ```
  ✓ Actualizado a v1.2.3
  ```
  donde `v1.2.3` es la version que se acaba de instalar (la `latestVersion` obtenida del registry al inicio del comando).
- AC-009.2: El simbolo `✓` (U+2713) precede al mensaje. En terminales que no lo soporten, el mensaje sigue siendo legible.
- AC-009.3: El proceso termina con codigo de salida 0.
- AC-009.4: No se imprime ningun output adicional de `prism` (npm puede imprimir lo que quiera por heredar stdio).

**Definition of Done:**

- Test con mock de spawnSync retornando `{ status: 0 }` verifica el texto exacto en stdout.
- Test verifica que el proceso termina con exit code 0.

**Priority:** Must

**Story Points:** 1

---

#### Historia US-010: Mensaje de error cuando npm install falla

**Como** usuario cuyo `prism update` fallo por un problema de permisos o de npm,
**quiero** ver un mensaje de error claro con el codigo de salida,
**para** poder diagnosticar el problema (por ejemplo, re-ejecutar con sudo).

**Acceptance Criteria:**

- AC-010.1: Si `npm install` termina con codigo de salida distinto de 0, se imprime en stderr:
  ```
  Error: npm install falló (código N)
  ```
  donde `N` es el codigo de salida real de npm.
- AC-010.2: El proceso de `prism update` termina con codigo de salida 1.
- AC-010.3: No se imprime el mensaje de exito (`✓ Actualizado a...`) cuando npm falla.
- AC-010.4: En caso de error de permisos (frecuente con instalaciones globales de npm sin nvm), el output de npm instalado via `stdio: 'inherit'` ya muestra el detalle del error. El mensaje de `prism` complementa con el codigo pero no intenta interpretar la causa.

**Definition of Done:**

- Test con mock de spawnSync retornando `{ status: 1 }` verifica el texto en stderr y exit code 1.
- Test con mock retornando `{ status: 127 }` verifica que el codigo impreso es 127.

**Priority:** Must

**Story Points:** 1

---

#### Historia US-011: Mensaje de error cuando no se puede obtener la ultima version (modo update)

**Como** usuario que ejecuta `prism update` sin conexion a internet,
**quiero** ver un mensaje de error claro que indique el problema de conectividad,
**para** entender por que el comando no puede proceder y que debo comprobar mi conexion.

**Acceptance Criteria:**

- AC-011.1: Si la peticion al registry de npm falla o supera el timeout de 5000 ms, se imprime en stderr:
  ```
  Error: no se pudo obtener la versión desde npm. Comprueba tu conexión.
  ```
- AC-011.2: El proceso termina con codigo de salida 1.
- AC-011.3: Este error se muestra SOLO en el subcomando `prism update` (accion explicita del usuario). El chequeo de background en US-003 sigue siendo silencioso.
- AC-011.4: No se muestra ningun stack trace de Node.js ni mensaje de error interno. Solo el texto definido en AC-011.1.

**Definition of Done:**

- Test con fetchLatestVersion mock que lanza error verifica el mensaje exacto en stderr y exit code 1.
- Test con fetch mock que supera 5000 ms verifica el mismo comportamiento.

**Priority:** Must

**Story Points:** 1

---

### Epic 3 — CLI Integration and Discoverability

#### Historia US-012: `prism update` documentado en `prism --help`

**Como** nuevo usuario de prism,
**quiero** ver `prism update` y `--no-update-check` en la salida de `prism --help`,
**para** descubrir estas funciones sin necesidad de leer la documentacion externa.

**Acceptance Criteria:**

- AC-012.1: La salida de `prism --help` (o `prism -h`) incluye una linea que describe el subcomando `update`:
  ```
  update              Actualiza prism-kanban a la última versión
  ```
  (o texto equivalente en la misma seccion de subcomandos).
- AC-012.2: La salida de `prism --help` incluye documentacion del flag `--no-update-check`:
  ```
  --no-update-check   Desactiva el chequeo de versión al arrancar
  ```
  (o texto equivalente en la seccion de flags globales).
- AC-012.3: `prism bogus` sigue exitando con codigo 2 y mensaje de "subcomando desconocido" (comportamiento existente preservado).
- AC-012.4: `prism update --help` no produce un error de subcomando desconocido; si no se implementa un help especifico para update, `prism --help` es suficiente.

**Definition of Done:**

- Test verifica que la string `update` aparece en stdout de `prism --help`.
- Test verifica que la string `--no-update-check` aparece en stdout de `prism --help`.
- Test de regresion: `prism bogus` todavia sale con codigo 2.

**Priority:** Must

**Story Points:** 1

---

## Resumen de Copy Exacto

Esta seccion centraliza todas las cadenas de texto para facilitar la implementacion y los tests de string matching.

### Startup version check (stderr)

| Situacion | Output en stderr |
|-----------|-----------------|
| Nueva version disponible | `✦ Nueva versión disponible: vX.Y.Z → vA.B.C. Ejecuta: prism update` |
| Version igual o superior instalada | (ninguno) |
| Offline / timeout | (ninguno) |
| `--no-update-check` activo | (ninguno) |

### `prism update` — stdout (informativo)

| Situacion | Output en stdout |
|-----------|-----------------|
| Ya en ultima version | `prism ya está en la última versión (vX.Y.Z)` |
| Prompt de confirmacion | `Actualizar prism-kanban vX.Y.Z → vA.B.C? [y/N]` |
| Usuario cancela | `Cancelado.` |
| Instalacion exitosa | `✓ Actualizado a vA.B.C` |

### `prism update` — stderr (errores)

| Situacion | Output en stderr |
|-----------|-----------------|
| Fallo de npm install (codigo N) | `Error: npm install falló (código N)` |
| No se pudo obtener la version | `Error: no se pudo obtener la versión desde npm. Comprueba tu conexión.` |

### `prism --help` — nuevas lineas a agregar

```
  update              Actualiza prism-kanban a la última versión

  --no-update-check   Desactiva el chequeo de versión al arrancar
```

---

## Comportamientos en Condiciones Especiales

| Escenario | Comportamiento esperado |
|-----------|------------------------|
| Cache invalido o corrompido | Tratarlo como cache ausente: disparar fetch y reescribir |
| Directorio de cache de solo lectura | Continuar sin cache; nunca mostrar error al usuario |
| `PRISM_UPDATE_CACHE` definido | Usar esa ruta en vez del path XDG/home para leer y escribir el cache |
| `PRISM_NO_UPDATE_CHECK=1` | Equivale a `--no-update-check`; suprime fetch, lectura de cache y output |
| `PRISM_NO_UPDATE_CHECK=0` o `""` | No suprime (valor falsy explicito respetado) |
| prism corriendo en modo dev (directorio `.git` presente) | El cache sigue en la ruta global de usuario, no en el data dir local |
| npm no esta en PATH | `spawnSync` retorna error; el mensaje de stderr de `prism update` muestra el codigo de fallo |
| Terminal sin soporte UTF-8 | Los simbolos `✦` y `✓` pueden no renderizarse, pero el texto es legible |

---

## Cobertura de Tests por Historia

| Historia | Modulo afectado | Cobertura requerida |
|----------|----------------|---------------------|
| US-001 | `bin/update-check.js` | >= 90% |
| US-002 | `bin/update-check.js` | >= 90% |
| US-003 | `bin/update-check.js` | >= 90% |
| US-004 | `bin/cli.js`, `bin/update-check.js` | >= 90% |
| US-005 | `bin/update.js` | >= 90% |
| US-006 | `bin/update.js` | >= 90% |
| US-007 | `bin/update.js` | >= 90% |
| US-008 | `bin/update.js` | >= 90% |
| US-009 | `bin/update.js` | >= 90% |
| US-010 | `bin/update.js` | >= 90% |
| US-011 | `bin/update.js` | >= 90% |
| US-012 | `bin/cli.js` | >= 90% |
