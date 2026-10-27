ÓRDENES DE TRABAJO PARA LA IA (Continue · «DC Cascada» o Gemini) · 26/10/2026
================================================================================
CÓMO USARLAS
- Antes: Run Task «IA en cascada (puente local)». En Continue: modelo «DC Cascada (todas las IA)», modo Agent.
- Pega UNA orden por mensaje. Cuando termine, revisa que diga lo que pide el «Listo cuando» y pasa a la siguiente.
- Si se enreda o la respuesta es muy larga, abre un chat nuevo (botón +), pega primero la ORDEN 0 y luego la que seguía.
- Cuando pida permiso para correr un comando:
  · acepta: git switch, git add, git commit, git push origin gemini/…, npm test y node pruebas/…;
  · niega: lo que abra .env, toque main, n8n o Supabase, o use --aplicar.

================================================================================
ORDEN 0 · ARRANQUE (siempre al abrir un chat nuevo)
================================================================================
Responde en español. Continúas el trabajo de Claude en DC Tecnology.
Lee CLAUDE.md, .agent/rules/dc-tecnology.md y las 3 primeras entradas de .agent/BITACORA.md.

Reglas:
- Nunca abras .env ni pidas claves.
- Trabaja solo en ramas gemini/<ID>.
- No toques main, n8n, Supabase ni el bot en vivo.
- Cero datos inventados.

Responde en 3 líneas qué entendiste y espera la siguiente orden.

================================================================================
ORDEN 1 · Rama de la T14
================================================================================
Corre: git switch main ; git pull ; git switch -c gemini/T14
Luego abre .agent/BLUEPRINT.md y cambia el título de la T14 de «**Pendiente**» a «**En curso (IA, 26/10)**».
Listo cuando: git branch muestra «* gemini/T14».

================================================================================
ORDEN 2 · docker-compose del servidor (T14, punto 1)
================================================================================
Crea el archivo infra/servidor/docker-compose.yml.

Servicios (todos con «restart: unless-stopped» y la zona horaria America/Bogota en TZ):
- caddy (imagen caddy:2): puertos 80 y 443; volúmenes caddy_data y caddy_config; monta ./Caddyfile en /etc/caddy/Caddyfile.
- n8n (imagen n8nio/n8n:latest):
  · DB_TYPE=postgresdb y conexión al servicio postgres_n8n;
  · N8N_HOST=bot.dctecnology.xyz, N8N_PROTOCOL=https y WEBHOOK_URL=https://bot.dctecnology.xyz/;
  · GENERIC_TIMEZONE=America/Bogota y N8N_ENCRYPTION_KEY=${N8N_ENCRYPTION_KEY};
  · volumen n8n_data en /home/node/.n8n.
- postgres_n8n (imagen postgres:16): base n8n; usuario y clave desde ${POSTGRES_N8N_USER} y ${POSTGRES_N8N_PASSWORD}; volumen pg_n8n.
- evolution (imagen atendai/evolution-api:v2.3.7):
  · SERVER_URL=https://wa.dctecnology.xyz y AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY};
  · DATABASE_PROVIDER=postgresql con DATABASE_CONNECTION_URI apuntando a postgres_evo;
  · CACHE_REDIS_ENABLED=true con CACHE_REDIS_URI=redis://redis:6379/6;
  · volumen evolution_instances en /evolution/instances.
- postgres_evo (imagen postgres:16): usuario y clave desde ${POSTGRES_EVO_USER} y ${POSTGRES_EVO_PASSWORD}; volumen pg_evo.
- redis (imagen redis:7): volumen redis_data.

Ningún valor de clave escrito en el archivo: todas como ${VARIABLE}.
Crea también infra/servidor/Caddyfile con dos sitios:
- bot.dctecnology.xyz → reverse_proxy n8n:5678
- wa.dctecnology.xyz → reverse_proxy evolution:8080

Listo cuando: existen los dos archivos y no tienen ninguna clave real.

================================================================================
ORDEN 3 · Variables de ejemplo (T14, punto 2)
================================================================================
Crea infra/servidor/.env.servidor.ejemplo con TODAS las variables ${…} que usa infra/servidor/docker-compose.yml, una por línea, SIN valor (NOMBRE=).
Encima de cada una, un comentario de qué es y cómo se genera. Por ejemplo, para las claves:
«genera una larga con: openssl rand -hex 32».
Listo cuando: cada ${VARIABLE} del compose aparece en el ejemplo.

