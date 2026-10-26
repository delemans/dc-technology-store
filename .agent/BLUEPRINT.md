# BLUEPRINT · tareas técnicas pendientes de DC Tecnology
_Escrito por Claude el 26/10/2026. Lo siguen Gemini (Antigravity) u otro agente mientras Claude no está._

## Cómo usar este archivo
- **Qué tarea tomar:** la primera con estado **Pendiente**, en orden. Las **Bloqueada** no se tocan.
- **Al empezar:** cambia su estado a **En curso (Gemini, fecha)** y crea la rama `gemini/<ID>`.
- **Al terminar:**
  - pon **Por revisar (Gemini) · rama gemini/<ID>** y escribe en `.agent/BITACORA.md` qué hiciste y el resultado de `npm test`;
  - nunca la marques «Hecha»: eso lo hace Claude o el director al revisar y publicar.
- **Criterio de terminado de cualquier tarea:**
  - `npm test` con 0 FALLA;
  - las pruebas nuevas de la tarea en verde;
  - nada generado editado a mano;
  - sin claves en el diff.

## Contexto rápido (lee CLAUDE.md para el detalle)
- **Tienda:** sitio estático (`index.html`, `app.js` y módulos). Precios en vivo desde Supabase (`precios_publicos`, llave pública).
- **Bot y automatizaciones:**
  - se escriben como funciones en `n8n/generar_flujo_n8n.js`, que se serializan como nodos Code;
  - la rama «Revisar salud» corre cada 30 min;
  - para avisar al director se arma `{ accion: 'avisar', numero, texto }` hacia el número de «Config bot» → `numero_aviso_admin`;
  - el estado entre ejecuciones se guarda en `$getWorkflowStaticData('global')`.
- **Base:**
  - los SQL `supabase/wo-0NN-*.sql` los aplica el director a mano;
  - la cola de WhatsApp es `encolar_aviso(clave, tipo, ref, destino, variables, prioridad)` (wo-032), con tipos permitidos por un CHECK (ver wo-044, que agregó RENOVACION);
  - el horario legal está en `horario_comercial_legal(timestamptz)` (wo-048).
- **Plantillas de mensajes al cliente:** fuente única en `plantillas-whatsapp.js` y en `generar_bot_conocimiento.js` → `plantillas`.
- **Pruebas:** `pruebas/flujo/*.js` ejecutan el código REAL de cada nodo con `$` simulado (copia el patrón de `pruebas/flujo/test-stock.js`); `pruebas/sql/*.mjs` usan PGlite (patrón: `pruebas/sql/prueba-wo051.mjs`).

---

## T01 · Resumen diario de ventas a las 8 p. m. — **Pendiente** (prioridad alta)
**Para qué:** que el director sepa cada noche cómo fue el día sin abrir el panel.

**Pasos**
1. **SQL `supabase/wo-052-resumen-dia.sql`** (requiere wo-046):
   - función `resumen_ventas_dia(p_fecha date default (now() at time zone 'America/Bogota')::date)`, `security definer`, que devuelve un jsonb:
     - `pedidos`: los creados ese día en `triangulaciones` sin `es_combo`;
     - `pagados`: los de estado ESPERANDO_CREDENCIALES o ENTREGADO, o web en REVISION_MANUAL;
     - `entregados`, `venta` (suma de precio_venta de los pagados) y `costo` (igual que en `finanzas_panel`);
     - `margen = venta - costo`;
     - `por_cobrar`: órdenes web ESPERANDO_PAGO o COMPROBANTE_RECIBIDO de las últimas 24 h, con cantidad y total;
     - `top`: los 3 productos más vendidos.
   - `revoke all … from public, anon, authenticated; grant execute … to service_role`.
   - Prueba: `pruebas/sql/prueba-wo052.mjs` (aplica 2 veces sin error, cuentas correctas con datos de ejemplo, anon no puede ejecutarla).
   - Luego `node herramientas/armar-pendientes.js` (agrega wo-052 a la lista ORDEN de ese script).
2. **n8n:**
   - en la rama de salud (busca el nodo «Revisar salud» y sus conexiones en el generador), agrega un nodo que solo actúe entre 20:00 y 20:29 hora de Bogotá, una vez por día (`memoria.resumenDia = 'AAAA-MM-DD'`);
   - llama a la RPC con el patrón `rpcPanel(...)` que ya usa el generador y arma el texto con `🧾 *Resumen de hoy · DC Tecnology*`.
   - Si la RPC no existe (SQL sin aplicar): una sola línea «aplica wo-052».
