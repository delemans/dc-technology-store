---
name: entregar
description: Cierra la tarea: pruebas, commit, push de la rama y bitácora
invokable: true
---
1. Corre npm test. Si no termina en «0 FALLA», para y explícame la falla.
2. Haz /revisar-cambios mentalmente: sin claves y sin generados editados a mano.
3. git add de los archivos de la tarea (nunca .env), git commit en español «<ID>: …» y git push -u origin <rama actual>. Nunca a main.
4. En .agent/BLUEPRINT.md pon la tarea «**Por revisar (IA) · rama <rama>**».
5. Agrega arriba en .agent/BITACORA.md: fecha, tarea, rama, archivos, resultado de npm test y lo que el director debe hacer.
6. Dime en 3 líneas qué quedó y cuál sigue.
