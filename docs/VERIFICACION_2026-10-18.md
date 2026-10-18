# Revisión de integración y recursos — 18 de octubre de 2026

La revisión posterior de transiciones, vistas previas y componentes personales
se detalla en [TRANSICIONES_TUS_COSAS_2026-10-18.md](TRANSICIONES_TUS_COSAS_2026-10-18.md).

La integración de Actividad, Tus cosas, Comunidad e Información conserva el
shell, el botón de ejecución y la identidad del acceso directo. El contenido
utiliza React/ReactDOM y componentes disponibles en la ventana propietaria de
Steam. Las capacidades ausentes conservan sus alternativas acotadas.

## Correcciones de esta revisión

- El teclado virtual puede cerrarse y reabrirse inmediatamente. La caché
  verifica el documento, runtime y administrador actuales; una solicitud
  fallida permite reintentar.
- Las entradas mantenidas al editar texto, ocultar la ventana o cerrar otro
  modal no activan controles al recuperar el foco. La selección vigente de
  pestaña prevalece sobre un marcador de foco antiguo.
- Volver desde la búsqueda de logros cierra primero la edición y restaura el
  foco nativo. Una repetición de esa pulsación no cierra la pantalla siguiente.
- Las colecciones funcionan sin un router global, mediante el historial de la
  ventana exacta o el historial local publicado por Steam.
- Inicio reconoce el mensaje de tiempo de juego vacío localizado y la identidad
  confirmada de las tarjetas que reciben `props.app.appid`, aunque no publiquen
  atributos DOM ni stores globales. Muestra el tiempo confirmado mediante el
  formateador nativo: prioridad a las dos últimas semanas y horas decimales
  desde 120 minutos, con la alternativa equivalente si falta esa capacidad.
  La ruta viva prevalece sobre detalles precargados u ocultos, y la traducción
  puede obtenerse del runtime propietario sin un administrador global.
  La entrada a ese refresco consulta la ruta de la ventana Big Picture; una
  ruta pública retenida por el escritorio compartido no puede bloquear Inicio.
  Los valores canónicos positivos se publican sin esperar al SDK de Steam.
  Las consultas alternativas tienen tiempo límite, concurrencia y caché
  acotados; descargar la sesión cancela sus temporizadores.
- La invalidación de peticiones deja de acumular claves históricas. Las
  respuestas de generaciones retiradas no sustituyen una petición nueva.
- Los botones de vinculación liberan listeners, reintentos y observadores.
  Su observador evita actualizar repetidamente un texto que ya es idéntico.
- Los paneles de información desconectan sus observadores aunque Steam ya los
  haya retirado del DOM. Cada documento conserva y cancela sus propias
  animaciones. Desactivar el plugin cancela el mantenimiento de almacenamiento.
- Las cachés del backend conservan límites de entradas y recuentos correctos
  después de invalidaciones; los perfiles de juegos retirados también expiran.
- Los procesos auxiliares propagan fallos y tiempos de espera. El auxiliar de
  tarjetas libera biblioteca, usuario, pipe y handles al terminar; el backend
  solicita detenerlo al descargarse. Una señal de control por sesión cancela
  también el arranque tardío si la parada llegó antes de crear sus handles.
- Las APIs del editor de logo validan el ID completo del acceso directo antes
  de leer o escribir archivos; rechazan rutas, decimales y valores fuera de rango.

## Verificación reproducible

`npm run verify` ejecuta TypeScript, arquitectura, Lua, pruebas de comportamiento,
contratos contra el cliente Steam instalado y fixtures de navegador; después
genera y valida `.millennium/Dist/index.js`.

La revisión incluye los siguientes escenarios:

- Flujo de logros con React 19.1.1 de Steam: 340 comprobaciones y 104 aperturas.
- Cuatro pestañas: 97 comprobaciones, incluidos navegación de colecciones sin
  router global y rechazo de acciones después de cambiar a un juego nativo.
- Entradas: 120 transiciones de ruta con navegación nativa y alternativa
  excluyentes; ventana oculta, edición, modales y controles mantenidos.
