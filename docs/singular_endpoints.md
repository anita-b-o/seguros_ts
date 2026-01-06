# Inventario de endpoints singulares

## Backend

### `/api/accounts/users/me`
- **Ruta real:** `/api/accounts/users/me` (incluida via `backend/accounts/urls.py:19-24` en `backend/seguros/urls.py:44-50` con `DefaultRouter(trailing_slash=False)`).
- **View/handler:** `UserViewSet.me` (`backend/accounts/views.py:48-69`). También hay una versión admin bajo `/api/admin/accounts/users/me` (ver `AdminUserViewSet.me` en `backend/accounts/views.py:81-89`) que obliga a `IsAdminUser`.
- **Requiere auth:** Sí (`permissions.IsAuthenticated()` para el usuario regular, `IsAdminUser` para la variante admin).
- **Ejemplo curl:** `curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/accounts/users/me`
- **Alias:** `/api/accounts/users/me/` responde al mismo handler sin hacer redirect, y la variante admin `/api/admin/accounts/users/me/` también está disponible.
- **Notas:** el router sin barra final mantiene el path firme para que coincida con los caminos "singulares" documentados en frontend; admite `GET`, `PATCH` y `PUT`.

### `/api/auth/google/status`
- **Ruta real:** `/api/auth/google/status` (registrada en `backend/seguros/urls.py:44-52`).
- **View/handler:** `GoogleLoginStatusView.get` (`backend/accounts/auth_views.py:745-761`).
- **Requiere auth:** No (permite `AllowAny`, pero responde 404 si `ENABLE_GOOGLE_LOGIN` no está activado).
- **Ejemplo curl:** `curl http://localhost:8000/api/auth/google/status`
- **Alias:** `/api/auth/google/status/` responde con el mismo payload sin redirección.
- **Notas:** el endpoint expone `google_login_enabled`, `google_client_id_configured` y `google_auth_available` para validar la configuración de Google sin revelar el client ID.

### `/healthz/`
- **Ruta real:** `/healthz/` (definida en `backend/seguros/urls.py:15-39`).
- **View/handler:** función `healthcheck` (`backend/seguros/urls.py:15-21`).
- **Requiere auth:** No.
- **Ejemplo curl:** `curl http://localhost:8000/healthz/`
- **Alias:** `/healthz` (sin slash) responde el mismo `{"status": "ok"}` sin redirección.
- **Notas:** devuelve `{"status": "ok"}` y se usa como chequeo básico de disponibilidad.

### `/api/accounts/profile` (profile)
- **Ruta real:** _No hay definición en los módulos `urls.py`/routers/views`_. Las búsquedas por `"profile"` no arrojan ningún handler en `backend/`.
- **View/handler:** n/a.
- **Requiere auth:** n/a (pendiente de implementación).
- **Ejemplo curl:** n/a.
- **Notas:** el único endpoint de usuario que existe es `/api/accounts/users/me`; la cadena `/accounts/profile` aparece únicamente en el frontend (`frontend/src/api/endpoints.js:3`) como constante sin consumo asociado.

### `/whoami`
- **Ruta real:** no definida (no se encuentra en `backend/` ni en routers ni vistas).
- **View/handler:** n/a.
- **Requiere auth:** n/a.
- **Ejemplo curl:** n/a.
- **Notas:** no hay trazos de `whoami` en el backend; si el frontend lo llegara a necesitar, habrá que exponer un handler nuevo o mapearlo a `/api/accounts/users/me`.

### `/current`
- **Ruta real:** no definida en el backend.
- **View/handler:** n/a.
- **Requiere auth:** n/a.
- **Ejemplo curl:** n/a.
- **Notas:** el término aparece en la solicitud del inventario pero no existe ninguna ruta ni vista que responda a `/current`. De momento, el único punto de contacto con la sesión actual es `/api/accounts/users/me`.

## Frontend

### Contexto general
- `frontend/src/api/endpoints.js` exporta las constantes de rutas singulares y `ensureSingularNoTrailingSlash`, que simplemente elimina barras finales del literal. No hay listas de rutas especiales ni lógica condicional.
- `frontend/src/api.js` ejecuta un único interceptor donde `ensureTrailingSlashForUrl` obliga a que todas las llamadas a `/api/*` terminen en `/` (assets como `.png`/`.css` quedan afuera). Ese mismo interceptor agrega `Authorization` si el request requiere autenticación.

### `/api/accounts/users/me` (`USERS_ME`)
- **Archivo + función:** `frontend/src/hooks/useAuth.js`:
  - `PROFILE_ENDPOINT = ensureSingularNoTrailingSlash(USERS_ME)` y `getCurrentUser()` hacen `api.get(PROFILE_ENDPOINT)` (`frontend/src/hooks/useAuth.js:13-39`).
  - `hydrateUser()` (efecto de arranque) y `login()` (después de recibir tokens) llaman a `getCurrentUser()` para poblar el usuario actual.
- **URL exacta construida:** `GET /api/accounts/users/me` sobre la instancia `api` (que ya incluye `API_BASE` y los headers necesarios).
- **Interceptor/normalizador:** la petición pasa por `frontend/src/api.js`, donde `ensureTrailingSlashForUrl` agrega `/` a cualquier llamada API antes de que el interceptor inyecte `Authorization`.
- **Notas adicionales:** `frontend/tests/e2e/logout.spec.js:28-42` también intercepta `**/api/accounts/users/me` para simular la respuesta del perfil.

### `/accounts/profile` (`ACCOUNTS_PROFILE`)
- **Archivo + función:** solo `frontend/src/api/endpoints.js:3-7` define la constante; no hay consumidores en runtime ni tests que la invoquen.
- **URL exacta construida:** ninguna (aún no se usa; el path singular sigue en el conjunto para cuando se agregue un handler backend).
- **Interceptor/normalizador:** se aplica la regla general del normalizador (`ensureTrailingSlashForUrl`) que mantiene `/` en cualquier endpoint API no estático.

### `/auth/google/status` (`AUTH_GOOGLE_STATUS`)
- **Archivo + función:** se exporta desde `frontend/src/api/endpoints.js:5`, pero no hay llamadas que lo consuman ni tests que lo verifiquen.
- **URL exacta construida:** sin llamadas, no se arma un request actual.
- **Interceptor/normalizador:** la llamada pasa por el mismo interceptor global y recibe `/` al final porque ya no hay whitelist.
- **Notas:** sí se refiere en la documentación (`README.md`) como smoke-check de Google login, pero no hay integración en JS.

### Búsqueda por `/me`, `/status`, `/whoami`, `/current`
- Se ejecutaron búsquedas (`rg -n "/me"`, `rg -n "profile"`, `rg -n "/status"`, `rg -n "whoami"`, `rg -n "current"`) dentro de `frontend/src` y no se encontraron requests activos (solo comentarios, constantes y clases CSS).
- Por ahora las únicas rutas concretas consumidas son `/api/accounts/users/me` (y las derivadas de OAuth en la documentación); el resto de nombres singulares no tienen representaciones HTTP en el frontend.