3. **Pruebas** en `pruebas/flujo/test-resumen-dia.js`: fuera de hora no envía; a las 20:05 envía una vez; la segunda corrida del mismo día no repite; sin SQL avisa una vez.

**Terminado cuando:** las pruebas nuevas y `npm test` estén en verde.
**No aplicar:** el SQL en Supabase ni sincronizar n8n.

## T02 · Alerta de pagos sin validar y pedidos por cobrar — **Pendiente** (alta)
**Para qué:** que ningún pago espere más de 30 min en horario ni se olvide un pedido por cobrar.

1. **En la rama de salud**, cada 30 min, dentro del horario de atención (lun–sáb 8–20):
   - órdenes web en COMPROBANTE_RECIBIDO con más de 30 min → aviso al director con la referencia y el monto;
   - pedidos con más de 24 h sin pago → resumen.
   - Un solo aviso por referencia (`memoria.alertasPago[ref]`).
2. **Si hace falta una RPC nueva** (service_role) para listar esas órdenes: `wo-053` con su prueba.
3. **Pruebas de flujo:** avisa una vez, no repite y no avisa de noche.

## T03 · Recordatorio al cliente sin comprobante (1 h) — **Pendiente** (media)
**Para qué:** recuperar ventas de quien pidió y no pagó.

1. **`wo-054`:**
   - agrega el tipo `RECORDATORIO_PAGO` al CHECK de `notificaciones_whatsapp` (conserva todos los tipos actuales: revisa el último CHECK en wo-044 y posteriores);
   - función service_role que encola el recordatorio para órdenes web ESPERANDO_PAGO con 60–180 min. Una sola vez por orden (clave `RECUERDA:<codigo>`), solo si `horario_comercial_legal(now())` y sin baja (`whatsapp_bajas`).
2. **Plantilla** `recordatorioPago` en `plantillas-whatsapp.js` y `generar_bot_conocimiento.js`:
   - tono amable, sin presionar, con el código del pedido y el enlace a www.dctecnology.xyz;
   - sin descuentos ni plazos inventados.
3. **Pruebas** de SQL y de la plantilla.

## T04 · Cliente molesto → pasa al director al instante — **Pendiente** (media)
**Para qué:** que un reclamo serio nunca lo atienda la IA.

1. En `n8n/generar_flujo_n8n.js` (función de normalizar o enrutar el mensaje):
   - si el texto trae señales de reclamo fuerte (estafa, robo, denuncia, SIC, superintendencia, abogado, devuélvanme, me robaron, insultos comunes), la ruta es `asesor`;
   - motivo «Cliente molesto: atender ya» y aviso con prioridad al director.
2. Pruebas en `pruebas/flujo/test-molesto.js`: casos positivos y negativos (por ejemplo «¿no es estafa?», pregunta legítima de confianza → también a asesor; «gracias» → no).

## T05 · Origen de cada cliente (de qué red llegó) — **Pendiente** (media)
**Para qué:** saber qué publicidad vende.

1. **Tienda (`app.js`):**
   - si la dirección trae `?de=tiktok|youtube|facebook|instagram|google|estado`, guárdalo en `localStorage` (`dc_origen`, 30 días);
   - envíalo con la orden web (busca `crear_orden_web` en `carrito.js`, sin romper la firma actual).
2. **`wo-055`:** columna `origen` en `ordenes_web` (nullable) y la función de crear orden que la acepta como parámetro opcional (con default).
3. **Finanzas (`finanzas.js`):** «Ventas por origen».
4. **`herramientas/generar_redes.js`:** los enlaces de cada publicación con `?de=<red>`.
5. Pruebas web y SQL.

## T06 · Política de uso de IA en las páginas legales — **Pendiente** (baja, fácil)
**Para qué:** transparencia, y cubrir los videos con voz sintética y el bot con IA.

1. En `herramientas/generar_legal.js`, agrega una sección clara:
   - el asistente de WhatsApp usa IA y una persona valida pagos y entregas;
   - los videos usan voz generada por IA;
   - no se usan datos para entrenar modelos propios;
   - el cliente puede pedir hablar con una persona.
