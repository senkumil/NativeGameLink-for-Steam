# FIX12 — Big Picture: pestañas e información nativa

Se inspeccionó el componente de Información del juego de la versión de Steam instalada. Consulta `BIsModOrShortcut`, `GetDescriptions` y `GetAssociations`; estos últimos leen `descriptionsData` y `associationData` del AppDetailsStore.

## Corrección

- El puente permanece estable durante la visita a la ficha vinculada, en lugar de desactivarse y reactivarse en cada cambio de pestaña.
- No modifica `app_type` ni `BIsShortcut` desde el puente de Información. Solo ajusta el predicado de presentación `BIsModOrShortcut`, restaurándolo al salir.
- Ya no devuelve el registro completo del juego oficial en sustitución del acceso. Conserva el ID, las imágenes personalizadas y los demás campos del registro original.
- Las lecturas y escrituras de imágenes siguen llegando al objeto real de Steam. Los metadatos de presentación se añaden mediante una vista estable, también alternando IDs con y sin signo.
- Completa las descripciones y asociaciones de desarrolladores, editores y franquicias con los metadatos disponibles del AppID vinculado. No convierte soporte de mando en certificación Steam Deck.
- Se conserva el componente nativo de Información y su navegación. No se añade una tarjeta que lo imite.
- Al salir se cancelan redibujados pendientes y se restaura GetAppData cuando el parche sigue siendo propiedad del plugin.

## Pruebas

`npm run verify` pasó. Tras el último ajuste de estabilidad de caché se repitieron la prueba específica, tipos, compilación y revisión del bundle.

`node scripts/check-bp-native-info.mjs` ejecuta el módulo real con el host simulado: 20 activaciones consecutivas del mismo juego producen un solo redibujado inicial; los métodos nativos obtienen descripción y desarrollador; las imágenes se mantienen y las escrituras llegan al store original; los juegos Steam nativos no se alteran; la salida restaura funciones y cancela timers.

No se ha confirmado visualmente el resultado en el cliente vivo. Reiniciar Steam carga FIX12. La información mostrada depende de los metadatos que existan para cada juego. El modo que desactiva las mejoras de Big Picture conserva su comportamiento anterior.

Incluye FIX1–FIX11. Cambios locales, sin publicación en GitHub.
