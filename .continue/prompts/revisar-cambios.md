---
name: revisar-cambios
description: "Revisa los cambios antes de entregar (claves, generados, reglas)"
invokable: true
---
Corre git status y git diff (y git diff --cached). Revisa y dime en una lista corta:
1. ¿Hay algo que parezca una clave (sk-, gsk_, nvapi-, AIza, tokens largos) o un .env? Si sí, PARA y avísame.
2. ¿Se editó a mano algún archivo generado (n8n/flujo_bot_dctechnology.json, bot-conocimiento.json, p/, c/, estilos/tailwind.css, supabase/APLICAR-PENDIENTES.sql)? Debe regenerarse con su script.
3. ¿Hay cambios ajenos a la tarea? Nómbralos.
4. ¿Hay datos inventados (precios, descuentos, reseñas, tiempos)?
5. ¿Hay una prueba nueva para lo que se cambió?
No cambies nada: solo informa.
