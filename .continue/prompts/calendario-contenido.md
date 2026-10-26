---
name: calendario-contenido
description: "Arma el plan de contenido de las próximas 4 semanas"
invokable: true
---
Reglas: español; cero datos inventados (precios y existencias solo de docs/catalogo-resumen.md, de la página del producto o de precios_publicos; nada de descuentos, reseñas ni tiempos que no existan); marca «DC Tecnology» y «www.dctecnology.xyz»; WhatsApp 322 328 4622; nunca nombrar proveedores (ANC, Emprende Red); nunca abrir .env; trabaja en una rama gemini/<tema>.
1. Lee herramientas/estados-plan.json, herramientas/salida/redes-plan.json (si existe) y docs/videos-estados/set.json.
2. Escribe docs/contenido/plan-<AAAA-MM>.md con una tabla por semana:
   - día, red, video existente que se usa (archivo real de set.json) o «NUEVO» con su tema;
   - objetivo (alcance, ventas o confianza) y llamado a la acción.
3. Propón máximo 4 videos NUEVOS (usa /guion-video para cada uno) y 2 ideas de imagen (usa /imagen-anuncio).
4. Prioriza lo que más vende: servicios técnicos, tecnología con existencias y streaming.