================================================================================
ORDEN 4 · Guía para el director (T14, punto 4)
================================================================================
Crea infra/servidor/LEEME.md en español, con pasos numerados y frases cortas:
1. Contratar un VPS con Ubuntu 24.04, 2 vCPU y 4 GB de RAM.
2. En el DNS de dctecnology.xyz, registros A «bot» y «wa» con la IP del VPS.
3. Entrar por SSH e instalar Docker (comando oficial: curl -fsSL https://get.docker.com | sh).
4. Copiar la carpeta infra/servidor al VPS.
5. Copiar .env.servidor.ejemplo como .env y llenarlo (el director, nunca en un chat).
6. docker compose up -d
7. Abrir https://bot.dctecnology.xyz y crear el usuario de n8n.
8. AVISAR A CLAUDE para la mudanza del flujo y la vinculación de WhatsApp por QR (no hacerlo solo).

Agrega una sección «Pendiente para Claude»:
- el parche de Evolution que ignora los JID @bot (ver CLAUDE.md, «Parche local de Evolution»);
- groupsIgnore = true en la instancia.

Listo cuando: el archivo existe con los 8 pasos.

================================================================================
ORDEN 5 · Prueba de la T14 (T14, punto 6)
================================================================================
Crea pruebas/datos/test-infra.mjs con el mismo estilo de pruebas/datos/test-actions.mjs (función ok que imprime «OK» o «FALLA»).
Debe comprobar:
- que docker-compose.yml tiene los 6 servicios y que todos llevan «restart: unless-stopped»;
- que cada ${VARIABLE} del compose está en .env.servidor.ejemplo;
- que ningún archivo de infra/servidor contiene algo parecido a una clave: sk-, gsk_, nvapi-, AIza, o una línea VARIABLE=valor con valor.

Corre: node pruebas/datos/test-infra.mjs
Listo cuando: todas las líneas dicen OK.

================================================================================
ORDEN 6 · Entregar la T14
================================================================================
1. Corre: npm test -- datos  (debe terminar en «0 FALLA»).
2. En .agent/BLUEPRINT.md cambia el estado de la T14 a «**Por revisar (IA) · rama gemini/T14**».
   Nota: el punto 5 (mudar-n8n.mjs) y el parche de Evolution quedan para Claude.
3. Agrega arriba de todo en .agent/BITACORA.md una entrada con: fecha, «T14», archivos creados y el resultado de npm test.
4. Corre: git add infra pruebas/datos/test-infra.mjs .agent ; git commit -m "T14: paquete del servidor (compose, Caddy, ejemplo de variables, guía y prueba)" ; git push -u origin gemini/T14
Listo cuando: el push dice «gemini/T14 -> gemini/T14».

================================================================================
ORDEN 7 · T06 Política de uso de IA (fácil)
================================================================================
Corre: git switch main ; git switch -c gemini/T06
Lee la T06 en .agent/BLUEPRINT.md y herramientas/generar_legal.js.
Agrega en los términos una sección «Uso de inteligencia artificial», solo con hechos:
- el asistente de WhatsApp usa IA para responder preguntas;
- los pagos los valida una persona;
- los videos usan voz sintética.
No inventes nada más.
Después:
1. Corre: node herramientas/generar_legal.js
2. Corre: npm test -- web
3. Haz commit y git push -u origin gemini/T06.
4. Agrega la entrada en la bitácora y marca la T06 «Por revisar (IA)».
Listo cuando: npm test -- web termina en 0 FALLA.

================================================================================
ORDEN 8 · T10 Verificar claves de redes
================================================================================
Corre: git switch main ; git switch -c gemini/T10
Haz la T10 exactamente como está en .agent/BLUEPRINT.md: modo --verificar en herramientas/publicar-redes.mjs y pruebas en pruebas/datos/test-publicar-redes.mjs.
Luego:
1. Corre: npm test -- datos
2. Haz commit y git push -u origin gemini/T10.
3. Agrega la entrada en la bitácora y marca la T10 «Por revisar (IA)».

================================================================================
DESPUÉS
================================================================================
Sigue con la misma fórmula y en este orden: T01 → T02 → T11 → T12 → T15 → T03 → T04 → T05 → T07 → T08 → T09.
Para cada una pega:
«Corre git switch main ; git switch -c gemini/<ID>. Haz la <ID> exactamente como está en .agent/BLUEPRINT.md, con su prueba. Corre npm test y debe dar 0 FALLA. Haz commit, git push -u origin gemini/<ID>, agrega la entrada en la bitácora y marca la tarea «Por revisar (IA)».»

Si una tarea pide un SQL nuevo (wo-052…): la IA solo escribe el archivo. NO lo aplica: eso lo haces tú en Supabase cuando Claude lo revise.
Cuando vuelva Claude: «Revisa lo que hizo la IA en las ramas gemini/*».

================================================================================
ESTILO, FLUJOS Y SEGURIDAD (tareas T18, T19 y T20)
================================================================================
Pega, de a una por chat (después de /retomar):
  /auditar-seguridad              → primero (lo grave queda en privado/ para Claude)
  /mejorar-flujo compra web
  /mejorar-estilo portada
  /mejorar-estilo catálogo y tarjetas
  /mejorar-flujo Mis pedidos
  /mejorar-estilo ficha de producto y carrito
  /mejorar-estilo panel admin
Cada una termina con /entregar (rama propia; nada llega a la tienda sin que Claude lo revise).
