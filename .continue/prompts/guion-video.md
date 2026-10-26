---
name: guion-video
description: "Escribe el guion de un video vertical de 20-30 s con datos reales"
invokable: true
---
Reglas: español; cero datos inventados (precios y existencias solo de productos.json o de precios_publicos; nada de descuentos, reseñas ni tiempos que no existan); marca «DC Tecnology» y «www.dctecnology.xyz»; WhatsApp 322 328 4622; nunca nombrar proveedores (ANC, Emprende Red); nunca abrir .env; trabaja en una rama gemini/<tema>.
Tema: (lo que escriba el director después del comando) (si está vacío, elige un producto o servicio visible de productos.json con buen precio).
1. Lee productos.json y herramientas/estados-plan.json (campaña vigente) para el tono y los datos.
2. Escribe docs/guiones/<AAAA-MM-DD>-<tema>.md con:
   - gancho de 0 a 3 s (una pregunta o un problema real del cliente);
   - 3 a 4 escenas con texto en pantalla (máx. 6 palabras cada una) y lo que dice la voz;
   - cierre con «www.dctecnology.xyz» y WhatsApp;
   - duración estimada (≤ 30 s, voz a 2,5 palabras por segundo);
   - 3 títulos para YouTube Shorts (≤ 60 caracteres) y 8 hashtags.
3. Revisa que cada precio o dato salga tal cual de productos.json. Lista abajo de qué campo salió cada cifra.
