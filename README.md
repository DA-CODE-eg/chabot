# chabot

Chatbot de WhatsApp para Legal Segura con panel admin para gestionar videos, manuales PDF e imágenes por producto.

## Panel admin

- URL: `http://localhost:3000/admin` (ajusta `ADMIN_PORT` si usas otro puerto)
- Acceso con usuario y contraseña (sesión simple).
- Permite cargar archivos locales o registrar URLs externas para videos y manuales.
- Estado de cada recurso visible por producto.

## Configuración de productos

Los recursos se almacenan en `data/products.json`. Cada producto mantiene:

- Nombre del producto y nombre del manual.
- Video (archivo local o URL).
- Manual PDF (archivo local o URL).
- Imagen (archivo local o URL).

El sistema crea un respaldo automático en `data/products.json.bak` al guardar cambios.

## Variables de entorno

Recomendadas en `.env`:

- `SESSION_NAME`: nombre de sesión para WhatsApp Web.
- `GROQ_API_KEY`: clave de Groq.
- `ADMIN_USER`: usuario del panel admin.
- `ADMIN_PASSWORD_HASH`: hash bcrypt de la contraseña del admin.
- `ADMIN_PASSWORD`: alternativa temporal si no se define el hash.
- `ADMIN_SESSION_SECRET`: secreto para la sesión del panel.
- `ADMIN_PORT`: puerto del panel (por defecto 3000).
- `MAX_UPLOAD_MB`: tamaño máximo por archivo (por defecto 100MB).
- `NODE_ENV`: usa `production` para activar cookies seguras.

## Despliegue

- El panel admin y el bot se ejecutan en el mismo proceso Node.
- Asegura que el servidor tenga permisos de escritura sobre `videos/`, `manuales/`, `imagenes/` y `data/`.
- Para proveedores que exigen un puerto específico, usa `ADMIN_PORT` o `PORT`.

## Notas de seguridad

- El paquete `csurf` se usa para proteger formularios y peticiones del panel admin; está archivado y se recomienda evaluar su reemplazo en el futuro.
- Se aplica un override de `cookie` en `package.json` para corregir una vulnerabilidad transitiva reportada por `npm audit`.
