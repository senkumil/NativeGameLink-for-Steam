# Fixes de la semana y preparación de v5.0.0

Periodo revisado: **19–23 de octubre de 2026**, zona horaria America/Bogota (UTC−05:00).

Este inventario combina el historial Git de la semana y la revisión del árbol de trabajo preparado para v5.0.0. Los cambios locales todavía no tienen un commit que permita atribuirles una fecha exacta. Las notas de la versión también incluyen trabajo previo de Big Picture; ese trabajo se identifica al final y no se cuenta como realizado esta semana.

## 1. Fixes confirmados por commits de esta semana

### 19 de octubre — integración visual nativa

Commit [`91adf0c`](https://github.com/senkumil/NativeGameLink-for-Steam/commit/91adf0c697f7d21c9efe4ada2d37c4a7386b496f) · `fix: match native Steam scroll-to-top button timing and icon`

- El botón de volver arriba usa el icono y la transición del encabezado fijo de Steam, con etiquetas localizadas.
- El panel Información respeta la portada 2:3, el ancho real del panel, sus columnas y el escalado del cliente, evitando aplicar el zoom dos veces.
- Los iconos de características y Steam Input se ajustan a la presentación nativa.
- Los enlaces principales se adaptan al ancho lógico y al zoom; su menú de desbordamiento conserva la navegación.
- Actividad distingue parches compactos (tipo 12), actualizaciones (13) y actualizaciones importantes (14), con estructura, etiquetas, glifo y resumen ajustados al espacio disponible.
- Los mosaicos de logros se distribuyen según el ancho real y mantienen el indicador de elementos adicionales; la ventana de logros evita desbordarse al cambiar tamaño o zoom.
- La barra de juego respeta las reglas nativas de visibilidad de Cloud/tiempo de juego y reserva espacio para Información y Logros.

Fuentes principales: `frontend/features/library/info-panel.ts`, `primary-links.ts`, `social/feed.ts`, `activity-summary.ts`, `frontend/features/achievements/sidebar.ts`, `modal.ts`, `frontend/steam/playbar-visibility.ts`.

### 19 de octubre — vinculación y recursos que podían quedarse esperando

Commit [`67af232`](https://github.com/senkumil/NativeGameLink-for-Steam/commit/67af232368cb664677c4cf5e0835abb648730efa) · `fix: prevent stalled game linking and display the full game path`

- La identidad local y los metadatos avanzan en paralelo; se prioriza el registro real de la ventana propietaria y se limita la espera de `shortcuts.vdf`.
- Las peticiones remotas de detección comparten un presupuesto total de espera; las respuestas parciales pueden reintentarse.
- La descarga de imágenes, iconos y logos limita cabeceras, cuerpo y decodificación dentro del plazo del trabajo.
- Las escrituras tienen controles de generación y vencimiento, siguen las operaciones IPC reales y evitan sobrescrituras tardías después de desvincular o revincular.
- Se mejora la recuperación de recursos temporales y la limpieza de formatos de imagen, incluido `.webp`.

Fuentes principales: `frontend/features/shortcuts/link-orchestrator.ts`, `manual-link.ts`, `frontend/features/library/artwork.ts`, `native-asset-write.ts`, `native-logo-position.ts`, `shortcut-icon.ts`, `backend/lib/shortcut_detection.lua`.

### 20 de octubre — identidad correcta y recuperación de vinculación

Commit [`b982959`](https://github.com/senkumil/NativeGameLink-for-Steam/commit/b98295986acb26f8730af538748df5f89b877648) · `fix: prevent stalled game linking and display the full game path`

Aunque comparte título con el commit anterior, contiene correcciones distintas:

- La revisión muestra la ruta completa y seleccionable del ejecutable y presenta resultados locales antes de esperar la red.
- La detección utiliza `GetAppDetails`/`RegisterForAppDetails` del acceso directo real: ejecutable, directorio de trabajo y argumentos, incluidos argumentos deliberadamente vacíos.
- Al añadir un juego externo se captura la selección, el nombre y el ejecutable correctos; no se reutiliza el juego que estaba abierto en Biblioteca ni se confunden accesos del mismo nombre.
- Se respetan las selecciones desmarcadas en el diálogo de Steam y se recuperan rutas truncadas cuando existe evidencia local completa.
- Después de renombrar se confirma nombre/ejecutable y se recupera el ID regenerado antes de guardar recursos y mostrar el resultado final.
- La cola recupera trabajos interrumpidos, diferencia cancelación y finalización y evita mostrar un estado listo antes de completar las fases obligatorias.
- Se protege `steam_appid.txt` antes de terminar el vínculo y se espera su restauración al desvincular, preservando contenido previo y copias existentes e informando de conflictos o permisos.
- El manejo de rutas contempla comillas, Unicode, UNC y rutas Unix.
- El botón Información recupera sus clases nativas tras un arranque en frío sin recrear la sesión.

Fuentes principales: `frontend/features/shortcuts/manual-link-review.ts`, `detection.ts`, `link-job-queue.ts`, `link-orchestrator.ts`, `frontend/steam/shortcut-details.ts`, `backend/lib/util.lua`.

Los commits `132e248` (merge) y `84ca411` (eliminación de documentación) también son de esta semana; no se cuentan como nuevos fixes funcionales.

## 2. Cambios locales adicionales incluidos en v5.0.0

Estos cambios están presentes en el código preparado para el lanzamiento. Su fecha individual no puede confirmarse con Git hasta que se registren en un commit. Se distinguen mejoras nuevas de correcciones cuando corresponde.

### Propiedades y configuración

- **Mejora:** cuatro grupos desplegables —juego vinculado, inicio y tiempo de juego, logros, tarjetas e insignias— con diseño compacto, adaptación al ancho y acceso por teclado.
- El resumen conserva la identidad confirmada aunque se seleccione otro candidato para revisión.
- Se elimina la miniatura seleccionada duplicada en la tira de candidatos.
- La búsqueda fallida se puede reintentar desde Propiedades y sigue permitiendo introducir un AppID manual.
- Tarjetas e insignias se ocultan sólo cuando los catálogos completos confirman que no existen tarjetas normales, foil ni insignias; las respuestas incompletas o fallidas conservan recuperación.
- La restauración fallida de `steam_appid.txt` ofrece un reintento explícito.

Fuentes: `frontend/features/shortcuts/properties.ts`, `properties-style.ts`, `properties-summary.ts`, `properties-detection.ts`, `community-item-properties.ts`.

### Comunidad, Actividad y estilo nativo

- La corrección de Comunidad se aplica globalmente a todos los juegos vinculados, sin excepciones por AppID.
- Se conserva la cuadrícula de Steam con filas alineadas y dimensiones nativas. Se priorizan vídeos, guías e imágenes de proporciones normales al inicio cuando están disponibles; retratos y panorámicas pasan a posiciones posteriores.
- Los vídeos ocupan una celda de la cuadrícula en lugar de expandirse para rellenar el ancho. Los huecos se completan con el primer contenido que encaja.
- Se respeta el ancho disponible junto a la columna lateral y el ancho completo debajo; el encabezado mantiene una separación de 16 px.
- Se conserva el iframe al redistribuir y se evita recolocar el vídeo activo al revelar más contenido.
- Actividad usa la estructura nativa de encabezado, cuerpo, editor y botón de noticias, con el pie final correcto y sin margen duplicado antes de Comunidad.
- El editor recupera altura, foco y estado al reutilizarse y mantiene borradores independientes por juego.
- Se elimina el desenfoque adicional de Logros y la segunda superficie translúcida de Control; Control conserva su fondo al hacer scroll.
- La sección de tarjetas se recupera cuando Steam reemplaza la columna lateral, sin reconstruir innecesariamente Actividad ni heredar opciones de otro juego.

Fuentes: `frontend/features/library/community-view.ts`, `styles/community.ts`, `activity-view.ts`, `activity-footer.ts`, `social/status.ts`, `mounted-sidebar.ts`, `renderer.ts`, `runtime.ts`, `styles/controller.ts`, `frontend/features/achievements/styles/sidebar.ts`.

### Tarjetas, insignias y persistencia

- **Mejora:** selección local de colección normal/foil, tarjetas individuales, colección completa/vacía y nivel de insignia, con opción de volver a los datos de Steam.
- Elegir una insignia máxima o foil completa su colección local; bloquear una tarjeta retira esa insignia local.
- Las definiciones nativas de Steam proporcionan ambos bordes y niveles aunque el inventario de la cuenta esté incompleto; el catálogo público queda como alternativa independiente.
- Tarjetas e insignias cargan progresivamente y por separado, sin esperar al catálogo completo para publicar los primeros resultados.
- La paginación valida desplazamiento, total, página vacía y estado de éxito; una página de inicio de sesión o verificación no se convierte en un catálogo vacío confirmado.
- La detección de foil usa metadatos independientes del idioma y conserva ambos conjuntos.
- Se eliminan duplicados y se retienen colecciones/selecciones conocidas frente a cargas parciales, timeouts o actualizaciones.
- Las preferencias se guardan atómicamente y se aíslan por acceso directo y AppID. No se heredan por parecido de nombre, por otro juego nativo ni por otra instalación.
- Los identificadores permanecen estables ante cambios de CDN, tamaño, rutas antiguas/nuevas y variantes foil.
- Los guardados se serializan; se descartan lecturas, confirmaciones y eventos antiguos; los cambios confirmados se sincronizan entre ventanas y se revierte la vista tras un fallo.
- Lecturas, cachés, eventos y reintentos tienen límites y se invalidan correctamente al cambiar idioma o contexto.
- Se mejora el aspecto de insignia/colección, navegación foil, ampliación, inclinación, iluminación y brillo de las tarjetas.
- Se corrige la salida del puntero y la recuperación de hover tras reemplazar nodos; una tarjeta vecina no captura la interacción de la ampliada.
- Las imágenes fallidas conservan el nombre visible; los tooltips respetan ventana/zoom y se desmontan al cerrar o hacer scroll.
- El restablecimiento de fábrica limpia estas preferencias y cachés.

Fuentes: `frontend/core/community-item-options.ts`, `frontend/steam/desktop/community-item-definitions.ts`, `frontend/features/library/community-items.ts`, `linked-card-presentation.ts`, `trading-cards.ts`, `trading-card-help.ts`, `backend/lib/community.lua`, `community_item_settings.lua`.

Las selecciones de esta sección sólo cambian la presentación local; no conceden objetos, insignias reales ni EXP a la cuenta.

### Detección, vinculación y recursos

- La normalización de títulos trata símbolos de marca y espacios especiales; identifica palabras y números en ejecutables concatenados y conserva Unicode, años, ediciones, remakes, remasters y secuelas.
- Los candidatos oficialmente rechazados se descartan antes de ordenar resultados; un tipo oficial no confirmado sigue siendo parcial y las ediciones con el mismo ejecutable no se dan por inequívocas.
- Los timeouts HTTP se convierten en enteros positivos para evitar que una fracción acabe como espera ilimitada en Lua.
- Se decodifican respuestas IPC anidadas, se recuperan resultados locales tardíos válidos dentro de su periodo permitido y se rechazan resultados de otro juego o contexto.
- Reintentar el mismo contexto conserva los candidatos anteriores; un resultado remoto vacío no es definitivo si la búsqueda local falló.
- Un vínculo confirmado termina aunque falten recursos opcionales; las imágenes se reparan en segundo plano y los cinco reintentos agotados no convierten el vínculo válido en un fallo permanente.
- Se recuperan trabajos antiguos marcados como sincronización de recursos incompleta.
- Al desvincular se cancela antes de esperar los bloqueos y se siguen las escrituras IPC reales de recursos y renombrado, incluso si el diálogo ya venció.
- La limpieza antigua comprueba si existe un vínculo nuevo antes de borrar; se elimina la limpieza global tardía lanzada sin seguimiento.
- Se restaura nombre/identidad por ejecutable y se gestiona el ID regenerado desde el documento propietario.
- Los almacenes nativos de imágenes se descubren por capacidades y documento, sin depender de IDs internos fijos; logos y warmup comparten el descubrimiento y admiten IDs signed/unsigned.
- El descubrimiento de clases CSS funciona sin ejecutar módulos nativos ajenos; el panel Información provisional se actualiza cuando las clases correctas están disponibles y mantiene su estado accesible.

Fuentes: `backend/lib/shortcut_detection*.lua`, `frontend/features/shortcuts/detection.ts`, `manual-link-review.ts`, `link-job-queue.ts`, `unlinking.ts`, `transaction.ts`, `frontend/features/library/native-artwork-stores.ts`, `native-logo-position.ts`, `frontend/steam/class-module-cache.ts`.

### Logros y Big Picture

- El deslizador de logros deja de retroceder por polling antiguo, carga inicial tardía o confirmaciones de guardado fuera de orden; prevalece la última selección.
- La vista previa se sincroniza entre Propiedades y Biblioteca, conserva el cero hasta cargar la fuente real y revierte de forma explícita si falla el guardado.
- Big Picture usa las mismas opciones de tarjetas por acceso directo y AppID, con el React del documento correspondiente.
- La hidratación parcial no borra un catálogo ya completo y los estados de carga/error/reintento no asumen una selección incorrecta.
- Las tarjetas cargadas o fallidas conservan semántica, foco y nombre; los enlaces foil utilizan el borde correcto y las suscripciones se liberan al navegar.

Fuentes: `frontend/features/shortcuts/achievement-properties.ts`, `frontend/features/achievements/service.ts`, `lifecycle.ts`, `frontend/features/big-picture/NativeBigPictureDetails.tsx`, `NativeBigPictureTradingCards.tsx`.

## 3. Trabajo anterior incluido en el lanzamiento mayor

El bloque de desarrollo de Big Picture fechado **18 de octubre de 2026** ya estaba en el changelog antes de esta preparación:

- Transiciones de pestañas con adopción antes del pintado; vista previa de logros con orden, ocultos, progreso y geometría nativos.
- Tarjetas nativas basadas en inventario confirmado, sin tratar catálogos desconocidos como ausencia.
- Notas bajo el nombre real del acceso directo y multimedia bajo su GameID de 64 bits.
- Recuperación del teclado virtual y del foco de mando; navegación desde el historial de la ventana propietaria.
- Tiempo de juego localizado en Home y actualización desde la ruta real de Big Picture.
- Limpieza de observadores, listeners, reintentos, animaciones y mantenimiento pendiente al desmontar.
- Cachés retiradas acotadas, errores/timeouts de herramientas auxiliares propagados, cancelación del arranque tardío y validación de IDs completos antes de acceder a archivos del logo.
- Pruebas de permanencia en Big Picture y de procesos/recursos del backend incorporadas a la verificación.

## 4. Preparación oficial de v5.0.0

- Sincronización de `package.json`, `package-lock.json`, `plugin.source.json` y `plugin.json` a **5.0.0**.
- Notas de lanzamiento en español e inglés, changelog y README actualizados.
- Paquetes separados de instalación y fuentes, con suma SHA-256 para cada ZIP.
- Empaquetado que excluye estado de usuario, secretos de entorno, logs, cachés y binarios temporales; conserva los archivos de lanzamiento anteriores y valida el destino antes de limpiar staging.
- Workflow de GitHub preparado para usar las notas explícitas de esta versión al crear la Release.

La preparación local no publica la Release ni sube commits o etiquetas a GitHub. Los resultados de las comprobaciones de esta preparación se entregan junto a los paquetes.
