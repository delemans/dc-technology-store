# Bitácora de agentes · DC Tecnology
Cada entrada: fecha · agente · tarea · rama · qué cambió · resultado de `npm test` · qué debe revisar o hacer el director.
La más reciente va arriba.

---

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
