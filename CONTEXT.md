# CONTEXTO: DC Technology

## Modelo de Negocio
Somos un e-commerce de reventa de servicios digitales (streaming, pines, licencias). Compramos al proveedor (ALL NECESSARY COLOMBIA) vía WhatsApp y entregamos al cliente final.

## Arquitectura Actual
- **Frontend:** HTML + JS Vanilla + Tailwind (index.html, app.js, admin.html, admin.js).
- **Backend:** Supabase (PostgreSQL).
- **Orquestación (En desarrollo):** n8n self-hosted + Evolution API para WhatsApp.

## Invariantes (Reglas que no cambian)
1. El proveedor envía cuentas con formatos no estructurados por WhatsApp.
2. La automatización se basa en la correlación del `wamid` (ID del mensaje de WhatsApp) o la referencia `DC-XXXX`.
3. Nunca se entrega una cuenta automáticamente si la "confianza" de la extracción es menor a 0.9.
4. El agente autónomo tiene un "modo sombra" (Shadow Mode): primero extrae y sugiere, el humano aprueba.