# FIX7 — Logos antiguos e iconos

Se deja de promover common.logo (banner JPEG antiguo) a logo de biblioteca y de usar legacy_logo como candidato automático. Se conservan los logos de biblioteca y los perfiles de SteamGridDB existentes. Se renueva la caché de metadatos y las revisiones de PES 2013/Mortal Kombat Komplete Edition para reparar resultados anteriores.

La reparación del icono se ejecuta también cuando las portadas están completas. Su marcador comprueba la ruta aplicada y se renueva para reparar iconos que habían quedado pendientes.

Verificado en Steam: cuatro imágenes aplicadas por juego; logos PNG RGBA con transparencia (PES: 1280x439, MK: 974x660) e iconos PNG de 32x32 guardados y aplicados por la API de Steam.

Pruebas: npm run verify y node scripts/check-icon-repair.mjs. Incluye las correcciones FIX1–FIX6. No publicado en GitHub.
