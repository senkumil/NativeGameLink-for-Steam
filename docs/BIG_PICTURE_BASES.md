# Big Picture para juegos vinculados: implementación y aceptación

Estado: cuatro pestañas y flujos integrados, 14 de octubre de 2026.

Corrección del arranque vacío en Steam real: el bootstrap instalado expone
`require.m` y mantiene privada su caché, sin `require.c`. Se captura ese runtime
y se resuelven sólo exports de presentación identificados y estilos puros,
conservando la propiedad por documento. La ruta y el modo se consultan en el
`WindowInstance` exacto de Steam; no requieren globals del router ni clases CSS
legibles. `IsMainGamepadUIWindow()` distingue la ventana principal de overlays,
VR y teclado. Las pruebas iniciales sólo modelaban una caché pública y un router
global, por lo que no detectaban estas diferencias del cliente instalado.

La meta es la misma presentación y navegación que un juego nativo en la misma
versión de Steam, idioma, escala y resolución. La ruta recomendada es **conservar
el shell de Steam y alimentar componentes nativos mediante adaptadores locales
del acceso directo**, con una sola autoridad de foco. No hay que reconstruir
Big Picture como otra aplicación ni convertir el acceso directo en el juego
oficial dentro de todos los stores.

La implementación no certifica todavía una experiencia visual 1:1 ni una prueba
física con control dentro del cliente. La integración está activa para los
juegos vinculados sin un interruptor independiente en Ajustes. Las preferencias
antiguas de ese interruptor ya no desactivan el montaje de las pestañas.

## 1. Identidad y fuentes de verdad

| Dato/acción | Identidad que debe utilizar |
| --- | --- |
| Jugar, detener, propiedades, Steam Input/configuración del control | `shortcutAppId`, el acceso directo real |
| Progreso local, tiempo local, actividad local, capturas y notas locales | `shortcutAppId` y la instalación correspondiente |
| Nombre, descripciones, recursos oficiales, noticias, comunidad, rareza mundial | `steamAppId`, solo como fuente de metadatos |
| Ruta interna de detalle o de progreso personal | Acceso directo y contexto propietario; evitar rutas del juego oficial |
| Tienda y comunidad pública | URL oficial construida con `steamAppId` |
| Juegos Steam nativos | Sus objetos, rutas, estado y acciones originales |

La pareja `shortcutAppId:steamAppId` es indivisible. Dos accesos directos al mismo
juego oficial mantienen estados separados. Un título coincidente, un logotipo,
un elemento conectado al DOM o un atributo del plugin no prueban la identidad.

El vínculo debe estar confirmado en el registro, con snapshot verificado. La
normalización acepta el ID firmado de Steam y su equivalente uint32, y rechaza
decimales, desbordamientos y valores fuera de rango. Un AppID público pertenece
siempre a Steam, incluso si existe una entrada mal formada en los mappings.

El progreso del plugin y los porcentajes mundiales son fuentes distintas. No
convertir datos ausentes en porcentajes, desbloqueos, propiedad, certificación
Steam Deck ni estado real de sincronización de Cloud. La etiqueta fija de los
juegos vinculados se limita a la presentación descrita en la sección 4.
Mostrar una función oficial no
crea la licencia ni el servicio que requiere. El botón explícito de sincronizar
logros de cuenta permanece fuera de la carga/navegación de Big Picture.

## 2. Autoridad de una sesión

Antes de montar, proyectar, actuar o aplicar una respuesta asíncrona, comprobar:

1. `Document` vivo, conectado y aún igual a `window.document`.
2. Modo GamepadUI en ese documento, no solo una señal global de modo.
3. Ruta de detalle del acceso directo exacto en su propia ventana.
4. Vínculo confirmado y pareja shortcut/metadatos exacta.
5. Generación vigente de detalle, runtime y panel; idioma y pestaña pertinentes.
6. Propiedad del nodo, modal o proyección sobre el que se va a actuar.

La ruta actual tiene prioridad sobre los marcadores viejos. Home, biblioteca,
tienda, ajustes, un juego nativo o un shortcut sin vincular revocan la autoridad.
Las rutas de parent, top e iframes no identifican el juego de este documento.
Si falta evidencia, conservar la superficie Steam y esperar una señal válida.
Una heurística de título puede ayudar a presentar información; no autoriza
escrituras ni captura de entradas.

