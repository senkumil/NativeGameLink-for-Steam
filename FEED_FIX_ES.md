# Corrección del feed — FIX5

El feed descartaba anuncios oficiales porque la API de Steam los marca como `is_external_url=true`. Además, sus enlaces usan el dominio histórico `steamstore-a.akamaihd.net`, que el filtro del frontend rechazaba. Ahora se valida el feed y el destino y se normaliza ese enlace de anuncios al dominio actual de la tienda.

Se amplía la espera del frontend de 4,5 a 30 segundos: antes vencía incluso antes de los plazos de 6 y 8 segundos del backend. Se liberan los temporizadores al finalizar. Los fallos temporales de noticias se reconocen correctamente y no se guarda un feed vacío como definitivo porque el endpoint de eventos esté ausente. La caché de noticias cambia a events19 para no reutilizar los resultados incompletos anteriores.

Pruebas: `npm run check:news-runtime` y `python scripts/check-news-backend.py` (requiere lupa). Cubren anuncios oficiales marcados externos, enlaces históricos, rechazo de otros dominios y conservación del estado reintentable ante fallos. Las pruebas generales, compilación y validación del bundle también pasan.

Se conservan todas las correcciones de FIX4. El paquete SOURCE contiene el código fuente; CLEAN es el instalable sin datos personales.

Verificación en Steam: God of War recuperó 27 noticias; la primera página mostró ocho tarjetas y al pulsar «Cargar más actividad» pasó a 16. Las miniaturas oficiales también se cargaron. El feed mantiene su paginación, no inserta todas las tarjetas de golpe.
