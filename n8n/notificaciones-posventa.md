# n8n · Notificaciones posventa (WO-015)

> **Listo para importar:** `n8n/flujo_bot_dctechnology.json` incluye esta rama de posventa y el bot de WhatsApp con IA (DeepSeek-V3 en SiliconFlow). Se regenera con `node n8n/generar_flujo_n8n.js` después de `node generar_bot_conocimiento.js`; las instrucciones de credenciales están en la nota "Leeme" dentro del flujo.

La base de datos decide **qué** enviar y **cuándo**; n8n solo entrega. Así no se duplican mensajes ni se envían en ráfaga.

```
compras_proveedor (cambio de estado)
   └─ trigger → notificaciones_whatsapp (PENDIENTE)
                    └─ n8n cada 60 s: tomar_notificaciones → Evolution API → marcar_notificacion
```

| Evento | Estado de la compra | Plantilla (`bot-conocimiento.json → plantillas`) | Cuándo sale |
|---|---|---|---|
| `PAGO_RECIBIDO` | `ESPERANDO_PROVEEDOR` | `pago_recibido` | Inmediato (uno por pedido) |
| `ENTREGA_CONFIRMADA` | `ENTREGADO` / `ENTREGADO_INMEDIATO` | `entrega_confirmada` | Inmediato |
| `SOLICITUD_RESENA` | (24 h después de la entrega) | `solicitud_resena` | Lun–sáb, 9:00–19:59 (Bogotá) |
| `OTP` (WO-028) | (el cliente pide entrar al portal) | `codigo_acceso` | Inmediato, prioridad máxima; se cancela si no sale en 5 min y el código se borra de la cola al enviarse |

Los mensajes **nunca** llevan credenciales. Las cuentas y seriales los entrega un asesor por el chat (modo sombra).

## Requisitos

1. Ejecutar `supabase/wo-015.sql`.
2. En n8n, una credencial de Supabase de **servidor** (la misma que ya usa para crear los pagos `PENDIENTE`). Esa clave vive solo en n8n: nunca en el sitio ni en el repositorio.
3. Variables de entorno de n8n: `SUPABASE_URL`, `EVOLUTION_URL`, `EVOLUTION_INSTANCIA`.

## Flujo (7 nodos)

1. **Schedule Trigger**: cada 1 minuto.
2. **HTTP Request · Tomar lote**
   - `POST {{$env.SUPABASE_URL}}/rest/v1/rpc/tomar_notificaciones`
   - Credencial de servidor (headers `apikey` y `Authorization: Bearer …`)
   - Body JSON: `{ "p_lote": 5 }`
   - Devuelve hasta 5 filas `{ id, tipo, destino, variables, intentos }`. Si viene vacío, el flujo termina.
3. **HTTP Request · Plantillas**: `GET https://dctecnology.xyz/bot-conocimiento.json` (activa "Execute Once").
4. **Loop Over Items** (tamaño de lote **1**): un mensaje a la vez.
5. **Code · Armar texto**:
   ```js
   // Misma lógica que PlantillasWA.rellenar (plantillas-whatsapp.js): variables sin * _ ~ `,
   // y si un {marcador} queda vacío se omite su línea entera.
   const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
   const rellenar = (plantilla, vars) => plantilla.split('\n').map((linea) => {
       let incompleta = false;
       const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
       return incompleta ? null : texto.replace(/[ \t]+$/, '');
   }).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

   const kb = $('Plantillas').first().json;
   const n = $json;
   const plantilla = kb.plantillas[kb.notificaciones.plantilla_por_tipo[n.tipo]];
   if (!plantilla) throw new Error(`Sin plantilla para ${n.tipo}`);   // va a la salida de error → marcar_notificacion(p_ok=false)
   const texto = rellenar(plantilla, n.variables ?? {});
   if (texto.length < 20) throw new Error('Mensaje vacío o incompleto');
   return { id: n.id, numero: n.destino, texto };
   ```
6. **HTTP Request · Enviar (Evolution API)**, con **On Error → Continue (using error output)**
   - `POST {{$env.EVOLUTION_URL}}/message/sendText/{{$env.EVOLUTION_INSTANCIA}}`
   - Body: `{ "number": "{{$json.numero}}", "text": {{JSON.stringify($json.texto)}}, "delay": 1500 }`
   - `delay` muestra "escribiendo…" antes de enviar. Revisa el formato exacto del body según tu versión de Evolution API.
7. **HTTP Request · Confirmar**: `POST …/rest/v1/rpc/marcar_notificacion`
   - Salida OK: `{ "p_id": {{id}}, "p_ok": true, "p_wamid": "{{$json.key.id}}" }`
   - Salida de error: `{ "p_id": {{id}}, "p_ok": false, "p_error": "{{$json.error.message}}" }`

   Después: **Wait** aleatorio de 8 a 15 s (`{{ 8 + Math.floor(Math.random() * 8) }}`) y vuelve al Loop.

## Protecciones anti-ráfaga y anti-duplicados

| Capa | Regla |
|---|---|
| BD · `tomar_notificaciones` | Máximo 10 por llamada (se usan 5), **uno por número** y nada a un número que recibió mensaje hace menos de 60 s. |
| BD · idempotencia | `clave` única: un solo "pago confirmado" por pedido, una sola entrega y una sola reseña por compra, aunque el estado cambie varias veces. |
| BD · limpieza | Cancela lo que ya no aplica: compra anulada, pago ya entregado, reseña ya escrita, cliente dado de baja, mensaje manual de satisfacción ya enviado, o más de 6 días de atraso. |
| BD · reintentos | Si falla: reintenta a los 5 y 10 min; al 3.er fallo queda `FALLIDO`. Desde el panel, **Pagos & Bot → Notificaciones automáticas → Reintentar**. |
| BD · bloqueo | `for update skip locked`: dos ejecuciones simultáneas de n8n nunca toman el mismo mensaje. Lo que quede "EN_PROCESO" más de 10 min se rescata. |
| n8n | Lote de 1 en el loop, `delay` de 1,5 s (escribiendo…) y espera aleatoria de 8 a 15 s entre envíos: unos 4 mensajes por minuto como máximo. |

## Bajas ("NO")

En el flujo del bot que recibe mensajes: si el cliente responde exactamente `NO` a una solicitud de reseña, llama a
`POST …/rest/v1/rpc/registrar_baja_whatsapp` con `{ "p_numero": "<número>" }`. Esto cancela sus solicitudes de reseña pendientes y evita las futuras. Los mensajes de pago y entrega se siguen enviando, porque son transaccionales.

## Palabras clave que responde el bot

Las plantillas invitan a responder **SOPORTE**, **ACCESOS** o **NO**. Las dos primeras **escalan a un asesor** según `bot-conocimiento.json → escalamiento`: pausar el bot en ese chat, avisar al WhatsApp del negocio y responder con la plantilla `escalar_asesor`.
