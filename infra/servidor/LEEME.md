# Guía de despliegue del servidor (DC Tecnology)

1. Contratar un VPS con Ubuntu 24.04, 2 vCPU y 4 GB de RAM.
2. En el DNS de dctecnology.xyz, crear registros A «bot» y «wa» apuntando a la IP del VPS.
3. Entrar por SSH al VPS e instalar Docker:
   curl -fsSL https://get.docker.com | sh
4. Copiar la carpeta `infra/servidor` al VPS.
5. Copiar `env-servidor-ejemplo.txt` como `.env` en esa carpeta y llenarlo con los valores correspondientes.
6. Ejecutar: docker compose up -d
7. Abrir https://bot.dctecnology.xyz y crear el usuario administrador de n8n.
8. AVISAR A CLAUDE para realizar la mudanza del flujo y la vinculación de WhatsApp por QR (no hacerlo solo).

## Pendiente para Claude
- Aplicar el parche de Evolution que ignora los JID @bot (ver CLAUDE.md, «Parche local de Evolution»).
- Configurar `groupsIgnore = true` en la instancia de Evolution.
