# Desplegar InfoCRM

El proyecto está empaquetado como **un solo servicio**: la API Fastify sirve
también el panel y corre las migraciones al arrancar. Así el despliegue es un
contenedor + una base de datos Postgres.

- Panel + API: el contenedor (puerto 4000).
- Base de datos: Postgres gestionado (Neon, Supabase, Railway…).
- El **servidor MCP** (`mcp/`) no se despliega: corre en tu ordenador apuntando
  a la URL pública de la API.

---

## Paso 1 · Subir el código a GitHub

> Desde esta sesión no puedo **crear** el repositorio (está limitada a repos ya
> configurados). Créalo tú una vez y, si quieres, yo empujo el código; o empuja
> tú con los comandos de abajo.

1. En GitHub, crea un repo **vacío** (sin README): `benjaminelias-jpg/infocrm`,
   privado.
2. Dale acceso a la App de Claude: github.com → Settings → Applications →
   Claude → Repository access → añade `infocrm`.
3. Empuja (el repo ya tiene los commits hechos en la rama `master`):

```bash
cd infocrm
git remote add origin https://github.com/benjaminelias-jpg/infocrm.git
git push -u origin master
```

Si prefieres que empuje yo, avísame cuando el repo exista y tenga acceso la App.

---

## Paso 2 · Desplegar

### Opción A — Railway (recomendada, la más simple)

1. railway.app → **New Project** → **Deploy from GitHub repo** → elige `infocrm`.
   Railway detecta el `Dockerfile` y construye.
2. En el proyecto, **+ New → Database → PostgreSQL**. Railway crea la base y la
   variable `DATABASE_URL`.
3. En el servicio de la app, pestaña **Variables**, añade:
   - `DATABASE_URL` → referencia la del Postgres de Railway (`${{Postgres.DATABASE_URL}}`).
   - `JWT_SECRET` → un secreto largo: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   - `API_URL` y `APP_URL` → la URL pública que te da Railway (p. ej. `https://infocrm-production.up.railway.app`).
4. **Deploy**. Al arrancar corre las migraciones solo. Abre la URL: verás el login.

### Opción B — Render

1. render.com → **New → Web Service** → conecta el repo → entorno **Docker**.
2. **New → PostgreSQL** (Render) y copia su *Internal Database URL*.
3. En el Web Service → **Environment**: `DATABASE_URL`, `JWT_SECRET`, `API_URL`,
   `APP_URL` (la URL de Render).
4. Create Web Service.

### Opción C — Un VPS tuyo (Docker)

```bash
git clone https://github.com/benjaminelias-jpg/infocrm.git
cd infocrm
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  docker compose up --build -d
```

Panel + API en el puerto 4000. Pon un Nginx/Caddy delante para HTTPS.

> **Sobre Vercel**: encaja para el panel estático, pero esta API es un servicio
> con estado (webhooks entrantes, despacho en segundo plano) que vive mejor en un
> host de proceso largo como Railway o Render. Por eso recomiendo A o B.

---

## Paso 3 · Crear tu cuenta real

El despliegue arranca con la base **vacía** (sin datos de demo). Crea tu cuenta
de administrador una vez, contra tu URL pública:

```bash
curl -X POST https://TU-URL/api/auth/registro \
  -H 'content-type: application/json' \
  -d '{
    "cuenta": "Mi Academia",
    "nombre": "Benjamín",
    "email": "tu@email.com",
    "password": "una-contraseña-larga",
    "ig_username": "tu_usuario_ig"
  }'
```

La respuesta trae ya tus tres webhooks de entrada listos. Entra en el panel con
ese email y contraseña.

---

## Paso 4 · Apuntar ManyChat y tu Claude a la URL pública

- **ManyChat / Calendly / pasarela**: en **Conexiones** del panel tienes las URLs
  de webhook con tu dominio público. Pégalas donde toque (ya no `localhost`).
- **Tu Claude (MCP)**: en `mcp/README.md`, pon `INFOCRM_API_URL=https://TU-URL` y
  una API key que generes en **Conexiones → Claves de API**.

---

## Notas

- Las migraciones se aplican solas en cada arranque; son aditivas e idempotentes.
- Para datos de demo en un entorno de pruebas: `cd server && npm run seed` (NO en
  producción: crea la cuenta demo@infocrm.app).
- Copia de seguridad: el host gestiona los backups del Postgres; actívalos.
- `JWT_SECRET` debe ser estable: si cambia, caducan todas las sesiones.
