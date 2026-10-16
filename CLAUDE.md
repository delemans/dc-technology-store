# DC Tecnology — mapa del proyecto

Marca visible: **DC Tecnology** (igual que el dominio y el logo; desde el 16/10/2026, antes "DC Technology"). No cambiar identificadores técnicos: `dctechnology.catalogovirtual.co` (subdominio real de Emprende Red), el repo y `flujo_bot_dctechnology.json`.

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
| Respaldo de ANC | Si ancpagos.com no responde (mantenimiento), `catalogo_ancpagos.mjs` (`leerAnc`) y el nodo "Tienda ANC (respaldo)" leen su tienda pública allnecessarycolombia.com (mismos precios). En compras web el pedido queda en REVISION_MANUAL con el costo de referencia y dónde comprarlo |
| Etiquetas de WhatsApp (16/10/2026) | En chats con la etiqueta **BAENAMORA** (Config bot → `etiquetas_silencio`, por nombre, separadas por coma) el bot no responde. Evolution avisa cada cambio (labels.association / labels.edit) y `node herramientas/sincronizar-etiquetas.mjs --aplicar` carga las actuales desde su base (correrlo si se reinicia n8n o se pierden los datos del flujo). "No es compra" ya no silencia: responde un mensaje corto (1 vez cada 6 h por chat) y avisa al director |
| Compra al proveedor: MANUAL (16/10/2026) | `canal_compra = manual` (Config bot): el bot NO compra ni le escribe al proveedor. Pedido por chat → aviso "⏳ AÚN NO HA PAGADO" con plan y costo en ANC (portal o su tienda); comprobante → aviso con el monto a validar y qué comprar; pedido web pagado → "cómpralo ya". Combos igual (nodo "Combo manual"). Cupón DCTECH2026 solo si el cliente escribe el código (el sistema calcula el precio) |
| Vigilante (Windows) | Tarea programada "DC Tecnology - vigilante del bot" cada 10 min (`herramientas/vigilante-bot.ps1`; instalar con -Instalar): si WhatsApp está trabado ("Connection Closed" aunque diga open) reinicia Evolution; recarga etiquetas. Registro en herramientas/salida/vigilante.log. Los envíos por WhatsApp reintentan 3 veces |
| Salud del sistema | Nodo "Revisar salud" cada 30 min: portal ANC, tienda de ANC y dctecnology.xyz/bot-conocimiento.json. Avisa al director solo al caer (2 fallas seguidas) y al volver. también avisa cuando una IA queda sin saldo o clave inválida y cuando vuelve |
| Videos para estados | `docs/videos-estados/mp4/anuncio-*.mp4` (ignorados por git; copia en el Escritorio "Anuncios DC Tecnology"). Sin precios para que no queden viejos. Voz: Gemini TTS (10 por día por modelo) |
| Estilo corporativo | `estilos/profesional.css` (último en el <head> de las 4 páginas): tokens grafito/blanco roto, rojo de marca #C8102E/#E03445 solo como acento, Inter, sin neón ni animaciones decorativas. Las páginas p/ toman la misma paleta desde `generar_seo.js` |
| Identidad "Corriente DC" | `estilos/corriente.css` + `efectos.js` (solo tienda): portada grafito con circuito animado que lleva la corriente al logo, borde de corriente en tarjetas, línea de energía bajo el encabezado, aparición al bajar. Respeta "reducir movimiento" |
| Logo | `img/logo-dc-192.png` (encabezados, favicon) y `img/logo-dc-512.png` (redes, apple-touch) |
| Herramientas | `herramientas/`: `sincronizar-n8n.mjs` (lleva el flujo al n8n en vivo), `configurar-ias.mjs` + `proveedores-ia.mjs` (IA balanceada), `configurar-n8n.js`, `configurar-evolution.js`, `iniciar-bot.ps1`, `comparar_ancpagos.mjs`, `nombres_ancpagos.mjs`, `generar_seo.js` |

