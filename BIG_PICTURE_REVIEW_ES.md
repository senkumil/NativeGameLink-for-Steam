# Revisión de Big Picture y webpack — 8 de septiembre de 2026

Se revisaron la detección de modo, el ciclo de vida de Big Picture, los cambios en los objetos de Steam y los resolutores de módulos y stores. Se conservaron las correcciones anteriores de instalación y vinculación.

## Hallazgos corregidos

1. **Caché de webpack desactualizada.** La lectura de módulos devolvía la fotografía inicial, incluso después de cargarse módulos adicionales. El registro alternativo de Millennium también dejaba de actualizarse en cuanto tenía entradas. Ahora se incorporan módulos nuevos, se retiran los eliminados y cambia la identidad de caché cuando cambian sus exportaciones.
2. **Store reemplazado conservado indefinidamente.** `getSteamStore` devolvía la primera instancia encontrada aunque Steam hubiera reconstruido la ventana y publicado otra. Ahora vuelve a resolver la instancia activa y descarta ventanas cerradas.
3. **Parches permanentes en prototipos.** Los wrappers de `BIsShortcut`, `BIsSteamDeckVerified` y los getters de compatibilidad no se restauraban. Además, se guardaban algunos valores después de aplicar el parche. Ahora se guardan antes y se restauran los descriptores originales; se preservan reemplazos posteriores de Steam.
4. **Respuesta de tiempo de juego posterior a la salida.** Las peticiones pendientes podían aplicar cambios tras desactivar Big Picture. Ahora verifican la sesión después de cada espera antes de modificar datos o DOM. También se cancela el temporizador de repintado pendiente.
5. **Snapshot posterior a la escritura.** Algunos campos de tiempo se guardaban solo si la asignación inicial fallaba. Ahora se guarda el descriptor antes de cualquier escritura.

La detección errónea de `GamepadUIToggle` como Big Picture activo se corrigió en FIX3 y sigue cubierta por una prueba independiente.

También se reprodujo y corrigió una corrupción de imágenes independiente de webpack: `artwork_icon.encode_base64` dividía la entrada en bloques de 4096 bytes, que no son múltiplos de tres. Repetía bytes entre bloques. Ahora usa 4095 bytes; la prueba compara el resultado con la biblioteca estándar de Python, incluyendo los límites de bloque y archivos binarios de 100 KB.

La descarga binaria también fallaba: el puente de `http.get` usa `lua_pushstring`, que termina en el primer byte NUL ([implementación de Millennium](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/lua_host/api/http.cc)). Se utiliza `http.download` cuando está disponible y lectura binaria desde un archivo temporal que se elimina tanto tras éxito como tras fallo. Se mantiene la validación de hosts y se desactiva el seguimiento automático de redirecciones en el lector remoto para validar cada destino. La lectura acepta como máximo 12 MB. Versiones antiguas sin `http.download` conservan el transporte anterior; no se ha certificado su compatibilidad con imágenes binarias.

## Pruebas reproducibles

- `npm run check:webpack-runtime`: módulos añadidos/eliminados, cambio de identidad, dos runtimes distintos, registro compartido actualizado y reemplazo/eliminación de stores.
- `npm run check:big-picture-lifecycle`: dos ciclos de entrada/salida, restauración exacta de métodos y getters, aislamiento de juegos nativos, cancelación de una respuesta tardía y conservación de cambios posteriores de Steam.
- `npm run check`: conjunto completo de comprobaciones.
- `npm run build` y `npm run check:dist`: compilación y comprobación del JavaScript distribuible.
- `python scripts/check-artwork-codec.py` (requiere `lupa`): codificación y decodificación binaria contrastadas con Python. Fallaba con 4097 bytes antes de la corrección.

Comprobación en Steam instalado: Big Picture abrió su pantalla de inicio y se pudo regresar al escritorio; el registro confirmó ambas transiciones de modo.

Después del regreso, Black Myth: Wukong seguía mostrando el botón «Vincular». Con el backend corregido, Steam registró 4/4 imágenes aplicadas y logo presente para Cyberpunk 2077, God of War Ragnarök y Hi-Fi RUSH. Una imagen recuperada por el puente real se decodificó en CEF a 1920 × 620 píxeles.

Esta revisión no certifica todas las funciones, resoluciones, mandos o versiones futuras de Steam. La detección estructural de componentes privados de webpack sigue dependiendo de la interfaz que publique Steam. Los cambios son locales y no se publican automáticamente en GitHub.