2. Regenera `legal/` con el script.
3. Prueba simple: el HTML generado contiene la sección y los enlaces del pie siguen.

## T07 · Libro de PQR en el panel — **Pendiente** (media)
**Para qué:** cumplir plazos legales (Ley 1581: consultas 10 días hábiles, reclamos 15; Ley 1480: PQR).

1. **`wo-056`:**
   - tabla `pqr`: id, fecha, whatsapp, tipo (consulta/reclamo/datos), detalle, estado, `vence_at` calculado en días hábiles usando `festivos_colombia` de wo-048, y respuesta;
   - RPC admin para listar, responder y cerrar; RPC service_role `registrar_pqr` para el bot;
   - prueba PGlite.
2. **Bot:** la ruta de «DATOS» (busca «Habeas data» en el generador) además registra la PQR.
3. **Panel:** vista «PQR» con lo que vence primero arriba (patrón: `proveedor.js` o `finanzas.js`).

## T08 · Gastos fijos y punto de equilibrio en Finanzas — **Pendiente** (baja)
**Para qué:** ver la utilidad real del mes.

- **`wo-057`:** tabla `gastos_fijos` (nombre, valor mensual, activo) con RPC solo para admin.
- **`finanzas.js`:** sección para agregar y editar gastos; utilidad = margen − gastos; punto de equilibrio = gastos ÷ margen promedio por pedido.
- Prueba SQL y web.

## T09 · Revisión de accesibilidad y contraste — **Pendiente** (baja)
- Recorre `index.html` y `admin.html` en celular (390 px) con Chrome sin ventana.
- Revisa áreas táctiles de 44 px o más, foco visible y contraste suficiente en modo claro y oscuro.
- Corrige en `estilos/corriente.css` o en `estilos/profesional.css` (último en el `<head>`).
- Agrega `pruebas/web/prueba-accesibilidad.mjs`.

---

## T10 · Redes: verificar las claves sin publicar — **Pendiente** (alta)
**Para qué:** cuando el director ponga sus claves de YouTube, Meta o TikTok en `.env`, saber en segundos si sirven, sin subir ningún video.
1. En `herramientas/publicar-redes.mjs` agrega el modo `--verificar`. Para cada red con claves (usa `redesActivas(env)`), haz una consulta de solo lectura:
   - YouTube: `tokenYoutube(env)` y luego `channels?part=snippet&mine=true`;
   - Facebook: `GET {META_PAGE_ID}?fields=name`;
   - Instagram: `GET {META_IG_USER_ID}?fields=username`;
   - TikTok: `user/info/` con `fields=display_name`.
2. Imprime una línea por red: ✅ con el nombre de la cuenta, o ❌ con el motivo en palabras simples (token vencido, permiso faltante). **Nunca imprimas el token.**
3. Recibe `f = fetch` como las demás funciones para poder probarla con respuestas simuladas.
4. **Prueba:** amplía `pruebas/datos/test-publicar-redes.mjs` con casos OK, 401 y red sin claves.
5. **Guía:** en «Anuncios DC Tecnology/REDES - CONFIGURAR UNA VEZ.txt» (Escritorio), paso 4, agrega `--verificar` antes de `--probar`.

## T11 · Redes: el plan se renueva solo — **Pendiente** (media)
**Para qué:** hoy, cada 4 semanas, hay que correr `node herramientas/generar_redes.js AAAA-MM-DD` a mano; si se olvida, las redes se quedan sin publicar.
1. En `publicar-redes.mjs`, antes de publicar: si la última fecha de `redes-plan.json` está a menos de 3 días, genera el plan siguiente desde el lunes después de esa fecha (reutiliza la función de `generar_redes.js` sin cambiar su salida).
2. Lo ya publicado no se repite: `redes-publicadas.json` manda.
3. **Prueba:** un plan que vence mañana debe generar las 4 semanas siguientes, y uno con 10 días por delante no debe cambiar nada.

## T12 · Redes y estados: resumen semanal por WhatsApp — **Pendiente** (media)
**Para qué:** que el director sepa cada lunes qué salió en cada red y en los estados, sin abrir archivos.
1. Script nuevo `herramientas/resumen-redes.mjs`:
   - lee `herramientas/salida/redes-publicadas.json` y `herramientas/salida/estados.json` de los últimos 7 días;
   - cuenta, por red, lo publicado y lo fallido (con su motivo);
   - dice la campaña de la semana que empieza (de `herramientas/estados-plan.json`).
