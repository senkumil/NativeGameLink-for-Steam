# NativeGameLink for Steam

[English](README.md) · **Español**

**Lleva la experiencia completa de la Biblioteca de Steam a tus juegos que no son de Steam.**

NativeGameLink for Steam es un complemento para [Millennium](https://steambrew.app/) que vincula un acceso directo externo con su AppID real de Steam y reconstruye su página de Biblioteca con metadatos oficiales, ilustraciones, actividad, logros, comunidad, tiempo de juego y controles de estilo nativo.

Una vez vinculado, el juego deja de sentirse como un acceso directo vacío: recibe la identidad y presentación de su versión de Steam sin dejar de ejecutar el archivo que añadiste originalmente.

> NativeGameLink modifica la presentación local de los accesos directos vinculados. No concede licencias, propiedad de juegos, objetos de inventario, almacenamiento de Steam Cloud ni logros oficiales para el perfil de Steam.

---

## ✨ Novedades de la v3.0.0 y Funciones principales

- **Compatibilidad con Juegos Eliminados y Deslistados de Steam:** Soporte completo para títulos descatalogados o sin página de tienda activa en Steam (como *Mortal Kombat Komplete Edition*, *Pro Evolution Soccer 2013*, etc.), resolviendo metadatos e ilustraciones oficiales sin bloqueos.
- **Gestión y Cambio de Artworks Directamente desde Propiedades:** Selector visual dentro de la pestaña *Personalización* en Propiedades para previsualizar, cambiar y aplicar fondos hero, logos, cápsulas e iconos en tiempo real.
- **Gestión de Logros en Juegos Oficiales de Steam:** Consulta, desbloquea, bloquea o edita el progreso de logros de tus juegos oficiales de Steam directamente desde la biblioteca.
- **Simulación y Farmeo de Cromos de Steam (Trading Cards):** Colección interactiva de tarjetas en 3D, seguimiento de cromos restantes, progreso de insignia y acceso directo a la comunidad.
- **Simulador de Logros Simplificado para Juegos No-Steam:** Configuración ultra accesible por juego (100% completado, progreso simulado o manual) con compatibilidad de archivos locales.
- **Detección Automática Inteligente:** Evalúa evidencias reales de ejecutables, rutas de instalación y niveles de confianza con previsualización de carátulas.
- **Integración con el Modo Big Picture:** Renderizado oficial de fondos hero, logos, navegación con mando y tiempo de juego sincronizado de forma nativa.

---

## 🎮 Una experiencia de Biblioteca de estilo nativo

NativeGameLink reconstruye las superficies que normalmente faltan en un acceso directo externo:

- **Barra superior estilo Steam** con Jugar, presentación del estado de Cloud, última sesión, tiempo total, progreso de logros, información del juego, mando y favoritos.
- **Enlaces oficiales** a la tienda, DLC, punto de encuentro, tienda de puntos, discusiones, guías, Workshop y soporte cuando existen.
- **Panel de información** con portada, descripción, desarrollador, editor, franquicia, fecha de lanzamiento, modos de juego, compatibilidad con mandos, préstamo familiar, capacidad de Steam Cloud y otras características de la tienda.
- **Feed de actividad y noticias** que combina eventos de socios, anuncios, actualizaciones importantes, parches, hotfixes, ofertas, eventos y lanzamientos de DLC en orden cronológico.
- **Editor de estados** con emoticonos e historial de actividad independiente para cada acceso directo.
- **Amigos que juegan** con perfiles, avatares, tiempo reciente, reseñas, capturas, vídeos y actividad cuando Steam permite obtenerla.
- **Contenido de la comunidad** con capturas, ilustraciones y guías que aparecen progresivamente para acelerar la carga inicial.
- **Panel y ventana de logros** con grupos desbloqueados y bloqueados, progreso, descripciones, fechas, porcentajes globales e iconos nativos.
- **Presentación de cromos/tarjetas** con recursos oficiales de Steam Community y el Mercado, insignia, colección, expansión 3D centrada, iluminación por cursor y reflejo foil cuando los metadatos lo permiten.
- **Secciones opcionales de DLC y Workshop** validadas contra el AppID vinculado.
- **Las notas y áreas multimedia de Steam permanecen disponibles** junto al contenido añadido.

Los datos esenciales pueden aparecer inmediatamente desde la caché mientras noticias, amigos, logros y comunidad cargan de forma independiente. Un fallo temporal de red, Store o IPC no queda guardado indefinidamente hasta reiniciar Steam.

---

## 📸 Capturas de pantalla

Estas capturas muestran la diferencia visual entre un acceso directo no vinculado y un juego vinculado, además de las interfaces de logros, actividad y la integración con Big Picture.

### 1. Antes de vincular — acceso directo original que no es de Steam

<img width="1917" height="928" alt="Captura de pantalla 2026-08-26 163249" src="https://github.com/user-attachments/assets/e6e6de91-6ab3-4b21-9aaa-3d1f8e709394" />

### 2. Después de vincular — integración de NativeGameLink en la Biblioteca

<img width="1917" height="974" alt="Captura de pantalla 2026-08-26 164536 pFDFDFng" src="https://github.com/user-attachments/assets/1dc423ff-04dc-496c-89a1-51a594c2fdc9" />

### 3. Logros / actividad / información del juego

<img width="1917" height="1015" alt="image" src="https://github.com/user-attachments/assets/5abb8961-6936-46f3-897b-6fede3df0c34" />


<img width="1917" height="1015" alt="image" src="https://github.com/user-attachments/assets/e7e839a8-a73d-4b70-b93d-2ea97ca32847" />


<img width="1917" height="907" alt="image" src="https://github.com/user-attachments/assets/883df422-cca0-4022-8076-1d830af6e92e" />


<img width="1917" height="1016" alt="image" src="https://github.com/user-attachments/assets/36998798-fb85-4e07-8e4b-2b0ae7c09ac2" />


<img width="1917" height="1016" alt="image" src="https://github.com/user-attachments/assets/3e9913ae-0d2e-47c2-a99f-f284aa4cf290" />


<img width="1917" height="1015" alt="image" src="https://github.com/user-attachments/assets/be7e3a13-1405-4b7b-b708-bdb45de6b14f" />

### 4. Contenido de la comunidad

<img width="1917" height="1015" alt="image" src="https://github.com/user-attachments/assets/81ea9dbf-a7bb-4556-bc39-d7d4413c508d" />

### 5. Personalización de ilustraciones / integración con Propiedades

<img width="1917" height="1020" alt="image" src="https://github.com/user-attachments/assets/763d36c1-8f60-4bd2-9901-4a1da09cd12a" />


<img width="1917" height="1015" alt="image" src="https://github.com/user-attachments/assets/f4e460c7-d7df-46f6-ac8d-645aeae06ccd" />

### 6. Integración con Big Picture

<img width="1917" height="1077" alt="aa" src="https://github.com/user-attachments/assets/55e55988-6749-4673-ab26-7efb3003fb3e" />


<img width="1917" height="1077" alt="ASDADASD" src="https://github.com/user-attachments/assets/3808bca5-ef79-4d78-9c1f-1fca03857067" />

### 7. Vinculación de AppID / detección automática

<img width="1917" height="1015" alt="image" src="https://github.com/user-attachments/assets/bb057d46-3946-4b83-842c-0f7171bf9fc2" />

### 8. Herramientas de Gestión de Logros Oficiales

<img width="2558" height="1356" alt="image" src="https://github.com/user-attachments/assets/d25978a0-7b77-4695-890c-03a4560d618d" />

---

## 🔍 Detección automática y vinculación inteligente

Al abrir un acceso directo externo recién añadido, NativeGameLink puede sugerir automáticamente la versión de Steam más probable.

El detector combina distintas evidencias en lugar de confiar únicamente en el nombre:

- Nombre y ruta completa del ejecutable.
- Carpetas superiores e identidad de la instalación.
- `steam_appid.txt`, argumentos de lanzamiento, manifiestos y otras evidencias directas.
- Ejecutables oficiales conocidos y alias verificados.
- Objetivos de Unreal Engine como `Win64-Shipping.exe`.
- Launchers genéricos y procesos bootstrap, tratados con menor confianza.
- Candidatos de la tienda y diferencias entre ediciones, exigiendo una separación mínima entre resultados ambiguos.

La ventana de confirmación muestra nombres, AppID, confianza y carátulas antes de realizar cambios. Puedes elegir otro candidato, rechazar la sugerencia o introducir manualmente un AppID desde **Propiedades**.

Después de confirmar, NativeGameLink:

1. Guarda una asociación estable para el acceso directo.
2. Lo renombra con el título oficial.
3. Aplica el icono y las ilustraciones de Biblioteca.
4. Conserva el destino de lanzamiento original.
5. Puede sustituir un launcher que se cierra rápidamente por el ejecutable real del juego para mantener el seguimiento de tiempo.
6. Termina la identidad y los recursos en segundo plano aunque cierres la ventana de Propiedades.

---

## 🖼️ Ilustraciones automáticas y colocación nativa

NativeGameLink da prioridad a los recursos publicados por Steam y los coloca en sus espacios y proporciones esperados:

- **Portada vertical** (`600 × 900`) para colecciones y estanterías.
- **Fondo hero** (`1920 × 620`) para la cabecera de detalles.
- **Logo transparente**, usando también la posición oficial publicada por Steam.
- **Cápsula horizontal** (`920 × 430`) para juegos recientes y carruseles.
- **Icono oficial** obtenido desde las fuentes modernas o heredadas de Steam.

Al terminar, el proceso informa si todos los recursos fueron aplicados y cuáles faltan. Los recursos oficiales de Steam nunca se sustituyen automáticamente por recursos comunitarios.

### Respaldo con SteamGridDB

Si Steam no publicó una portada, fondo, logo o cápsula concreta, NativeGameLink puede pedir únicamente ese recurso faltante a [SteamGridDB](https://www.steamgriddb.com/). La selección prioriza AppID, tipo, dimensiones, transparencia, idioma y estilo apropiados, y rechaza dominios no autorizados.

Introduce tu propia API key de SteamGridDB en los ajustes de NativeGameLink y activa el respaldo automático. La clave se guarda solo en el contexto local de Steam/Millennium; no viene incluida con el complemento ni se envía a servidores de NativeGameLink. Otro código inyectado en el mismo contexto podría acceder al almacenamiento local, por lo que nunca debes publicar una clave compartida.

Para juegos cuya ficha haya sido retirada, abre **Propiedades** del acceso
directo y usa **Artwork de la biblioteca → Elegir artwork** para previsualizar
y escoger carátula vertical, fondo hero, logo y cápsula horizontal. La elección
queda guardada únicamente para ese acceso directo y se mantiene en futuras
sincronizaciones.

---

## 🖥️ Integración con Big Picture

NativeGameLink adapta localmente el modelo de datos de Big Picture para que los accesos vinculados se presenten como entradas normales de la Biblioteca:

- Ya no quedan separados dentro de **Fuera de Steam**, **No de Steam**, **Non-Steam** o su equivalente localizado.
- La categoría redundante se oculta cuando queda vacía.
- El estado de instalación, la presentación de mando, campos de compatibilidad y tiempo de juego se exponen a la interfaz de Big Picture.
- El comportamiento se limita a accesos vinculados y se restaura al desmontar el complemento o abandonar la integración.

Es una integración visual local: no convierte el acceso en una licencia adquirida ni evita las comprobaciones de propiedad de Steam.

---

## 🏆 Logros en Juegos No-Steam y Notificaciones Nativas

NativeGameLink ofrece una experiencia completa de logros para tus juegos vinculados que no son de Steam, combinando los metadatos e iconos oficiales de Steam con archivos locales de progreso o simulación.

Incluye:

- Contadores desbloqueados/totales en la barra superior y en el panel lateral.
- Barras de progreso, grupos bloqueados y desbloqueados, iconos, descripciones y fechas de desbloqueo.
- Ventana completa de logros con filtros de estilo nativo y porcentajes globales cuando están disponibles.
- Supervisión en vivo del archivo de progreso.
- Notificaciones toast y sonido de desbloqueo utilizando el sistema nativo de Steam.
- Botón de prueba de notificaciones en los ajustes del plugin.
- Logros de prueba deterministas opcionales para revisar la interfaz sin un archivo local; desactivados por defecto.

### 💡 Sistema de Logros para Juegos No-Steam

El sistema de logros de NativeGameLink for Steam está **integrado directamente en la interfaz de Steam**, con compatibilidad nativa para:
- **Seguimiento local en tiempo real:** Detecta y lee el progreso de logros locales automáticamente en tu carpeta configurada o en la carpeta del juego.
- **Notificaciones nativas con sonido:** Muestra las notificaciones emergentes de logros de Steam al desbloquearlos durante la partida con el sonido oficial.
- **Simulación y personalización integrada:** Configura el progreso de logros de tus juegos No-Steam fácilmente (100% desbloqueado, simulación progresiva o ajuste manual desde Propiedades).

Puedes configurar el origen de los logros de tres formas:

1. **Búsqueda automática por AppID (Por defecto):** Busca automáticamente en `%APPDATA%\SteamAchievements\<AppID>\` y en las carpetas locales configuradas.
2. **Carpeta global:** Abre los ajustes de NativeGameLink y selecciona tu carpeta raíz de logros.
3. **Ruta personalizada por juego:** Haz clic derecho en el acceso directo → **Propiedades** → **Juego vinculado** y selecciona un archivo `achievements.json` concreto o su carpeta contenedora.

---

## 🎖️ Herramientas de Gestión de Logros para Juegos Oficiales de Steam

El plugin incluye herramientas integradas de **Gestión de Logros** para tus **juegos oficiales de Steam**:

- **Gestión directa en la biblioteca:** Consulta, desbloquea, bloquea o edita el progreso de logros de tus juegos oficiales de Steam directamente desde la interfaz de Steam.
- **Sin herramientas externas:** No necesitas descargar, configurar ni abrir ejecutables adicionales.
- **Sincronización instantánea:** Los cambios se sincronizan de inmediato con el backend de Steam y se reflejan en tiempo real en la interfaz de la biblioteca.

---

## ⏱️ Tiempo de juego y sesiones

### ¿Steam Beta o el seguimiento de NativeGameLink?

Las versiones de Steam Beta que incluyen medición nativa para juegos externos son la opción recomendada si quieres que el propio cliente mida y muestre el tiempo local del acceso directo. Puedes activarla desde **Steam → Parámetros → Interfaz → Participación en la beta del cliente → Steam Beta Update**.

NativeGameLink comprueba si el cliente actual ya expone tiempo de juego nativo para cada acceso vinculado. Cuando existe, utiliza el valor de Steam y no crea un contador duplicado. Cuando no existe, NativeGameLink activa automáticamente su propio seguimiento local alternativo. Este fallback viene activado por defecto y puede deshabilitarse desde los ajustes del complemento.

El historial canónico del seguimiento local se guarda fuera de la carpeta del complemento, en `%APPDATA%\\NativeGameLinkForSteam\\playtime_sessions.json`, con tres copias rotativas de recuperación. Los archivos de estado encontrados dentro de la carpeta del plugin se ignoran deliberadamente porque paquetes de desarrollo antiguos podían contener datos específicos de otra máquina. Al iniciar, el historial persistido se valida contra el `shortcuts.vdf` real de la cuenta de Steam activa y se eliminan automáticamente los registros de accesos directos que no pertenecen a esa biblioteca. Aun así, conviene exportar o copiar periódicamente el directorio de datos por usuario si también quieres protegerte contra el borrado completo del perfil de Windows o un fallo del disco.

El seguimiento alternativo puede:

- Detectar cuándo comienza y termina un juego vinculado.
- Conservar sesiones tras cambios de título o regeneraciones del ID del acceso directo.
- Mostrar tiempo total en la Biblioteca de escritorio y Big Picture.
- Mantener sincronizados los alias con una identidad canónica.
- Recuperarse de sesiones interrumpidas o superpuestas.

### ⚠️ Requisito fundamental: Ejecutable principal vs. Launchers

> [!IMPORTANT]
> **Apunta directamente al `.exe` original del juego:**
> Para que el registro y la detección del tiempo de juego funcionen correctamente (tanto mediante la medición nativa de Steam como con el seguimiento alternativo de NativeGameLink), el acceso directo en Steam debe apuntar al **ejecutable principal/original del juego** —es decir, al archivo ejecutable que permanece abierto y en memoria durante toda la partida—.
> 
> **¿Por qué no funciona con launchers o ejecutables intermediarios?**
> Si agregas a Steam un launcher externo, script, instalador o ejecutable intermediario/wrapper que únicamente se encarga de abrir el juego real y luego se cierra de inmediato, Steam y el monitor de procesos detectarán que la aplicación ha finalizado en cuestión de segundos, deteniendo el contador y provocando que el tiempo jugado no se registre.
> 
> Si el juego incluye un launcher de este tipo, localiza en su carpeta de instalación el ejecutable real de larga duración (por ejemplo, en juegos de Unreal Engine suele estar en `Binaries/Win64/...-Shipping.exe`) y configúralo como destino en las propiedades del acceso directo en Steam. Durante el flujo de vinculación, NativeGameLink también intentará detectar y sugerirte dicho ejecutable real de forma automática.

---

## 🎴 Cromos, insignias, DLC y Workshop

Cuando la versión de Steam ofrece los datos necesarios, NativeGameLink añade secciones laterales de estilo nativo:

- Ilustraciones oficiales de cromos obtenidas desde Steam Community y el Mercado.
- Insignia, experiencia, cantidades obtenidas/restantes y cuadrícula adaptable.
- Expansión interactiva con inclinación 3D, brillo direccional, glow del cursor y reflejo holográfico exclusivo para foil.
- Portadas de DLC validadas y enlaces a la tienda.
- Vista previa y acceso a Workshop cuando el título lo admite.

Estas secciones reproducen la presentación de la Biblioteca. NativeGameLink no entrega cromos, insignias, EXP, propiedad de DLC ni objetos de inventario.

---

## 🌐 Interfaz multilenguaje

NativeGameLink detecta automáticamente el idioma activo del cliente Steam y traduce la interfaz inyectada para que coincida con él. Los encabezados de Biblioteca, enlaces de navegación, logros, etiquetas del feed, secciones de comunidad, información del juego, tooltips y controles nativos reutilizan las traducciones oficiales de Steam siempre que están disponibles.

Las ventanas propias del complemento, mensajes de detección, ajustes y resultados de vinculación utilizan el catálogo de localización de NativeGameLink. El español está incluido directamente y el inglés actúa como fallback seguro para los textos que Steam no traduzca. Al cambiar el idioma del cliente, los datos y la interfaz localizados se actualizan sin necesitar una edición separada del complemento.

---

## 📥 Instalación

1. Instala [Millennium](https://steambrew.app/) para Steam.
2. Descarga la versión más reciente `NativeGameLink-for-Steam.zip`.
3. Descomprime el archivo y copia la carpeta incluida `NativeGameLinkForSteam` dentro de `millennium\plugins` de **la instalación de Steam que realmente utilizas**. No asumas que Steam está instalado en `C:`.

   - El destino siempre es relativo a la carpeta real de tu Steam:
     ```text
     <instalación de Steam>\millennium\plugins\NativeGameLinkForSteam\
     ```
   - Por ejemplo, si Steam está en `D:\Steam`, instala el plugin en `D:\Steam\millennium\plugins\NativeGameLinkForSteam\`.
4. Reinicia Steam.
5. Activa **NativeGameLink for Steam** en la sección de complementos de Millennium.

---

## 🚀 Inicio rápido

1. En Steam, selecciona **Juegos → Añadir un producto que no es de Steam a mi biblioteca...** y agrega el **ejecutable principal** del juego (evita seleccionar launchers o ejecutables intermediarios para que el tiempo de juego se registre correctamente).
2. Abre el nuevo acceso directo en tu Biblioteca.
3. Revisa la detección automática y pulsa **Vincular juego**.
4. Espera el informe que confirma el nombre, icono y recursos aplicados.
5. La página vinculada cargará la información disponible y sus secciones opcionales.

Si la detección es incierta o no aparece:

1. Haz clic derecho sobre el acceso y abre **Propiedades**.
2. En **Juego vinculado**, revisa los candidatos visuales o pega un AppID/enlace de la tienda.
3. Selecciona la versión correcta y pulsa **Guardar**.

---

## 🛠️ Compilación desde el código fuente

El repositorio incluye el bundle de producción en `.millennium/Dist/index.js`. `plugin.source.json` es el manifiesto canónico; cada compilación regenera `plugin.json` desde ese archivo para impedir que la versión o los metadatos generados queden desactualizados.

```bash
# Instalar exactamente las dependencias bloqueadas en package-lock.json
npm ci

# Comprobar TypeScript, arquitectura, localización, detección y Lua
npm run check

# Generar el bundle de producción
npm run build

# Ejecutar todas las comprobaciones y validar el bundle
npm run verify

# Preparar las carpetas de release limpio y código fuente
npm run package:prepare
```

Los cambios dentro de `backend/` se aplican después de reiniciar Steam.

### GitHub Actions / releases automáticos

El repositorio queda preparado para CI/CD dentro de `.github/workflows/`:

- `ci.yml` se ejecuta en pull requests y pushes a `main`: instala con `npm ci`, ejecuta el build limpio completo mediante `npm run verify`, sube el frontend generado como artifact y, en pushes confiables a `main`, sincroniza automáticamente `plugin.json` y `.millennium/Dist/index.js` en el repositorio si cambiaron.
- `release.yml` se ejecuta al publicar tags semánticos como `v3.0.2`. Comprueba que el tag coincida con `package.json`, `plugin.source.json` y `plugin.json`, recompila todo desde cero, genera un paquete limpio de runtime y otro con el código fuente, calcula SHA-256 y crea o actualiza automáticamente el GitHub Release.

Para publicar una versión nueva:

```bash
# Sincronizar package.json, package-lock.json y ambos manifiestos del plugin
npm run version:set -- 3.0.2

# Primero subir los cambios de código
git add .
git commit -m "release: v3.0.2"
git push origin main

# Cuando CI termine correctamente, etiquetar el commit que quieres publicar
git tag v3.0.2
git push origin v3.0.2
```

El workflow del tag publica `NativeGameLinkForSteam-v3.0.2-CLEAN-INSTALL.zip`, `NativeGameLinkForSteam-v3.0.2-SOURCE.zip` y `SHA256SUMS.txt`. El usuario final no necesita Node ni compilar manualmente el frontend.

Si la sincronización de archivos generados o la publicación del release recibe un error de permisos, activa **Settings → Actions → General → Workflow permissions → Read and write permissions** en el repositorio. Una regla de protección de `main` que prohíba pushes desde GitHub Actions también puede bloquear únicamente la sincronización automática; la verificación y el empaquetado por tag siguen siendo independientes.

---

## ☕ Apoya el proyecto

Si NativeGameLink for Steam ha mejorado tu Biblioteca, puedes apoyar su desarrollo, pruebas, traducción y mantenimiento en Ko-fi. Cada contribución ayuda a que el proyecto siga avanzando.

<a href="https://ko-fi.com/senkumil" target="_blank">
  <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support on Ko-fi" />
</a>

---

## 💖 Créditos y Agradecimientos

Gracias por hacer este proyecto posible:

- [retrotoolsdev-wq/game-data-linker](https://github.com/retrotoolsdev-wq/game-data-linker)
- [gibbed/SteamAchievementManager](https://github.com/gibbed/SteamAchievementManager)
- [xan105/Achievement-Watcher](https://github.com/xan105/Achievement-Watcher)
- [k0d13/steam-non-steam-playtimes](https://github.com/k0d13/steam-non-steam-playtimes)

---

## 📄 Licencia

Licencia MIT — consulta [LICENSE](LICENSE) para más información.
