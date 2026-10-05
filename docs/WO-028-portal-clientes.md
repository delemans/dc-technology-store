# WO-028 · Portal de Clientes propio — Arquitectura inicial

Estado: **fase 0 y fase 1 construidas** (portal `cliente.html`, acceso con código por WhatsApp, historial y accesos protegidos). Decisiones del director aprobadas (sección 7). Combos: reglas configurables desde el panel (`supabase/wo-029-combos.sql`).

## 1. Principios (heredados del proyecto)

| Regla vigente | Cómo la respeta el portal |
|---|---|
| "Nada de correos ni contraseñas públicas" | El cliente se identifica con su **WhatsApp + código de un solo uso (OTP) que envía el bot**. Sin email, sin contraseña. |
| Supabase con registro público cerrado (`disable_signup`) | Los clientes **no** son usuarios de Supabase Auth: tienen una sesión propia (token firmado, guardado como hash en la base). El panel admin sigue igual. |
| Cero datos inventados | Combos, precios y métodos de pago salen solo de la base (lo que el admin configura). |
| Modo sombra / validación humana | El portal recibe comprobantes; **el pago lo sigue validando el admin** en el panel. |
| Estático en GitHub Pages + CSP | HTML/JS sin frameworks, Tailwind compilado, toda la lógica sensible en RPC de Supabase (`security definer`). |

## 2. Mapa de archivos

```
index.html / app.js          Tienda (ya existe) → + botón "Agregar al carrito"
carrito.js                   Carrito en el dispositivo (localStorage), sin datos sensibles
pagar.html / pagar.js        Checkout: resumen, cupón, método local/cripto, datos de pago, subir comprobante
cuenta.html / cuenta.js      Autogestión: mis pedidos, estado, accesos, garantías, reportes
soporte.js                   Asistente de fallas (árbol de diagnóstico guiado)
soporte-arbol.json           Árbol de preguntas/pasos por tipo de producto (editable, sin código)
sesion.js                    Sesión del cliente: pedir OTP, verificar, renovar, cerrar
api.js                       Llamadas RPC con manejo de errores común (una sola puerta a Supabase)
portal.html / portal.js      Rastreo por código (ya existe) → enlaza a cuenta.html
supabase/wo-028-portal.sql   Tablas, RPC, Storage y límites anti-abuso
```

`ui.js`, `tema.js`, `plantillas-whatsapp.js` (catálogo de métodos de pago, `montoCripto`) se reutilizan tal cual.

## 3. Modelo de datos (supabase/wo-028-portal.sql)

| Tabla / cambio | Para qué |
|---|---|
| `ordenes` (codigo `DC-…`, cliente_id, total_cop, monto_unico_offset, metodo_elegido, estado, expira_at) | El **carrito** completo. Cada ítem sigue siendo un `pedido` (la regla `cantidad = 1` se respeta: 3 ítems = 3 pedidos). |
| `pedidos.orden_id` (nueva columna) | Agrupa los pedidos de una orden; `pagos` se asocia a la orden. |
| `otp_cliente` (whatsapp, hash del código, intentos, expira_at) | Códigos de 6 dígitos, 5 min, 3 intentos. |
| `sesiones_cliente` (hash del token, cliente_id, expira_at, ultimo_uso) | Sesión de 30 días en el dispositivo; se puede cerrar desde "Mi cuenta". |
| `reportes_falla` (pedido_id, tipo, respuestas del diagnóstico, estado, garantia_id) | Lo que el cliente reportó y qué pasos ya intentó; aparece en el panel. |
| `accesos_vistos` (pedido_id, sesion, fecha) | Auditoría: quién vio los accesos y cuándo. |
| `combos` + `combo_items` (definidos por el admin) | Combos reales con su precio; si no hay ninguno, no se muestran. |
| Storage: bucket privado `comprobantes` | Subida con URL firmada de un solo uso; el archivo nunca es público. Ya existen `pagos.comprobante_path` y `comprobante_sha256`. |

**RPC públicas (anon) — con límites por WhatsApp e `ip_hash`:**
`crear_orden(items, cupon, metodo)` · `datos_pago_orden(codigo)` · `url_subida_comprobante(codigo)` · `registrar_comprobante(codigo, ruta, sha256, referencia)` · `solicitar_otp(whatsapp)` · `verificar_otp(whatsapp, codigo)`

**RPC con sesión de cliente (token):**
`mis_pedidos(token)` · `ver_accesos(token, pedido)` · `reportar_falla(token, pedido, diagnostico)` · `cerrar_sesion(token)`

El OTP lo entrega el bot: `solicitar_otp` encola un mensaje en `notificaciones_whatsapp` (tipo nuevo `OTP`, prioridad máxima, sin horario restringido) y n8n lo envía como cualquier otra notificación.

**El precio siempre se calcula en la base**, nunca se acepta el que manda el navegador (ver decisión 1).

## 4. Flujos

