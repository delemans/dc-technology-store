# El bot en Northflank (gratis, sin tarjeta)

> **05/11/2026: en pausa.** Northflank no deja crear cuentas nuevas («El registro está actualmente deshabilitado», con correo, GitHub y Google). Todo queda listo por si vuelven a abrir. Mientras tanto el bot sigue en el PC, protegido por el vigilante (`herramientas/vigilante-bot.ps1 -Instalar`: lo enciende solo al prender el PC y si n8n o Evolution se caen).

El bot (n8n + Evolution/WhatsApp) deja de depender de este PC. Northflank, plan **Sandbox**: 2 servicios siempre encendidos y 1 base de datos, sin tarjeta (hasta US$20/mes de recursos).

| Pieza | Dónde |
|---|---|
| Evolution API 2.3.7 + parche `@bot` | imagen `ghcr.io/delemans/dc-evolution:2.3.7-dc1`, la construye GitHub Actions («Imagen de Evolution») |
| Sesión de WhatsApp | la misma base de Neon que usa hoy el PC: **no hay que escanear QR** |
| n8n 2.43.8 | imagen oficial, con la base Postgres de Northflank |
| Entre ellos | red privada del proyecto: `http://evolution:8080` y `http://n8n:5678` |
| Todo por API | `herramientas/northflank.mjs` (`--revisar`, `--crear`, `--mudar`, `--estado`) |

## Lo que haces tú (una sola vez)

1. Entra a **northflank.com** → *Sign up* → **Continue with GitHub** (cuenta `delemans`). Plan: **Sandbox** (gratis).
2. Crea la clave de la API: menú de tu equipo → **Settings → API → Tokens → Create API token**. Dale permisos de proyectos (crear y administrar). Copia el token.
3. Abre el archivo `.env` del proyecto y agrega al final una línea:
   `NORTHFLANK_TOKEN=el-token-que-copiaste`
4. Avísale a Claude. Él corre `--revisar` y `--crear`.
5. Cuando Claude te pase la dirección de n8n en la nube: ábrela, crea tu usuario dueño y en **Settings → n8n API → Create an API key** crea una clave. Pégala en `.env` como `N8N_NUBE_API_KEY=…`.
6. El día de la mudanza: cierra la ventana negra **Evolution API** de este PC. Claude corre `--mudar` (enciende Evolution en la nube, apunta el webhook a n8n y desactiva el vigilante del PC). El último comando lo corres tú, porque usa tus claves de Supabase.

## Lo que hace Claude

- `node herramientas/northflank.mjs --revisar`: valida el token, elige planes y comprueba que la imagen de Evolution sea pública.
- `node herramientas/northflank.mjs --crear`: crea el proyecto `dc-bot`, la base `n8n-db`, Evolution **apagado** y n8n.
- `node herramientas/northflank.mjs --mudar`: solo si el Evolution del PC ya no responde.

## Antes de mudarse (pendientes conocidos)

- **Estados de WhatsApp.** `publicar-estado.mjs` le entrega el video a Evolution desde este PC (`127.0.0.1`). En la nube eso no llega: el día de la mudanza hay que pasarlo a subir el archivo.
- **Memoria del bot.** Las etiquetas (BAENAMORA) y las pausas viven en la memoria de n8n. Después de mudarse: `node herramientas/sincronizar-etiquetas.mjs --aplicar`.
- **Vigilante del PC.** `vigilante-bot.ps1` reinicia el Evolution local. `--mudar` desactiva su tarea. No vuelvas a usar `iniciar-bot.ps1`.
- **Volver atrás.** Escala `evolution` a 0 en Northflank, reactiva la tarea del vigilante y corre `iniciar-bot.ps1`.
