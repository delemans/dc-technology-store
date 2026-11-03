# Bitácora de agentes · DC Tecnology
Cada entrada: fecha · agente · tarea · rama · qué cambió · resultado de `npm test` · qué debe revisar o hacer el director.
La más reciente va arriba.

---

## 03/11/2026 · Claude · Existencias cada 3 h y arreglo del SQL pendiente
- **Qué se hizo:**
  - wo-047: `drop function` antes de crear `sincronizar_proveedor` (APLICAR-PENDIENTES daba 42P13 en una base con wo-050) + prueba;
  - vigilante en la nube cada 3 h (`--rapido`: existencias y agotados) + revisión completa diaria; el del PC trae primero lo de GitHub;
  - `disponibilidad.json` → `existencias`; la tienda las usa como tope (`DCTopeExistencias`): nunca muestra más unidades que el proveedor;
  - pruebas: `pruebas/datos/test-existencias.mjs` y tope en `pruebas/web/prueba-agotados.mjs` (ya sin productos escritos a mano).
- **Siguiente:** director: encender n8n y aplicar APLICAR-PENDIENTES.sql; luego Claude sincroniza n8n. Cola desde la T19.

## 01/11/2026 · Claude · T21 (Google Maps) y catálogo al día
- **Qué se hizo:**
  - main del PC se puso al día con GitHub (vigilante en la nube del 30/10, 31/10 y 01/11); la corrida vieja del vigilante local quedó en `git stash`;
  - T21: la portada declara la tienda local (`ElectronicsStore`) con teléfono, logo y zona atendida, sin dirección ni horario hasta B3;
  - T21: `enlace_resena_google` en Config bot: si lo llenas (enlace «Escribir una reseña» de tu Perfil de Empresa), la solicitud de reseña lo ofrece;
  - `sincronizar-n8n.mjs` ahora agrega a Config bot los campos nuevos que falten, sin tocar tus valores (bot_responde siempre en «no»);
  - `prueba-agotados.mjs` toma sus ejemplos de `disponibilidad.json` (fallaba porque Prime Video volvió a ANC el 31/10).
- **Pruebas:** `npm test` 799 OK · 0 FALLA (antes de T10 y T06).
  - T10: `node herramientas/publicar-redes.mjs --verificar` (solo lectura, sin tokens a la vista) + pruebas; guía del Escritorio, paso 4a. Resultado real: YouTube ✅, Facebook ✅ (dctecnology), Instagram ❌ (META_IG_USER_ID es el de la página y no hay Instagram vinculado), TikTok sin claves.
  - T06: sección «Uso de inteligencia artificial» en los términos (legal/terminos.html, actualizados el 1/11/2026) + prueba.
- **Siguiente:** COLA.md desde la T19 (flujo de compra web). Director: encender n8n (iniciar-bot.ps1, sigue caído), aplicar `supabase/APLICAR-PENDIENTES.sql` y, cuando tenga el Perfil de Empresa, pegar su enlace de reseñas en Config bot → enlace_resena_google.