**A · Compra rápida (invitado o con sesión)**
1. Carrito → `pagar.html`. Si hay sesión, el WhatsApp ya viene; si no, el cliente lo escribe (invitado).
2. Elige método: pestañas **Pagos locales / Criptomonedas** (solo los activos de `metodos_pago`).
3. `crear_orden` crea orden + pedidos + compras (`PENDIENTE_PAGO`) y devuelve el **monto único** (precio + 0–99 pesos de `monto_unico_offset`, para identificar el pago).
4. `datos_pago_orden` muestra cuenta / llave / enlace o, en cripto, **moneda + RED en grande + dirección + QR + monto exacto** (`montoCripto` con la tasa vigente; sin tasa vigente, la cripto no se ofrece).
5. Sube la captura (o pega el TXID) → `pagos` PENDIENTE → aparece en tiempo real en "Pagos por verificar" del panel (ya construido).
6. El cliente ve "En validación" y recibe los avisos por WhatsApp que ya existen (pago confirmado, entrega, reseña).

**B · Autogestión (`cuenta.html`)**
- Entrar: WhatsApp → código por WhatsApp → sesión en el dispositivo.
- Mis pedidos con línea de tiempo real: *Esperando pago → En validación → Pagado → Comprando al proveedor → Entregado* (los estados de `pedidos.estado`).
- **Ver mis accesos**: botón "Mostrar" (re-verificación si la sesión tiene más de 24 h), copiar, y registro en `accesos_vistos`.
- Garantía: días restantes; "Reclamar" abre el asistente de soporte.

**C · Soporte inteligente (`soporte.js` + `soporte-arbol.json`)**
```
¿Qué pasa con tu Netflix?
 ├─ "Dice contraseña incorrecta"  → pasos (copiar exacto, cerrar sesión) → ¿se resolvió? → no ↓
 ├─ "Me cambiaron la contraseña / ya no entra" → garantía vigente? → crea reclamo automático
 ├─ "Demasiadas pantallas"        → pasos (cerrar dispositivos) → no ↓
 ├─ "Pide código de verificación" → explica y escala (requiere al proveedor)
 └─ "Otra cosa"                   → descripción libre ↓
↓ reportar_falla(...) guarda el diagnóstico → abre WhatsApp con el resumen ya escrito
  (pedido, producto, qué probó) → el asesor no vuelve a preguntar lo mismo.
```
El árbol es un JSON editable: agregar un caso no requiere tocar código. Las respuestas son las mismas de las FAQ del bot (una sola fuente).

## 5. Seguridad

- **OTP:** hash con sal en la base, 5 min, 3 intentos, máximo 3 envíos por hora por número y 10 por IP (`ip_hash`).
- **Token de sesión:** aleatorio de 256 bits; en la base solo su hash; caduca a los 30 días o al cerrar sesión.
- **Accesos:** solo el dueño del WhatsApp del pedido (sesión verificada) y con auditoría; nunca se envían en la URL ni se guardan en el dispositivo.
- **Comprobantes:** bucket privado, URL firmada de un solo uso con tamaño y tipo limitados (JPG, PNG, PDF ≤ 5 MB) y hash para detectar duplicados.
- **Órdenes de invitados:** expiran (`expira_at`) si no se paga; límite de órdenes abiertas por número e IP.
- La CSP actual se mantiene; si se usa Storage, se agrega su dominio en `connect-src`.

## 6. Fases

| Fase | Entrega | Depende de |
|---|---|---|
| 1 ✅ | `wo-028-portal.sql` (sesiones, OTP, `mis_pedidos`, `ver_accesos`) + `sesion.js` en `cliente.html#cuenta` (entrar, historial, accesos con re-verificación cada 24 h) | Decisiones 2 y 3 |
| 2 ✅ (parcial) | `wo-030-comprobantes.sql`: orden web (DC-XXXXX) + comprobante a Storage privado con ruta de un solo uso; validación en el panel (Pagos & Agente Bot → Comprobantes web). Falta: total recalculado en el servidor cuando los precios migren a la base | Decisión 1 |
| 3 | Carrito multi-ítem (`ordenes`) | Fase 2 |
| 4 ✅ (accesos) | Accesos dentro de la tarjeta del pedido (velados, copia por línea, cierre a los 60 s, re-verificación cada 24 h). Pendiente: reportes de falla en el panel | Fase 1 |
| 5 ✅ | Descuento por combo: `wo-029-combos.sql` (reglas editables en el panel, inicio 2 = 10 % y 3+ = 15 %; el cupón no se acumula con el combo) | Decisión 4 |

## 7. Decisiones del director antes de empezar

1. **Fuente de verdad de precios.** Hoy la tienda usa `productos.json` y la base tiene `variantes`. Para cobrar con seguridad, el precio debe salir de la base. Propuesta: la base manda y `productos.json` se genera desde ella (o, mínimo, una columna de precio en `variantes` sincronizada).
2. **¿Mostrar las credenciales en el portal?** Propuesta: sí, solo con sesión verificada por OTP y con auditoría. Alternativa: solo "Reenviar a mi WhatsApp".
3. **OTP por WhatsApp a través del bot** (no SMS ni email). Propuesta: sí, encaja con la regla de no usar correos.
4. **Combos:** ¿qué combos reales quieres ofrecer y a qué precio? Sin esa definición no se mostrará ninguno.
5. **¿Compra de invitado?** Propuesta: sí (menos fricción); ver accesos y reportar fallas requieren verificar el WhatsApp.
