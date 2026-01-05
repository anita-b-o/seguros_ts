# San Cayetano Seguros

## Variables obligatorias (.env)
- `DJANGO_SECRET_KEY`, `ALLOWED_HOSTS`, `FRONTEND_ORIGINS`
- SMTP real: `EMAIL_BACKEND` (smtp), `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`
  asegurate que `DEFAULT_FROM_EMAIL` se use como remitente para 2FA y onboarding; si el valor es vacío los correos pueden romperse en producción.
- Mercado Pago: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_REQUIRE_WEBHOOK_SECRET` (true en prod), `MP_NOTIFICATION_URL` opcional
- Media/CDN: `MEDIA_URL` apuntando a CDN o `https://tu-dominio/media/`; `MEDIA_ROOT` si usás filesystem; `SERVE_MEDIA_FILES=false` en prod (default) o habilitarlo conscientemente
- CORS/CSRF: `FRONTEND_ORIGINS` separados por coma; en prod no se habilita `CORS_ALLOW_ALL_ORIGINS`
- Base de datos: en desarrollo podés usar SQLite local (`backend/db.sqlite3`), pero ese archivo no está versionado y se crea automáticamente. En producción es obligatorio configurar `DB_ENGINE`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST` y `DB_PORT` (o cualquier otro backend que uses) mediante variables de entorno; el backend no arranca con SQLite cuando `DEBUG=False`.
- Entorno base: copiá `backend/.env.example` hacia `backend/.env` antes de levantar el backend y completá cada valor sensible para el entorno correspondiente.
- Otros: `API_PAGE_SIZE`, `API_MAX_PAGE_SIZE`, `LOG_LEVEL`

> **Rotación de secretos:** rotar `DJANGO_SECRET_KEY` y cualquier secreto si alguna vez se versionó; genera valores nuevos antes de desplegar o compartir el repositorio y evita reutilizar claves expuestas.

## Dependencias y tests
- Instalar todas las dependencias del backend antes de correr pruebas o levantar el servidor: `./venv/bin/pip install -r backend/requirements.txt`. Eso garantiza que `requests`, `google-auth` y otras librerías estén disponibles.
- Luego podés ejecutar `./venv/bin/python manage.py test accounts` (o la suite completa) sin fallos por dependencias faltantes.
## Promover administradores seguros
- Eliminamos la migración `accounts/0003_make_anita_admin.py` que contenía un email hardcodeado; su funcionalidad ahora se reemplaza con un comando explícito.
- Para promover a un usuario existente ejecutá `python manage.py promote_user_to_admin --email foo@bar.com`. Por default habilita `is_staff` e `is_superuser`, pero podés usar `--no-staff`/`--no-superuser` si necesitás solo uno de los dos flags. El comando es idempotente y arroja `CommandError` si el email no existe.

## Entornos sin internet / Offline
- Si no podés bajar paquetes porque no hay acceso a PyPI, mantené `ENABLE_GOOGLE_LOGIN=false` y `VITE_ENABLE_GOOGLE=false`. Así el backend ni el frontend nunca intentan usar `google-auth`.
- Si activás Google Login sin tener `google-auth`/`requests`, el backend responde `500` con:
  ```
  {"detail": "Google login habilitado pero faltan dependencias (google-auth/requests). Instala `pip install -r requirements.txt` para continuar."}
  ```
  y el frontend mostrará “Login con Google no disponible.”. Esto evita stacktraces mientras te recuerda instalar los paquetes.
- Para habilitar el flujo en un entorno cerrado podés mantener un mirror local o wheelhouse y ejecutar `pip install --no-index --find-links=/path/to/wheels -r backend/requirements.txt`. No lo automatizamos aquí para no complicar la infraestructura existente.

## Webhook de MercadoPago
- Configurá el webhook de MP con el secreto en `X-Mp-Signature` o `Authorization: Bearer <token>`.
- En producción se exige `MP_WEBHOOK_SECRET` (o `MP_REQUIRE_WEBHOOK_SECRET=true`); sin secreto se rechaza.

## Autenticación y 2FA (staff/admin)
- El login corta con 403 si el usuario está inactivo (`is_active=False`).
- Usuarios staff requieren 2FA: el primer POST a `/api/auth/login` con credenciales válidas devuelve `require_otp=true` y envía el código al email del usuario; hay un rate limit de intentos en cache.
- El segundo POST debe incluir `otp`; si es correcto devuelve tokens JWT y datos del usuario.
- El login público (`/api/auth/login` y `/api/auth/register`) requiere emails únicos; el modelo `User.email` es `unique=True` (ejecutá migración tras desplegar).

## CORS / Orígenes permitidos
- Usá `FRONTEND_ORIGINS` (puede ser `http://localhost:5173,http://127.0.0.1:5173` en dev y los dominios oficiales en prod) para que Django exponga los encabezados CORS/CSRF al frontend. El backend también usa esas URLs para construir enlaces de reinicio de contraseña.
- En desarrollo el sistema permite `CORS_ALLOW_ALL_ORIGINS=true` porque `DEBUG=True`, pero en producción no deberías activar `CORS_ALLOW_ALL_ORIGINS`; dejá solo los dominios listados en `FRONTEND_ORIGINS`.
- Si no tenés CORS porque el frontend se sirve desde el mismo dominio (por ejemplo detrás de un proxy que hace /api/*), anotá en la configuración del proxy el mapeo a `/api/` y mantené `FRONTEND_ORIGINS` alineado con ese host.

### Login con Google (opcional)
- Para activar el flujo, poné `ENABLE_GOOGLE_LOGIN=true` en el backend y `VITE_ENABLE_GOOGLE=true` en el frontend. Mientras la flag esté apagada, `/api/auth/google` responde `404` como si el endpoint no existiera.
- Ambas capas deben usar el mismo OAuth client: `GOOGLE_CLIENT_ID` y `VITE_GOOGLE_CLIENT_ID` apuntan al mismo Client ID creado en Google Cloud; la ausencia de `GOOGLE_CLIENT_ID` hace que el backend devuelva un error 500.
- El botón de Google en el front solo aparece si `VITE_GOOGLE_CLIENT_ID` está definido; si no, nunca se muestra.
- El backend usa `google-auth` para verificar el `id_token` (audiencia, issuer y token verificado) antes de devolver los tokens JWT y los datos del usuario.
- Flujo resumido: el frontend obtiene un `id_token` con Google Identity Services, lo envía a `/api/auth/google`, el backend valida el token, crea/sincroniza al usuario y responde con el par de JWT (`access`/`refresh`) y los datos mínimos del usuario.
- El backend también revisa que `iss` sea `accounts.google.com` o `https://accounts.google.com`, que el `aud` iguale `GOOGLE_CLIENT_ID` y que `email_verified=true`. Si activás el feature sin `google-auth`/`requests`, el endpoint responde `500` con un mensaje claro. Si la flag está apagada responde `404` y el frontend muestra “Login con Google no disponible.”

## Google Cloud OAuth Setup
- En la consola de Google Cloud creá un OAuth Client ID tipo “Web application”.
- En la sección “Authorized JavaScript origins” agregá:
  - `http://localhost:5173` (o el host/puerto de tu dev server)
  - `https://TU_DOMINIO` (el dominio público donde corre el frontend en prod)
- Para GIS no necesitas “Authorized redirect URIs” porque el flujo usa el método `GoogleLogin` de Identity Services. Sólo los dejamos si tu frontend hace redirect manual.
- Copiá el Client ID recién creado en:
  - `backend/.env` como `GOOGLE_CLIENT_ID`
  - `frontend/.env` como `VITE_GOOGLE_CLIENT_ID`
- Activá las flags: `ENABLE_GOOGLE_LOGIN=true` y `VITE_ENABLE_GOOGLE=true` (mantenerlas en `false` para entornos offline).
- Reinicia backend y frontend si cambiaste estos valores para que tomen las nuevas variables.
 - Verificá el estado con `GET /api/auth/google/status`; devuelve `google_login_enabled`, `google_client_id_configured` y `google_auth_available` (booleans) para confirmar que el backend ve la configuración correcta sin exponer el client ID.

## Troubleshooting Google Login
Sintoma | Causa probable | Cómo resolver
--- | --- | ---
El botón “Continuar con Google” no aparece | `VITE_ENABLE_GOOGLE` no está en `"true"` o `VITE_GOOGLE_CLIENT_ID` vacío | Definí ambos valores en `frontend/.env` (ej. `VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com`) y reiniciá `npm run dev`.
Backend responde `404` | `ENABLE_GOOGLE_LOGIN` está apagado o no es `"true"` | Confirmá `backend/.env`, usá `ENABLE_GOOGLE_LOGIN=true`, reiniciá Django; también podés consultar `/api/auth/google/status` para ver que `google_login_enabled=false`.
Backend responde `500` (“faltan dependencias”) | `google-auth` o `requests` no están instalados | Ejecutá `./venv/bin/python -m pip install -r backend/requirements.txt` o usa un wheelhouse local (`pip install --no-index --find-links=/path/to/wheels -r backend/requirements.txt`).
Respuesta `401/400 invalid token / aud mismatch` | `GOOGLE_CLIENT_ID` no coincide con el Client ID real o el token no es un ID token de Google | Asegurate que `GOOGLE_CLIENT_ID` y `VITE_GOOGLE_CLIENT_ID` sean idénticos al ID de Google Cloud; revisá también que el token provenga de GIS (no uses un JWT arbitrario).
Respuesta con issuer inválido | Token no emitido por `accounts.google.com` / `https://accounts.google.com` | Usá Google Identity Services oficial; no aceptamos otros proveedores.
CORS error en el navegador | El origen del frontend no está listado en `FRONTEND_ORIGINS` | Agregá `http://localhost:5173` (dev) y `https://TU_DOMINIO` (prod) a `FRONTEND_ORIGINS`.
Clock skew / Token expirado | Reloj del servidor desincronizado (especialmente en VPC/VM) | Sincronizá con NTP (`ntpdate`, `chronyd`, etc.) para ancho <5s.
`email_verified=false` en la respuesta | La cuenta de Google no tiene email verificado | Usá otra cuenta, verificá el email en Google o vinculá con una cuenta existente ya verificada.
El botón aparece pero no funciona y el backend responde 403 | No se puede leer `GOOGLE_CLIENT_ID` en el backend o hay mismatch | Confirmá el valor en `backend/.env` y reiniciá el servicio; el health `/api/auth/google/status` debe mostrar `google_client_id_configured=true`.
El botón aparece, el backend responde OK pero el usuario no ve cambios | El `first_name`/`last_name` no cambian porque las columnas vienen vacías | `GOOGLE_LOGIN` solo sincroniza si el valor nuevo difiere de lo actual; podés forzar el cambio editando el usuario en Django Admin.

## Deploy checklist (Google login)
1. Configurá los “Authorized JavaScript origins” en Google Cloud (por ejemplo `http://localhost:5173` para dev y `https://app.tu-dominio.com` en prod).
2. Creá el OAuth client tipo Web Application y copialo en `GOOGLE_CLIENT_ID` y `VITE_GOOGLE_CLIENT_ID`.
3. Poné `ENABLE_GOOGLE_LOGIN=true` en `backend/.env` y `VITE_ENABLE_GOOGLE=true` en `frontend/.env` (mantener `false` offline).
4. Asegurate de que `FRONTEND_ORIGINS` incluye tanto los dominios de dev (`http://localhost:5173`) como de prod (`https://app.tu-dominio.com`).
5. Instalá las dependencias del backend (`pip install -r backend/requirements.txt`) para que `google-auth` esté disponible.
6. Reiniciá Django/Daphne (o el WSGI) y el dev server/build del frontend para recargar envs.
7. Ejecutá el smoke test descrito arriba y confirmá que `/api/auth/google/status` devuelve `true` en `google_login_enabled` y `google_client_id_configured`.
8. Verificá que el login clásico (`/api/auth/login`) sigue funcionando (mismo flujo sin tocar).
9. Recorre la sección de Troubleshooting si aparece algún `invalid token`, `aud mismatch`, issuer reject o CORS repeat.
10. Documentá en el release (o en el deploy ticket) los valores reales usados y los pasos seguidos.

## Smoke test manual
1. Asegurate de tener `google-auth` instalado (`./venv/bin/python -m pip install -r backend/requirements.txt`) para que `GOOGLE_AUTH_AVAILABLE` sea `True`.
2. Arrancá el backend y el dev server (`npm run dev` o equivalente) con `ENABLE_GOOGLE_LOGIN=true` y `VITE_ENABLE_GOOGLE=true`.
3. Abrí `/login` y confirmá que el botón dice “Continuar con Google”.
4. Hacé click y completá el flujo con una cuenta de Google válida.
5. En la respuesta del backend `/api/auth/google` deberías ver `{"access": "...", "refresh": "...", "user": {...}}`. Verificá en los logs (o agregá temporalmente un `logger.info("google login", extra={"email": email})`) que el email recibido es el esperado, sin loguear tokens.
6. En el frontend confirmá que el usuario queda autenticado (por ejemplo, se redirige al dashboard y el header muestra su nombre).
7. Si el usuario ya existía, revisá que `first_name`/`last_name` se actualicen si cambiaron en Google; si no existía, confirmá que se creó.

## Tests con dependencias instaladas
- Cuando tengás acceso a PyPI, ejecutá `./venv/bin/python -m pip install -r backend/requirements.txt` y luego `./venv/bin/python manage.py test accounts`. Eso hace que `GOOGLE_AUTH_AVAILABLE` sea `True` y los tests que dependen de Google se ejecuten.
## Media/archivos
- Producción: serví media desde CDN/bucket o Nginx (location `/media/` apuntando a `MEDIA_ROOT`). Dejá `SERVE_MEDIA_FILES=false` (default) y poné `MEDIA_URL` al endpoint público del CDN.
- Solo si querés que Django sirva media en prod (no recomendado), definí `SERVE_MEDIA_FILES=true` **y** `ALLOW_SERVE_MEDIA_IN_PROD=true`.
- Límite de subida configurable vía `MEDIA_MAX_UPLOAD_MB` (default 10 MB) que aplica a `DATA_UPLOAD_MAX_MEMORY_SIZE` y `FILE_UPLOAD_MAX_MEMORY_SIZE`.

### Estrategia de media para recibos y fotos
- En producción no dejés que Django sirva archivos directamente; usá un CDN/bucket (S3, Backblaze B2, DigitalOcean Spaces) y apuntá `MEDIA_URL` al endpoint público (por ejemplo `https://cdn.sancayetano.com/media/`).
- Configurá `MEDIA_ROOT` solo si necesitás subir archivos en el filesystem local (por ejemplo en staging). Para entornos con CDN, la carpeta local puede seguir como `/home/app/backend/media` pero la URL pública queda en `MEDIA_URL`.
- Preferí un almacenamiento compatible con `django-storages` + `boto3` si usás S3. Entonces definí `DEFAULT_FILE_STORAGE` (p. ej. `storages.backends.s3boto3.S3Boto3Storage`) y las credenciales (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_STORAGE_BUCKET_NAME`, `AWS_S3_REGION_NAME`).
- Si vas a servir `MEDIA_URL` desde Django en staging/QA, habilitá `SERVE_MEDIA_FILES=true` y `ALLOW_SERVE_MEDIA_IN_PROD=true` *solo* en entornos controlados. Asegurate de que `MEDIA_ROOT` apunte al directorio que usará Django y de que el servidor web tenga permisos de lectura/escritura.
- Verificá que las URLs devueltas por los endpoints `/api/payments/*/receipts` y `/api/quotes/share/<token>` construyan rutas absolutas usando `request.build_absolute_uri`; esos links solo funcionarán si el archivo es accesible desde el URL configurado.

## Throttling / rate limiting
- Global: `anon` y `user` (configurables por env).
- Scopes específicos:
  - `login` para `/api/auth/login`
  - `reset` para `/api/auth/password/reset` y `/api/auth/password/reset/confirm`
  - `register` para `/api/auth/register`
  - `quotes` para `/api/quotes/*`
  Ajustá los límites vía `API_THROTTLE_LOGIN`, `API_THROTTLE_RESET`, `API_THROTTLE_REGISTER`, `API_THROTTLE_QUOTES`.

## Checklist de producción
Tomá `backend/.env.example` como base y completá las variables obligatorias (ver arriba). Además:
- Base de datos: este proyecto usa SQLite (`backend/db.sqlite3`) por defecto. Si realmente necesitás Postgres, agregá `DB_ENGINE`/`DB_NAME`/... y documentalo, pero las pruebas locales sólo usan el archivo.  
- JWT: `JWT_SIGNING_KEY` (o usa `DJANGO_SECRET_KEY`) para tokens válidos.
- Seguridad: `SESSION_COOKIE_SECURE=true`, `CSRF_COOKIE_SECURE=true`, `SECURE_SSL_REDIRECT=true`, `SECURE_HSTS_SECONDS` > 0 en prod.

## Frontend endpoint verification

Dentro de `frontend/` existe `scripts/verify-endpoints.js` que compara las rutas consumidas con `frontend_backend_contract.md`. Antes de push, ejecutá:

```
cd frontend
npm install
npm run verify:endpoints
STRICT=1 npm run verify:endpoints
```

La variante `STRICT=1` falla si el código usa interpolaciones dinámicas (p. ej. `` `/policies/${id}` ``) sin documentarlas; el modo sin `STRICT` solo advierte. Este paso se usa para que `frontend_backend_contract.md` siga siendo la fuente de verdad.

## Frontend API base URL

- Durante el desarrollo local (`import.meta.env.DEV === true`), el frontend busca `VITE_API_BASE_URL`, `VITE_API_URL` o `VITE_API_BASE` (en ese orden). Si no encuentra ninguna, usa `http://127.0.0.1:8000/api`, lo que deja trabajar con un backend local sin cambiar la configuración.
- En producción (`import.meta.env.DEV === false`), el valor por defecto es la misma-origin `/api` y nunca salta hacia `localhost` o `127.0.0.1`. Si necesitás pegar a un backend externo podes definir `VITE_API_BASE_URL=https://api.tu-dominio.com/api`.
- Si alguien setea `VITE_API_BASE_URL` a `localhost`/`127.0.0.1` y construye para producción, la compilación falla con un mensaje claro: no permitimos que el bundle apunte a un backend local en ese entorno.

## Flujo operativo (cotización manual → póliza → asociación)
1. El cliente completa un formulario de cotización (información del vehículo + fotos) y lo envía al WhatsApp del negocio; no hay endpoint público automatizado para inspecciones.
2. El responsable (admin) revisa ese formulario externamente y, desde el panel de administración, crea la póliza correspondiente, establece el monto y comparte con el cliente el **número de póliza** asignado.
3. El cliente se registrará y, desde la sección **Asociar póliza** (`GET /claim-policy`), ingresará apenas ese número. El backend solo valida que exista la póliza y no esté vinculada a otro usuario, sin requerir códigos adicionales.
4. Una vez asociada, el cliente puede pagar (`POST /api/payments/policies/{id}/create_preference`) y consultar recibos (`/api/payments/.../receipts`); Mercado Pago reporta a `/api/payments/webhook` con `MP_WEBHOOK_SECRET`.
5. Los admins siguen pudiendo actualizar cuotas y reenviar onboarding (`POST /api/auth/onboarding/resend`), pero ya no hay `claim_code` obligatorio para asociar una póliza.
