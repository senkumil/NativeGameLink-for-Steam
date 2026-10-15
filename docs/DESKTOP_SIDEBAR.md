# Columnas de la biblioteca de escritorio

`frontend/features/library/sidebar-order.ts` coordina exclusivamente los bloques
de NativeGameLink de un acceso directo vinculado. La autorización incluye
Document, columna, AppID del acceso directo, AppID oficial, generación y ruta
actual; dos accesos directos con los mismos metadatos no comparten autorización.

El orden procede de la composición AppDetails del cliente instalado
(`steamui/sp.js`, módulo 43257): Control, contenido incluido en suscripciones,
Amigos, contenido adicional, Logros, Notas, Cromos, DLC, Workshop, grabaciones y
capturas, reseña. Los bloques históricos propios preceden a Control y los logros
externos siguen a Logros. Las grabaciones y capturas comparten la sección Media.

Los elementos que administra Steam mantienen sus nodos, contenido y orden
relativo. Se identifican por el SeekTarget comprometido, con títulos localizados
como alternativa. Una sección desconocida conserva su posición nativa. El
coordinador inserta únicamente los nodos propios entre esos elementos.

Las actualizaciones de metadatos del mismo acceso directo conservan los bloques
existentes, imágenes, foco e interacciones. Actividad y el sidebar conocido se
publican en el primer commit de columnas nativas, sin esperar el logo ni el aviso
del acceso directo. El observador nativo de artwork también reintenta ese commit
liviano mientras sus imágenes cargan; la barrera de imágenes se reserva para el
trabajo pesado. Control se publica antes del primer frame junto con Logros; su
observador de recuperación vigila solamente la columna actual. Los cambios de
dispositivos utilizan las suscripciones de Steam.

Amigos, DLC y Cromos capturan la autorización antes de cualquier espera y la
comprueban al publicar. Un resultado pendiente no borra información conocida.
Un resultado vacío confirmado elimina únicamente el bloque propio; los bloques
retirados no se resucitan desde el observador. La salida de ruta desconecta los
observadores y cancela frames pendientes.

La separación inferior de enlaces se obtiene de los márgenes de las envolturas
nativas y mantiene el padding responsive de ColumnContainer. El CSS instalado
actualmente produce 36 px de margen después de la superficie de enlaces y 10 px
del contenedor de columnas: 46 px hasta los encabezados en ambas columnas. No se
aplica un desplazamiento individual a Control, Logros o Actividad.

Validación: `npm run check:desktop-sidebar`. Incluye el renderizador real y CSS
instalado, secciones dinámicas, conexión/desconexión del control, navegación
rápida, accesos directos hermanos, respuestas obsoletas, actualizaciones sin
desmontar bloques y tamaños/escalas comparados con una referencia nativa.
Las rutas, servicios y dispositivos son simulados; no escribe logros ni datos
de la cuenta. La comprobación visual final debe hacerse en el cliente Steam.
