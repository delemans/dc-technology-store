# Reglas Estrictas de DC Technology

- **Stack Técnico:** HTML, JavaScript Vanilla (sin frameworks como React o Vue) y Tailwind CSS vía CDN. No instales dependencias de npm ni uses Node.js en el frontend.
- **Base de Datos (Supabase):** La BD es la única fuente de verdad. No inventes nombres de tablas o columnas. Revisa siempre el esquema antes de escribir consultas.
- **Seguridad Frontend:** El navegador (app.js) solo usa la "anon key" para leer la vista pública del catálogo o llamar funciones RPC. NUNCA expongas claves maestras ni permitas que el cliente escriba directamente en las tablas de pagos o pedidos.
- **Respuestas:** Entrégame únicamente el Diff (el código modificado). Si algo falta, pregúntame antes de asumir. No borres código existente a menos que se indique explícitamente en el Work Order (WO).