## Orden de los SQL
wo-011 → 012 → 014 → 015 (o 015b) → 015a → 027 → 028 → 029 → 030 → 024 → 026 → 031 → 032 → 033 → 034 (→ 034b tras publicar) → 035 → 036 → 037 → 038 → 041 (Emprende Red; se regenera con el script).

## Comandos
- `npm run css` tras cambiar clases (Tailwind compilado); `npm run seo` tras cambiar `productos.json`.
- `node generar_bot_conocimiento.js && node n8n/generar_flujo_n8n.js` tras cambiar prompt, FAQ o flujo; luego
  `node herramientas/sincronizar-n8n.mjs` (revisar) y `--aplicar` (código, nodos sin credenciales, conexiones, Set salvo Config bot, 57 en los números).
- `node herramientas/comparar_ancpagos.mjs [--local]` compara precios con el proveedor.
- `node herramientas/versionar.js` antes de cada push que cambie la web: pone ?v=<fecha> a estilos y scripts (si no, los navegadores muestran el diseño viejo hasta 10 min o más).

## Infraestructura local (PC de oficina)
- n8n en `localhost:5678` y Evolution API 2.3.7 en `localhost:8080` (`C:\evolution-api\evolution-api-main`), instancia `dc-bot`.
- Kaspersky intercepta HTTPS: Node necesita `NODE_EXTRA_CA_CERTS=C:\evolution-api\kaspersky-ca.pem` (variable de máquina).
- **Parche local de Evolution (16/10/2026):** en `C:evolution-apievolution-api-mainsrcapiintegrationschannelwhatsappwhatsapp.baileys.service.ts` (shouldIgnoreJid) se ignoran los JID `@bot` ("Meta Business Agent"): con Baileys 7.0.0-rc.9 daban "Unknown message type" y trababan la cola, y del 13 al 16/10 no entró ningún mensaje. Respaldo: `.respaldo-dc-*`. Si se actualiza Evolution, revisar que siga. `herramientas/revisar-entrada.mjs` (vigilante) alerta si pasan 8 h sin mensajes entrantes. Mensajes con más de 20 min de atraso no se contestan: van en el resumen de "Revisar salud".
- WhatsApp manda chats con `@lid`: el número real viene en `key.remoteJidAlt` / `senderPn`.
- IA balanceada (16/10/2026): nodo Code "IA balanceada" (chat, memoria de 4 idas y vueltas por cliente) y "Extraer accesos (IA)" reparten las consultas entre varias IA compatibles con OpenAI según su peso (≈ cuota gratis diaria) y saltan a la siguiente si una falla (401/402/cuota diaria → pausa 6 h; 429 → 2 min; caída → 1 min; 20 s máx. por IA en el chat). Lista y registro de claves: `herramientas/proveedores-ia.mjs` (Groq, Cerebras, Mistral, SiliconFlow .com, NVIDIA, Gemini x2 modelos, OpenRouter, GitHub Models); probar: `node herramientas/configurar-ias.mjs`. Las claves van de .env al código del nodo SOLO al sincronizar (en git la lista queda vacía `[] /*__CLAVES_IA__*/`; n8n/respaldos/ está en .gitignore). El catálogo que recibe la IA es liviano: digitales y servicios completos + solo los físicos que coinciden con la charla (≈ 7.800 tokens; antes ≈ 11.000). Si ninguna responde → aviso de espera + menú sin IA. `configurar-ia.mjs` y `configurar-ia-respaldo.mjs` quedaron obsoletos (eran del Agente IA).
- "Config posventa" copia todo de "Config bot" (antes tenía un túnel viejo y los avisos no salían).
- Secretos solo en `.env` (ignorado por git). Nunca pedir ni usar la service_role de Supabase.

## Reglas de trabajo
- `git push` autorizado de forma permanente (15/10/2026) SIEMPRE que esté probado: pruebas en verde y diff revisado sin claves.
  Si algo no se pudo probar, se deja en local y se avisa. Después del push, verificar que dctecnology.xyz quedó publicado.
- Cero datos inventados (descuentos, reseñas, disponibilidad). Pagos validados por un humano.
- Probar antes de entregar: PGlite para SQL, nodos Code del flujo con arnés, Chrome headless para la web.