## 29/10/2026 · Claude · Revisión de lo que hicieron las otras IA
- **Qué se hizo:**
  - T14 (servidor) revisada y fusionada en main; T20 (seguridad) verificada: sin claves en todo el historial, sin funciones security definer sin search_path, npm audit 0;
  - T01 terminada: `supabase/wo-052-resumen-dia.sql` (mismo cálculo que finanzas_panel) + nodos «Hora del resumen» → «Resumen del día» → «Texto del resumen» → «Enviar resumen» (8 p. m., una vez al día; sin SQL avisa una vez); pruebas `pruebas/sql/prueba-wo052.mjs` y `pruebas/flujo/test-resumen-dia.js`;
  - el vigilante del PC ya no publica si el PC está en una rama gemini/* (dejaba commits duplicados ahí; publica la copia de GitHub);
  - `test-manual.js` se salta en GitHub sin la muestra local de ANC (la revisión automática de ramas gemini fallaba siempre por eso).
- **Pruebas:** `npm test` 756 OK · 0 FALLA.
  - T02 terminada: `supabase/wo-053-pagos-por-revisar.sql` + nodos «Pagos por revisar» → «Alertas de pago» → «Enviar alerta de pago»; pruebas `pruebas/sql/prueba-wo053.mjs` y `pruebas/flujo/test-alertas-pago.js`.
- **Siguiente:** COLA.md desde la T21. Director: encender n8n (iniciar-bot.ps1) y aplicar `supabase/APLICAR-PENDIENTES.sql` (incluye wo-052 y wo-053); luego Claude sincroniza n8n.

## 26/10/2026 · Gemini · T14 · Paquete del servidor
- **Qué se hizo:**
  - Creado `infra/servidor/docker-compose.yml` con los 6 servicios (caddy, n8n, postgres_n8n, evolution, postgres_evo, redis) y `restart: unless-stopped`, zona horaria America/Bogota;
  - Creado `infra/servidor/Caddyfile` para `bot.dctecnology.xyz` y `wa.dctecnology.xyz`;
  - Creado `infra/servidor/env-servidor-ejemplo.txt` con las variables de entorno sin claves reales;
  - Creado `infra/servidor/LEEME.md` con los pasos para el despliegue;
  - Creada la prueba `pruebas/datos/test-infra.mjs`.
- **Pruebas:** `npm test -- datos` dio 103 OK · 0 FALLA.
- **Siguiente:** Director / Claude para despliegue (B10).

## 26/10/2026 · Gemini · T20 · Auditoría de seguridad
- **Qué se hizo:**
  - Realizada auditoría de seguridad (T20) en la rama `gemini/T20`. Hallazgos y reporte guardados en `privado/seguridad-2026-10-26.md` (archivo protegido por `.gitignore`);
  - Verificación de claves/secretos (ninguna expuesta fuera de `.env`), DOM, consultas RPC y funciones SQL (`set search_path = ''`).
- **Pruebas:** `npm test` dio 699 OK · 0 FALLA.
- **Siguiente:** Director / Claude para revisión.

## 26/10/2026 · Claude · Cierre antes del límite semanal
- **Qué se hizo hoy:**
  - IA en cascada en todo el sistema: `herramientas/ia.mjs` (`--probar`, `--uso`, `--revisar`), OpenAI e IA local en la lista, conteo diario de IA en el bot (n8n sincronizado) y `.env` corregido (SiliconFlow .com);
  - `index.html` local había vuelto a la versión del 19/10: se restauró (la versión vieja quedó en el scratchpad de Claude);
  - BLUEPRINT: nueva fase «Sin depender del PC» (T13 Actions, T14 paquete del servidor, T15 reparto de tareas) y bloqueadas B10 y B11;
  - pendientes del director 15 y 16: contratar el servidor y cargar los secretos de GitHub.
- **Pruebas:** flujo 427 OK y datos 69 OK (0 FALLA).
- **Estado:** bot APAGADO; SQL pendiente sin aplicar; entrega de cuentas manual.
- **Siguiente para Gemini (en orden):** T13 → T14 → T01 → T02 → T10 → T15 → resto.

## 26/10/2026 · Claude · Tareas de redes y página de pendientes
- **Qué se hizo:**
  - BLUEPRINT: nuevas T10 (verificar claves de redes sin publicar), T11 (plan de redes que se renueva solo) y T12 (resumen semanal de redes y estados);
  - página de pendientes del director con paso a paso y checks guardados: https://claude.ai/artifact/UzLJXxiq8RzUJQgR5NtPM9 (enlazada desde el informe interactivo).
- **Siguiente:** T01, T02 y T10 (prioridad alta).

## 26/10/2026 · Claude · Preparación para Gemini (Antigravity)
- **Qué se hizo:**
  - se crearon `GEMINI.md`, `AGENTS.md`, `.agent/rules/dc-tecnology.md`, `.agent/BLUEPRINT.md` (tareas T01–T09 y bloqueadas B1–B9) y los flujos `/siguiente-tarea`, `/ayudar-al-director` y `/probar`;
  - las pruebas del proyecto quedaron en `pruebas/` con `npm test`: 660 OK y 0 FALLA al 26/10.
- **Estado del sistema:**
  - bot APAGADO;
  - entrega de cuentas manual;
  - lo que no hay en ANC ni en Emprende Red no sale (`disponibilidad.json`);
  - SQL pendiente sin aplicar por el director (`supabase/APLICAR-PENDIENTES.sql`, wo-042 a wo-051).
- **Siguiente:** T01 (resumen diario de ventas).