- Inicio: 66 comprobaciones con el componente de tarjeta y el formateador
  extraídos del Steam instalado, español/LATAM/inglés, respuesta tardía,
  restauración y conservación de juegos nativos y accesos directos hermanos.
  Se ejecutan también el arranque y watchdog reales con rutas contradictorias
  entre ventanas y una consulta SDK que nunca responde.
- Caché de peticiones: 10.000 invalidaciones y resolución tardía de peticiones
  sustituidas. Botón de vinculación: 100 ciclos de creación y retirada.
- Panel de información: retirada externa, animaciones simultáneas en varios
  documentos y cancelación de observadores y temporizadores.
- Backend: invalidación repetida, límite LRU, errores transitorios, ciclos de
  inicio/parada y pruebas de subprocess con salida, timeout y rutas Unicode.

Los resultados de la suite general, incluidos Inicio y aislamiento, se
conservan en `logs/complete-plugin-verification.log`, un archivo local
excluido de Git.

## Medición del heap de Big Picture

`npm run check:bp-memory-browser` utiliza una sola página Chromium, los
componentes de producción y React 19.1.1 de Steam. Después de 24 ciclos de
calentamiento ejecuta 200 ciclos en cinco lotes: montaje de navegación,
apertura de logros, cambio de pestaña, búsqueda, cierre y desmontaje. Alterna
autoridad nativa y alternativa y fuerza GC entre muestras.

Primera ejecución local, heap JavaScript retenido después de GC, en bytes:

| Calentamiento | 40 ciclos | 80 ciclos | 120 ciclos | 160 ciclos | 200 ciclos |
| --- | --- | --- | --- | --- | --- |
| 17.623.821 | 17.733.807 | 17.801.095 | 17.813.663 | 17.835.971 | 17.846.223 |

Crecimiento total: 222.402 bytes, aproximadamente 217 KiB; en los últimos 120
ciclos: 45.128 bytes. Cada lote vuelve a cero suscripciones, observadores,
timers, frames, raíces de modal y anillos de foco; la autoridad termina en
`none`. Un listener global estable de React permanece en el baseline.

La prueba rechaza crecimiento superior al máximo entre 4 MiB y el 20 % del
baseline; para la cola usa el máximo entre 2 MiB y el 10 %. Es una alarma de
regresión después del calentamiento, no una exigencia de variación cero del
asignador. La suite general incluye esta medición y las pruebas del backend.

En la repetición incluida en `npm run verify`, el heap pasó de 17.630.717 a
17.848.331 bytes: 217.614 bytes adicionales (aproximadamente 213 KiB), con el
mismo baseline final de recursos.

En la siguiente ejecución completa de `npm run check`, pasó de 17.630.449 a
17.846.311 bytes: 215.862 bytes adicionales (aproximadamente 211 KiB), con
45.844 bytes en los últimos 120 ciclos y el mismo baseline de recursos.

La ejecución final de `npm run verify` pasó de 17.631.677 a 17.847.759 bytes:
216.082 bytes adicionales (aproximadamente 211 KiB), con 45.952 bytes en los
últimos 120 ciclos y todos los recursos propios nuevamente a cero.

## Alcance de la evidencia

Se inspeccionó Steam real en escritorio y Big Picture con la interfaz en
español. Las pruebas automatizadas ejecutan código de producción y los
componentes de presentación instalados, con servicios de cuenta y red
controlados. No escriben logros oficiales.

Después de compilar y reiniciar Steam por completo, se confirmó en Inicio
que la tarjeta vinculada de DRAGON BALL: Sparking! ZERO muestra
«ÚLTIMAS DOS SEMANAS: 2.2 H» en lugar del mensaje vacío. También se recorrieron
Actividad, Tus cosas, Comunidad, Información y la pantalla de logros en el
cliente real. El botón de jugar y la identidad del acceso directo permanecen
bajo control de Steam.

La liberación de recursos y una medición de heap en un navegador controlado
no demuestran por sí solas ausencia absoluta de fugas en todos los procesos de
Steam. La matriz física de Xbox/DualSense, hotplug, overlays, todas las escalas
y resoluciones, comparación visual 1:1 y consumo sostenido de `steamwebhelper`
siguen requiriendo validación específica. No se declara esa certificación.
