# FIX10 — Auditoría y optimización de descargas

## Resultado medido

Se ejecutó el módulo real `artwork-image.ts` antes y después del cambio contra el CDN de Steam. Un adaptador HTTP de Node sustituyó el puente de Millennium. Cada caso solicitó `header.jpg` y `logo.png`, con dos consumidores simultáneos de cada URL, y repitió la misma operación inmediatamente. No se modificaron vinculaciones para ejecutar la prueba.

| Juego | Solicitudes iniciales antes → después | Bytes iniciales antes → después | Solicitudes de repetición antes → después |
| --- | --- | --- | --- |
| Cyberpunk 2077 | 4 → 2 | 229068 → 114534 | 4 → 0 |
| GTA IV | 4 → 2 | 184890 → 92445 | 4 → 0 |
| PES 2013 | 4 → 2 | 93090 → 46545 | 2 → 0 |

En PES, el logo de esa URL devolvió 404 en ambas versiones. Se conservó el resultado: la optimización no transforma una ausencia en éxito ni evita buscar otro recurso desde el flujo superior.

La reducción del 50 % corresponde a este escenario de consumidores duplicados. No significa que toda vinculación descargue la mitad o tarde la mitad. La ejecución posterior también se beneficia de conexiones y cachés de red calientes; los tiempos individuales están en `RESOURCE_BENCHMARK_FIX10.json` y no permiten atribuir toda la diferencia al código.

## Cambio aplicado

- Una misma URL en curso comparte una promesa entre consumidores, también si termina en 404.
- Los resultados exitosos se reutilizan durante 60 segundos.
- La caché tiene un presupuesto de 16 MiB para el contenido de las cadenas base64, estimado como UTF-16, con expulsión de entradas menos recientes. No es un límite de memoria total del plugin ni de transferencias activas.
- Las imágenes mayores que ese presupuesto pueden descargarse, pero no se retienen en esta caché.
- Los errores transitorios no se guardan como éxitos ni como ausencias permanentes. Se mantienen los reintentos existentes y la caché previa de 404/410.

## Revisión del resto del recorrido

La caché de metadatos y la unión de solicitudes por AppID ya existían. La aplicación conserva las imágenes completas y prioriza hero/logo/portada en paralelo; la cápsula horizontal se resuelve después. Mantener esa prioridad evita retrasar los elementos principales por una imagen secundaria.

Persisten costes variables: búsqueda comunitaria, intentos de URLs alternativas para juegos retirados, consultas de metadatos y llamadas de escritura a Steam. Los límites de espera no garantizan que el servidor o Steam termine antes: acotan ciertas esperas del flujo. No se ha medido aquí el tiempo completo desde pulsar Vincular hasta el último repintado de Steam, ni el tráfico de todos los proveedores comunitarios. El puerto de diagnóstico de Steam no estaba disponible en esta sesión.

## Pruebas y reproducción

- `npm run verify`: batería completa y compilación de producción, correctas.
- `node scripts/check-download-cache.mjs`: 12 consumidores comparten una transferencia; vencimiento, errores transitorios, expulsión LRU y entradas grandes, correctos.
- `node scripts/benchmark-resource-downloads.mjs`: ejecuta la medición de red de la versión actual y escribe el JSON. Acepta rutas de módulos anteriores para compararlos. Los datos iniciales de este informe proceden del módulo anterior al cambio de FIX10.

Reiniciar Steam activa el bundle nuevo. Incluye FIX1–FIX9. No publicado en GitHub.
