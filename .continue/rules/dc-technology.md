---
name: DC Tecnology - continuar el trabajo
alwaysApply: true
---
**Responde y razona SIEMPRE en español, nunca en inglés.** Qué hacer: la primera línea sin marcar de `.agent/COLA.md`. Este proyecto lo venía trabajando Claude; tú continúas con las mismas reglas.
Antes de proponer o cambiar algo, lee (con @ o abriendo los archivos):
1. `CLAUDE.md`: mapa del proyecto y reglas.
2. `GEMINI.md` y `.agent/rules/dc-tecnology.md`: lo que puedes y no puedes hacer.
3. `.agent/BITACORA.md`: lo último que se hizo.
4. `.agent/BLUEPRINT.md`: las tareas pendientes, en orden.

Reglas:
- Nunca abras ni muestres `.env` ni pidas claves.
- Trabaja en una rama `gemini/<ID>`, nunca en `main`.
- No publiques en la tienda, no enciendas el bot ni toques Supabase o n8n en vivo.
- Cero datos inventados.
- No edites a mano los archivos generados (`n8n/flujo_bot_dctechnology.json`, `bot-conocimiento.json`, `p/`, `c/`, `estilos/tailwind.css`).
- Antes de entregar, `npm test` debe dar 0 FALLA. Anota lo que hiciste en `.agent/BITACORA.md`.
- Terminal: el proyecto usa **Git Bash** (grep, head, && funcionan). Si un comando dice «no se reconoce» estás en PowerShell: usa `Select-String -Path archivo -Pattern texto` en vez de grep, y `;` en vez de &&.
- Catálogo: lee `docs/catalogo-resumen.md`; NO abras productos.json entero (650 KB). Para la foto o el detalle de UN producto: grep su id en productos.json.

**Estado al 09/11/2026 (no rehacer):** T01–T14, T20 y T21 ya están en main (mira la sección «Estado» de `.agent/COLA.md`). La rama local `gemini/T01` es vieja: ignórala. Siguiente: **T19 · flujo de compra web**.
- Antes de crear la rama: `git switch main ; git pull` y confirma con `git log --oneline -5` que tienes lo último.
- Colores (T09, accesibilidad): todo botón con letra blanca usa `bg-dcRed` o `var(--acento-fondo)` (#C8102E); el rojo de TEXTO es `rgb(var(--rojo))`. No uses #E03445 de fondo con letra blanca. Áreas táctiles de 44 px. `pruebas/web/prueba-accesibilidad.mjs` debe seguir en verde.
- Pruebas SQL con PGlite: para varios comandos seguidos usa `db.exec(sql)`; `db.query()` acepta UNO solo («cannot insert multiple commands into a prepared statement»). Copia el arranque de `pruebas/sql/prueba-wo057.mjs`.
- Si el modelo «DC Cascada» no responde: Terminal → Run Task… → «IA en cascada (puente local)».
