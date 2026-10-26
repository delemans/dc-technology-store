# Instrucciones para Gemini (Google Antigravity) · DC Tecnology

Hablas siempre en **español**, con el director del negocio (dueño de DC Tecnology, no programador).
Trabajas en este repositorio **mientras Claude no está disponible**. Tu trabajo lo revisa Claude o el director antes de publicarse.

## Lee primero, en este orden
1. `.agent/rules/dc-tecnology.md`: las reglas que nunca se rompen.
2. `CLAUDE.md`: el mapa del proyecto (dónde está cada cosa y cómo se genera).
3. `.agent/BLUEPRINT.md`: las tareas técnicas pendientes, con pasos y criterio de terminado.
4. `.agent/BITACORA.md`: lo que ya hiciste tú u otro agente (no repitas trabajo).
5. Si el director pide ayuda con **sus** tareas: `privado/director-pendientes.md` (existe solo en este PC).

## Tus dos trabajos
- **A. Adelantar las tareas técnicas** del BLUEPRINT (flujo `/siguiente-tarea`):
  - una tarea a la vez, en una rama `gemini/<id-tarea>`;
  - siempre con pruebas (`npm test`) y su anotación en la bitácora.
- **B. Ayudar al director con sus pendientes** (flujo `/ayudar-al-director`):
  - lo guías paso a paso, con tiempos, y verificas con él cada paso;
  - preparas textos y listas que él usa;
  - marcas lo hecho en `privado/director-pendientes.md`.

## Cómo trabajar (siempre)
1. **Antes de tocar nada:**
   - `git status` y `git pull`;
   - crea la rama `git switch -c gemini/<id>`.
2. **Al cambiar código:**
   - Imita el estilo del archivo que editas: comentarios en español, nombres en español, sin librerías nuevas.
   - **Archivos generados:**
     - nunca se editan a mano: `n8n/flujo_bot_dctechnology.json`, `n8n/simulador-nodos.js`, `bot-conocimiento.json`, `p/`, `c/`, `sitemap.xml`, `merchant/` y `supabase/APLICAR-PENDIENTES.sql`;
     - se regeneran con sus scripts (ver CLAUDE.md, «Comandos»).
   - **SQL nuevo:**
     - archivo `supabase/wo-0NN-nombre.sql` idempotente, que verifica requisitos y si faltan avisa con «Nada se aplicó…»;
     - con su prueba en `pruebas/sql/prueba-wo0NN.mjs` (PGlite);
     - al final, `node herramientas/armar-pendientes.js`.
   - **Flujo del bot:** solo en `n8n/generar_flujo_n8n.js`, con prueba en `pruebas/flujo/`. Luego `node n8n/generar_flujo_n8n.js`.
3. **Probar:** `npm test` (o `npm test -- flujo web` para grupos). **Nada se entrega con una prueba en FALLA.**
4. **Entregar:**
   - `git add` solo de lo que tocaste;
   - commit en español que diga qué y para qué;
   - `git push -u origin gemini/<id>`;
   - **nunca** a `main`.
5. **Anotar en `.agent/BITACORA.md`:** fecha, tarea, rama, qué cambió, resultado de `npm test` y qué falta revisar. Marca la tarea en el BLUEPRINT como **«Por revisar (Gemini)»**.

## Lo que NO haces nunca
- Publicar en `main`, desplegar, o correr comandos con `--aplicar`, `--forzar` o `--instalar` que cambien sistemas en vivo:
  - `herramientas/sincronizar-n8n.mjs --aplicar`;
  - `publicar-estado`, `publicar-redes`, `interruptor-bot`;
  - la creación de tareas de Windows.
- Encender el bot, enviar WhatsApp, escribir en Supabase o aplicar SQL en Supabase.
- Abrir, copiar o mostrar `.env` o cualquier clave. Si una tarea necesita una clave, la tarea queda **bloqueada** y lo anotas.
- Usar o pedir la clave `service_role` de Supabase.
- Inventar datos (precios, descuentos, reseñas, disponibilidad o tiempos), mencionar al proveedor (ANC, Emprende Red) al cliente o prometer lo que el negocio no cumple.
- Tocar el estudio de videos: vive en una carpeta temporal de Claude, fuera de este repositorio.

> Terminal: Git Bash (grep, head, && funcionan). Si estás en PowerShell: Select-String en vez de grep y `;` en vez de &&. Catálogo: docs/catalogo-resumen.md (no leas productos.json entero).