La base implementada reutiliza `GamepadContext.isCurrentLinkedGamepadTarget`,
la generación existente de `details.ts`, el registro de vínculos y el servicio
de modo. No añade un segundo registro global de juegos.

## 3. Qué conservar de Steam

Steam debe seguir siendo dueño del hero, botón de ejecución, ajustes, shell de
pestañas, historial de rutas, menú global, acceso rápido, overlays, teclado y
pie de acciones. Reutilizar sus componentes de sección, carrusel, diálogo,
foco y sus estilos resueltos en la ventana CEF propietaria.

Montar contenido en el panel de la pestaña correspondiente, con React/ReactDOM
y proveedores de navegación/configuración de esa misma ventana. Validar sus
capacidades en ejecución; un nombre minificado o una clase CSS no constituye
un contrato estable.

`native-info-bridge.ts` es una referencia útil: mantiene la identidad y artwork
del shortcut, ofrece una vista enriquecida acotada y devuelve los datos
originales ante una consulta ajena. Extender ese patrón por sección, manteniendo
lecturas nativas actuales y rollback. No depender de un `force rerender` de toda
la ventana para completar cada recurso o mover el foco.

Si faltan capacidades, el fallback afecta solo esa sección y no cuenta como
paridad 1:1. Los hermanos del panel nativo se ocultan después del commit real de
React, verificando pestaña, panel, pareja y generación. Un commit tardío no
oculta la superficie de otra sesión. Las acciones de hijos nativos también se
bloquean mientras una nueva vista está pendiente o la ruta ya cambió.

## 4. Una sola autoridad de navegación

La selección debe ser explícita por sesión/panel:

| Autoridad | Condición | Comportamiento |
| --- | --- | --- |
| `native` | Proveedores Steam vigentes y `navRef` propio registrado en su árbol y documento | Steam procesa entradas, scroll, sonidos, glyphs y regreso de modales |
| `fallback` | Árbol nativo no disponible, panel propio y sesión válida | Navegación local limitada al contenido propietario |
| `none` | Ruta ajena, sesión inválida o modal ajeno activo | Ninguna captura ni acción del plugin |

El objetivo es que `native` sea la ruta normal. No ejecutar simultáneamente
`keydown`/polling del plugin y el árbol de foco de Steam sobre el mismo control.
Una pulsación debe producir una sola acción. Un modal de Steam debe suspender
el fallback; nunca retirarlo con `remove()` ni activar sus botones por heurística.

El contexto se descubre por el contrato del módulo de navegación, sin fijar un
ID minificado. Se leen los proveedores del fiber confirmado de Steam y se
conservan sus valores de árbol activo, ventana, gestor e instancia propietaria.
También se conserva el contexto del anillo de foco: su valor predeterminado es
un conjunto de callbacks vacíos y deja la selección sin indicador visible.
El nodo padre por sí solo no concede autoridad: el `navRef` añadido debe
pertenecer a ese padre, estar montado dentro del panel y usar su mismo árbol.
Mientras se registra, la autoridad es `none`. Desde la pestaña seleccionada,
Abajo/A entrega el foco al nodo registrado; B solicita el foco nativo de la
pestaña. Una acción sin manejar devuelve `false` para permitir que Steam continúe.

Las estadísticas de cabecera usan el tiempo confirmado del shortcut y sus
clases nativas, en orden última sesión, tiempo y control. Se retiran al abandonar
su ruta. Para los juegos vinculados se muestra una fila fija «Steam Cloud:
Actualizado», con el icono y las clases del cliente. Es presentación del vínculo;
no escribe flags Cloud ni añade sincronización de archivos. La fila auténtica
de Steam tiene prioridad y los juegos nativos conservan su comportamiento.

Contrato de interacción a validar en cada sección:

