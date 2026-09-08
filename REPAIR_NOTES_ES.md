# Corrección de instalación limpia — 8 de septiembre de 2026

## Fallos corregidos

- FIX3, diagnosticado en Steam real: `GamepadUIToggle`, la clase del botón para entrar en Big Picture, coincidía con el selector parcial de modo gamepad. El escritorio se clasificaba como Big Picture y no ejecutaba la integración de Biblioteca. La detección usa ahora clases completas de superficie (`GamepadUI` o `gamepadui`).
- FIX2: las acciones de Propiedades están debajo de las sugerencias, con posición adhesiva y ajuste de ancho para mantener «Vincular» accesible al desplazarse.

- La elección del documento principal aceptaba el título genérico «Steam» y nombres que contenían «SP Desktop». Un menú podía convertirse en el destino del diálogo y desplazar a la Biblioteca. Ahora se comprueba la identidad del escritorio y se excluyen menús, ventanas auxiliares, contexto compartido y Big Picture.
- La confirmación se insertaba como un div fijo dentro del documento de Steam, sin límite vertical ni desplazamiento. Ahora utiliza la capa superior del navegador mediante un diálogo, con desplazamiento para ventanas pequeñas.
- Los clics en «Añadir seleccionados» se comprobaban con `instanceof Element` del contexto del complemento. Los elementos de otra ventana de Steam no pertenecen a ese contexto. Ahora se comprueba el tipo de nodo sin depender de su ventana de origen.
- Las imágenes se descargaban mediante el backend y, tras fallar o no superar la validación de dimensiones, se volvían a descargar al guardarlas. Se eliminó ese segundo recorrido, que también podía saltarse la validación. Los 404/410 se recuerdan durante un minuto; los fallos temporales permiten reintentos. El tiempo límite de la descarga directa incluye ahora la lectura del cuerpo.

## Comprobaciones

- `npm ci` y `npm run check`: instalación de dependencias y conjunto completo de verificaciones.
- `npm run build` y `npm run check:dist`: compilación de producción y comprobación del paquete generado.
- `node scripts/check-window-runtime.mjs`: selección de escritorio frente a menús y ventanas cerradas.
- `node scripts/check-image-runtime.mjs`: 404, expiración, reintentos temporales y cuerpo de descarga bloqueado.
- `npm run check:modal-browser`: Chromium/Edge real, tamaños 1920×1080, 800×450 y 360×640; contenedor transformado y recortado, desplazamiento, cancelación, Escape y eventos entre ventanas. Requiere Playwright instalado o `PLAYWRIGHT_MODULE_PATH` apuntando a un runtime externo; por defecto usa Edge.
- `python scripts/check-backend-runtime.py`: Lua real con APIs del anfitrión simuladas; perfil temporal vacío, arranque, escritura, lectura, recuperación de copia y desvinculación. Requiere `lupa`.

Estas pruebas no sustituyen una prueba integral en el Steam del otro equipo. No se han modificado juegos ni logros para verificarlas.

## Prueba con el paquete limpio

1. Salir completamente de Steam.
2. Mantener una sola instalación de este complemento en `Steam/millennium/plugins`. Si existe una versión anterior, mover su carpeta a una ubicación de respaldo fuera de `plugins`.
3. Extraer la carpeta `NativeGameLinkForSteam` del ZIP limpio directamente en `plugins`. Debe contener `plugin.json`, `backend` y `.millennium/Dist/index.js`.
4. Abrir Steam y activar el complemento en Millennium.
5. Abrir un juego no-Steam sin vincular: comprobar que aparece «Vincular» en su página. Añadir después un nuevo acceso directo y comprobar que la revisión aparece en la ventana principal y permite confirmar.

No hacen falta Node.js ni npm en el equipo de prueba. El ZIP anterior v3.0.0 incluía `achievement_options.json` personal; el paquete limpio excluye ese estado. No usar el ZIP anterior para esta prueba.

En el equipo de desarrollo, el código compilado queda ya en la carpeta activa del complemento: basta reiniciar Steam para cargarlo. Los cambios son locales; no se publican automáticamente en GitHub.
