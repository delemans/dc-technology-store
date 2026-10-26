---
description: Corre todas las pruebas del proyecto y explica el resultado en palabras simples
---

1. Si es la primera vez en este PC: `npm install`.
2. Corre `npm test`. Toma 10 a 20 minutos: lee ANC y Emprende Red en vivo y abre Chrome sin ventana.
   - Solo una parte: `npm test -- flujo`, `npm test -- datos`, `npm test -- sql` o `npm test -- web`.
3. Explica el resultado al director:
   - **«0 FALLA»:** todo bien.
   - **Si hay FALLA:** qué prueba es, qué significa para el negocio y si es por un cambio reciente (mira `git log -5` y `.agent/BITACORA.md`).
   - **Fallas de «datos»:** pueden deberse a que ANC o Emprende Red no respondieron. Repite antes de concluir.
4. No cambies código para «hacer pasar» una prueba sin entender la causa. Anota lo encontrado en `.agent/BITACORA.md`.