2. Lo envía al número de aviso con la misma función de envío que usa `publicar-estado.mjs`; con `--probar` solo imprime.
3. Agrega `--instalar` para la tarea de Windows «DC Tecnology - resumen de redes» (lunes, 8 a. m.), igual que los otros scripts.
4. **Sin métricas inventadas:** solo lo que está en los registros. Las vistas y los seguidores requieren las APIs de estadísticas (bloqueada B7).
5. **Prueba:** `pruebas/datos/test-resumen-redes.mjs` con registros de ejemplo.

---

# Fase «Sin depender del PC» (pedida por el director el 26/10/2026)
**Objetivo:** que tienda, bot, WhatsApp y tareas automáticas sigan funcionando aunque el PC de la oficina esté apagado.
**Hoy dependen del PC:**
- n8n (`localhost:5678`) y Evolution/WhatsApp (`localhost:8080`, con un parche local; ver CLAUDE.md);
- las tareas de Windows: vigilantes, videos, estados, redes y respaldo.

La tienda (GitHub Pages) y la base (Supabase) ya están en internet.
**Orden:**
1. T13: lo que no necesita servidor va a GitHub Actions.
2. T14: se prepara el servidor.
3. B10: el director lo contrata.
4. Claude hace la mudanza.

## T13 · Vigilante del catálogo en GitHub Actions — **Hecha (Claude, 26/10/2026)**: `.github/workflows/vigilante-catalogo.yml` (6:30 a. m. Bogotá; no necesita secretos porque solo lee páginas públicas; con los secretos EVOLUTION_* y NUMERO_AVISO_ADMIN además envía el informe). Prueba: pruebas/datos/test-actions.mjs. Gemini: no la rehagas; sigue con T14
**Para qué:** sincronizar Emprende Red y ANC, publicar el catálogo y revisar el sitio cada día, aunque el PC esté apagado.
1. **Workflow:** crea `.github/workflows/vigilante-catalogo.yml`:
   - se ejecuta a diario a las 11:00 UTC (6 a. m. en Bogotá) y también a mano (`schedule` + `workflow_dispatch`);
   - usa Node 24 (`actions/setup-node`) y `npm ci`;
   - corre `node herramientas/vigilante-catalogo.mjs`;
   - tiene `permissions: contents: write` y git configurado como «DC Tecnology bot».
2. **Correr sin `.env`:** el vigilante y sus subprocesos leen las variables con `cargarEntorno()`, que solo toma de la terminal los prefijos de `entorno.js`. Amplía esa lista para que también tome `NUMERO_`, `EVOLUTION_`, `IA_`, `SUPABASE_` y `ANC_` (los secretos de GitHub llegan como variables de la terminal). No cambies cómo funciona en el PC.
3. **Secretos:** se leen de `secrets.*` (los carga el director: B11). Si `EVOLUTION_URL` no existe o es `localhost`, el informe se imprime en el registro de Actions en vez de enviarse por WhatsApp. Eso pasa hasta que exista el servidor.
4. **Sin Windows:** `powershell.exe` solo se usa con `--instalar`; verifica que el camino normal no lo use. El push lo hace el propio vigilante con `git`; en Actions usa el `GITHUB_TOKEN`.
5. **Mismo trabajo en otro workflow:** `revisar-sitio.yml` (diario 11:30 UTC, `node herramientas/revisar-sitio.mjs`; no necesita secretos).
6. **Pruebas:**
   - `pruebas/datos/test-actions.mjs` lee los `.yml` y comprueba la hora (`cron`), los permisos y que no tengan claves escritas;
   - prueba aparte que `cargarEntorno()` toma las variables nuevas de la terminal.
7. **No apagues la tarea de Windows:** eso lo hace Claude cuando el workflow ya haya corrido bien una vez.

## T14 · Paquete del servidor para n8n + WhatsApp — **Pendiente** (alta; el despliegue lo hace Claude)
**Para qué:** mudar el bot a un servidor en internet (VPS) de forma reproducible.
1. **`infra/servidor/docker-compose.yml`:**
   - n8n (con Postgres) y Evolution API 2.3.7 (con su Postgres y Redis);
   - Caddy con HTTPS automático para `bot.dctecnology.xyz` (n8n) y `wa.dctecnology.xyz` (Evolution);
   - volúmenes persistentes y `restart: unless-stopped`;
   - zona horaria `America/Bogota` (`GENERIC_TIMEZONE` y `TZ`).
