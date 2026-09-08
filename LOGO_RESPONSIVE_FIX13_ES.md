# FIX13: logos al mover el separador de la biblioteca

El ancho y el alto del logo son límites independientes en Steam. Un límite de ancho pequeño puede reducir la imagen al ensanchar la lista lateral, incluso si el encabezado mantiene la altura. Los márgenes transparentes del PNG también cuentan en ese límite.

Cambios:
- El ajuste automático usa toda la anchura disponible como límite de seguridad; la altura determina el tamaño preferido. Mantiene la proporción y reduce la imagen si la ficha es demasiado estrecha.
- Se eliminan los límites globales, las animaciones de tamaño y el observador de redimensionado del encabezado añadidos por el plugin. Steam conserva el control de su fondo.
- El editor permite alternar una vista estrecha manteniendo la altura y utiliza márgenes internos de 16/26 px como la implementación de Steam instalada. La vista sigue siendo aproximada: escala, tema y modo de Steam pueden variar.
- «Restablecer ajuste automático» guarda el ajuste automático y normaliza el margen transparente del logo. No descarga recursos. Es una acción explícita del usuario.
- La migración conserva ajustes manuales, posiciones oficiales y perfiles específicos. No escribe archivos ni recarga imágenes en cada movimiento del separador.

Para GTA IV, el archivo actual contiene 47,74795799 % de ancho y 100 % de alto. Ese ajuste manual se conserva. Tras reiniciar Steam, abrir sus propiedades, «Ajustar logo» y «Restablecer ajuste automático» para reemplazarlo. El recorte del fondo sigue las reglas de Steam; no se garantiza una composición idéntica en todas las proporciones de ventana.

Validación: npm run verify; check-logo-sizing; check-logo-layout-browser (PNG real local de GTA IV, reinicio explícito de ajustes, vista estrecha, ratios 0,5/1/2/4 y fichas de 1582/942/400 px); check-bp-native-info. Las pruebas de navegador son aisladas: falta confirmar visualmente en el Steam del usuario tras reiniciar. No se modificaron sus archivos de grid durante las pruebas.
