# Transiciones y Tus cosas — 18 de octubre de 2026

La referencia de esta revisión es el cliente Steam instalado: sus componentes,
estilos y transiciones de GamepadUI, además de las vistas previas guardadas por
Steam para juegos nativos. No se añade una animación paralela al shell de Steam.

## Transiciones

El panel saliente conserva una copia visual inerte durante la animación nativa.
La única raíz React activa se transfiere al panel entrante al confirmarse su
montaje, antes de pintar. La copia no conserva acciones, identidad de propietario,
IDs duplicados ni reproductores activos; se retira con el panel o al descargar
la sesión. La navegación rápida también debe conservar esa raíz cuando Steam
desconecta temporalmente un panel durante el cambio.

## Vista previa de logros

- Hasta 12 conseguidos y 12 bloqueados visibles por fila, igual que los vectores
  de vista previa de Steam. Los bloqueados ocultos no se revelan en la fila.
- Conseguido más reciente primero; bloqueados por porcentaje mundial descendente.
  Los empates conservan el orden del esquema cuando está disponible.
- El orden se conserva desde el esquema nativo o la respuesta de metadatos hasta
  el snapshot persistente. Los esquemas anteriores siguen disponibles como
  alternativa durante un fallo de red.
- El progreso utiliza el relleno y los textos nativos. Los iconos conservan la
  geometría nativa de la fila prioritaria y la secundaria, el recorte y el foco.
- El límite afecta únicamente a la vista previa. Abrir un logro conserva la
  lista completa de la instalación, sin recortar su progreso ni sus datos.
- La precarga utiliza exactamente la misma selección de iconos que la fila.

## Resto de Tus cosas

El inventario confirmado utiliza el componente de tarjetas de Steam, con sus
filas de poseídas y faltantes, tamaños, atenuación, insignia y recuentos. Un
catálogo público sin inventario confirmado no declara una insignia conseguida,
experiencia ni tarjetas restantes inventadas. La presentación del escritorio
permanece independiente.
Una sección sin tarjetas se oculta al terminar la carga; el lector nativo
permanece activo para mostrar datos que lleguen después.

Los componentes personales conservan la identidad real del acceso directo:
las notas utilizan su nombre local, y la galería recibe su GameID de 64 bits.
Los enlaces públicos de DLC y comunidad conservan la identidad oficial.

## Comprobaciones

Las pruebas ejecutan los componentes y CSS del Steam instalado con React de esa
misma versión. La comparación de logros cubre anchos lógicos de 680, 1160 y 1452,
escalas de 0,8, 1 y 1,135, ambas prioridades de fila, recorte, desplazamiento y
apertura de los 50 logros de una lista cuya vista previa está limitada.

Las pruebas de tarjetas ejecutan el componente nativo y comparan inventario,
insignia, tarjetas normales de 100 px y faltantes de 85 px. La transición se
verifica con el componente de transición instalado, cambios rápidos, aislamiento
de juegos nativos y retirada de recursos.

Resultados: 163 comprobaciones de integración, incluidos 20 cambios rápidos con
la transición instalada; 74 de carruseles y vista previa; 40 de propiedad de
paneles; 38 de tarjetas; 60 de metadatos Lua y 4 del fixture público; 37 de
identidad y persistencia de caché. La verificación general está en
`logs/transitions-stuff-verification.log` y la regresión final de Big Picture
en `logs/transitions-stuff-final-bp.log`.

En Steam real, DRAGON BALL: Sparking! ZERO conserva el total 32/50 y muestra
12 conseguidos y 6 bloqueados visibles; los demás pendientes son ocultos.
Se recorrieron las cuatro pestañas con la compilación de esta revisión.