| Entrada | Resultado esperado |
| --- | --- |
| Cruceta/stick y flechas | Vecino correcto, scroll nativo, sin saltar filas ni enfocar controles deshabilitados |
| A / Enter | Una selección o apertura |
| B / Esc | Cierra el nivel superior propio o vuelve mediante Steam; restaura el foco anterior |
| LB/RB | Cambia una pestaña, conserva su estado y actualiza el foco |
| X/Y y menú | Solo las acciones expuestas por esa superficie nativa; hints coincidentes |
| Entrada de texto | Teclado nativo, edición sin captura de flechas y cierre sin acciones fantasma |
| Conectar/desconectar control | Cambia glyphs/disponibilidad sin remontar toda la página ni perder foco |

No asumir el mismo número de botón o símbolo para Xbox y DualSense. Reutilizar
las acciones y glyphs del cliente para navegación del cliente. La documentación
de [Steam Input](https://partner.steamgames.com/doc/features/steam_controller/getting_started_for_devs)
describe acciones y glyphs para juegos; no documenta un API público para montar
paneles React dentro de Big Picture.

## 5. Proyecciones y limpieza

Usar vistas/adaptadores limitados al shortcut. Preferir una proyección reversible
o proxy a mutar objetos compartidos. Cada cambio registra objeto, propietario,
valor original y valor instalado. Al salir, restaurar solo lo que todavía es
propiedad del plugin: una actualización posterior de Steam tiene prioridad.

La sesión debe liberar React roots, providers, listeners de pestañas y control,
timers, observers, polling, anillos de foco, ventanas propias y proyecciones.
Invalidar la generación antes del desmontaje. Un callback de una sesión vieja
no recupera autoridad aunque se vuelva al mismo acceso directo.

Los paneles conservan exactamente `hidden`, valor/prioridad de `display`,
`aria-hidden` y marcadores previos. No desocultar un nodo solo porque tenga un
atributo parecido al del plugin. No reinsertar nodos retirados por Steam.

## 6. Implementación integrada

| Área | Cambio y prueba de regresión |
| --- | --- |
| Contexto/ruta | Ruta propietaria antes de marcadores; AppIDs públicos protegidos; IDs estrictos y vínculo confirmado. `check-big-picture-foundation.mjs` |
| Arranque real | Ruta desde `WindowStore.GetWindowInstanceFromWindow` y modo principal nativo, con shell y CSS genéricos. Runtime con factories y caché privada, sin ejecutar módulos de cuenta ajenos. `check-bp-native-window-route.mjs`, `check-webpack-private-cache.mjs`, `check-ui-mode-runtime.mjs`, `check-bp-details-integration-browser.mjs` |
| Hidratación | Resultados limitados a ruta, pareja, modo y generación. El contador de recursos termina la carga incluso sin datos; respuestas retiradas no remontan. `check-bp-details-integration-browser.mjs` |
| Runtime y stores | Caches por documento/runtime; React, ReactDOM, UI, modales y stores del propietario. Reemplazar una ventana no restaura ni limpia otra. `check-bp-component-realms.mjs`, `check-bp-realm-adapters.mjs`, `check-gamepad-runtime-lifecycle.mjs` |
| Montaje y paneles | Ocultación tras commit; snapshot exacto de atributos y estilos; restauración que conserva cambios posteriores de Steam. `check-bp-panel-ownership-browser.mjs`, `check-bp-details-integration-browser.mjs` |
| Navegación | Autoridad exclusiva nativa/fallback/ninguna; proveedores renovados; X/Y semánticos; edición de texto, modales ajenos y pulsaciones sostenidas. `check-bp-input-runtime-browser.mjs`, `check-bp-native-navigation-lifecycle.mjs`, `check-bp-navigation-ownership.mjs` |
| Tus cosas y logros | Capturas/notas consultan el shortcut. Flujo personal/mundial, búsqueda, porcentajes reales, detalles ocultos, scroll y regreso. `check-bp-achievements-workflow-browser.mjs`, `check-achievement-state-ownership.mjs` |
| Actividad y comunidad | Feed del shortcut, noticias y contenido público del AppID oficial; imágenes/vídeos/noticias en modales propietarios. `check-bp-details-integration-browser.mjs` |
| Modales | Cierre por handle propietario, liberación de backdrop/observers y regreso del foco; B/Esc conserva diálogos Steam ajenos. `check-bp-owned-modals-browser.mjs` |
| Información | Vista local del shortcut, descripciones actualizadas, enlaces públicos explícitos y colecciones reales del shortcut. No se invoca el helper de enlaces que consulta badges de cuenta del AppID público. `check-bp-details-integration-browser.mjs`, `check-bp-native-info.mjs` |
| Tiempo y control | Sólo tiempo medido en el overview local exacto; glyph genérico cuando no hay compatibilidad conocida; roots de control ligados a documento/renderer/generación. `check-bp-overview-ownership.mjs`, `check-bp-controller-roots-browser.mjs` |
| Juegos nativos | Sin cambios de clasificación, instalación, certificación o prototipos compartidos; consultas y acciones ajenas conservadas. `check-native-achievement-isolation.mjs` |

Las pruebas ejecutan código de producción con fixtures. Los flujos de navegador
usan React/ReactDOM de la instalación de Steam y componentes puros disponibles;
los servicios de cuenta/red y componentes complejos se sustituyen por sondas
controladas. No modifican logros oficiales y no sustituyen el cliente completo
ni una prueba física con control.

## 7. Estado de las fases

| Fase | Trabajo concreto | Estado |
| --- | --- | --- |
| 0. Aislamiento | Rutas nativas rechazadas, respuestas viejas inertes y rollback exacto | Integrado y verificado con fixtures |
| 1. Datos/runtime | Caches por ventana, stores con `doc`, vistas locales y retirada de flags forzados | Integrado y verificado con dos realms |
| 2. Montaje/foco | Commit real, proveedores vigentes, autoridad exclusiva y recursos con disposer | Integrado y verificado con cambios repetidos de panel/generación |
| 3. Logros | **Tus cosas → logros → mis/mundiales → volver**, con identidad del shortcut | Integrado y verificado con aperturas/cierres, filtros y foco |
| 4. Pestañas | Actividad/noticias, comunidad/medios, información, amigos, notas y recursos disponibles | Integrado y verificado en el flujo de cuatro pestañas |
| 5. Certificación | Comparaciones contra Steam nativo, controles y resoluciones reales | Pendiente de validación física y visual; mejoras optativas |

Al ampliar funciones, conservar el flujo completo de datos, foco, acción, modal
y regreso. Las capacidades se resuelven en ejecución; un fallback acotado debe
seguir funcionando si una actualización de Steam retira un export interno.

## 8. Límites de datos y validación

La vinculación aporta metadatos públicos y el estado local disponible. No crea
Steam Cloud, propiedad de cromos/DLC, soporte de mando, certificación Deck ni
progreso oficial. Los datos ausentes permanecen ausentes; la rareza desconocida
se muestra como `—`. Las capturas personales y notas usan el shortcut; las
imágenes promocionales de la tienda son contenido público. Si falta el componente
de capturas personal, el fallback abre la carpeta de capturas del acceso directo
mediante Steam. El catálogo de cromos no afirma posesión ni presenta una insignia
adquirida sin datos de inventario.

La información del juego utiliza componentes locales y enlaces nativos con URL
explícita. Se excluyen helpers que mezclan esa presentación con consultas de
cuenta del AppID oficial. Las colecciones conservan sus objetos y destinos reales.

La ficha, los enlaces y las tarjetas de colecciones se resuelven por los contratos
del bundle instalado cuando cambian los identificadores de módulo. La vista conserva
los métodos de artwork del shortcut incluso en ventanas sin stores globales. Las
categorías oficiales alimentan los iconos y textos localizados del componente nativo;
no se enumeran como etiquetas inglesas ni se duplican las variantes del control.
`check-bp-information-components.mjs` verifica esos contratos, la identidad del
artwork y la ausencia de escrituras en los registros reales.

Quedan por comprobar en Steam real: geometría 1:1, pie de acciones y glyphs de
cada dispositivo, hotplug, teclado virtual, overlays y consumo sostenido de RAM.
La suite prueba limpieza de recursos, pero no equivale a una medición de memoria
de `steamwebhelper` en una sesión física. Registrar cualquier fallback observado
en la matriz y no contarlo como paridad certificada.

## 9. Matriz de aceptación

El propietario y el modo se obtienen mediante `steam/native-window-store.ts`, que
resuelve el WindowStore por su API y valida que `BrowserWindow` sea la ventana
del Document solicitado. Los números de módulos Webpack no son un
contrato: el cliente instalado cambió el identificador del UIStore y produjo un
contexto vinculado cuya ruta no podía autorizarse. Las pruebas de ventana derivan
el módulo y la consulta pura del bundle instalado; no deben fabricar un número
fijo ni sustituir esta autorización por títulos. La navegación a logros y el
teclado virtual utilizan el mismo propietario. Un bootstrap tardío se vuelve a
sondear de forma acotada.

Steam también crea ventanas mediante `document.write` y `ReactDOM.createPortal`
desde su SharedJSContext. La ventana visible puede tener solo `/index.html`,
sin Webpack, React ni router global propios. En ese caso el WindowStore del
contexto original debe demostrar que el `BrowserWindow` solicitado es suyo,
antes de autorizar su runtime compartido para ese Document. Esa autorización
se revisa en cada acceso y `require` retenido; un cierre, reemplazo de Document,
retirada del propietario o cambio del runtime fuente la revoca. La ruta usada
sigue siendo la del WindowInstance exacto del popup, nunca la ruta ni la ventana
activa del contexto compartido. Un CEF con runtime independiente conserva el suyo.

La ruta también puede publicarse en el `tempNavStore` del propio Document: el
router de Big Picture actualiza `m_history` y `m_locationPathname`, mientras la
URL del navegador permanece en la pantalla contenedora. `GamepadContext` lee
esa ruta local; no consulta el historial de otra ventana ni autoriza por el
título. El oráculo extrae `UpdateRoutingInfo` del Steam instalado y comprueba
una navegación que solo dispone de ese contrato. La integración cubre montaje
de Actividad con URL y WindowInstance todavía en sus rutas contenedoras. Si la
autorización falla, el registro indica el vínculo, la verificación y las rutas
sin parámetros de URL, en lugar de un mensaje genérico de espera.

Usar un acceso directo vinculado A, uno B con el mismo AppID oficial pero distinto
estado, otro sin vínculo y un juego Steam nativo. Comparar plugin apagado/encendido
y mejoras apagadas/encendidas, sin modificar logros oficiales durante las pruebas.

- 100 cambios A → nativo → B → Home; incluir respuestas de red fuera de orden,
  pérdida temporal de contexto, re-vinculación y recursos ausentes.
- 20 entradas/salidas Desktop ↔ Big Picture, reload de CEF, cierre de ventana,
  unload del plugin y Steam actualizando sus propios modelos durante una proyección.
- Xbox, DualSense, teclado y ratón; hotplug; pulsación sostenida; ventana Steam
  ajena encima; teclado virtual; cierre/regreso de cada modal.
- 720p/1080p/1440p, escala e idioma de referencia; comparar spacing, fuentes,
  artwork, estados de foco, scroll, pies de acciones y tiempos de primera pintura.
- Medir baseline de RAM/CPU/listeners y después de volver a reposo. La cantidad de
  roots, listeners y timers no debe crecer por visita; el foco no puede quedar en
  nodos desconectados. Registrar número/build de Steam y Millennium usados.
- En juegos nativos: mismos datos, objetos públicos, decisiones instalar/jugar,
  rutas, botones, modales, logros, controles y notificaciones que en el baseline.

Comandos desde la raíz del repositorio:

```powershell
npm run check:big-picture
npm run check
npm run build
npm run check:dist
```

`check:big-picture-foundation` conserva la selección de regresiones de base;
`check:big-picture-integration` reúne los nuevos flujos de navegador, realms y
propiedad; `check:big-picture` ejecuta ambas. La suite general incluye estos
flujos. Ningún comando constituye una certificación visual.

Millennium permite ampliar el cliente con plugins, pero sus componentes pueden
cambiar con una actualización de Steam, como indica su
[documentación de diagnóstico](https://docs.steambrew.app/users/getting-started/troubleshooting).
Por eso cada fase debe detectar capacidades, conservar fallbacks acotados y
repetir la matriz contra la versión instalada, sin prometer compatibilidad
permanente basándose en los nombres internos actuales.
