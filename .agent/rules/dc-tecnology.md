---
trigger: always_on
---

# Reglas de DC Tecnology (siempre activas)

1. **Responde en español**, claro y sin tecnicismos para el director.
2. **Secretos:**
   - Solo viven en `.env` y en n8n. Nunca abras, copies, muestres ni subas `.env`, ni pegues claves en código, commits o mensajes.
   - Nunca uses ni pidas la `service_role` de Supabase.
   - Antes de cada commit: `git diff --cached` sin claves (`sk-`, `AIza`, `ghp_`, `gsk_`, `nvapi-`, `eyJhbGciOi`).
3. **Nada en vivo sin revisión:**
   - Trabajas en ramas `gemini/<id>` y haces push solo de esa rama; **nunca a `main`** (main publica www.dctecnology.xyz).
   - No corres `--aplicar`, `--forzar` ni `--instalar`.
   - No enciendes el bot.
   - No envías WhatsApp ni escribes en Supabase.
4. **Cero datos inventados:** nada de precios, descuentos, reseñas, disponibilidad, tiempos de entrega ni garantías que el negocio no tenga. Los precios mandan desde la base (`precios_publicos`).
5. **El cliente nunca ve al proveedor:** nada de ANC, Emprende Red, costos, márgenes ni esperas por terceros en textos para clientes.
6. **La entrega de cuentas es manual:** el director entrega con `#entregar`. No la vuelvas automática.
7. **Los pagos los valida una persona.** No automatices la aprobación de pagos.
8. **Lo generado no se edita a mano.** Se regenera con su script:
   - `n8n/flujo_bot_dctechnology.json` y `n8n/simulador-nodos.js` → `node n8n/generar_flujo_n8n.js`;
   - `bot-conocimiento.json` → `node generar_bot_conocimiento.js`;
   - `p/`, `c/`, `sitemap.xml` y `merchant/` → `npm run seo`;
   - `supabase/APLICAR-PENDIENTES.sql` → `node herramientas/armar-pendientes.js`;
   - `estilos/tailwind.css` → `npm run css`;
   - `?v=` de estilos y scripts → `node herramientas/versionar.js`.
9. **SQL:**
   - archivos nuevos e idempotentes `supabase/wo-0NN-*.sql`, con verificación previa «Nada se aplicó…»;
   - funciones `security definer` con `set search_path = ''`;
   - permisos mínimos (revoke a public/anon; grant solo a quien lo usa);
   - con prueba PGlite en `pruebas/sql/`.
10. **Pruebas:**
    - `npm test` en verde antes de cada commit;
    - toda función nueva lleva su prueba;
    - nunca borres ni debilites una prueba para que pase: si una regla de negocio cambió, se anota en la bitácora.
11. **Legal (Colombia):**
    - Ley 1480 (consumidor, retracto, garantía), Ley 1581 (datos) y Ley 2300 (mensajes comerciales: lun–vie 7–19, sáb 8–15, nunca domingos ni festivos);
    - no anuncies apuestas ni vapeadores.
12. **Marca:** se escribe «DC Tecnology» (sin h), con www.dctecnology.xyz en lo que ve el cliente. No renombres identificadores técnicos (`dctechnology.catalogovirtual.co`, nombre del repo, `flujo_bot_dctechnology.json`).
13. **Ante la duda, no lo hagas:** anota la pregunta en `.agent/BITACORA.md` y marca la tarea como «Bloqueada: necesita decisión del director».
