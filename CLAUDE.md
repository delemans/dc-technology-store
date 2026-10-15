# DC Technology — mapa del proyecto

Tienda de productos digitales (streaming, licencias, pines, recargas) + tecnología física. Sitio estático en
GitHub Pages (`dctecnology.xyz`, repo delemans/dc-technology-store, rama main). Proveedor: ANC Pagos (ancpagos.com).
Contexto de negocio e invariantes: `CONTEXT.md`. Responder siempre en español.

## Dónde está cada cosa
| Área | Archivos |
|---|---|
| Tienda (vitrina + carrito) | `index.html`, `app.js`, `tienda-carrito.js` (puente → `carrito.js`) |
| Portal de clientes | `cliente.html`, `cliente.js`, `carrito.js` (carrito, combos, pago web), `sesion.js` (OTP, Mis pedidos), `soporte.js` |
| Panel admin | `admin.html`, `admin.js`, `admin-prueba.js` (Prueba del sistema) |
| Textos de WhatsApp | `plantillas-whatsapp.js` (fuente única) |
| Catálogo | `productos.json` (los PRECIOS mandan desde la base: `catalogo_precios`) |
| Bot (IA) | `generar_bot_conocimiento.js` → `bot-conocimiento.json` (n8n lo lee en vivo desde el sitio): prompt, FAQ y textos del menú |
| Menú del bot (WO-040) | Nodo "Responder menú": catálogo, compra (plan → medio de pago → datos), soporte, pagos y Mis pedidos SIN IA. Lo que no es compra → `[NO_COMPRA]`: el bot no contesta y avisa al director |
| Flujo n8n | `n8n/generar_flujo_n8n.js` → `n8n/flujo_bot_dctechnology.json` + `n8n/simulador-nodos.js` (no editar los generados) |
| SQL Supabase | `supabase/wo-*.sql` (idempotentes, con verificación previa "Nada se aplicó…") |
| Proveedor Emprende Red (WO-041) | `herramientas/sincronizar-emprendered.mjs` [--ia] [--tienda]: catálogo de catalogovirtual.co → productos `er-*` en `productos.json` (solo TECNOLOGIA, costo + 40 %, sin réplicas) + `supabase/wo-041-emprendered.sql`. n8n actualiza costo, precio y stock cada 6 h con `sincronizar_proveedor()`. El bot y la tienda usan los precios de la base (`precios_publicos`) |
| Estilo corporativo | `estilos/profesional.css` (último en el <head> de las 4 páginas): tokens grafito/blanco roto, rojo de marca #C8102E/#E03445 solo como acento, Inter, sin neón ni animaciones decorativas. Las páginas p/ toman la misma paleta desde `generar_seo.js` |
| Logo | `img/logo-dc-192.png` (encabezados, favicon) y `img/logo-dc-512.png` (redes, apple-touch) |
| Herramientas | `herramientas/`: `sincronizar-n8n.mjs` (lleva el flujo al n8n en vivo), `configurar-ia.mjs`, `configurar-n8n.js`, `configurar-evolution.js`, `iniciar-bot.ps1`, `comparar_ancpagos.mjs`, `nombres_ancpagos.mjs`, `generar_seo.js` |

## Orden de los SQL
wo-011 → 012 → 014 → 015 (o 015b) → 015a → 027 → 028 → 029 → 030 → 024 → 026 → 031 → 032 → 033 → 034 (→ 034b tras publicar) → 035 → 036 → 037 → 038 → 041 (Emprende Red; se regenera con el script).

## Comandos
- `npm run css` tras cambiar clases (Tailwind compilado); `npm run seo` tras cambiar `productos.json`.
- `node generar_bot_conocimiento.js && node n8n/generar_flujo_n8n.js` tras cambiar prompt, FAQ o flujo; luego
  `node herramientas/sincronizar-n8n.mjs` (revisar) y `--aplicar` (código, nodos sin credenciales, conexiones, Set salvo Config bot, 57 en los números).
- `node herramientas/comparar_ancpagos.mjs [--local]` compara precios con el proveedor.

## Infraestructura local (PC de oficina)
- n8n en `localhost:5678` y Evolution API 2.3.7 en `localhost:8080` (`C:\evolution-api\evolution-api-main`), instancia `dc-bot`.
- Kaspersky intercepta HTTPS: Node necesita `NODE_EXTRA_CA_CERTS=C:\evolution-api\kaspersky-ca.pem` (variable de máquina).
- WhatsApp manda chats con `@lid`: el número real viene en `key.remoteJidAlt` / `senderPn`.
- IA en cadena: SiliconFlow internacional (`api.siliconflow.com`; HTTP 402 = sin saldo) → "IA de respaldo" (Gemini u otra compatible con OpenAI; `herramientas/configurar-ia-respaldo.mjs` con `IA_RESPALDO_KEY` en .env; sube el Agente IA a v2.2 con needsFallback) → menú sin IA. `sincronizar-n8n` no toca ese nodo.
- "Config posventa" copia todo de "Config bot" (antes tenía un túnel viejo y los avisos no salían).
- Secretos solo en `.env` (ignorado por git). Nunca pedir ni usar la service_role de Supabase.

## Reglas de trabajo
- Commits en local; `git push` solo cuando el director lo autoriza.
- Cero datos inventados (descuentos, reseñas, disponibilidad). Pagos validados por un humano.
- Probar antes de entregar: PGlite para SQL, nodos Code del flujo con arnés, Chrome headless para la web.
