---
description: Toma la siguiente tarea técnica del BLUEPRINT, la hace en una rama, la prueba y la deja lista para revisión
---

1. **Lee** `.agent/rules/dc-tecnology.md`, `GEMINI.md` y `.agent/BITACORA.md`.
2. **Elige la tarea:** abre `.agent/BLUEPRINT.md` y toma la primera con estado **Pendiente** (nunca una Bloqueada).
3. **Explica al director** en 3 líneas qué vas a hacer, para qué sirve y cuánto tardará, y espera su visto bueno.
4. **Prepara:**
   - `git status` (debe estar limpio) y `git pull`;
   - `git switch -c gemini/<ID>`;
   - en el BLUEPRINT marca la tarea **En curso (Gemini, <fecha>)**.
5. **Investiga antes de escribir:**
   - busca en el código los archivos que nombra la tarea y lee el patrón de una función parecida que ya exista;
   - no inventes nombres de tablas ni de funciones: verifica que existan en `supabase/*.sql` o en `n8n/generar_flujo_n8n.js`.
6. **Implementa en pasos pequeños.** Después de cada paso:
   - corre las pruebas del grupo que tocaste (`npm test -- flujo`, `npm test -- sql` o `npm test -- web`);
   - escribe la prueba nueva de la tarea junto con el código.
7. **Regenera lo que corresponda** (nunca edites a mano lo generado):
   - `node n8n/generar_flujo_n8n.js`
   - `node generar_bot_conocimiento.js`
   - `npm run seo`
   - `node herramientas/armar-pendientes.js`
   - `npm run css`
8. **Prueba todo:** `npm test` debe terminar con «0 FALLA». Si algo falla y no lo puedes arreglar, para y anótalo.
9. **Revisa el diff:** `git diff --cached` sin claves, sin `.env` y sin archivos ajenos a la tarea.
10. **Entrega:**
    - commit en español («T01: resumen diario de ventas a las 8 p. m.…»);
    - `git push -u origin gemini/<ID>`.
11. **Anota y cierra:**
    - en `.agent/BITACORA.md`: fecha, tarea, rama, archivos, pruebas nuevas, resultado de `npm test` y lo que el director debe hacer (por ejemplo, aplicar un SQL);
    - en el BLUEPRINT: **Por revisar (Gemini) · rama gemini/<ID>**.
12. **Cuéntale al director** en pocas líneas qué quedó y qué sigue. No publiques nada en `main`.
