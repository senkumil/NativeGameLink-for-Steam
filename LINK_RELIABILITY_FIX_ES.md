# FIX8 — Fiabilidad de detección y vinculación

Incluye FIX1–FIX7. Cambios locales; no publicado en GitHub.

## Cambios

- La vinculación masiva exige puntuación de al menos 90, confianza alta, evidencia fuerte validada o prueba local, y una diferencia mínima de 15 puntos respecto de otro AppID. La puntuación es una medida del detector, no una probabilidad de acierto. Alias que requieren confirmación, contradicciones y coincidencias ambiguas quedan para revisión manual desde la gestión de vinculaciones. Se conserva el acceso manual por AppID para títulos retirados.
- Al combinar candidatos locales y remotos se conservan advertencias y colisiones de identidad. La disponibilidad de una ficha remota no elimina una contradicción local.
- La resolución del acceso ya no utiliza el juego abierto como sustituto ni el primer resultado entre duplicados. Comprueba el ID existente o una coincidencia única de ejecutable/nombre. Un ejecutable distinto no se sustituye por otro de igual título.
- La cola distingue accesos con IDs distintos aunque compartan nombre o ejecutable. Antes de procesar el siguiente trabajo vuelve a consultar la cola para respetar cancelaciones. Una respuesta antigua no borra una nueva intención de vinculación en primer plano.
- Se conservan los errores reales y se detienen reintentos de errores definitivos. Los fallos transitorios mantienen reintentos limitados con espera creciente; guardar de nuevo permite reintentarlo. Las intenciones interrumpidas por cierre se recuperan en la siguiente sesión.
- Una reparación no se considera terminada si falta el icono. El mensaje final distingue la vinculación guardada de los recursos pendientes.
- La validación de dimensiones de imágenes tiene un límite de diez segundos para evitar esperas indefinidas de decodificación.

## Verificación

`npm run verify`: tipos, estructura, localización, detección, política masiva, regresiones, arranque limpio, ciclo Big Picture/escritorio, imágenes, noticias, compilación de producción y revisión del bundle.

`npm run check:link-reliability`: escenarios ejecutables con módulos reales y APIs de Steam simuladas: duplicados, cancelación durante una espera, recuperación entre sesiones, errores definitivos, icono incompleto, IDs inválidos, pérdida de advertencias y decodificación bloqueada.

Pruebas Python con Lua real y host simulado: `scripts/check-backend-runtime.py`, `scripts/check-artwork-codec.py`, `scripts/check-news-backend.py`. Requieren `lupa`. Prueba adicional de iconos: `node scripts/check-icon-repair.mjs`.

Estas pruebas no equivalen a verificar todo el catálogo en Steam ni una instalación física en otro equipo. No se pueden garantizar imágenes que sus proveedores ya no ofrecen. Los cambios de FIX8 requieren reiniciar Steam para sustituir el código que ya estaba cargado.

## Paquetes

CLEAN contiene el plugin compilado para instalar. SOURCE incluye el código completo, pruebas y archivos de compilación; ejecutar `npm ci` y `npm run verify` para reconstruirlo. Ninguno incluye las vinculaciones ni el estado personal de esta instalación.
