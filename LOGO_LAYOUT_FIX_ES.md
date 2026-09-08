# FIX11 — Composición del logo y editor por juego

## Comportamiento

- La posición oficial se usa cuando las URLs registradas del logo y del fondo coinciden con los recursos oficiales correspondientes. No se aplica automáticamente a una combinación comunitaria distinta.
- Cuando falta una composición oficial, se elimina margen transparente excesivo del logo, manteniendo transparencia, proporción y un pequeño borde de seguridad. Se procesa el archivo instalado, sin otra descarga.
- El respaldo deja de ser 70 % uniforme. El límite de ancho/alto depende de la proporción del logo visible: compacto 38/65, intermedio 50/65, horizontal 60/45. Son límites de encaje, no una deformación de la imagen. Los perfiles existentes de PES 2013 y Mortal Kombat Komplete Edition se conservan.
- Los ajustes manuales se guardan por acceso, AppID y huella del contenido del logo y el fondo; se conservan hasta 16 combinaciones por acceso. Cambiar el fondo no reutiliza la preferencia de otra combinación.
- Una posición nativa distinta de la última aplicada por el plugin se trata como ajuste manual durante la reconciliación. Los respaldos genéricos antiguos conocidos se migran. Sin historial no puede distinguirse un ajuste manual idéntico al respaldo antiguo.

## Ajuste manual

Después de reiniciar Steam, abrir Propiedades del acceso → Personalización → Ajustar logo. Elegir la posición y los límites de ancho/alto y pulsar Guardar. La previsualización no modifica Steam; Cancelar descarta los cambios. Se ofrecen las cinco posiciones admitidas por este flujo de Steam, no coordenadas libres.

La vista previa es aproximada: Steam adapta el resultado a su ventana y a su área de cabecera. El cálculo automático no identifica personajes ni garantiza una composición artística perfecta sobre todos los fondos; el editor permite corregir esos casos.

## Verificación

- `npm run verify`: comprobaciones y compilación de producción.
- `node scripts/check-logo-sizing.mjs`: migración al cálculo por contenido, dimensiones oficiales, ajustes nativos, perfiles existentes y protección ante trabajo obsoleto.
- `node scripts/check-logo-layout-browser.mjs`: procesamiento real en Chromium del PNG instalado de GTA IV (1280×720, contenido visible 603×598); resultado 651×646 incluyendo margen. Prueba de encaje, editor, cancelación sin escrituras, guardado y aislamiento entre fondos. Requiere Playwright/Edge; admite PLAYWRIGHT_MODULE_PATH.
- `python scripts/check-logo-layout-backend.py`: lectura de la pareja instalada desde la cuenta activa, rechazo de IDs nativos/rutas y ausencia de cuenta; Lua real con host simulado. Requiere lupa.

Las pruebas del editor simulan las llamadas de Steam. Falta confirmar visualmente la composición final en el cliente después de reiniciar. No se modificaron los archivos de juegos durante estas pruebas.

Incluye FIX1–FIX10. Cambios locales, no publicados en GitHub.
