# FIX9 — Tamaño de logos

GTA IV tenía un logo de 640×360 cuyo contenido visible ocupa 307×304 píxeles, con márgenes transparentes. Su posición guardada usaba el respaldo genérico de 50 % por 50 %.

Se aumenta el respaldo a 70 % por 70 % (40 % más de tamaño lineal). Se conservan las dimensiones oficiales que estén disponibles y los perfiles específicos de PES 2013 y Mortal Kombat Komplete Edition. La migración conserva posiciones nativas distintas del antiguo respaldo; una posición manual idéntica al respaldo antiguo no puede distinguirse de él.

La sincronización revisa la posición aunque las cuatro imágenes ya estén guardadas. No es necesario desvincular ni volver a descargar imágenes. Reiniciar Steam carga la corrección y permite ejecutar la reparación.

Verificación: npm run verify, node scripts/check-logo-sizing.mjs y node scripts/check-icon-repair.mjs. Las pruebas de posición usan la API de Steam simulada; el aspecto final de FIX9 aún necesita comprobarse en Steam.

Incluye FIX1–FIX8. Cambios locales, no publicados en GitHub.
