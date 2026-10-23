# NativeGameLink for Steam v5.0.0

Lanzamiento oficial · 23 de octubre de 2026

La versión 5.0 mejora la integración visual con Steam, la fiabilidad de la vinculación, la organización de Propiedades y las preferencias locales de tarjetas e insignias, tanto en escritorio como en Big Picture.

## Biblioteca y Propiedades

- Reorganiza Propiedades en cuatro grupos compactos y desplegables: juego vinculado, inicio y tiempo de juego, logros, y tarjetas e insignias.
- Mantiene la identidad del juego realmente vinculado mientras revisas otro candidato, elimina la miniatura duplicada y mejora el uso con teclado y ventanas estrechas.
- Oculta la configuración de tarjetas e insignias cuando el catálogo completo confirma que el juego no tiene ninguna. Los errores y catálogos parciales conservan la posibilidad de reintentar.
- Conserva la cuadrícula, las dimensiones y las filas alineadas de Steam en Comunidad. Prioriza al inicio vídeos, guías e imágenes de proporciones normales cuando hay disponibles; deja retratos y panorámicas para después. Los vídeos ocupan una celda y permiten contenido a su lado.
- Corrige la separación entre Actividad y Comunidad, el pie y el editor de actividad, y elimina una capa de fondo adicional de Logros y Control.
- Mejora el panel Información, los iconos de características, los enlaces adaptables y su menú, el botón de volver arriba, las medidas de Logros y el reparto de espacio en la barra superior.
- Recupera los estilos nativos en un arranque en frío y las secciones laterales cuando Steam reemplaza sus nodos.

## Tarjetas e insignias

- Añade preferencias por acceso directo para colecciones normales/foil, tarjetas individuales y niveles de insignia, compartidas entre escritorio y Big Picture.
- Prioriza las definiciones nativas de Steam y usa catálogos públicos como alternativa progresiva. Tarjetas e insignias cargan por separado y conservan los datos conocidos ante respuestas parciales o fallos temporales.
- Corrige la identificación normal/foil, la paginación, los duplicados y los falsos catálogos vacíos causados por páginas de inicio de sesión o verificación.
- Aísla las preferencias por acceso directo y AppID vinculado, ordena los guardados, rechaza respuestas antiguas y sincroniza los cambios confirmados entre ventanas.
- Mejora la ampliación, inclinación, iluminación, presentación foil, textos de insignias, imágenes fallidas y tooltips ajustados al espacio disponible.

Estas preferencias cambian la presentación local. No añaden objetos al inventario, EXP ni propiedad de juegos a la cuenta de Steam.

## Vinculación, detección y recuperación

- Muestra la ruta completa del ejecutable y utiliza el ejecutable, directorio de trabajo y argumentos del acceso directo seleccionado. Respeta los argumentos vacíos explícitos.
- Mejora la normalización de títulos, nombres de ejecutables concatenados, Unicode, años, ediciones y distinción entre secuelas. Descarta candidatos inválidos antes de ordenarlos y evita presentar resultados no confirmados como definitivos.
- Inicia pronto la detección local, limita las esperas de red, recupera resultados locales tardíos válidos y conserva candidatos al reintentar el mismo juego.
- Confirma nombre, ejecutable e ID regenerado antes de terminar; recupera trabajos interrumpidos y diferencia cancelación y éxito.
- Permite terminar un vínculo confirmado aunque falten imágenes opcionales y reintenta esos recursos en segundo plano.
- Protege las escrituras de imágenes, iconos, logos y renombrados frente a trabajos vencidos y ciclos de desvinculación/revinculación para que un trabajo antiguo no sobrescriba el nuevo vínculo.
- Protege y restaura el contenido previo de `steam_appid.txt`, informa de conflictos y permite recuperar una restauración fallida.
- Encuentra los almacenes de imágenes nativos por sus capacidades, sin depender de números internos fijos; admite IDs signed/unsigned y utiliza la ventana propietaria correcta.

## Logros, Big Picture y recursos

- Evita que el deslizador de logros retroceda por consultas o confirmaciones antiguas; sincroniza la última selección entre Propiedades y Biblioteca y restaura el estado anterior si falla el guardado.
- Mejora las medidas del panel y la ventana de logros al cambiar ancho o zoom, conservando el orden del esquema y el tratamiento de logros ocultos.
- Mejora las transiciones de pestañas de Big Picture, el foco del mando, la recuperación del teclado virtual, la identidad de notas/capturas y la presentación del tiempo de juego.
- Conserva los catálogos de tarjetas durante la carga parcial en Big Picture y muestra estados de carga, error y reintento de preferencias.
- Libera observadores, eventos, reintentos y recursos de cada documento al desmontarlo; limita las cachés retiradas del backend y cancela correctamente el arranque tardío de herramientas auxiliares.

Este lanzamiento mayor también incluye la integración de Big Picture preparada antes del periodo de fixes del 19 al 23 de octubre; el inventario semanal identifica ese trabajo anterior por separado.

## Descarga e instalación

1. Instala Millennium para Steam.
2. Descarga **`NativeGameLinkForSteam-v5.0.0-CLEAN-INSTALL.zip`**.
3. Copia la carpeta incluida **`NativeGameLinkForSteam`** en `millennium/plugins/` de la instalación de Steam que utilizas.
4. Reinicia Steam y activa el complemento en Millennium.

**`NativeGameLinkForSteam-v5.0.0-SOURCE.zip`** incluye código fuente, pruebas y herramientas de lanzamiento. **`SHA256SUMS.txt`** permite comprobar las descargas de ambos ZIP.

Consulta el [changelog](https://github.com/senkumil/NativeGameLink-for-Steam/blob/v5.0.0/CHANGELOG.md), las [notas en inglés](https://github.com/senkumil/NativeGameLink-for-Steam/blob/v5.0.0/RELEASE_NOTES.md) y el [inventario completo de fixes de esta semana](https://github.com/senkumil/NativeGameLink-for-Steam/blob/v5.0.0/WEEKLY_FIXES.md). El inventario separa los commits del 19 al 23 de octubre de los cambios locales adicionales incluidos en esta versión.
