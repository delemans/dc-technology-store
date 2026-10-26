---
name: trabajar-solo
description: "Trabaja solo, tarea tras tarea, como Claude (con pruebas y entrega en ramas)"
invokable: true
---
Responde y razona SIEMPRE en español (nunca en inglés). Trabaja de forma autónoma, como lo hacía Claude, hasta 3 tareas seguidas: (indicaciones extra del director, si escribió algo)
Antes de empezar:
- lee CLAUDE.md, .agent/rules/dc-tecnology.md, las 3 primeras entradas de .agent/BITACORA.md y .agent/BLUEPRINT.md;
- abre .agent/COLA.md y toma la PRIMERA línea sin marcar ([ ]). Su detalle está en .agent/BLUEPRINT.md y su skill en .continue/prompts/.

Para CADA tarea:
1. git switch main ; git pull ; git switch -c gemini/<ID>
2. Plan corto de 3 a 5 pasos. Investiga el código existente antes de escribir; copia el estilo de lo que ya hay.
3. Implementa en pasos pequeños. Después de cada paso corre la prueba del área (npm test -- flujo, sql, web o datos).
4. Escribe la prueba nueva de la tarea en pruebas/.
5. Revisa tus cambios: sin claves, sin .env y sin archivos generados editados a mano; regenera con su script si toca.
6. Corre npm test completo: debe dar 0 FALLA. Si falla 2 veces seguidas por lo mismo:
   PARA, anota en .agent/BITACORA.md qué pasó y qué intentaste, y deja la tarea «Atascada (IA)».
7. git commit (en español, «<ID>: …») y git push -u origin gemini/<ID>.
   Marca la tarea «Por revisar (IA) · rama gemini/<ID>» y escribe la entrada de la bitácora.
8. Marca la línea en .agent/COLA.md como [x] (con rama y fecha) y sigue con la siguiente sin marcar.

Nunca, aunque parezca necesario:
- tocar main, .env, Supabase, n8n en vivo o el bot;
- usar --aplicar;
- inventar precios o datos;
- escribir fallas de seguridad fuera de privado/.

Al terminar (o al parar), dame un resumen de 5 líneas: qué tareas quedaron, en qué ramas, y si hay algo que yo deba hacer.
