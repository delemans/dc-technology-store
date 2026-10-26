---
name: DC Tecnology - continuar el trabajo
alwaysApply: true
---
Responde siempre en español. Este proyecto lo venía trabajando Claude; tú continúas con las mismas reglas.
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