2. **`infra/servidor/.env.servidor.ejemplo`:** solo los nombres de las variables (sin valores) y un comentario de dónde sale cada una.
3. **Parche de Evolution:** que ignore los JID `@bot`, como el parche local de CLAUDE.md. Hazlo con un `Dockerfile` que parte de la imagen oficial y aplica el cambio. Si no se puede, déjalo anotado como pendiente para Claude. Además, `groupsIgnore = true`.
4. **`infra/servidor/LEEME.md`, paso a paso para el director:**
   - cómo crear el VPS;
   - cómo apuntar los subdominios en el DNS;
   - `docker compose up -d`;
   - cómo vincular WhatsApp leyendo el QR desde el celular del bot.
5. **`herramientas/mudar-n8n.mjs` (lo prepara Gemini; lo corre Claude):**
   - lee el flujo del n8n del PC (API) y lo crea en el n8n nuevo (`N8N_URL_NUEVO` y `N8N_API_KEY_NUEVO`);
   - con `--probar` solo muestra lo que haría;
   - nunca imprime claves.
6. **Prueba:** `pruebas/datos/test-infra.mjs` valida el YAML (servicios, volúmenes, reinicio), que no haya claves escritas y que el `.env.servidor.ejemplo` tenga todas las variables que usa el compose.
7. **No despliegues nada ni toques el n8n del PC:** el despliegue lo hace Claude con el director.

## T15 · Tareas del PC que pasan al servidor o a Actions — **Pendiente** (media; después de T13)
1. Lista en `infra/servidor/LEEME.md`, para cada tarea de Windows, dónde queda:
   - **Actions:** vigilante del catálogo y revisión del sitio;
   - **servidor (cron del VPS):** estados de WhatsApp, redes y respaldo semanal;
   - **sigue en el PC por ahora:** los videos de las 3 a. m. (necesitan Chrome, ffmpeg y la cuota de voz; se pueden mover después).
2. Los videos MP4 no están en git: propone dónde guardarlos para que el servidor los publique (por ejemplo, un bucket de Supabase Storage). Escríbelo como propuesta, sin implementarla.

---

## Bloqueadas (necesitan algo del director: no tocar)
| ID | Tarea | Qué falta |
|---|---|---|
| B1 | Quitar los 35 precios «antes» tachados | Decisión del director (recomendado quitarlos) |
| B2 | Cambiar «entrega inmediata · máx. 15 min» en sitio y videos | Decisión del director (con entrega manual, ¿se cumple?) |
| B3 | Datos legales del responsable (razón social, NIT, dirección) | RUT y Cámara de Comercio |
| B4 | Página «Quiénes somos» | Fotos reales del director o del local |
| B5 | Pasarela Wompi | Cuenta Wompi aprobada |
| B6 | Pines y recargas con API (Reloadly u otro) | Cuenta y saldo |
| B7 | Publicación automática en redes | Cuentas y claves en `.env` (las pone el director) |
| B8 | Videos con video real | `PEXELS_API_KEY` en `.env` (el estudio es de Claude) |
| B9 | Activar categorías de Emprende Red | Elección del director en el panel |
| B10 | Desplegar el servidor (n8n + WhatsApp en internet) | El director contrata el VPS y apunta el DNS (pendiente 15); después Claude hace la mudanza con el paquete de T14 |
| B11 | Activar los workflows de T13 | El director carga los secretos en GitHub (pendiente 16) |

## Para Claude al volver
- **Mudanza fuera del PC:** revisar T13 y T14, activar Actions con los secretos (B11), desplegar el VPS (B10), mudar el flujo, vincular WhatsApp por QR, cambiar las URL en Config bot y en .env, apagar las tareas de Windows que ya corran afuera y actualizar CLAUDE.md.
- **IA en cascada (26/10):** `herramientas/ia.mjs` está listo; falta pasar los scripts del estudio de videos (scratchpad) cuando se muden.
- Revisar cada rama `gemini/*`: diff, `npm test`, y fusionar a `main` lo que esté bien.
- Aplicar lo necesario en vivo: sincronizar n8n, versionar y publicar.
- Actualizar este archivo y CLAUDE.md.
